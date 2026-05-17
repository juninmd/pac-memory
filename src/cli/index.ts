import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { getDb, closeDb } from '../knowledge/database.js'
import { searchKnowledge, listKnowledge, countKnowledge } from '../knowledge/repository.js'
import { runFullCollection } from '../agents/orchestrator.agent.js'
import { startWebServer } from '../web/server.js'
import { analyzeGaps } from '../evolution/gap-analyzer.js'
import { generateCollector } from '../evolution/code-generator.js'
import { deployCollector } from '../evolution/deployer.js'
import { buildKnowledgeDigest, exportDigestMarkdown } from '../knowledge/insights.js'
import { runLearningCycle } from '../learning/cycle.js'
import { childLogger } from '../shared/logger.js'
import { writeFileSync } from 'fs'

const log = childLogger('cli')

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinnerTimer: ReturnType<typeof setInterval> | null = null

function startSpinner(msg: string) {
  let frame = 0
  process.stdout.write(`\r${SPINNER_FRAMES[frame]} ${msg}`)
  spinnerTimer = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length
    process.stdout.write(`\r${SPINNER_FRAMES[frame]} ${msg}`)
  }, 80)
}

function stopSpinner(msg: string, icon: 'ok' | 'fail' | 'info' = 'ok') {
  if (spinnerTimer) {
    clearInterval(spinnerTimer)
    spinnerTimer = null
  }
  const iconStr = icon === 'ok' ? '✓' : icon === 'fail' ? '✗' : '➤'
  process.stdout.write(`\r${iconStr} ${msg}\n`)
}

function logProgress(current: number, total: number, label: string) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  process.stdout.write(`\r  ${label}: ${current}/${total} (${pct}%)`)
}

