import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { getDb, closeDb } from '../knowledge/database.js'
import { searchKnowledge, listKnowledge, countKnowledge } from '../knowledge/repository.js'
import { runFullCollection, startScheduler } from '../agents/orchestrator.agent.js'
import { startWebServer } from '../web/server.js'
import { analyzeGaps } from '../evolution/gap-analyzer.js'
import { generateCollector } from '../evolution/code-generator.js'
import { deployCollector } from '../evolution/deployer.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('cli')

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
        await runFullCollection()
      }

      startScheduler()
      log.info('System running. Press Ctrl+C to stop.')

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
    await runFullCollection()
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

  .demandCommand(1, 'Please specify a command.')
  .help('h').alias('h', 'help')
  .strict()
  .parseAsync()
  .catch((err: unknown) => {
    log.error({ err }, 'CLI error')
    process.exit(1)
  })
