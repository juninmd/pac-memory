import { describe, it, expect, vi } from 'vitest'
import { summarize } from '../src/knowledge/summarizer.js'
import * as llmClient from '../src/llm/client.js'

vi.mock('../src/llm/client.js', () => ({
  generateText: vi.fn(),
}))

describe('Summarizer', () => {
  it('calls the configured LLM with correct prompt and returns trimmed content', async () => {
    const mockResponse = { content: '  This is a summary.  ', raw: '...' }
    vi.mocked(llmClient.generateText).mockResolvedValue({ ...mockResponse, provider: 'ollama', model: 'test-model' })

    const result = await summarize('Technical Info', 'Detailed technical content about something.')

    expect(llmClient.generateText).toHaveBeenCalledWith(expect.stringContaining('Technical Info'))
    expect(llmClient.generateText).toHaveBeenCalledWith(expect.stringContaining('Detailed technical content'))
    expect(result).toBe('This is a summary.')
  })

  it('returns empty string if the LLM fails', async () => {
    vi.mocked(llmClient.generateText).mockRejectedValue(new Error('API Error'))
    const result = await summarize('T', 'C')
    expect(result).toBe('')
  })
})
