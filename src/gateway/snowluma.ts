// SnowLuma 管理：检测用户自己安装的副本、后台启停、读它的 OneBot 配置、只给机器人号注入。
//
// 合规红线（SnowLuma EULA 5.4）：不下载、不打包、不替用户同意协议——
// 一键安装器只引导用户自行下载；本管理器只操作"用户已安装并已同意协议"的那一份。
// 永远不开 hookAutoLoad；注入前按 /api/processes 的 account.uin 核对，只注入机器人小号。

import { spawn, execFile } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import type { EndpointConfig } from '../onebot/types.js'
import type { Logger } from '../core/logger.js'

export const SNOWLUMA_DOWNLOAD_PAGE = 'https://github.com/SnowLuma/SnowLuma/releases/latest'

export interface SnowLumaConfigView {
  dir: string
  autoStart: boolean
  autoAttach: boolean
  webuiPort: number
  webuiPassword: string
  httpUrl: string
  wsUrl: string
  httpToken: string
  wsToken: string
}

function readJsonSafe(file: string): any {
  try {
    let t = readFileSync(file, 'utf8')
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
    return JSON.parse(t)
  } catch { return null }
}

export function detectInstall(dir: string): { installed: boolean; reason?: string; dir?: string; entry?: string; runtime?: string; version?: string } {
  const d = String(dir ?? '').trim()
  if (!d) return { installed: false, reason: '还没填 SnowLuma 目录' }
  const entry = join(d, 'index.mjs')
  if (!existsSync(entry)) return { installed: false, reason: `在 ${d} 里没找到 index.mjs，请确认解压位置` }
  // full 包自带运行时：Windows 是 node.exe，Linux/macOS 是 node
  const candidates = process.platform === 'win32' ? ['node.exe'] : ['node', 'node.exe']
  const runtime = candidates.map((n) => join(d, n)).find((p) => existsSync(p)) ?? ''
  const release = readJsonSafe(join(d, 'release.json')) ?? {}
  return {
    installed: true,
    dir: d,
    entry,
    runtime,
    version: release.version || readJsonSafe(join(d, 'package.json'))?.version || '?',
  }
}

/** 从 SnowLuma 配置读某 QQ 号的 OneBot 地址（onebot_<uin>.json 单号覆盖；mode=snapshot 不叠全局）。 */
export function readOneBotEndpoint(dir: string, uin: string): EndpointConfig & { found: boolean } {
  const cfgDir = join(dir, 'config')
  const global = readJsonSafe(join(cfgDir, 'onebot.json'))
  const per = readJsonSafe(join(cfgDir, `onebot_${uin}.json`))
  const sources = per?.mode === 'snapshot' ? [per] : [global, per].filter(Boolean)
  let http: any = null
  let ws: any = null
  for (const s of sources) {
    const nets = s?.networks || s?.network || {}
    const h = (nets.httpServers || []).find((x: any) => x && x.enable !== false) ?? (nets.httpServers || [])[0]
    const w = (nets.wsServers || nets.webSockets || nets.websocketServers || []).find((x: any) => x && x.enable !== false)
      ?? (nets.wsServers || nets.webSockets || nets.websocketServers || [])[0]
    if (h) http = h
    if (w) ws = w
  }
  const host = (h: any) => (!h || h.host === '0.0.0.0' || h.host === '::' ? '127.0.0.1' : h.host)
  const pathOf = (h: any) => (h.path && h.path !== '/' ? h.path : '')
  return {
    httpUrl: http ? `http://${host(http)}:${http.port}${pathOf(http)}` : '',
    wsUrl: ws ? `ws://${host(ws)}:${ws.port}${pathOf(ws)}` : '',
    httpToken: http?.accessToken ?? '',
    wsToken: ws?.accessToken ?? '',
    found: Boolean(http || ws),
  }
}

export function portOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => { if (done) return; done = true; try { sock.destroy() } catch { /* ignore */ }; resolve(v) }
    const sock = net.connect({ host, port })
    sock.setTimeout(timeoutMs, () => finish(false))
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
  })
}

export async function gatewayHealthy(ep: { httpUrl: string; httpToken: string }, timeoutMs = 1500): Promise<boolean> {
  if (!ep?.httpUrl) return false
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (ep.httpToken) headers.authorization = `Bearer ${ep.httpToken}`
    const r = await fetch(`${ep.httpUrl.replace(/\/+$/, '')}/get_login_info`, {
      method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(timeoutMs),
    })
    const j = await r.json().catch(() => null)
    return Boolean(j && (j.status === 'ok' || j.retcode === 0))
  } catch { return false }
}

