// ─── PAC-MEMORY :: Terminal Dashboard ─────────────────────────────────────

const API = ''
let ws = null
let wsRetryDelay = 1000
let knowledgeOffset = 0
let searchMode = false
let currentSearchQuery = ''
let searchDebounceTimer = null
let activeControlTasks = new Set()
let startTime = Date.now()
const LIMIT = 30

// ─── Theme ─────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('pacMemoryTheme', theme)
  document.getElementById('theme-toggle').textContent = theme === 'light' ? '◐' : '◑'
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'dark'
  applyTheme(current === 'dark' ? 'light' : 'dark')
}

document.getElementById('theme-toggle').addEventListener('click', toggleTheme)

// ─── Toast system ──────────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('toast-show'))
  setTimeout(() => {
    toast.classList.remove('toast-show')
    toast.addEventListener('transitionend', () => toast.remove(), { once: true })
  }, duration)
}

// ─── WebSocket ─────────────────────────────────────────────────────────────

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws`)

  ws.onopen = () => {
    wsRetryDelay = 1000
    setWsStatus(true)
    appendLog('system', 'WebSocket conectado ao pac-memory', 'success')
  }

  ws.onclose = () => {
    setWsStatus(false)
    appendLog('system', `Reconectando em ${wsRetryDelay / 1000}s...`, 'error')
    setTimeout(() => {
      wsRetryDelay = Math.min(wsRetryDelay * 2, 30000)
      connectWS()
    }, wsRetryDelay)
  }

  ws.onerror = () => {
    appendLog('system', 'Erro no WebSocket', 'error')
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
    const countStr = data.count ? ` — ${data.count} itens` : ''
    const errStr = data.error ? ` ERRO: ${data.error}` : ''
    appendLog(`agent:${data.name}`, `${data.status}${countStr}${errStr}`, cls)

    if (data.status === 'completed' || data.status === 'failed') {
      const taskKey = `collect`
      if (activeControlTasks.has(taskKey)) {
        activeControlTasks.delete(taskKey)
        setButtonBusy('btn-run-collect', false)
      }
      if (data.status === 'completed' && data.count > 0 && !searchMode) {
        loadKnowledge(true)
      }
      if (data.status === 'failed') {
        showToast(`Agente ${data.name} falhou: ${data.error || 'erro desconhecido'}`, 'error')
      }
    }
    refreshAgents()
    refreshStats()
  } else if (event === 'evolution') {
    appendLog(`evolution:${data.phase}`, `${data.feature ? data.feature + ' — ' : ''}${data.status}`, 'evolution')
    if (data.phase === 'completed' || data.phase === 'failed') {
      activeControlTasks.delete('evolve')
      setButtonBusy('btn-run-evolve', false)
    }
    refreshEvolution()
    refreshDigest()
  } else if (event === 'learn') {
    appendLog(`learn`, `${data.status}${data.count ? ' — ' + data.count + ' itens' : ''}`, data.status === 'failed' ? 'error' : 'success')
    if (data.status === 'completed' || data.status === 'failed') {
      activeControlTasks.delete('learn')
      setButtonBusy('btn-run-learn', false)
    }
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
  div.innerHTML = `<span class="log-ts">${now}</span><span class="log-msg ${cls}">[${escHtml(source)}] ${escHtml(msg)}</span>`
  list.prepend(div)
  while (list.children.length > 300) list.removeChild(list.lastChild)
}

// ─── Knowledge ─────────────────────────────────────────────────────────────

async function loadKnowledge(reset = false) {
  if (reset) {
    knowledgeOffset = 0
    searchMode = false
    currentSearchQuery = ''
    document.getElementById('knowledge-list').innerHTML = ''
  }
  const cat = document.getElementById('cat-filter').value
  const url = `/api/knowledge?limit=${LIMIT}&offset=${knowledgeOffset}${cat ? '&category=' + encodeURIComponent(cat) : ''}`
  const data = await fetchJson(url)
  if (!data) return
  renderKnowledgeItems(data.items, null)
  knowledgeOffset += data.items.length
  updateLoadMoreButton(data.total)
  refreshStats(data.total)
}

function updateLoadMoreButton(total) {
  const btn = document.getElementById('btn-load-more')
  if (!btn) return
  const hasMore = knowledgeOffset < total
  btn.style.display = hasMore ? '' : 'none'
  if (hasMore) btn.textContent = `LOAD MORE (${total - knowledgeOffset} restantes)`
}

function highlightTerms(text, query) {
  if (!query) return escHtml(text)
  const terms = query.trim().split(/\s+/).filter(t => t.length > 1)
  if (!terms.length) return escHtml(text)
  let result = escHtml(text)
  for (const term of terms) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    result = result.replace(re, '<mark class="search-highlight">$1</mark>')
  }
  return result
}

function importanceClass(score) {
  if (score >= 0.8) return 'importance-high'
  if (score >= 0.5) return 'importance-med'
  return 'importance-low'
}

function renderKnowledgeItems(items, query) {
  const list = document.getElementById('knowledge-list')
  for (const item of items) {
    const div = document.createElement('div')
    div.className = 'knowledge-item'
    div.dataset.id = item.id
    const score = (item.importance_score * 100).toFixed(0)
    const scoreClass = importanceClass(item.importance_score)
    const preview = (item.summary || item.content).slice(0, 180) + ((item.summary || item.content).length > 180 ? '…' : '')
    const titleHtml = query ? highlightTerms(item.title, query) : escHtml(item.title)
    const previewHtml = query ? highlightTerms(preview, query) : escHtml(preview)
    div.innerHTML = `
      <div class="ki-header">
        <span class="ki-cat">${escHtml(item.category)}</span>
        <span class="ki-title">${titleHtml}</span>
        <span class="ki-score ${scoreClass}">${score}%</span>
      </div>
      <div class="ki-content">${previewHtml}</div>
      <div class="ki-source">↳ ${escHtml(item.source)} · ${item.updated_at?.slice(0, 16) ?? ''}</div>
    `
    div.tabIndex = 0
    div.setAttribute('role', 'button')
    div.addEventListener('click', () => showKnowledgeDetail(item))
    div.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      ev.preventDefault()
      showKnowledgeDetail(item)
    })
    list.appendChild(div)
  }
}

async function showKnowledgeDetail(item) {
  const modal = document.getElementById('modal-overlay')
  document.getElementById('modal-title').textContent = `// ${item.title.toUpperCase()}`
  document.getElementById('modal-summary').textContent = item.summary || 'Nenhum resumo disponível para esta entrada.'
  document.getElementById('modal-original').textContent = item.content
  document.getElementById('modal-source').textContent = item.source
  document.getElementById('modal-category').textContent = item.category
  document.getElementById('modal-updated').textContent = item.updated_at
  document.getElementById('modal-importance').textContent = `${(item.importance_score * 100).toFixed(0)}%`
  document.getElementById('modal-importance').className = `modal-importance ${importanceClass(item.importance_score)}`

  const deleteBtn = document.getElementById('modal-delete')
  if (deleteBtn) {
    deleteBtn.onclick = () => confirmDeleteKnowledge(item.id, item.title)
  }

  const editBtn = document.getElementById('modal-edit')
  if (editBtn) {
    editBtn.onclick = () => openEditModal(item)
  }

  const copyBtn = document.getElementById('modal-copy')
  if (copyBtn) {
    copyBtn.onclick = () => {
      const text = `${item.title}\n\n${item.summary || item.content}`
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copiado para a área de transferência', 'success', 2000)
        copyBtn.textContent = 'COPIADO'
        setTimeout(() => { copyBtn.textContent = 'COPIAR' }, 2000)
      })
    }
  }

  openDialog(modal, 'modal-close')
  loadRelatedKnowledge(item.id)
}

