// ─── PAC-MEMORY :: Terminal Dashboard ─────────────────────────────────────

const API = ''
let ws = null
let knowledgeOffset = 0
const LIMIT = 30
let startTime = Date.now()

// ─── WebSocket ─────────────────────────────────────────────────────────────

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws`)

  ws.onopen = () => {
    setWsStatus(true)
    appendLog('connected', 'WebSocket connected to pac-memory', 'success')
  }

  ws.onclose = () => {
    setWsStatus(false)
    appendLog('system', 'WebSocket disconnected. Retrying in 3s...', 'error')
    setTimeout(connectWS, 3000)
  }

  ws.onerror = () => {
    appendLog('system', 'WebSocket error', 'error')
  }

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      handleWsMessage(msg)
    } catch (_e) {
      appendLog('ws', evt.data, 'log')
    }
  }
}

function handleWsMessage(msg) {
  const { event, data } = msg
  if (event === 'agent') {
    const cls = data.status === 'completed' ? 'success' : data.status === 'failed' ? 'error' : 'agent'
    appendLog(`agent:${data.name}`, `${data.status}${data.count ? ' — ' + data.count + ' items' : ''}${data.error ? ' ERROR: ' + data.error : ''}`, cls)
    refreshAgents()
    refreshStats()
  } else if (event === 'evolution') {
    appendLog(`evolution:${data.phase}`, `${data.feature ? data.feature + ' — ' : ''}${data.status}`, 'evolution')
    refreshEvolution()
    refreshDigest()
  } else if (event === 'connected') {
    appendLog('system', data.message, 'success')
  }
}

function setWsStatus(online) {
  const el = document.getElementById('ws-status')
  if (online) {
    el.textContent = '● ONLINE'
    el.className = 'badge badge-online'
  } else {
    el.textContent = '● OFFLINE'
    el.className = 'badge badge-offline'
  }
}

// ─── Log ───────────────────────────────────────────────────────────────────

function appendLog(source, msg, type = 'log') {
  const list = document.getElementById('log-list')
  const div = document.createElement('div')
  div.className = 'log-entry'
  const now = new Date().toTimeString().slice(0, 8)
  const cls = { agent: 'log-agent', evolution: 'log-evolution', error: 'log-error', success: 'log-success' }[type] || ''
  div.innerHTML = `<span class="log-ts">${now}</span><span class="log-msg ${cls}">[${source}] ${escHtml(msg)}</span>`
  list.prepend(div)
  // Keep max 200 entries
  while (list.children.length > 200) list.removeChild(list.lastChild)
}

function bindClick(id, fn) {
  const el = document.getElementById(id)
  if (el) el.addEventListener('click', fn)
}

function bindKey(id, key, fn) {
  const el = document.getElementById(id)
  if (el) {
    el.addEventListener('keydown', (ev) => {
      if (ev.key === key) fn()
    })
  }
}

bindClick('btn-clear-log', () => {
  const logList = document.getElementById('log-list')
  if (logList) logList.innerHTML = ''
})

// ─── Knowledge ─────────────────────────────────────────────────────────────

async function loadKnowledge(reset = false) {
  if (reset) { knowledgeOffset = 0; document.getElementById('knowledge-list').innerHTML = '' }
  const cat = document.getElementById('cat-filter').value
  const url = `/api/knowledge?limit=${LIMIT}&offset=${knowledgeOffset}${cat ? '&category=' + encodeURIComponent(cat) : ''}`
  const data = await fetchJson(url)
  if (!data) return
  renderKnowledgeItems(data.items)
  knowledgeOffset += data.items.length
  refreshStats(data.total)
}

function renderKnowledgeItems(items) {
  const list = document.getElementById('knowledge-list')
  for (const item of items) {
    const div = document.createElement('div')
    div.className = 'knowledge-item'
    const score = (item.importance_score * 100).toFixed(0)
    // Show summary in preview if available, otherwise content
    const preview = (item.summary || item.content).slice(0, 180) + ((item.summary || item.content).length > 180 ? '…' : '')
    div.innerHTML = `
      <div class="ki-header">
        <span class="ki-cat">${escHtml(item.category)}</span>
        <span class="ki-title">${escHtml(item.title)}</span>
        <span class="ki-score">${score}%</span>
      </div>
      <div class="ki-content">${escHtml(preview)}</div>
      <div class="ki-source">↳ ${escHtml(item.source)} · ${item.updated_at?.slice(0,16) ?? ''}</div>
    `
    div.addEventListener('click', () => showKnowledgeDetail(item))
    list.appendChild(div)
  }
}

function showKnowledgeDetail(item) {
  const modal = document.getElementById('modal-overlay')
  const title = document.getElementById('modal-title')
  const summary = document.getElementById('modal-summary')
  const original = document.getElementById('modal-original')
  const source = document.getElementById('modal-source')
  const category = document.getElementById('modal-category')
  const updated = document.getElementById('modal-updated')

  title.textContent = `// ${item.title.toUpperCase()}`
  summary.textContent = item.summary || 'Nenhum resumo disponível para esta entrada.'
  original.textContent = item.content
  source.textContent = item.source
  category.textContent = item.category
  updated.textContent = item.updated_at

  modal.classList.remove('hidden')
  loadRelatedKnowledge(item.id)
}

