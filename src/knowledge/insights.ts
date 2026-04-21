import type { Knowledge } from '../shared/types.js'
import {
  countKnowledge,
  getKnowledgeById,
  listAgentRuns,
  listCategories,
  listEvolutionLog,
  listKnowledge,
  listSources,
  searchKnowledge,
} from './repository.js'

export interface KnowledgeInsight {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  action: string
}

export interface KnowledgeDigest {
  generatedAt: string
  total: number
  averageImportance: number
  freshness: {
    newest?: string
    oldest?: string
    staleCount: number
    staleRatio: number
  }
  categories: ReturnType<typeof listCategories>
  sources: ReturnType<typeof listSources>
  topKnowledge: Knowledge[]
  staleKnowledge: Knowledge[]
  recentAgentRuns: ReturnType<typeof listAgentRuns>
  recentEvolutions: ReturnType<typeof listEvolutionLog>
  insights: KnowledgeInsight[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const STALE_DAYS = 14

export function buildKnowledgeDigest(): KnowledgeDigest {
  const all = listKnowledge(undefined, 10_000)
  const total = countKnowledge()
  const categories = listCategories()
  const sources = listSources()
  const now = Date.now()
  const sortedByImportance = [...all].sort((a, b) => b.importance_score - a.importance_score)
  const sortedByUpdated = [...all].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  const staleKnowledge = all
    .filter((item) => now - Date.parse(item.updated_at) > STALE_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
    .slice(0, 20)
  const averageImportance = total
    ? all.reduce((sum, item) => sum + item.importance_score, 0) / total
    : 0

  const digest: KnowledgeDigest = {
    generatedAt: new Date().toISOString(),
    total,
    averageImportance,
    freshness: {
      newest: sortedByUpdated[0]?.updated_at,
      oldest: sortedByUpdated.at(-1)?.updated_at,
      staleCount: staleKnowledge.length,
      staleRatio: total ? staleKnowledge.length / total : 0,
    },
    categories,
    sources,
    topKnowledge: sortedByImportance.slice(0, 10),
    staleKnowledge,
    recentAgentRuns: listAgentRuns(25),
    recentEvolutions: listEvolutionLog(15),
    insights: [],
  }

  digest.insights = generateInsights(digest, all)
  return digest
}

export function findRelatedKnowledge(id: number, limit = 8): Knowledge[] {
  const item = getKnowledgeById(id)
  if (!item) return []

  const query = tokenize(`${item.title} ${safeText(item.summary)} ${item.category}`).slice(0, 8).join(' ')
  const ftsRelated = query ? searchKnowledge(query, limit + 5).filter((candidate) => candidate.id !== id) : []
  const seen = new Set(ftsRelated.map((candidate) => candidate.id))
  const categoryFallback = listKnowledge(item.category, limit + 5)
    .filter((candidate) => candidate.id !== id && !seen.has(candidate.id))

  return [...ftsRelated, ...categoryFallback]
    .sort((a, b) => relatedScore(item, b) - relatedScore(item, a))
    .slice(0, limit)
}

export function exportDigestMarkdown(digest = buildKnowledgeDigest()): string {
  const lines = [
    '# PAC-MEMORY Digest',
    '',
    `Generated: ${digest.generatedAt}`,
    `Knowledge entries: ${digest.total}`,
    `Average importance: ${(digest.averageImportance * 100).toFixed(1)}%`,
    '',
    '## Intelligence Signals',
    ...digest.insights.map((insight) => `- [${insight.severity}] ${insight.title}: ${insight.detail} Action: ${insight.action}`),
    '',
    '## Categories',
    ...digest.categories.map((category) => `- ${category.category}: ${category.count} entries, avg importance ${(category.avg_importance * 100).toFixed(1)}%`),
    '',
    '## Top Knowledge',
    ...digest.topKnowledge.map((item) => `- [${item.category}] ${item.title} (${(item.importance_score * 100).toFixed(0)}%)`),
    '',
    '## Recent Agents',
    ...digest.recentAgentRuns.map((run) => `- ${run.agent_name}: ${run.status}, items=${run.items_collected}, started=${run.started_at}`),
  ]

  return `${lines.join('\n')}\n`
}

function generateInsights(digest: Omit<KnowledgeDigest, 'insights'>, all: Knowledge[]): KnowledgeInsight[] {
  const insights: KnowledgeInsight[] = []

  if (digest.total === 0) {
    insights.push({
      id: 'empty-base',
      severity: 'critical',
      title: 'Base vazia',
      detail: 'Nenhum conhecimento foi coletado ainda.',
      action: 'Execute uma coleta completa pelo cockpit ou CLI.',
    })
    return insights
  }

  if (digest.freshness.staleRatio > 0.35) {
    insights.push({
      id: 'stale-knowledge',
      severity: 'warning',
      title: 'Conhecimento envelhecendo',
      detail: `${digest.freshness.staleCount} entradas estao sem atualizacao ha mais de ${STALE_DAYS} dias.`,
      action: 'Priorize coletores de fontes dinamicas e rode uma nova coleta.',
    })
  }

  const failedRuns = digest.recentAgentRuns.filter((run) => run.status === 'failed').length
  if (failedRuns > 0) {
    insights.push({
      id: 'agent-failures',
      severity: failedRuns >= 3 ? 'critical' : 'warning',
      title: 'Falhas recentes em agentes',
      detail: `${failedRuns} das ultimas execucoes falharam.`,
      action: 'Abra o log de agentes e corrija credenciais, rede ou dependencias externas.',
    })
  }

  const categoryCoverage = digest.categories.length
  if (categoryCoverage < 5) {
    insights.push({
      id: 'low-category-coverage',
      severity: 'info',
      title: 'Cobertura estreita',
      detail: `A base cobre ${categoryCoverage} categorias.`,
      action: 'Use a evolucao para gerar coletores que ampliem dominios pouco representados.',
    })
  }

  const lowSummaryCount = all.filter((item) => !safeText(item.summary).trim()).length
  if (lowSummaryCount > 0) {
    insights.push({
      id: 'missing-summaries',
      severity: 'info',
      title: 'Resumos ausentes',
      detail: `${lowSummaryCount} entradas ainda nao tem resumo.`,
      action: 'Configure o Gemini CLI ou rode enriquecimento posterior quando disponivel.',
    })
  }

  if (digest.averageImportance < 0.45) {
    insights.push({
      id: 'low-importance',
      severity: 'info',
      title: 'Baixa densidade de valor',
      detail: `Importancia media em ${(digest.averageImportance * 100).toFixed(1)}%.`,
      action: 'Ajuste scoring dos coletores e descarte sinais ruidosos.',
    })
  }

  if (!insights.length) {
    insights.push({
      id: 'healthy-base',
      severity: 'info',
      title: 'Base saudavel',
      detail: 'Os sinais locais nao indicam problemas relevantes.',
      action: 'Continue coletando e revise oportunidades de evolucao semanalmente.',
    })
  }

  return insights
}

function relatedScore(base: Knowledge, candidate: Knowledge): number {
  const baseTokens = new Set(tokenize(`${base.title} ${safeText(base.summary)} ${base.category}`))
  const candidateTokens = new Set(tokenize(`${candidate.title} ${safeText(candidate.summary)} ${candidate.category}`))
  let overlap = 0
  for (const token of candidateTokens) {
    if (baseTokens.has(token)) overlap += 1
  }

  const categoryBonus = base.category === candidate.category ? 3 : 0
  return overlap + categoryBonus + candidate.importance_score
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
