import { spawn } from 'child_process'
import { childLogger } from '../shared/logger.js'

const log = childLogger('validator')

export async function validateTypeScript(filePath: string): Promise<{ valid: boolean; errors: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'pnpm',
      ['exec', 'tsc', '--noEmit', '--skipLibCheck', '--strict', '--target', 'ES2022',
       '--module', 'NodeNext', '--moduleResolution', 'NodeNext', filePath],
      { shell: true }
    )
    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    child.on('close', (code) => {
      const errors = (stdout + stderr).trim()
      if (code === 0) {
        log.info({ filePath }, 'TypeScript validation passed')
        resolve({ valid: true, errors: '' })
      } else {
        log.warn({ filePath, errors }, 'TypeScript validation failed')
        resolve({ valid: false, errors })
      }
    })
    child.on('error', (err) => {
      resolve({ valid: false, errors: err.message })
    })
  })
}
