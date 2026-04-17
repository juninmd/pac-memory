import { spawn } from 'child_process'
import { childLogger } from '../shared/logger.js'
import { cfg } from '../shared/config.js'
import type { GeminiResponse } from '../shared/types.js'

const log = childLogger('gemini-client')

const TIMEOUT_MS = 60_000

export async function gemini(prompt: string, model: string = cfg.geminiModel): Promise<GeminiResponse> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '-m', model, '--output-format', 'text']
    const child = spawn('gemini', args, { shell: false, windowsHide: true })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Gemini CLI timed out after 60s'))
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        log.warn({ code, stderr, model }, 'Gemini CLI exited with error')
        reject(new Error(`Gemini CLI failed (code ${code}): ${stderr.trim()}`))
        return
      }
      resolve({ content: stdout.trim(), raw: stdout })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      const extra = err && typeof err === 'object' && 'code' in err && (err as any).code === 'ENOENT'
        ? 'Gemini CLI não encontrado. Instale @google/gemini-cli globalmente e garanta que o comando gemini esteja no PATH.'
        : `Failed to spawn gemini: ${err.message}. Is @google/gemini-cli installed globally?`
      reject(new Error(extra))
    })
  })
}

export async function geminiJson<T>(prompt: string, model: string = cfg.geminiModel): Promise<T> {
  const args = ['-p', prompt, '-m', model, '--output-format', 'json']
  return new Promise((resolve, reject) => {
    const child = spawn('gemini', args, { shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Timeout')) }, TIMEOUT_MS)

    child.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) { reject(new Error(`Gemini CLI error: ${stderr}`)); return }
      try { resolve(JSON.parse(stdout) as T) }
      catch { reject(new Error(`Invalid JSON from Gemini CLI: ${stdout.slice(0, 200)}`)) }
    })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}