// Modal Close logic
bindClick('modal-close', () => {
  document.getElementById('modal-overlay').classList.add('hidden')
})

const modalOverlay = document.getElementById('modal-overlay')
if (modalOverlay) {
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.add('hidden')
    }
  })
}

bindClick('btn-load-more', () => loadKnowledge())
const catFilter = document.getElementById('cat-filter')
if (catFilter) {
  catFilter.addEventListener('change', () => loadKnowledge(true))
}

// ─── Search ────────────────────────────────────────────────────────────────

async function doSearch() {
  const searchInput = document.getElementById('search-input')
  if (!searchInput) return

  const query = searchInput.value.trim()
  if (!query) { loadKnowledge(true); return }

  const data = await fetchJson('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 30 }),
  })
  if (!data) return

  const knowledgeList = document.getElementById('knowledge-list')
  if (knowledgeList) knowledgeList.innerHTML = ''
  renderKnowledgeItems(data.items)
  appendLog('search', `"${query}" → ${data.items.length} results`, 'agent')
}

const searchBtn = document.getElementById('search-btn')
const searchInputEl = document.getElementById('search-input')
const qaButton = document.getElementById('btn-qa')
const qaInputEl = document.getElementById('qa-input')

if (searchBtn) searchBtn.addEventListener('click', doSearch)
if (searchInputEl) searchInputEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') doSearch()
})
if (qaButton) qaButton.addEventListener('click', doQa)
if (qaInputEl) qaInputEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') doQa()
})

bindClick('btn-run-collect', () => runControlTask('collect'))
bindClick('btn-run-evolve', () => runControlTask('evolve'))
bindClick('btn-export-md', () => {
  location.href = '/api/export/digest?format=markdown'
})

async function doQa() {
  const qaInput = document.getElementById('qa-input')
  const output = document.getElementById('qa-output')
  const sources = document.getElementById('qa-sources')
  if (!qaInput || !output || !sources) return

  const question = qaInput.value.trim()
  if (!question) {
    output.textContent = 'Digite uma pergunta para obter resposta.'
    sources.innerHTML = ''
    return
  }

  output.textContent = '⟳ consultando o conhecimento…'
  sources.innerHTML = ''

  const data = await fetchJson('/api/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, limit: 6 }),
  })

  if (!data) {
    output.textContent = 'Erro ao consultar o servidor.'
    return
  }

  if (data.error) {
    output.textContent = `Erro: ${data.error}`
    return
  }

  output.textContent = data.answer || 'Nenhuma resposta gerada.'
  if (data.sources && data.sources.length) {
    sources.innerHTML = '<div class="qa-sources-title">Fontes usadas:</div>' + data.sources.map((src) => {
      return `<div class="qa-source-item">• ${escHtml(src.title)} <span class="qa-source-meta">[${escHtml(src.category)}] ${escHtml(src.source)}</span></div>`
    }).join('')
  } else {
    sources.innerHTML = ''
  }
}
// ─── Agents ────────────────────────────────────────────────────────────────