yargs(hideBin(process.argv))
  .scriptName('pac-memory')
  .usage('$0 <command> [options]')

  .command('start', 'Start the full system (collection + scheduler + web server)', (y) =>
    y.option('no-web', { type: 'boolean', default: false, description: 'Disable web server' })
      .option('no-collect', { type: 'boolean', default: false, description: 'Skip initial collection' }),
    async (args) => {
      log.info('Starting pac-memory system')
      getDb()

      if (!args['no-web']) {
        await startWebServer()
      }

      if (!args['no-collect']) {
        log.info('Running initial full collection...')
        startSpinner('Coletando dados iniciais…')
        await runFullCollection()
        stopSpinner('Coleta inicial completa', 'ok')
      }

      log.info('System running. Scheduling via k8s CronJobs. Press Ctrl+C to stop.')

      process.on('SIGINT', () => {
        log.info('Shutting down...')
        closeDb()
        process.exit(0)
      })
    }
  )

  .command('web', 'Start only the web dashboard', {}, async () => {
    getDb()
    await startWebServer()
    log.info('Web server running. Press Ctrl+C to stop.')
    process.on('SIGINT', () => { closeDb(); process.exit(0) })
  })

  .command('collect', 'Run a one-shot full collection cycle', {}, async () => {
    getDb()
    startSpinner('Coletando dados de todos os agentes…')
    await runFullCollection()
    stopSpinner('Coleção completa', 'ok')
    closeDb()
  })

  .command('status', 'Show knowledge base status', {}, async () => {
    getDb()
    const total = countKnowledge()
    const recent = listKnowledge(undefined, 5)
    console.log(`\nKnowledge entries: ${total}`)
    console.log('\nMost recent:')
    recent.forEach(k => console.log(`  [${k.category}] ${k.title}`))
    console.log()
    closeDb()
  })

  .command('search <query>', 'Search the knowledge base', (y) =>
    y.positional('query', { type: 'string', demandOption: true })
      .option('limit', { type: 'number', default: 10 }),
    async (args) => {
      getDb()
      const results = searchKnowledge(args.query!, args.limit)
      if (!results.length) {
        console.log('No results found.')
      } else {
        results.forEach((r, i) => {
          console.log(`\n[${i + 1}] [${r.category}] ${r.title}`)
          console.log(`    ${r.content.slice(0, 200)}...`)
          console.log(`    ↳ ${r.source} · ${r.updated_at}`)
        })
      }
      closeDb()
    }
  )

  .command('evolve', 'Run one evolution cycle (gap analysis + code generation)', {}, async () => {
    getDb()
    log.info('Starting evolution cycle...')
    const suggestions = await analyzeGaps()
    if (!suggestions.length) {
      console.log('No gaps identified in this cycle.')
      closeDb()
      return
    }

    console.log(`\nFound ${suggestions.length} gap(s):`)
    suggestions.forEach((s, i) => console.log(`  [${i + 1}] ${s.name}: ${s.description}`))

    for (const s of suggestions.slice(0, 2)) {
      console.log(`\nGenerating: ${s.name}...`)
      try {
        const code = await generateCollector(s)
        const { success, filePath } = await deployCollector(s, code)
        console.log(`  ${success ? '✓' : '✗'} ${filePath}`)
      } catch (err) {
        console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    closeDb()
  })

  .command('agents', 'List recent agent runs', {}, async () => {
    getDb()
    const { listAgentRuns } = await import('../knowledge/repository.js')
    const runs = listAgentRuns(20)
    if (!runs.length) { console.log('No agent runs recorded.'); closeDb(); return }
    console.log('\nRecent agent runs:')
    runs.forEach(r => {
      console.log(`  [${r.status.padEnd(9)}] ${r.agent_name.padEnd(15)} items=${r.items_collected} ${r.finished_at ?? 'running'} ${r.error ? '⚠ ' + r.error : ''}`)
    })
    console.log()
    closeDb()
  })

  .command('learn', 'Run a one-shot autonomous internet learning cycle', {}, async () => {
    getDb()
    const result = await runLearningCycle()
    console.log(`\nLearning cycle complete`)
    console.log(`Collected: ${result.collected}`)
    console.log(`Stored: ${result.stored}`)
    console.log(`Blocked sources: ${result.blocked}`)
    result.blockedSources.forEach((blocked) => {
      console.log(`  - ${blocked.source}: ${blocked.reason}`)
    })
    console.log()
    closeDb()
  })

  .command('insights', 'Show local intelligence signals about the knowledge base', {}, async () => {
    getDb()
    const digest = buildKnowledgeDigest()
    console.log(`\nPAC-MEMORY intelligence digest`)
    console.log(`Entries: ${digest.total}`)
    console.log(`Average importance: ${(digest.averageImportance * 100).toFixed(1)}%`)
    console.log(`Stale entries: ${digest.freshness.staleCount}`)
    console.log('\nSignals:')
    digest.insights.forEach((insight) => {
      console.log(`  [${insight.severity}] ${insight.title}`)
      console.log(`    ${insight.detail}`)
      console.log(`    action: ${insight.action}`)
    })
    console.log('\nTop categories:')
    digest.categories.slice(0, 8).forEach((category) => {
      console.log(`  ${category.category.padEnd(16)} ${String(category.count).padStart(4)} avg=${(category.avg_importance * 100).toFixed(0)}%`)
    })
    console.log()
    closeDb()
  })

  .command('mcp', 'Start the MCP server (stdio transport for Claude / AI clients)', {}, async () => {
    const { startMcpServer } = await import('../mcp/server.js')
    await startMcpServer()
  })

  .command('export [file]', 'Export a markdown intelligence digest', (y) =>
    y.positional('file', { type: 'string', default: 'pac-memory-digest.md' }),
    async (args) => {
      getDb()
      const file = args.file as string
      writeFileSync(file, exportDigestMarkdown(), 'utf-8')
      console.log(`Digest exported: ${file}`)
      closeDb()
    }
  )

  .demandCommand(1, 'Please specify a command.')
  .help('h').alias('h', 'help')
  .strict()
  .parseAsync()
  .catch((err: unknown) => {
    log.error({ err }, 'CLI error')
    process.exit(1)
  })
