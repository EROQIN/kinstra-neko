// 轻量日志：分级 + 环形缓冲（面板查看最近日志），不引第三方日志库（2G 内存友好）。

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_ENTRIES = 500

export interface LogEntry {
  t: number
  level: LogLevel
  area: string
  msg: string
}

export interface Logger {
  debug(msg: string): void
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  child(area: string): Logger
}

export interface LogSink {
  level: LogLevel
  recent(limit?: number, filter?: { level?: string; area?: string }): LogEntry[]
}

class LogBoard implements LogSink {
  level: LogLevel = process.env.KINSTRA_NEKO_LOG === 'debug' ? 'debug' : 'info'
  private entries: LogEntry[] = []

  push(e: LogEntry): void {
    this.entries.push(e)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
  }

  recent(limit = 300, filter: { level?: string; area?: string } = {}): LogEntry[] {
    let out = this.entries
    if (filter.level) {
      const n = ORDER[filter.level as LogLevel] ?? 0
      out = out.filter((e) => ORDER[e.level] >= n)
    }
    if (filter.area) out = out.filter((e) => e.area.includes(filter.area!))
    return out.slice(-limit)
  }
}

export const logBoard = new LogBoard()

export function createLogger(area = 'core'): Logger {
  const make = (level: LogLevel) => (msg: string) => {
    if (ORDER[level] < ORDER[logBoard.level]) return
    const text = String(msg ?? '')
    logBoard.push({ t: Date.now(), level, area, msg: text })
    const line = `[${new Date().toISOString().slice(11, 19)}] ${level.toUpperCase()} ${area} | ${text}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  return {
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    child: (a: string) => createLogger(a),
  }
}
