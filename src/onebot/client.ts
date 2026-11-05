// OneBot v11 客户端：HTTP 调接口，正向 WebSocket 收事件，断线指数退避自动重连。
// 仅依赖 Node 22+ 自带的 fetch / WebSocket。

import type { EndpointConfig, OneBotEvent, OneBotResponse, OneBotState } from './types.js'
import type { Logger } from '../core/logger.js'

const RECONNECT_MIN = 2000
const RECONNECT_MAX = 30_000
const RETRY_DELAYS = [1000, 3000, 5000]

export class OneBotError extends Error {
  constructor(
    public action: string,
    public data: any,
    public transport = false,
  ) {
    super(`${action} 失败：${data?.message ?? data?.wording ?? data?.retcode ?? '未知错误'}`)
    this.name = 'OneBotError'
  }
}

export interface OneBotClientOptions {
  endpoint: () => EndpointConfig
  onEvent: (event: OneBotEvent) => void
  onState?: (state: OneBotState, detail?: string) => void
  log: Logger
}

interface PendingCall {
  resolve: (v: any) => void
  reject: (e: OneBotError) => void
  timer: NodeJS.Timeout
  action: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function createOneBotClient(opts: OneBotClientOptions) {
  const { endpoint, onEvent, log } = opts
  let ws: WebSocket | null = null
  let stopped = true
  let timer: NodeJS.Timeout | null = null
  let backoff = RECONNECT_MIN
  let state: OneBotState = 'stopped'
  let echoSeq = 0
  const pending = new Map<string, PendingCall>()

  const setState = (s: OneBotState, detail?: string) => {
    if (state === s) return
    state = s
    try { opts.onState?.(s, detail) } catch { /* ignore */ }
  }

  function describeNetError(error: any, ep: EndpointConfig): string {
    const where = ep.httpUrl || ep.wsUrl || '(未配置地址)'
    const why = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error)
    return `连不上 QQ 网关（${where}）：${why}`
  }

  async function callOnce(action: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    const ep = endpoint()
    if (ep.httpUrl) {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (ep.httpToken) headers.authorization = `Bearer ${ep.httpToken}`
        const r = await fetch(`${ep.httpUrl.replace(/\/+$/, '')}/${action}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
          signal: ctrl.signal,
        })
        const j: OneBotResponse = await r.json().catch(() => ({
          status: 'failed' as const, retcode: r.status, data: null as never, message: `HTTP ${r.status}`,
        }))
        if (j.status === 'ok' || j.retcode === 0) return j.data
        throw new OneBotError(action, j)
      } catch (error) {
        if (error instanceof OneBotError) throw error
        // 超时可能消息已发出——绝不重试，避免重复发言
        if ((error as Error).name === 'AbortError') throw new OneBotError(action, { message: '超时' })
        if (ws && ws.readyState === 1) return callWs(action, params, timeoutMs)
        throw new OneBotError(action, { message: describeNetError(error, ep) }, true)
      } finally {
        clearTimeout(t)
      }
    }
    return callWs(action, params, timeoutMs)
  }

  async function call(
    action: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; retries?: number } = {},
  ): Promise<any> {
    const { timeoutMs = 30_000, retries = RETRY_DELAYS.length } = options
    const ep0 = endpoint()
    if (!ep0.httpUrl && !ep0.wsUrl) {
      throw new OneBotError(action, { message: '还没配置 QQ 网关地址' }, true)
    }
    let lastError: OneBotError | null = null
    for (let i = 0; i <= retries; i++) {
      try {
        return await callOnce(action, params, timeoutMs)
      } catch (error) {
        lastError = error as OneBotError
        if (!lastError.transport) throw lastError
        if (i === retries) break
        const wait = RETRY_DELAYS[i] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]!
        log.warn(`${action}：网关暂时连不上，${wait / 1000}s 后重试（${i + 1}/${retries}）`)
        await sleep(wait)
      }
    }
    throw lastError
  }

  function callWs(action: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    if (!ws || ws.readyState !== 1) {
      return Promise.reject(new OneBotError(action, { message: '没连上 QQ 网关' }, true))
    }
    const echo = `kn-${Date.now()}-${++echoSeq}`
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(echo)
        reject(new OneBotError(action, { message: '超时' }))
      }, timeoutMs)
      pending.set(echo, { resolve, reject, timer: t, action })
      ws!.send(JSON.stringify({ action, params, echo }))
    })
  }

  function connect(): void {
    if (stopped) return
    const ep = endpoint()
    if (!ep.wsUrl) {
      setState('unconfigured', '没有 WS 地址')
      schedule()
      return
    }
    setState('connecting')
    let url = ep.wsUrl
    if (ep.wsToken) url += (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(ep.wsToken)
    let sock: WebSocket
    try {
      sock = new WebSocket(url)
    } catch (error) {
      log.warn(`WS 连接失败：${(error as Error).message}`)
      schedule()
      return
    }
    ws = sock
    // 连接超时守卫：WS 服务尚未监听（NapCat 还在登录）时首次连接可能一直挂在
    // CONNECTING 且不一定触发 onclose（Node 全局 WebSocket 真机实测），没有它重连
    // 永不启动、状态永久卡在 connecting。到点未 open 就主动关闭，由 onclose 走退避重连。
    const openTimer = setTimeout(() => {
      try { sock.close() } catch { /* ignore */ }
    }, 10_000)
    sock.onopen = () => {
      clearTimeout(openTimer)
      backoff = RECONNECT_MIN
      setState('connected')
      log.info('已连上 QQ 网关（WS）')
    }
    sock.onmessage = (ev) => {
      let data: any
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8'))
      } catch { return }
      if (data && data.echo && pending.has(data.echo)) {
        const p = pending.get(data.echo)!
        pending.delete(data.echo)
        clearTimeout(p.timer)
        if (data.status === 'ok' || data.retcode === 0) p.resolve(data.data)
        else p.reject(new OneBotError(p.action, data))
        return
      }
      if (data && data.post_type) {
        try { onEvent(data as OneBotEvent) } catch (error) { log.warn(`处理事件出错：${(error as Error).message}`) }
      }
    }
    sock.onclose = (ev) => {
      clearTimeout(openTimer)
      if (ws === sock) ws = null
      for (const [k, p] of pending) {
        clearTimeout(p.timer)
        p.reject(new OneBotError(p.action, { message: '连接断开' }, true))
        pending.delete(k)
      }
      if (!stopped) {
        setState('disconnected', `code ${ev?.code ?? ''}`)
        schedule()
      }
    }
    sock.onerror = () => { /* close 会跟着触发 */ }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(connect, backoff)
    backoff = Math.min(RECONNECT_MAX, backoff * 2)
  }

  return {
    call,
    start() {
      if (!stopped) return
      stopped = false
      backoff = RECONNECT_MIN
      connect()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      setState('stopped')
      try { ws?.close() } catch { /* ignore */ }
      ws = null
    },
    restart() {
      this.stop()
      this.start()
    },
    get state() { return state },
  }
}

export type OneBotClient = ReturnType<typeof createOneBotClient>
