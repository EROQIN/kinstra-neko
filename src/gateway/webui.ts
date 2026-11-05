// NapCat 内置 WebUI 的本机代理：浏览器只同源请求我们的 /kinstra/api/*，由这里在
// Node 侧访问 127.0.0.1:6099，webui token / 登录凭证永不下发给面板。
//
// 鉴权（NapCat 官方 WebUI 契约，跨版本实测）：
//   原始 token 在 <installDir>/config/webui.json 的 "token"；
//   hash = sha256(token + '.napcat')；POST /api/auth/login {hash,totpCode:''}
//   换一个约 1 小时有效的 Credential，之后请求带 Authorization: Bearer <Credential>。
//   /api/auth/login 限流（默认 3 次/分钟/IP），故凭证必须缓存、单飞刷新，401 只重换一次。
//
// 登录状态只轮询 POST /api/QQLogin/CheckLoginStatus，返回 {isLogin,isOffline,
// loginPhase,qrcodeurl,loginError,coreReady}；二维码本体就是 qrcodeurl（txz.qq.com），
// 面板本地渲染成 QR。最终「真的就绪」以 OneBot get_login_info 在线且 QQ 号正确为准。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../core/logger.js'

export type QrPhase =
  | 'stopped'        // NapCat 没在跑
  | 'starting'       // 进程/WebUI 启动中，二维码还没好
  | 'waiting'        // 二维码就绪，等扫码
  | 'scanned'        // 手机已扫，待确认
  | 'initializing'   // 已确认登录，OneBot 启动中
  | 'online'         // OneBot 在线、QQ 号正确
  | 'reconnecting'   // NapCat 掉线重连
  | 'offline'        // 登录服务离线

export interface QrStatus {
  ok: boolean
  phase: QrPhase
  qrcodeurl?: string
  loginError?: string
  uin?: string
  message?: string
}

interface WebUiOptions {
  installDir: () => string
  configuredPort: () => number
  log: Logger
}

const CRED_TTL_MS = 3500 * 1000      // 官方 1 小时，保守点
const FETCH_TIMEOUT_MS = 4000

export function createNapCatWebUI(opts: WebUiOptions) {
  const log = opts.log
  let discoveredToken = ''           // stdout 兜底抓到的 token
  let credential = ''
  let credentialAt = 0
  let inflight: Promise<string> | null = null

  /** stdout 抓到 `WebUi Token: xxx` 时回灌，仅在 webui.json 还读不到时用。 */
  function setDiscoveredToken(t: string): void {
    if (t) discoveredToken = t
  }

  function readWebUiConfig(): { token: string; port: number } | null {
    // 文件里的 token 权威；stdout 抓到的只兜底。
    let fileToken = ''
    let filePort = 0
    try {
      const p = join(opts.installDir(), 'config', 'webui.json')
      if (existsSync(p)) {
        const j = JSON.parse(readFileSync(p, 'utf8'))
        fileToken = String(j.token ?? '').trim()
        filePort = Number(j.port) || 0
      }
    } catch { /* 配置尚未生成 */ }
    const token = fileToken || discoveredToken
    if (!token) return null
    return { token, port: filePort || opts.configuredPort() || 6099 }
  }

  const hashOf = (token: string) => createHash('sha256').update(token + '.napcat').digest('hex')

  async function fetchCredential(cfg: { token: string; port: number }): Promise<string> {
    const res = await webFetch(cfg.port, '/api/auth/login', { hash: hashOf(cfg.token), totpCode: '' }, undefined)
    const body = await res.json().catch(() => null)
    if (res.status === 200 && body?.code === 0 && body?.data?.Credential) return String(body.data.Credential)
    throw new Error(`WebUI 换凭证失败：${body?.message ?? res.status}`)
  }

  /** 取有效凭证；单飞，避免轮询并发把 login 限流打爆。 */
  async function getCredential(): Promise<string> {
    if (credential && Date.now() - credentialAt < CRED_TTL_MS) return credential
    if (inflight) return inflight
    const cfg = readWebUiConfig()
    if (!cfg) throw new Error('webui-no-token')
    inflight = fetchCredential(cfg)
      .then((c) => { credential = c; credentialAt = Date.now(); return c })
      .finally(() => { inflight = null })
    return inflight
  }

  function resetCredential(): void { credential = ''; credentialAt = 0 }

  async function webFetch(port: number, path: string, jsonBody: unknown, bearer: string | undefined, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(jsonBody ?? {}),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** 带鉴权调一个 WebUI 接口；Unauthorized 时作废凭证并重换一次（只一次）。 */
  async function call<T = any>(path: string, jsonBody: unknown = {}): Promise<T> {
    const cfg = readWebUiConfig()
    if (!cfg) throw new Error('webui-no-token')
    const once = async (bearer: string): Promise<{ status: number; body: any }> => {
      const res = await webFetch(cfg.port, path, jsonBody, bearer)
      const body = await res.json().catch(() => null)
      return { status: res.status, body }
    }
    let r = await once(await getCredential())
    if (r.status === 401 || r.body?.code === -1 && /unauthorized/i.test(String(r.body?.message ?? ''))) {
      resetCredential()
      r = await once(await getCredential())
    }
    if (r.body?.code === -1) throw new Error(String(r.body.message ?? 'WebUI 接口错误'))
    return r.body as T
  }

  function mapPhase(loginPhase: string | undefined, isOffline: boolean | undefined, reconnecting: boolean | undefined): QrPhase {
    if (reconnecting) return 'reconnecting'
    if (isOffline) return 'offline'
    switch (loginPhase) {
      case 'waiting_qrcode': return 'waiting'
      case 'qrcode_scanned': return 'scanned'
      case 'initializing': return 'initializing'
      case 'generating_qrcode': return 'starting'
      case 'ready': return 'initializing'   // core ready 但 OneBot 未确认前先显示启动中
      default: return 'starting'
    }
  }

  /**
   * 聚合一次扫码登录状态。onebot 状态由 host 传入（最终权威）：
   * online=true 且 uin 正确 → online；否则透传 WebUI 的 phase。
   */
  async function loginStatus(onebot: { online: boolean; uin?: string }): Promise<QrStatus> {
    if (onebot.online) return { ok: true, phase: 'online', uin: onebot.uin }
    let data: any
    try {
      data = (await call('/api/QQLogin/CheckLoginStatus', {})).data
    } catch (error) {
      const m = (error as Error).message
      // WebUI 还没起来 / token 文件还没生成：进程仍在启动
      if (m === 'webui-no-token' || /fetch failed|ECONNREFUSED|aborted|timeout|ENOTFOUND/i.test(m)) {
        return { ok: true, phase: 'starting' }
      }
      log.debug(`WebUI 登录状态获取失败：${m}`)
      return { ok: false, phase: 'starting', message: m }
    }
    const phase = mapPhase(data?.loginPhase, data?.isOffline, data?.loginPhase === 'reconnecting')
    return {
      ok: true,
      phase,
      qrcodeurl: data?.qrcodeurl || undefined,
      loginError: data?.loginError || undefined,
    }
  }

  async function refreshQr(): Promise<{ qrcodeurl?: string }> {
    const data = (await call('/api/QQLogin/RefreshQRcode', {})).data
    return { qrcodeurl: data?.qrcodeurl || undefined }
  }

  /** 进程重启后旧凭证作废；manager start/stop 时调。 */
  function reset(): void { resetCredential(); discoveredToken = '' }

  return { loginStatus, refreshQr, setDiscoveredToken, reset, readWebUiConfig }
}
