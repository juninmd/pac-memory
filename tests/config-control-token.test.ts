import { afterEach, describe, expect, it, vi } from 'vitest'

describe('control token', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('never writes the generated token to the log', async () => {
    vi.stubEnv('CONTROL_API_TOKEN', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { cfg } = await import('../src/shared/config.js')

    expect(cfg.controlApiToken).toMatch(/^[0-9a-f]{32}$/)
    expect(warn).toHaveBeenCalled()
    for (const call of warn.mock.calls) {
      expect(call.join(' ')).not.toContain(cfg.controlApiToken)
    }
  })

  it('uses CONTROL_API_TOKEN when set', async () => {
    vi.stubEnv('CONTROL_API_TOKEN', 'from-env')
    const { cfg } = await import('../src/shared/config.js')
    expect(cfg.controlApiToken).toBe('from-env')
  })
})
