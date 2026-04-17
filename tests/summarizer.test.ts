import { describe, it, expect, vi } from 'vitest'
import { summarize } from '../src/knowledge/summarizer.js'
import * as geminiClient from '../src/gemini/client.js'

vi.mock('../src/gemini/client.js', () => ({
  gemini: vi.fn(),
  geminiJson: vi.fn(),
}))

describe('Summarizer', () => {
  it('calls gemini with correct prompt and returns trimmed content', async () => {
    const mockResponse = { content: '  This is a summary.  ', raw: '...' }
    vi.mocked(geminiClient.gemini).mockResolvedValue(mockResponse)

    const result = await summarize('Technical Info', 'Detailed technical content about something.')

    expect(geminiClient.gemini).toHaveBeenCalledWith(expect.stringContaining('Technical Info'))
    expect(geminiClient.gemini).toHaveBeenCalledWith(expect.stringContaining('Detailed technical content'))
    expect(result).toBe('This is a summary.')
  })

  it('returns empty string if gemini fails', async () => {
    vi.mocked(geminiClient.gemini).mockRejectedValue(new Error('API Error'))
    const result = await summarize('T', 'C')
    expect(result).toBe('')
  })
})