const uinOf = (p: any): string => {
  const u = String(p?.account?.uin ?? p?.uin ?? '').trim()
  return u === '0' ? '' : u
}

export function pickBotProcess(list: any[], botUin: string, exclude: number[] = []): { proc: any | null; reason: string; unverified?: boolean } {
  const bot = String(botUin)
  const mine = (list || []).filter((p) => uinOf(p) === bot)
  if (mine.length > 1) return { proc: null, reason: '有多个进程声称是机器人号，为安全起见不注入' }
  if (mine.length === 1) return { proc: mine[0], reason: '' }
  const skip = new Set(exclude.map(Number))
  const unknown = (list || []).filter((p) => !uinOf(p) && !skip.has(Number(p?.pid)))
  if (unknown.length === 1) return { proc: unknown[0], reason: '', unverified: true }
  if (unknown.length > 1) return { proc: null, reason: 'SnowLuma 认不出这几个 QQ 进程登录的是哪个号，只开着机器人号那个 QQ 再试一次' }
  return { proc: null, reason: '没找到登录机器人号的 QQ 进程' }
}

export function generatePassword(): string {
  const b = randomBytes(18).toString('base64url').replace(/[-_]/g, '')
  return `Ab${b.slice(0, 16)}#9!`
}

interface ManagerOptions {
  config: () => SnowLumaConfigView
  botQQ: () => string
  savePassword: (pw: string) => void
  log: Logger
}

