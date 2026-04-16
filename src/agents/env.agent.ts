import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('agent:env')

// Block any key whose name contains these patterns (case-insensitive)
const SENSITIVE_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|AUTH|PRIVATE|CREDENTIAL|CERT|PWD|PASS/i

export function collectEnvVars(): KnowledgeInput[] {
  log.info('Collecting environment variables')
  const items: KnowledgeInput[] = []

  const safeVars: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue
    if (SENSITIVE_PATTERN.test(k)) continue
    safeVars[k] = v
  }

  const grouped: Record<string, Record<string, string>> = {
    'Path & System': {},
    'Node.js': {},
    'User': {},
    'Application': {},
    'Other': {},
  }

  for (const [k, v] of Object.entries(safeVars)) {
    if (['PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA'].some(p => k.toUpperCase() === p)) {
      grouped['Path & System'][k] = v
    } else if (k.startsWith('NODE') || k.startsWith('NPM') || k.startsWith('PNPM')) {
      grouped['Node.js'][k] = v
    } else if (['USERNAME', 'USERPROFILE', 'USERDOMAIN', 'COMPUTERNAME', 'OS'].some(p => k.toUpperCase() === p)) {
      grouped['User'][k] = v
    } else if (['PORT', 'HOST', 'LOG_LEVEL', 'DB_PATH', 'GEMINI_API_KEY', 'GITHUB_TOKEN', 'GITHUB_USERNAME'].includes(k)) {
      grouped['Application'][k] = '***' // redact app-specific
    } else {
      grouped['Other'][k] = v
    }
  }

  for (const [group, vars] of Object.entries(grouped)) {
    const count = Object.keys(vars).length
    if (count === 0) continue
    const content = Object.entries(vars)
      .map(([k, v]) => `${k}=${v.length > 200 ? v.slice(0, 200) + '...' : v}`)
      .join('\n')
    items.push({
      title: `Environment: ${group} (${count} vars)`,
      content,
      category: 'environment',
      source: 'env-agent',
      metadata: { group, count },
      importance_score: group === 'Application' ? 0.6 : 0.4,
    })
  }

  items.push({
    title: 'Environment Summary',
    content: `Total safe env vars: ${Object.keys(safeVars).length}. Sensitive vars filtered (pattern: KEY|SECRET|TOKEN|PASSWORD|AUTH|PRIVATE).`,
    category: 'environment',
    source: 'env-agent',
    metadata: { total: Object.keys(process.env).length, safe: Object.keys(safeVars).length },
    importance_score: 0.5,
  })

  log.info({ count: items.length }, 'Env vars collected')
  return items
}
