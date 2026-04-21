import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

const source = 'src/web/public'
const target = 'dist/web/public'

if (!existsSync(source)) {
  throw new Error(`Static web directory not found: ${source}`)
}

mkdirSync(dirname(target), { recursive: true })
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