async function refreshAgents() {
  const data = await fetchJson('/api/agents/status')
  if (!data) return
  const list = document.getElementById('agent-list')
  list.innerHTML = ''

  const agentMap = {}
  for (const run of data.runs) {
    if (!agentMap[run.agent_name] || run.id > agentMap[run.agent_name].id) {
      agentMap[run.agent_name] = run
    }
  }

  const statCount = Object.keys(agentMap).length
  document.getElementById('stat-agents').textContent = statCount

  for (const [name, run] of Object.entries(agentMap)) {
    const row = document.createElement('div')
    row.className = 'agent-row'
    const statusCls = `agent-status agent-${run.status}`
    row.innerHTML = `
      <span class="agent-name">${escHtml(name)}</span>
      <span class="${statusCls}">${run.status}</span>
      <span class="agent-count">${run.items_collected ?? 0}</span>
    `
    list.appendChild(row)
  }
}

bindClick('btn-refresh-agents', refreshAgents)

// ─── Evolution ─────────────────────────────────────────────────────────────

async function refreshEvolution() {
  const data = await fetchJson('/api/evolution/log?limit=15')
  if (!data) return
  const list = document.getElementById('evolution-list')
  list.innerHTML = ''
  document.getElementById('stat-evolutions').textContent = data.log.length

  for (const entry of data.log) {
    const div = document.createElement('div')
    div.className = 'evo-entry'
    const fileName = entry.generated_file?.split(/[\\/]/).pop() || entry.trigger_reason
    div.innerHTML = `
      <div class="evo-file ${`evo-status-${entry.status}`}">[${entry.status}] ${escHtml(fileName)}</div>
      <div class="evo-reason">${escHtml(entry.trigger_reason)} · ${entry.created_at?.slice(0,16) ?? ''}</div>
    `
    list.appendChild(div)
  }
}

// ─── Intelligence Digest ─────────────────────────────────────────────────

async function refreshDigest() {
  const data = await fetchJson('/api/intelligence/digest')
  if (!data) return

  const avg = Math.round((data.averageImportance || 0) * 100)
  const critical = data.insights.filter((insight) => insight.severity === 'critical').length
  const warning = data.insights.filter((insight) => insight.severity === 'warning').length
  const health = critical ? 'CRITICAL' : warning ? 'WATCH' : 'OK'

  document.getElementById('stat-total').textContent = data.total
  document.getElementById('stat-value').textContent = `${avg}%`
  document.getElementById('stat-health').textContent = health
  document.getElementById('intel-categories').textContent = data.categories.length
  document.getElementById('intel-sources').textContent = data.sources.length
  document.getElementById('intel-stale').textContent = data.freshness.staleCount

  renderInsights(data.insights)
  renderTopKnowledge(data.topKnowledge)
}

function renderInsights(insights) {
  const list = document.getElementById('insight-list')
  if (!list) return
  list.innerHTML = ''

  for (const insight of insights.slice(0, 4)) {
    const div = document.createElement('div')
    div.className = `insight insight-${insight.severity}`
    div.innerHTML = `
      <div class="insight-title">${escHtml(insight.title)}</div>
      <div class="insight-detail">${escHtml(insight.detail)}</div>
      <div class="insight-action">${escHtml(insight.action)}</div>
    `
    list.appendChild(div)
  }
}

