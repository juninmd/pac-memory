import pino from 'pino'

const level = process.env.LOG_LEVEL ?? 'info'

export const logger = pino({
  level,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
})

export function childLogger(module: string) {
  return logger.child({ module })
}