async function confirmDeleteKnowledge(id, title) {
  if (!confirm(`Excluir "${title}"? Esta ação não pode ser desfeita.`)) return
  const data = await fetchJson(`/api/knowledge/${id}`, { method: 'DELETE', headers: controlHeaders() })
  if (data?.deleted) {
    showToast(`Conhecimento "${title}" excluído.`, 'success')
    closeModal()
    const item = document.querySelector(`.knowledge-item[data-id="${id}"]`)
    if (item) item.remove()
    refreshStats()
    refreshDigest()
  } else {
    showToast('Falha ao excluir entrada.', 'error')
  }
}

// ─── Edit Modal ───────────────────────────────────────────────────────────

function openEditModal(item) {
  editItem = item
  document.getElementById('edit-title').value = item.title
  document.getElementById('edit-category').value = item.category
  document.getElementById('edit-summary').value = item.summary || ''
  document.getElementById('edit-content').value = item.content
  document.getElementById('edit-importance').value = item.importance_score.toFixed(2)
  openDialog(document.getElementById('edit-modal-overlay'), 'edit-title')
}

function closeEditModal() {
  editItem = null
  closeDialog(document.getElementById('edit-modal-overlay'))
}

document.getElementById('edit-cancel').addEventListener('click', closeEditModal)
document.getElementById('edit-modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('edit-modal-overlay')) closeEditModal()
})

