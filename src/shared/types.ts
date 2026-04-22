export interface Knowledge {
  id: number
  title: string
  content: string
  summary: string
  category: string
  source: string
  metadata: Record<string, unknown>
  importance_score: number
  created_at: string
  updated_at: string
}

export type KnowledgeInput = Omit<Knowledge, 'id' | 'created_at' | 'updated_at' | 'summary'> & { summary?: string }

export interface Source {
  id: number
  name: string
  type: 'rss' | 'scrape' | 'system' | 'github' | 'env'
  url?: string
  config: Record<string, unknown>
  last_checked?: string
  is_active: boolean
}

export type SourceInput = Omit<Source, 'id' | 'last_checked'> & { last_checked?: string }

export interface EvolutionLog {
  id: number
  trigger_reason: string
  generated_file: string
  status: 'pending' | 'compiled' | 'deployed' | 'failed'
  gemini_prompt: string
  created_at: string
}

export interface AgentRun {
  id: number
  agent_name: string
  status: 'running' | 'completed' | 'failed'
  items_collected: number
  error?: string
  started_at: string
  finished_at?: string
}

export interface CollectorResult {
  items: KnowledgeInput[]
  agentName: string
}
