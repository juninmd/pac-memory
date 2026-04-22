import { describe, expect, it } from 'vitest'
import { isAllowedDomain, isPrivateAddress, normalizeHostname } from '../src/security/url-policy.js'

describe('URL policy', () => {
  it('normalizes hostnames', () => {
    expect(normalizeHostname('WWW.OpenAI.com')).toBe('openai.com')
  })

  it('allows exact domains and subdomains only', () => {
    const allowed = new Set(['example.com'])

    expect(isAllowedDomain('example.com', allowed)).toBe(true)
    expect(isAllowedDomain('docs.example.com', allowed)).toBe(true)
    expect(isAllowedDomain('evil-example.com', allowed)).toBe(false)
  })

  it('blocks private and loopback addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.0.0.5')).toBe(true)
    expect(isPrivateAddress('172.20.1.1')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('::1')).toBe(true)
  })
})
