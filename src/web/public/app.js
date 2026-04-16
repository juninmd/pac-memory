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

document.getElementById('btn-clear-log').addEventListener('click', () => {
  document.getElementById('log-list').innerHTML = ''
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
    const content = item.content.slice(0, 180) + (item.content.length > 180 ? '…' : '')
    div.innerHTML = `
      <div class="ki-header">
        <span class="ki-cat">${escHtml(item.category)}</span>
        <span class="ki-title">${escHtml(item.title)}</span>
        <span class="ki-score">${score}%</span>
      </div>
      <div class="ki-content">${escHtml(content)}</div>
      <div class="ki-source">↳ ${escHtml(item.source)} · ${item.updated_at?.slice(0,16) ?? ''}</div>
    `
    div.addEventListener('click', () => showKnowledgeDetail(item))
    list.appendChild(div)
  }
}

function showKnowledgeDetail(item) {
  // Display full content in suggest-output panel
  const out = document.getElementById('suggest-output')
  out.textContent = `[${item.category}] ${item.title}\n\n${item.content}\n\nSource: ${item.source}\nUpdated: ${item.updated_at}`
}

document.getElementById('btn-load-more').addEventListener('click', () => loadKnowledge())
document.getElementById('cat-filter').addEventListener('change', () => loadKnowledge(true))

// ─── Search ────────────────────────────────────────────────────────────────

async function doSearch() {
  const query = document.getElementById('search-input').value.trim()
  if (!query) { loadKnowledge(true); return }

  const data = await fetchJson('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 30 }),
  })
  if (!data) return

  document.getElementById('knowledge-list').innerHTML = ''
  renderKnowledgeItems(data.items)
  appendLog('search', `"${query}" → ${data.items.length} results`, 'agent')
}

document.getElementById('search-btn').addEventListener('click', doSearch)
document.getElementById('search-input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') doSearch()
})

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

document.getElementById('btn-refresh-agents').addEventListener('click', refreshAgents)

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

// ─── AI Suggestions ────────────────────────────────────────────────────────

document.getElementById('btn-suggest').addEventListener('click', async () => {
  const query = document.getElementById('suggest-input').value.trim()
  if (!query) return
  const out = document.getElementById('suggest-output')
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

document.getElementById('suggest-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-suggest').click()
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
    if (!resp.ok) { appendLog('api', `HTTP ${resp.status} on ${url}`, 'error'); return null }
    return await resp.json()
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

  updateClock()
  updateUptime()
  setInterval(updateClock, 1000)
  setInterval(updateUptime, 1000)
  setInterval(refreshAgents, 15000)
  setInterval(refreshEvolution, 30000)
  setInterval(refreshStats, 60000)
}

init()
