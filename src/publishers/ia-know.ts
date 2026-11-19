import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Knowledge } from '../shared/types.js'
import { cfg } from '../shared/config.js'
import { listKnowledgeBySource } from '../knowledge/repository.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('publisher:ia-know')

const GENERATED_MD = 'docs/papers/ia-llms.md'
const GENERATED_JSON = 'docs/papers/ia-llms.json'

export interface IaKnowPublishResult {
  repoPath: string
  totalPapers: number
  changed: boolean
  committed: boolean
  pushed: boolean
  commit?: string
}

export interface IaKnowPaper {
  id: string
  title: string
  authors: string[]
  abstract: string
  summary: string
  categories: string[]
  published: string
  updated: string
  url: string
  pdfUrl: string
  importanceScore: number
}

export function buildIaKnowPaperDataset(records: Knowledge[], generatedAt = new Date().toISOString()) {
  const papers = records.map(toIaKnowPaper).sort(comparePapers)
  return {
    schemaVersion: 1,
    generatedAt,
    source: 'pac-memory paper-aggregator',
    total: papers.length,
    papers,
  }
}

export function renderIaKnowPaperMarkdown(records: Knowledge[], generatedAt = new Date().toISOString()): string {
  const dataset = buildIaKnowPaperDataset(records, generatedAt)
  const lines = [
    '# Papers de IA e LLMs',
    '',
    '> Catalogo gerado automaticamente pelo PAC-MEMORY a partir de fontes academicas como arXiv.',
    '',
    `Atualizado em: ${generatedAt}`,
    `Total de papers: ${dataset.total}`,
    '',
    '## Destaques recentes',
    '',
  ]

  if (!dataset.papers.length) {
    lines.push('Nenhum paper coletado ainda.', '')
    return `${lines.join('\n')}\n`
  }

  for (const paper of dataset.papers) {
    lines.push(`### ${paper.title}`)
    lines.push('')
    lines.push(`- **Autores:** ${paper.authors.join(', ') || 'Nao informado'}`)
    lines.push(`- **Publicado:** ${paper.published || 'Nao informado'}`)
    lines.push(`- **Categorias:** ${paper.categories.join(', ') || 'Nao informado'}`)
    lines.push(`- **Links:** [Resumo](${paper.url}) | [PDF](${paper.pdfUrl})`)
    lines.push(`- **Score:** ${(paper.importanceScore * 100).toFixed(0)}%`)
    lines.push('')
    lines.push(paper.summary || paper.abstract)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export async function publishIaKnowPapers(): Promise<IaKnowPublishResult> {
  const repoPath = cfg.iaKnowRepoPath
  ensureIaKnowRepo(repoPath)

  const records = listKnowledgeBySource('paper-aggregator', cfg.paperAggregatorMaxItems)
  const generatedAt = new Date().toISOString()
  writeGeneratedFile(repoPath, GENERATED_MD, renderIaKnowPaperMarkdown(records, generatedAt))
  writeGeneratedFile(repoPath, GENERATED_JSON, `${JSON.stringify(buildIaKnowPaperDataset(records, generatedAt), null, 2)}\n`)

  const changed = git(repoPath, ['status', '--porcelain', '--', GENERATED_MD, GENERATED_JSON]).trim().length > 0
  if (!changed) {
    return { repoPath, totalPapers: records.length, changed: false, committed: false, pushed: false }
  }

  git(repoPath, ['add', GENERATED_MD, GENERATED_JSON])
  git(repoPath, [
    '-c', 'user.name=pac-memory-bot',
    '-c', 'user.email=pac-memory-bot@users.noreply.github.com',
    'commit',
    '-m', `chore: atualiza catalogo de papers (${records.length})`,
  ])
  const commit = git(repoPath, ['rev-parse', '--short', 'HEAD']).trim()
  let pushed = false

  if (cfg.iaKnowAutoPush) {
    const branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    git(repoPath, ['push', buildAuthenticatedRepoUrl(cfg.iaKnowRepoUrl), `HEAD:${branch}`])
    pushed = true
  }

  log.info({ repoPath, totalPapers: records.length, commit, pushed }, 'IA Know paper dataset published')
  return { repoPath, totalPapers: records.length, changed: true, committed: true, pushed, commit }
}

function toIaKnowPaper(record: Knowledge): IaKnowPaper {
  const metadata = record.metadata
  return {
    id: stringMetadata(metadata.paperId) || record.title,
    title: record.title.replace(/^\[arXiv]\s*/, ''),
    authors: stringArrayMetadata(metadata.authors),
    abstract: extractAbstract(record.content),
    summary: record.summary || extractAbstract(record.content),
    categories: stringArrayMetadata(metadata.categories),
    published: stringMetadata(metadata.published),
    updated: stringMetadata(metadata.updated),
    url: stringMetadata(metadata.url),
    pdfUrl: stringMetadata(metadata.pdfUrl),
    importanceScore: record.importance_score,
  }
}

function comparePapers(left: IaKnowPaper, right: IaKnowPaper): number {
  const rightDate = Date.parse(right.published || right.updated || '')
  const leftDate = Date.parse(left.published || left.updated || '')
  if (!Number.isNaN(rightDate) && !Number.isNaN(leftDate) && rightDate !== leftDate) {
    return rightDate - leftDate
  }
  return right.importanceScore - left.importanceScore
}

function extractAbstract(content: string): string {
  return content.split('\n\n')[0]?.trim() ?? content.trim()
}

function stringMetadata(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArrayMetadata(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function ensureIaKnowRepo(repoPath: string): void {
  let isRepo: boolean
  try {
    git(repoPath, ['rev-parse', '--is-inside-work-tree'])
    isRepo = true
  } catch {
    isRepo = false
  }

  if (!isRepo) {
    git('.', ['clone', buildAuthenticatedRepoUrl(cfg.iaKnowRepoUrl), repoPath])
    return
  }

  const branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  git(repoPath, ['fetch', '--prune', 'origin'])
  git(repoPath, ['pull', '--rebase', '--autostash', 'origin', branch])
}

function writeGeneratedFile(repoPath: string, relativePath: string, content: string): void {
  const fullPath = join(repoPath, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

function buildAuthenticatedRepoUrl(repoUrl: string): string {
  if (!cfg.githubToken || !repoUrl.startsWith('https://github.com/')) return repoUrl
  return repoUrl.replace('https://github.com/', `https://x-access-token:${encodeURIComponent(cfg.githubToken)}@github.com/`)
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
