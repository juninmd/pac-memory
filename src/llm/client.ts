import { cfg } from '../shared/config.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('llm-client')

export interface LlmTextResponse {
  content: string
  provider: 'ollama'
  model: string
  raw: string
}

export async function generateText(prompt: string): Promise<LlmTextResponse> {
  return liteLlmGenerate(prompt)
}

async function liteLlmGenerate(prompt: string): Promise<LlmTextResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.litellmTimeoutMs)

  try {
    const response = await fetch(new URL('/v1/chat/completions', cfg.litellmBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.litellmApiKey ? { authorization: `Bearer ${cfg.litellmApiKey}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.litellmModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    })

    if (!response.ok) {
      throw new Error(`LiteLLM returned HTTP ${response.status}`)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>
      error?: { message?: string } | string
    }
    if (data.error) {
      const message = typeof data.error === 'string' ? data.error : data.error.message
      throw new Error(message ?? 'LiteLLM returned an unknown error')
    }

    return {
      content: (data.choices?.[0]?.message?.content ?? '').trim(),
      provider: 'ollama',
      model: cfg.litellmModel,
      raw: JSON.stringify(data),
    }
  } catch (err) {
    log.warn({ err, model: cfg.litellmModel, baseUrl: cfg.litellmBaseUrl }, 'LiteLLM generation failed')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
