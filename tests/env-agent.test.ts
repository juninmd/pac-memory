import { describe, it, expect } from 'vitest'
import { collectEnvVars } from '../src/agents/env.agent.js'

describe('Env Agent', () => {
  it('returns KnowledgeInput items', () => {
    const items = collectEnvVars()
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBeGreaterThan(0)
  })

  it('does not leak sensitive values', () => {
    const SENSITIVE = /KEY|SECRET|TOKEN|PASSWORD|AUTH|PRIVATE|CREDENTIAL|CERT|PWD|PASS/i

    // Inject a fake sensitive env var for testing
    process.env['MY_SECRET_KEY'] = 'super-secret-value-1234'
    process.env['SOME_SAFE_VAR'] = 'hello-world'

    const items = collectEnvVars()
    const allContent = items.map(i => i.content).join('\n')

    // The value must not appear
    expect(allContent).not.toContain('super-secret-value-1234')

    // The safe var should appear
    expect(allContent).toContain('hello-world')

    delete process.env['MY_SECRET_KEY']
    delete process.env['SOME_SAFE_VAR']
  })

  it('has valid category and source on all items', () => {
    const items = collectEnvVars()
    for (const item of items) {
      expect(item.source).toBe('env-agent')
      expect(typeof item.category).toBe('string')
      expect(item.importance_score).toBeGreaterThanOrEqual(0)
      expect(item.importance_score).toBeLessThanOrEqual(1)
    }
  })
})
