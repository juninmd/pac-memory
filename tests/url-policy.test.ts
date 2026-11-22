import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithPolicy, isAllowedDomain, isPrivateAddress, normalizeHostname } from '../src/security/url-policy.js'

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

describe('fetchWithPolicy redirects', () => {
  const policy = { allowedDomains: new Set(['93.184.215.14', '127.0.0.1']), allowHttp: true }
  const strict = { allowedDomains: new Set(['93.184.215.14']), allowHttp: true }
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

  afterEach(() => vi.unstubAllGlobals())

  it('rejects a redirect to a private address and never requests it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect('http://127.0.0.1:8080/meta'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchWithPolicy(new URL('http://93.184.215.14/feed'), policy, {})).rejects.toThrow(/SSRF/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect to a domain outside the allowlist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(redirect('https://evil.test/x')))
    await expect(fetchWithPolicy(new URL('http://93.184.215.14/feed'), strict, {})).rejects.toThrow(/not allowlisted/)
  })

  it('follows a relative redirect inside the allowlist with manual redirect mode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirect('/rss.xml'))
      .mockResolvedValueOnce(new Response('<rss/>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchWithPolicy(new URL('http://93.184.215.14/feed'), strict, {})
    expect(await res.text()).toBe('<rss/>')
    expect(fetchMock.mock.calls[1][0].toString()).toBe('http://93.184.215.14/rss.xml')
    expect(fetchMock.mock.calls.every(([, init]) => init.redirect === 'manual')).toBe(true)
  })

  it('gives up after too many redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => redirect('/loop')))
    await expect(fetchWithPolicy(new URL('http://93.184.215.14/feed'), strict, {})).rejects.toThrow(/Too many redirects/)
  })
})