function renderTopKnowledge(items) {
  const list = document.getElementById('top-knowledge-list')
  if (!list) return
  list.innerHTML = ''

  for (const item of items.slice(0, 6)) {
    const button = document.createElement('button')
    button.className = 'top-item'
    button.innerHTML = `
      <span>${escHtml(item.title)}</span>
      <small>${escHtml(item.category)} · ${Math.round(item.importance_score * 100)}%</small>
    `
    button.addEventListener('click', () => showKnowledgeDetail(item))
    list.appendChild(button)
  }
}

async function loadRelatedKnowledge(id) {
  const related = document.getElementById('modal-related')
  if (!related) return
  related.textContent = 'Carregando relacionados...'

  const data = await fetchJson(`/api/knowledge/${id}/related?limit=6`)
  if (!data || !data.items.length) {
    related.textContent = 'Nenhuma entrada relacionada encontrada.'
    return
  }

  related.innerHTML = data.items.map((item) => {
    return `<button class="related-item" data-id="${item.id}">
      <span>${escHtml(item.title)}</span>
      <small>${escHtml(item.category)} · ${escHtml(item.source)}</small>
    </button>`
  }).join('')

  for (const button of related.querySelectorAll('.related-item')) {
    const relatedItem = data.items.find((item) => String(item.id) === button.dataset.id)
    if (relatedItem) button.addEventListener('click', () => showKnowledgeDetail(relatedItem))
  }
}

async function runControlTask(task) {
  appendLog('control', `starting ${task}...`, 'agent')
  const data = await fetchJson(`/api/control/${task}`, { method: 'POST' })
  if (data?.accepted) {
    appendLog('control', `${task} accepted by server`, 'success')
  }
}

// ─── AI Suggestions ────────────────────────────────────────────────────────

bindClick('btn-suggest', async () => {
  const suggestInput = document.getElementById('suggest-input')
  const out = document.getElementById('suggest-output')
  if (!suggestInput || !out) return

  const query = suggestInput.value.trim()
  if (!query) {
    out.textContent = ''
    return
  }

  out.textContent = '⟳ thinking...'

  const data = await fetchJson('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 5 }),
  })

  if (!data || !data.items.length) {
    out.textContent = 'No relevant knowledge found.'
    return
  }

  const context = data.items.map(i => `[${i.category}] ${i.title}\n${i.content.slice(0, 300)}`).join('\n\n---\n\n')
  out.textContent = `Found ${data.items.length} relevant entries:\n\n${context}`
})

bindKey('suggest-input', 'Enter', () => {
  const btn = document.getElementById('btn-suggest')
  if (btn) btn.click()
})

// ─── Stats ──────────────────────────────────────────────────────────────────

async function refreshStats(knowledgeTotal) {
  if (knowledgeTotal !== undefined) {
    document.getElementById('stat-total').textContent = knowledgeTotal
    return
  }
  const data = await fetchJson('/api/knowledge/stats')
  if (data) document.getElementById('stat-total').textContent = data.total
}

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false })
}

function updateUptime() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0')
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
  const s = String(elapsed % 60).padStart(2, '0')
  document.getElementById('stat-uptime').textContent = `${h}:${m}:${s}`
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function fetchJson(url, options) {
  try {
    const resp = await fetch(url, options)
    const text = await resp.text()
    const json = text ? JSON.parse(text) : null
    if (!resp.ok) {
      appendLog('api', `HTTP ${resp.status} on ${url}${json?.error ? ` - ${json.error}` : ''}`, 'error')
      return json
    }
    return json
  } catch (err) {
    appendLog('api', `Fetch error: ${err.message}`, 'error')
    return null
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function init() {
  connectWS()
  await loadKnowledge(true)
  await refreshAgents()
  await refreshEvolution()
  await refreshStats()
  await refreshDigest()

  updateClock()
  updateUptime()
  setInterval(updateClock, 1000)
  setInterval(updateUptime, 1000)
  setInterval(refreshAgents, 15000)
  setInterval(refreshEvolution, 30000)
  setInterval(refreshDigest, 30000)
  setInterval(refreshStats, 60000)
}

init()
