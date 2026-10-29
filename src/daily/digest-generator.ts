import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import { listKnowledge, listAgentRuns } from '../knowledge/repository.js'
import { generateTextWithFallback } from '../llm/client.js'

const log = childLogger('daily-digest')

export interface DailyDigestResult {
  date: string
  filePath: string
  summary: string
  newItems: number
}

export async function generateDailyDigest(): Promise<DailyDigestResult> {
  const date = new Date().toISOString().slice(0, 10)
  log.info({ date }, 'Generating daily digest')

  const cutoff = Date.now() - 24 * 3600 * 1000
  // SQLite stores 'YYYY-MM-DD HH:MM:SS' (UTC); comparing it to an ISO string as text is wrong
  // because ' ' sorts before 'T', so same-day items were dropped. Compare parsed timestamps.
  const isRecent = (ts: string): boolean => Date.parse(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`) >= cutoff
  const allItems = listKnowledge(undefined, 5000)
  const newItems = allItems.filter(item => isRecent(item.created_at) || isRecent(item.updated_at))

  const recentRuns = listAgentRuns(20)
  const agentSummary = recentRuns
    .map(r => `  - ${r.agent_name}: ${r.status} (${r.items_collected ?? 0} items)`)
    .join('\n')

  const topItems = newItems
    .sort((a, b) => b.importance_score - a.importance_score)
    .slice(0, 30)

  const topTitles = topItems
    .map(i => `- [${i.category}] ${i.title} (score: ${(i.importance_score * 100).toFixed(0)}%)`)
    .join('\n')

  const prompt = `Você é o sistema pac-memory. Gere um resumo diário em português do que foi aprendido hoje.

Data: ${date}
Novos itens coletados (últimas 24h): ${newItems.length}

Títulos mais relevantes:
${topTitles || '(nenhum item novo)'}

Agentes executados:
${agentSummary || '(sem execuções recentes)'}

Escreva um resumo executivo de 3-5 parágrafos cobrindo:
1. Principais novidades e temas aprendidos
2. Tecnologias e projetos em destaque
3. Insights ou padrões notáveis
4. Sugestões para próximos ciclos de aprendizado

Seja conciso e direto.`

  let summary = buildFallbackSummary(date, newItems.length, topTitles)
  try {
    const result = await generateTextWithFallback(prompt)
    summary = result.content.trim()
  } catch (err) {
    log.warn({ err }, 'LLM unavailable — using structural fallback')
  }

  const content = buildDigestMarkdown(date, newItems.length, summary, topTitles, agentSummary)

  mkdirSync(join(cfg.generatedDir, 'daily'), { recursive: true })
  const filePath = join(cfg.generatedDir, 'daily', `digest-${date}.md`)
  writeFileSync(filePath, content, 'utf-8')
  log.info({ filePath, newItems: newItems.length }, 'Daily digest saved')

  return { date, filePath, summary, newItems: newItems.length }
}

export function getLatestDigest(): { date: string; content: string } | null {
  try {
    const dir = join(cfg.generatedDir, 'daily')
    const files = readdirSync(dir)
      .filter(f => f.startsWith('digest-') && f.endsWith('.md'))
      .sort()
      .reverse()
    if (!files.length) return null
    const content = readFileSync(join(dir, files[0]), 'utf-8')
    const date = files[0].replace('digest-', '').replace('.md', '')
    return { date, content }
  } catch {
    return null
  }
}

function buildFallbackSummary(date: string, count: number, topTitles: string): string {
  return `${count} itens coletados nas últimas 24h em ${date}.\n\n### Destaques\n${topTitles || '(nenhum item novo)'}`
}

function buildDigestMarkdown(
  date: string,
  newItems: number,
  summary: string,
  topTitles: string,
  agentSummary: string
): string {
  return `# PAC-MEMORY — Digest Diário ${date}

Gerado em: ${new Date().toISOString()}
Novos itens (24h): ${newItems}

---

## Resumo Executivo

${summary}

---

## Itens Mais Relevantes

${topTitles || '(nenhum item novo nas últimas 24h)'}

---

## Execuções de Agentes

${agentSummary || '(sem execuções recentes)'}
`
}
