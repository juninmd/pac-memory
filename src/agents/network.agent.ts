import si from 'systeminformation'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('agent:network')

const PUBLIC_IP_URL = 'https://api.ipify.org?format=json'
const IP_INFO_URL = 'https://ipapi.co'

export async function collectNetworkInfo(): Promise<KnowledgeInput[]> {
  log.info('Collecting network information')
  const items: KnowledgeInput[] = []

  const [ifaces, stats] = await Promise.allSettled([
    si.networkInterfaces(),
    si.networkStats(),
  ])

  if (ifaces.status === 'fulfilled') {
    const active = (Array.isArray(ifaces.value) ? ifaces.value : [ifaces.value])
      .filter((i: { operstate: string }) => i.operstate === 'up')
    items.push({
      title: 'Network Interfaces',
      content: active.map((i: { ifaceName: string; ip4: string; ip6?: string; mac: string; speed: number | null; type: string }) =>
        `${i.ifaceName}: IPv4=${i.ip4}, IPv6=${i.ip6?.slice(0, 20) ?? 'n/a'}, MAC=${i.mac}, Speed=${i.speed ?? 0}Mbps, Type=${i.type}`
      ).join('\n'),
      category: 'network',
      source: 'network-agent',
      metadata: { count: active.length },
      importance_score: 0.7,
    })
  }

  // Public IP (single outbound request — by design)
  try {
    const resp = await fetch(PUBLIC_IP_URL)
    const { ip } = await resp.json() as { ip: string }

    // Geo lookup
    let geo: Record<string, unknown> = {}
    try {
      const geoResp = await fetch(`${IP_INFO_URL}/${ip}/json`)
      geo = await geoResp.json() as Record<string, unknown>
    } catch { /* optional */ }

    items.push({
      title: 'Public IP Address',
      content: `Public IP: ${ip}, Country: ${geo['country_name'] ?? 'unknown'}, City: ${geo['city'] ?? 'unknown'}, ISP: ${geo['org'] ?? 'unknown'}`,
      category: 'network',
      source: 'network-agent',
      metadata: { ip, ...geo },
      importance_score: 0.8,
    })
  } catch (err) {
    log.warn({ err }, 'Could not fetch public IP')
  }

  if (stats.status === 'fulfilled') {
    const s = Array.isArray(stats.value) ? stats.value[0] : stats.value
    if (s) {
      items.push({
        title: 'Network Statistics',
        content: `Interface ${s.iface}: RX=${(s.rx_bytes / 1024 ** 2).toFixed(2)}MB, TX=${(s.tx_bytes / 1024 ** 2).toFixed(2)}MB, RX speed=${s.rx_sec}/s, TX speed=${s.tx_sec}/s`,
        category: 'network',
        source: 'network-agent',
        metadata: { rx_bytes: s.rx_bytes, tx_bytes: s.tx_bytes },
        importance_score: 0.4,
      })
    }
  }

  log.info({ count: items.length }, 'Network info collected')
  return items
}
