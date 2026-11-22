import { lookup } from 'dns/promises'
import { isIP } from 'net'

export interface UrlPolicy {
  allowedDomains: Set<string>
  allowHttp: boolean
}

const PRIVATE_V4_RANGES = [
  [10, 0, 0, 0, 10, 255, 255, 255],
  [127, 0, 0, 0, 127, 255, 255, 255],
  [169, 254, 0, 0, 169, 254, 255, 255],
  [172, 16, 0, 0, 172, 31, 255, 255],
  [192, 168, 0, 0, 192, 168, 255, 255],
  [0, 0, 0, 0, 0, 255, 255, 255],
  [224, 0, 0, 0, 239, 255, 255, 255],
]

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '')
}

export function isAllowedDomain(hostname: string, allowedDomains: Set<string>): boolean {
  const normalized = normalizeHostname(hostname)
  for (const domain of allowedDomains) {
    const allowed = normalizeHostname(domain)
    if (normalized === allowed || normalized.endsWith(`.${allowed}`)) {
      return true
    }
  }
  return false
}

export function isPrivateAddress(address: string): boolean {
  const ipVersion = isIP(address)
  if (ipVersion === 4) {
    const parts = address.split('.').map(Number)
    return PRIVATE_V4_RANGES.some(([a, b, c, d, w, x, y, z]) =>
      compareV4(parts, [a, b, c, d]) >= 0 && compareV4(parts, [w, x, y, z]) <= 0
    )
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('ff')
  }

  return false
}

export async function assertSafeFetchUrl(url: string, policy: UrlPolicy): Promise<URL> {
  const parsed = new URL(url)
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`)
  }

  if (parsed.protocol === 'http:' && !policy.allowHttp) {
    throw new Error('HTTP URLs are disabled by policy')
  }

  if (!isAllowedDomain(parsed.hostname, policy.allowedDomains)) {
    throw new Error(`Domain is not allowlisted: ${parsed.hostname}`)
  }

  const addresses = await lookup(parsed.hostname, { all: true, verbatim: true })
  if (!addresses.length) {
    throw new Error(`Hostname did not resolve: ${parsed.hostname}`)
  }

  for (const address of addresses) {
    if (isPrivateAddress(address.address)) {
      throw new Error(`Resolved address is blocked by SSRF policy: ${address.address}`)
    }
  }

  return parsed
}

const MAX_REDIRECTS = 3

/** fetch that re-checks the policy on every redirect hop instead of letting fetch follow them blindly. */
export async function fetchWithPolicy(url: URL, policy: UrlPolicy, init: RequestInit): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return response
    await response.body?.cancel()
    current = await assertSafeFetchUrl(new URL(location, current).toString(), policy)
  }
  throw new Error(`Too many redirects: ${url.hostname}`)
}

function compareV4(left: number[], right: number[]): number {
  for (let index = 0; index < 4; index += 1) {
    const diff = left[index] - right[index]
    if (diff !== 0) return diff
  }
  return 0
}