export function createSnowLumaManager(opts: ManagerOptions) {
  const log = opts.log
  let child: ReturnType<typeof spawn> | null = null
  let token = ''
  let tokenAt = 0
  let tokenPw = ''
  let pendingVerify: { pid: number; at: number } | null = null
  const rejected = new Set<number>()
  let lastAttach = { at: 0, ok: false, message: '' }

  const base = () => `http://127.0.0.1:${opts.config().webuiPort}`

  async function api(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (options.auth !== false) headers['x-snowluma-token'] = await login()
    const r = await fetch(base() + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401 && options.auth !== false) token = ''
    if (!r.ok) {
      const e = new Error(j.message || `HTTP ${r.status}`) as Error & { status?: number; body?: unknown }
      e.status = r.status
      e.body = j
      throw e
    }
    return j
  }

  async function login(): Promise<string> {
    const pw = opts.config().webuiPassword
    if (token && tokenPw === pw && Date.now() - tokenAt < 30 * 60_000) return token
    if (!pw) throw Object.assign(new Error('还没在面板里填 SnowLuma 控制台密码'), { code: 'no-password' })
    const r = await fetch(base() + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
      signal: AbortSignal.timeout(15_000),
    })
    const j = await r.json().catch(() => ({}))
    if (!j.success || !j.token) throw new Error(j.message || '登录 SnowLuma 控制台失败')
    if (j.mustChangePassword) throw Object.assign(new Error('SnowLuma 要求先在它的控制台里改一次密码'), { status: 403 })
    token = j.token
    tokenPw = pw
    tokenAt = Date.now()
    return token
  }

  async function running(): Promise<boolean> {
    try {
      const r = await fetch(base() + '/api/status', { signal: AbortSignal.timeout(3000) })
      return r.status > 0
    } catch { return false }
  }

  async function start(): Promise<{ ok: boolean; message: string }> {
    const cfg = opts.config()
    const inst = detectInstall(cfg.dir)
    if (!inst.installed || !inst.entry) return { ok: false, message: inst.reason ?? '未安装' }
    if (await running()) return { ok: true, message: 'SnowLuma 已经在运行' }
    const exe = inst.runtime || process.execPath
    const env = { ...process.env, SNOWLUMA_HOOK_AUTOLOAD: '0', SNOWLUMA_UPDATE_CHECK: '0' } as Record<string, string | undefined>
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    if (!inst.runtime && process.platform === 'win32') env.ELECTRON_RUN_AS_NODE = '1'
    if (!existsSync(join(cfg.dir, 'config', 'webui.json')) && !cfg.webuiPassword) {
      const pw = generatePassword()
      opts.savePassword(pw)
      env.SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD = pw
      token = ''
    }
    try {
      child = spawn(exe, ['./index.mjs'], { cwd: cfg.dir, env: env as NodeJS.ProcessEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: false })
    } catch (error) {
      return { ok: false, message: `启动失败：${(error as Error).message}` }
    }
    const me = child
    me.on('exit', () => { if (child === me) child = null })
    log.info(`已在后台启动 SnowLuma（pid ${me.pid}）`)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await running()) return { ok: true, message: '已启动' }
      if (child !== me) return { ok: false, message: 'SnowLuma 启动后马上退出了' }
    }
    return { ok: false, message: '等了 30 秒控制台还没起来' }
  }

  function stop(): { ok: boolean; message: string } {
    if (!child) return { ok: false, message: '不是插件启动的 SnowLuma（或已经停了）' }
    try { child.kill() } catch { /* ignore */ }
    return { ok: true, message: '已停止' }
  }

  async function processes(): Promise<any[]> {
    const j = await api('/api/processes')
    const bot = opts.botQQ()
    return (j.list || []).map((p: any) => ({
      pid: p.pid, name: p.name, injected: Boolean(p.injected), connected: Boolean(p.connected),
      loggedIn: Boolean(p.loggedIn), status: p.status, error: p.error || '',
      uin: uinOf(p), nickname: p.account?.nickname || '', isBot: uinOf(p) === String(bot),
    }))
  }

  async function attachBot(): Promise<{ at: number; ok: boolean; message: string }> {
    let list: any[]
    try {
      const j = await api('/api/processes')
      list = j.list || []
    } catch (error) {
      lastAttach = { at: Date.now(), ok: false, message: (error as Error).message }
      return lastAttach
    }
    const { proc, reason, unverified } = pickBotProcess(list, opts.botQQ(), [...rejected])
    if (!proc) { lastAttach = { at: Date.now(), ok: false, message: reason }; return lastAttach }
    if (unverified) pendingVerify = { pid: proc.pid, at: Date.now() }
    if (proc.injected && proc.connected) {
      lastAttach = { at: Date.now(), ok: true, message: `机器人号（pid ${proc.pid}）已接入` }
      return lastAttach
    }
    try {
      const r = await api(`/api/processes/${proc.pid}/load`, { method: 'POST' })
      lastAttach = { at: Date.now(), ok: Boolean(r.success), message: r.success ? `已给 QQ 进程（pid ${proc.pid}）注入` : (r.message || '注入失败') }
    } catch (error) {
      lastAttach = { at: Date.now(), ok: false, message: `注入失败：${(error as Error).message}` }
    }
    return lastAttach
  }

  async function confirmLogin(uin: string): Promise<boolean> {
    const bot = String(opts.botQQ())
    if (String(uin) === bot) {
      if (pendingVerify) log.info(`已核对：pid ${pendingVerify.pid} 登录的就是机器人号 ${bot}`)
      pendingVerify = null
      return true
    }
    const pend = pendingVerify
    pendingVerify = null
    if (pend) {
      rejected.add(Number(pend.pid))
      try { await api(`/api/processes/${pend.pid}/unload`, { method: 'POST' }) } catch { /* ignore */ }
    }
    lastAttach = { at: Date.now(), ok: false, message: `连上的是 ${uin || '未知号'}，不是机器人号 ${bot}，已断开` }
    log.warn(lastAttach.message)
    return false
  }

  async function agreements(): Promise<any> {
    const j = await api('/api/agreements')
    return {
      version: j.version,
      consentRequired: Boolean(j.consentRequired),
      documents: (j.documents || []).map((d: any) => ({ id: d.id, title: d.title, version: d.declaredVersion, date: d.effectiveDate, text: d.text })),
    }
  }

  async function consent(version: string): Promise<{ ok: boolean; message: string }> {
    const r = await api('/api/agreements/record-consent', { method: 'POST', body: { version: String(version || '') } })
    return { ok: Boolean(r.success), message: r.success ? '已同意' : (r.message || '没记上') }
  }

  function dispose(): void {
    try { child?.kill() } catch { /* ignore */ }
  }

  return {
    detect: () => detectInstall(opts.config().dir),
    endpoint: (): EndpointConfig & { found: boolean } => readOneBotEndpoint(opts.config().dir, opts.botQQ()),
    running, start, stop, processes, attachBot, confirmLogin, agreements, consent,
    clearRejected: () => rejected.clear(),
    get ownsProcess() { return Boolean(child) },
    get lastAttach() { return lastAttach },
    webuiUrl: () => `${base()}/`,
    dispose,
    execFile, // 供 host 诊断使用
  }
}
