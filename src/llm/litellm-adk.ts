import { BaseLlm } from '@google/adk'
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk'
import { cfg } from '../shared/config.js'

type LiteLlmRole = 'system' | 'user' | 'assistant' | 'tool'

interface LiteLlmMessage {
  role: LiteLlmRole
  content?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

interface LiteLlmTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

interface LiteLlmChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: LiteLlmMessage['tool_calls']
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: { message?: string } | string
}

export class LiteLlmAdk extends BaseLlm {
  static readonly supportedModels = [/^ollama\//, /^litellm\//]

  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(
    params: {
      model?: string
      baseUrl?: string
      apiKey?: string
      timeoutMs?: number
    } = {}
  ) {
    super({ model: stripLiteLlmPrefix(params.model ?? cfg.litellmModel) })
    this.baseUrl = params.baseUrl ?? cfg.litellmBaseUrl
    this.apiKey = params.apiKey ?? cfg.litellmApiKey
    this.timeoutMs = params.timeoutMs ?? cfg.litellmTimeoutMs
  }

  async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.maybeAppendUserContent(llmRequest)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(new URL('/v1/chat/completions', this.baseUrl), {
        method: 'POST',
        headers: this.headers(),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: toLiteLlmMessages(llmRequest),
          tools: toLiteLlmTools(llmRequest),
          tool_choice: toLiteLlmTools(llmRequest).length ? 'auto' : undefined,
          stream: false,
        }),
      })

      if (!response.ok) {
        throw new Error(`LiteLLM returned HTTP ${response.status}`)
      }

      const data = await response.json() as LiteLlmChatResponse
      if (data.error) {
        const message = typeof data.error === 'string' ? data.error : data.error.message
        throw new Error(message ?? 'LiteLLM returned an unknown error')
      }

      yield toAdkResponse(data)
    } catch (err) {
      yield {
        errorCode: 'LITELLM_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('LiteLLM ADK live connections are not supported')
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
    return headers
  }
}

function stripLiteLlmPrefix(model: string): string {
  return model.startsWith('litellm/') ? model.slice('litellm/'.length) : model
}

function toLiteLlmMessages(llmRequest: LlmRequest): LiteLlmMessage[] {
  const messages: LiteLlmMessage[] = []
  const systemInstruction = stringifyPart(llmRequest.config?.systemInstruction)
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction })
  }

  for (const content of llmRequest.contents) {
    const text = content.parts?.map((part) => stringifyPart(part)).filter(Boolean).join('\n')
    const functionCalls = content.parts?.flatMap((part) => {
      if (!('functionCall' in part) || !part.functionCall?.name) return []
      return [{
        id: part.functionCall.id ?? part.functionCall.name,
        type: 'function' as const,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      }]
    }) ?? []

    const functionResponses = content.parts?.flatMap((part) => {
      if (!('functionResponse' in part) || !part.functionResponse?.name) return []
      return [{
        role: 'tool' as const,
        tool_call_id: part.functionResponse.id ?? part.functionResponse.name,
        content: JSON.stringify(part.functionResponse.response ?? {}),
      }]
    }) ?? []

    messages.push(...functionResponses)
    if (text || functionCalls.length) {
      messages.push({
        role: content.role === 'model' ? 'assistant' : 'user',
        content: text || undefined,
        tool_calls: functionCalls.length ? functionCalls : undefined,
      })
    }
  }

  return messages
}

function toLiteLlmTools(llmRequest: LlmRequest): LiteLlmTool[] {
  return (llmRequest.config?.tools ?? [])
    .flatMap((tool) => 'functionDeclarations' in tool ? tool.functionDeclarations ?? [] : [])
    .map((declaration) => ({
      type: 'function' as const,
      function: {
        name: declaration.name ?? '',
        description: declaration.description,
        parameters: declaration.parameters,
      },
    }))
    .filter((tool) => tool.function.name)
}

function toAdkResponse(data: LiteLlmChatResponse): LlmResponse {
  const choice = data.choices?.[0]
  const message = choice?.message
  const parts = [
    ...(message?.content ? [{ text: message.content }] : []),
    ...(message?.tool_calls ?? []).map((toolCall) => ({
      functionCall: {
        id: toolCall.id,
        name: toolCall.function.name,
        args: parseToolArgs(toolCall.function.arguments),
      },
    })),
  ]

  if (!parts.length) {
    return {
      errorCode: choice?.finish_reason ?? 'EMPTY_RESPONSE',
      errorMessage: 'LiteLLM returned no content.',
    }
  }

  return {
    content: { role: 'model', parts },
    usageMetadata: {
      promptTokenCount: data.usage?.prompt_tokens,
      candidatesTokenCount: data.usage?.completion_tokens,
      totalTokenCount: data.usage?.total_tokens,
    },
    finishReason: choice?.finish_reason as LlmResponse['finishReason'],
  }
}

function stringifyPart(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text
  return ''
}

function parseToolArgs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