document.getElementById('edit-save').addEventListener('click', async () => {
  if (!editItem) return
  const payload = {}
  const title = document.getElementById('edit-title').value.trim()
  const category = document.getElementById('edit-category').value.trim()
  const summary = document.getElementById('edit-summary').value.trim()
  const content = document.getElementById('edit-content').value.trim()
  const importance = parseFloat(document.getElementById('edit-importance').value)

  if (title) payload.title = title
  if (category) payload.category = category
  if (summary !== undefined) payload.summary = summary
  if (content) payload.content = content
  if (!isNaN(importance)) payload.importance_score = importance

  const btn = document.getElementById('edit-save')
  btn.disabled = true
  btn.textContent = 'SALVANDO…'

  const data = await fetchJson(`/api/knowledge/${editItem.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...controlHeaders() },
    body: JSON.stringify(payload),
  })

  btn.disabled = false
  btn.textContent = 'SALVAR'

  if (data?.item) {
    showToast('Entrada atualizada com sucesso.', 'success')
    closeEditModal()
    closeModal()
    if (document.getElementById('cat-filter').value) {
      loadKnowledge(true)
    } else {
      const el = document.querySelector(`.knowledge-item[data-id="${editItem.id}"]`)
      if (el) {
        el.querySelector('.ki-title').textContent = data.item.title
        el.querySelector('.ki-cat').textContent = data.item.category
        const preview = (data.item.summary || data.item.content).slice(0, 180)
        el.querySelector('.ki-content').textContent = preview + (preview.length >= 180 ? '…' : '')
      }
    }
    refreshDigest()
  } else {
    showToast(data?.error || 'Falha ao salvar alterações.', 'error')
  }
})

document.getElementById('modal-close').addEventListener('click', closeModal)
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal()
})

function closeModal() {
  closeDialog(document.getElementById('modal-overlay'))
}

// Remembers who opened each dialog so focus returns there on close (keyboard/screen reader users).
const dialogOpeners = new Map()

function openDialog(overlay, focusId) {
  if (overlay.classList.contains('hidden')) dialogOpeners.set(overlay, document.activeElement)
  overlay.classList.remove('hidden')
  document.getElementById(focusId)?.focus()
}

function closeDialog(overlay) {
  if (overlay.classList.contains('hidden')) return
  overlay.classList.add('hidden')
  const opener = dialogOpeners.get(overlay)
  dialogOpeners.delete(overlay)
  if (opener?.isConnected) opener.focus()
}

document.getElementById('btn-load-more').addEventListener('click', () => {
  if (searchMode && currentSearchQuery) {
    doSearch(false)
  } else {
    loadKnowledge()
  }
})

document.getElementById('cat-filter').addEventListener('change', () => loadKnowledge(true))

// ─── Dynamic categories ────────────────────────────────────────────────────

async function loadCategoryOptions() {
  const data = await fetchJson('/api/knowledge/stats')
  if (!data?.byCategory?.length) return
  const select = document.getElementById('cat-filter')
  // Clear existing options except "ALL"
  while (select.options.length > 1) select.remove(1)
  for (const { category, count } of data.byCategory) {
    const opt = document.createElement('option')
    opt.value = category
    opt.textContent = `${category} (${count})`
    select.appendChild(opt)
  }
}

// ─── Search with debounce ──────────────────────────────────────────────────

function scheduleSearch() {
  clearTimeout(searchDebounceTimer)
  const query = document.getElementById('search-input').value.trim()
  if (!query) {
    if (searchMode) loadKnowledge(true)
    return
  }
  searchDebounceTimer = setTimeout(() => doSearch(true), 350)
}

async function doSearch(reset = true) {
  const query = document.getElementById('search-input').value.trim()
  if (!query) { loadKnowledge(true); return }

  if (reset) {
    knowledgeOffset = 0
    currentSearchQuery = query
    searchMode = true
    document.getElementById('knowledge-list').innerHTML = ''
  }

  const data = await fetchJson('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: LIMIT, offset: knowledgeOffset }),
  })
  if (!data) return

  renderKnowledgeItems(data.items, query)
  knowledgeOffset += data.items.length
  updateLoadMoreButton(data.total ?? data.items.length)

  if (reset) appendLog('search', `"${query}" → ${data.total ?? data.items.length} resultados`, 'agent')
}

document.getElementById('search-btn').addEventListener('click', () => doSearch(true))
document.getElementById('search-input').addEventListener('input', scheduleSearch)
document.getElementById('search-input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { clearTimeout(searchDebounceTimer); doSearch(true) }
  if (ev.key === 'Escape') { document.getElementById('search-input').value = ''; loadKnowledge(true) }
})

// ─── Q&A ───────────────────────────────────────────────────────────────────

document.getElementById('btn-qa').addEventListener('click', doQa)
document.getElementById('qa-input').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') doQa()
})

async function doQa() {
  const qaInput = document.getElementById('qa-input')
  const output = document.getElementById('qa-output')
  const sources = document.getElementById('qa-sources')
  const question = qaInput.value.trim()

  if (!question) {
    output.textContent = 'Digite uma pergunta para obter resposta.'
    sources.innerHTML = ''
    return
  }

  const dots = ['⟳', '⟳⟳', '⟳⟳⟳']
  let dotIdx = 0
  output.innerHTML = '<span class="spinner">⟳</span> consultando o conhecimento…'
  sources.innerHTML = ''
  document.getElementById('btn-qa').disabled = true
  const spinnerTimer = setInterval(() => {
    dotIdx = (dotIdx + 1) % dots.length
    const el = output.querySelector('.spinner')
    if (el) el.textContent = dots[dotIdx]
  }, 400)

  const data = await fetchJson('/api/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, limit: 6 }),
  })

  clearInterval(spinnerTimer)
  document.getElementById('btn-qa').disabled = false

  if (!data) {
    output.textContent = 'Erro ao consultar o servidor.'
    return
  }
  if (data.error) {
    output.textContent = `Erro: ${data.error}`
    showToast(data.error, 'error')
    return
  }

  if (data.warning) {
    output.innerHTML = `<span class="qa-warning">⚠ ${escHtml(data.warning)}</span>\n\n${escHtml(data.answer || '')}`
  } else {
    output.textContent = ''
    await typewrite(output, data.answer || 'Nenhuma resposta gerada.', 18)
  }

  if (data.llmUsed === false && !data.warning) {
    output.innerHTML = `<span class="qa-warning">⚠ LLM indisponível — fontes locais:</span>\n\n${escHtml(data.answer)}`
  }

  if (data.sources?.length) {
    sources.innerHTML = '<div class="qa-sources-title">Fontes consultadas:</div>' +
      data.sources.map((src) =>
        `<div class="qa-source-item" style="cursor:pointer" data-id="${src.id}">• ${escHtml(src.title)} <span class="qa-source-meta">[${escHtml(src.category)}] ${escHtml(src.source)}</span></div>`
      ).join('')

    for (const el of sources.querySelectorAll('[data-id]')) {
      el.addEventListener('click', async () => {
        const r = await fetchJson(`/api/knowledge/${el.dataset.id}`)
        if (r?.item) showKnowledgeDetail(r.item)
      })
    }
  }
}

async function typewrite(el, text, cps = 25) {
  el.textContent = ''
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i]
    if (i % cps === 0) await sleep(16)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Control tasks ─────────────────────────────────────────────────────────

function setButtonBusy(id, busy) {
  const btn = document.getElementById(id)
  if (!btn) return
  btn.disabled = busy
  btn.classList.toggle('cmd-busy', busy)
}

document.getElementById('btn-run-collect').addEventListener('click', () => runControlTask('collect', 'btn-run-collect'))
document.getElementById('btn-run-learn').addEventListener('click', () => runControlTask('learn', 'btn-run-learn'))
document.getElementById('btn-run-evolve').addEventListener('click', () => runControlTask('evolve', 'btn-run-evolve'))
document.getElementById('btn-export-md').addEventListener('click', () => {
  location.href = '/api/export/digest?format=markdown'
})
document.getElementById('btn-export-json').addEventListener('click', () => {
  location.href = '/api/export/digest?format=json'
})
document.getElementById('btn-export-csv').addEventListener('click', () => {
  location.href = '/api/export/knowledge?format=csv'
})

document.getElementById('btn-save-control-token').addEventListener('click', () => {
  const input = document.getElementById('control-token-input')
  if (!input) return
  const token = input.value.trim()
  if (token) {
    localStorage.setItem('pacMemoryControlToken', token)
    showToast('Token salvo localmente', 'success', 2000)
    appendLog('control', 'control token salvo', 'success')
  } else {
    localStorage.removeItem('pacMemoryControlToken')
    showToast('Token removido', 'info', 2000)
  }
})

async function runControlTask(task, btnId) {
  if (activeControlTasks.has(task)) {
    showToast(`Tarefa "${task}" já está em execução.`, 'warning')
    return
  }
  activeControlTasks.add(task)
  if (btnId) setButtonBusy(btnId, true)
  appendLog('control', `iniciando ${task}...`, 'agent')

  const data = await fetchJson(`/api/control/${task}`, { method: 'POST', headers: controlHeaders() })
  if (data?.accepted) {
    appendLog('control', `${task} aceito pelo servidor`, 'success')
    showToast(`Tarefa "${task}" iniciada`, 'info')
  } else if (data?.error) {
    appendLog('control', `${task} recusado: ${data.error}`, 'error')
    showToast(data.error, 'error')
    activeControlTasks.delete(task)
    if (btnId) setButtonBusy(btnId, false)
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

  document.getElementById('stat-agents').textContent = Object.keys(agentMap).length

  for (const [name, run] of Object.entries(agentMap)) {
    const row = document.createElement('div')
    row.className = 'agent-row'
    const statusCls = `agent-status agent-${run.status}`
    const ago = run.started_at ? timeAgo(run.started_at) : ''
    row.innerHTML = `
      <span class="agent-name">${escHtml(name)}</span>
      <span class="${statusCls}">${run.status}</span>
      <span class="agent-count">${run.items_collected ?? 0} itens</span>
      <span class="agent-ago">${ago}</span>
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
      <div class="evo-file evo-status-${entry.status}">[${entry.status}] ${escHtml(fileName)}</div>
      <div class="evo-reason">${escHtml(entry.trigger_reason)} · ${entry.created_at?.slice(0, 16) ?? ''}</div>
    `
    list.appendChild(div)
  }
}

// ─── Intelligence Digest ─────────────────────────────────────────────────

async function refreshDigest() {
  const data = await fetchJson('/api/intelligence/digest')
  if (!data) return

  const avg = Math.round((data.averageImportance || 0) * 100)
  const critical = data.insights.filter((i) => i.severity === 'critical').length
  const warning = data.insights.filter((i) => i.severity === 'warning').length
  const health = critical ? 'CRITICAL' : warning ? 'WATCH' : 'OK'
  const healthEl = document.getElementById('stat-health')
  healthEl.textContent = health
  healthEl.className = `stat-value health-${health.toLowerCase()}`

  document.getElementById('stat-total').textContent = data.total
  document.getElementById('stat-value').textContent = `${avg}%`
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
  for (const insight of insights.slice(0, 5)) {
    const div = document.createElement('div')
    div.className = `insight insight-${insight.severity}`
    div.innerHTML = `
      <div class="insight-title">${escHtml(insight.title)}</div>
      <div class="insight-detail">${escHtml(insight.detail)}</div>
      <div class="insight-action">→ ${escHtml(insight.action)}</div>
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
    const scoreClass = importanceClass(item.importance_score)
    button.innerHTML = `
      <span>${escHtml(item.title)}</span>
      <small>${escHtml(item.category)} · <span class="${scoreClass}">${Math.round(item.importance_score * 100)}%</span></small>
    `
    button.addEventListener('click', () => showKnowledgeDetail(item))
    list.appendChild(button)
  }
}

async function loadRelatedKnowledge(id) {
  const related = document.getElementById('modal-related')
  if (!related) return
  related.innerHTML = '<span class="text-dim">Carregando relacionados...</span>'

  const data = await fetchJson(`/api/knowledge/${id}/related?limit=6`)
  if (!data?.items?.length) {
    related.textContent = 'Nenhuma entrada relacionada encontrada.'
    return
  }

  related.innerHTML = data.items.map((item) =>
    `<button class="related-item" data-id="${item.id}">
      <span>${escHtml(item.title)}</span>
      <small>${escHtml(item.category)} · ${escHtml(item.source)}</small>
    </button>`
  ).join('')

  for (const button of related.querySelectorAll('.related-item')) {
    const relatedItem = data.items.find((item) => String(item.id) === button.dataset.id)
    if (relatedItem) button.addEventListener('click', () => showKnowledgeDetail(relatedItem))
  }
}

// ─── LLM Health ─────────────────────────────────────────────────────────────

let llmPanelOpen = false
let editItem = null

async function refreshLlmHealth() {
  const statEl = document.getElementById('stat-llm')
  const wrap = document.getElementById('stat-llm-wrap')
  const statusBar = document.getElementById('llm-status-bar-wrap') // unused, using llm-status-wrap
  if (!statEl) return

  const [health, config] = await Promise.all([
    fetchJson('/api/llm/health'),
    fetchJson('/api/llm/config'),
  ])

  if (!health || !config) {
    statEl.textContent = 'ERR'
    statEl.className = 'stat-value llm-fail'
    return
  }

  const modelShort = (health.model || config.model || '—').split(':')[0].toUpperCase()
  statEl.textContent = health.ok ? modelShort : 'OFFLINE'
  statEl.className = `stat-value ${health.ok ? 'llm-ok' : 'llm-fail'}`

  const tooltip = `${config.provider.toUpperCase()} · ${config.baseUrl} · ${health.latencyMs ?? '?'}ms`
  wrap?.setAttribute('title', tooltip)

  renderLlmPanel(health, config)
}

function renderLlmPanel(health, config) {
  const bar = document.getElementById('llm-status-wrap')
  const label = document.getElementById('llm-status-label')
  const modelsList = document.getElementById('llm-models-list')
  if (!bar || !label || !modelsList) return

  const providerTag = config.provider === 'ollama' ? 'OLLAMA direct' : 'LiteLLM proxy'
  const status = health.ok ? `✓ OK · ${health.latencyMs}ms` : `✗ ${health.error || 'unreachable'}`
  label.innerHTML = `<span class="${health.ok ? 'llm-ok' : 'llm-fail'}">${providerTag}</span> · ${escHtml(config.baseUrl)} · modelo: <strong>${escHtml(health.model || config.model)}</strong> · ${escHtml(status)}`

  modelsList.innerHTML = ''
  if (health.models?.length) {
    const activeModel = (health.model || config.model || '').toLowerCase()
    for (const m of health.models) {
      const tag = document.createElement('span')
      tag.className = `llm-model-tag${m.name.toLowerCase() === activeModel ? ' active-model' : ''}`
      const size = m.details?.parameter_size ? ` (${m.details.parameter_size})` : ''
      tag.textContent = `${m.name}${size}`
      tag.title = `${m.name} · ${formatBytes(m.size)}`
      modelsList.appendChild(tag)
    }
  } else if (config.provider !== 'ollama') {
    const tag = document.createElement('span')
    tag.className = 'llm-model-tag active-model'
    tag.textContent = health.model || config.model
    modelsList.appendChild(tag)
  }

  if (!bar.classList.contains('hidden') || llmPanelOpen) {
    bar.classList.remove('hidden')
  }
}

document.getElementById('stat-llm-wrap')?.addEventListener('click', () => {
  const bar = document.getElementById('llm-status-wrap')
  if (!bar) return
  llmPanelOpen = !llmPanelOpen
  bar.classList.toggle('hidden', !llmPanelOpen)
  if (llmPanelOpen) refreshLlmHealth()
})

function formatBytes(bytes) {
  if (!bytes) return '?'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(0)}MB`
}

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

// ─── Keyboard shortcuts ─────────────────────────────────────────────────────

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    // close only the top-most dialog: Esc while editing must not also drop the detail view
    if (!document.getElementById('edit-modal-overlay').classList.contains('hidden')) closeEditModal()
    else if (!document.getElementById('shortcuts-modal').classList.contains('hidden')) closeShortcutsModal()
    else closeModal()
  }

  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'k') {
    ev.preventDefault()
    document.getElementById('search-input').focus()
    document.getElementById('search-input').select()
  }

  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    const modal = document.getElementById('modal-overlay')
    if (!modal.classList.contains('hidden')) return
    doQa()
  }

  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'e') {
    ev.preventDefault()
    document.getElementById('btn-export-md')?.click()
  }

  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'j') {
    ev.preventDefault()
    document.getElementById('btn-export-json')?.click()
  }

  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'l') {
    ev.preventDefault()
    document.getElementById('log-list').innerHTML = ''
  }

  if (ev.key === '?' && !ev.ctrlKey && !ev.metaKey) {
    const tag = ev.target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    openShortcutsModal()
  }
})

function openShortcutsModal() {
  openDialog(document.getElementById('shortcuts-modal'), 'shortcuts-close')
}
function closeShortcutsModal() {
  closeDialog(document.getElementById('shortcuts-modal'))
}
document.getElementById('shortcuts-close').addEventListener('click', closeShortcutsModal)
document.getElementById('shortcuts-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('shortcuts-modal')) closeShortcutsModal()
})

// ─── Utils ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}m atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

async function fetchJson(url, options) {
  try {
    const resp = await fetch(url, options)
    const text = await resp.text()
    const json = text ? JSON.parse(text) : null
    if (!resp.ok) {
      const errMsg = json?.error || `HTTP ${resp.status}`
      appendLog('api', `${resp.status} em ${url.split('?')[0]} — ${errMsg}`, 'error')
      return json
    }
    return json
  } catch (err) {
    appendLog('api', `Erro de rede: ${err.message}`, 'error')
    return null
  }
}

function controlHeaders() {
  const token = localStorage.getItem('pacMemoryControlToken')
  const headers = {}
  if (token) headers['x-pac-memory-token'] = token
  return headers
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function init() {
  applyTheme(localStorage.getItem('pacMemoryTheme') || 'dark')

  const tokenInput = document.getElementById('control-token-input')
  if (tokenInput) tokenInput.value = localStorage.getItem('pacMemoryControlToken') || ''

  connectWS()

  await Promise.all([
    loadKnowledge(true),
    refreshAgents(),
    refreshEvolution(),
    refreshDigest(),
    loadCategoryOptions(),
    refreshLlmHealth(),
  ])

  updateClock()
  updateUptime()
  setInterval(updateClock, 1000)
  setInterval(updateUptime, 1000)
  setInterval(refreshAgents, 15000)
  setInterval(refreshEvolution, 30000)
  setInterval(refreshDigest, 30000)
  setInterval(refreshStats, 60000)
  setInterval(loadCategoryOptions, 120000)
  setInterval(refreshLlmHealth, 60000)
}

init()
