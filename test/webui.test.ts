import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createNapCatWebUI } from '../src/gateway/webui.js'

const silentLog = { debug() {}, info() {}, warn() {}, error() {}, child() { return this } } as any

function makeWebUiConfig(dir: string, extra: Record<string, unknown> = {}) {
  const cfgDir = join(dir, 'config')
  mkdirSync(cfgDir, { recursive: true })
  writeFileSync(join(cfgDir, 'webui.json'), JSON.stringify({ token: 'tok123', port: 6099, ...extra }))
}

function jsonRes(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as any
}

describe('napcat webui 代理', () => {
  let dir: string
  let origFetch: typeof fetch

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kn-webui-'))
    origFetch = globalThis.fetch
  })
  afterEach(() => { globalThis.fetch = origFetch; rmSync(dir, { recursive: true, force: true }) })

  it('换凭证用 sha256(token+".napcat")，并缓存只 login 一次', async () => {
    makeWebUiConfig(dir)
    let logins = 0
    const calls: any[] = []
    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url); const body = JSON.parse(init.body)
      calls.push({ u, body })
      if (u.endsWith('/api/auth/login')) { logins++; return jsonRes(200, { code: 0, data: { Credential: 'cred-A' } }) }
      return jsonRes(200, { code: 0, data: { loginPhase: 'waiting_qrcode', qrcodeurl: 'https://txz.qq.com/p?k=x' } })
    }) as any

    const w = createNapCatWebUI({ installDir: () => dir, configuredPort: () => 6099, log: silentLog })
    const a = await w.loginStatus({ online: false })
    const b = await w.loginStatus({ online: false })

    const expectedHash = createHash('sha256').update('tok123.napcat').digest('hex')
    expect(calls.find((c) => c.u.endsWith('/api/auth/login'))?.body.hash).toBe(expectedHash)
    expect(logins).toBe(1)               // 第二次命中缓存，不再 login
    expect(a.phase).toBe('waiting')
    expect(a.qrcodeurl).toBe('https://txz.qq.com/p?k=x')
    expect(b.phase).toBe('waiting')
  })

  it('业务 401 时作废凭证并重换一次后重试', async () => {
    makeWebUiConfig(dir)
    let logins = 0
    let qrCalls = 0
    globalThis.fetch = (async (url: any) => {
      const u = String(url)
      if (u.endsWith('/api/auth/login')) { logins++; return jsonRes(200, { code: 0, data: { Credential: `cred-${logins}` } }) }
      if (u.endsWith('/api/QQLogin/CheckLoginStatus')) {
        qrCalls++
        return qrCalls === 1 ? jsonRes(401, {}) : jsonRes(200, { code: 0, data: { loginPhase: 'qrcode_scanned' } })
      }
      return jsonRes(500, {})
    }) as any

    const w = createNapCatWebUI({ installDir: () => dir, configuredPort: () => 6099, log: silentLog })
    const r = await w.loginStatus({ online: false })
    expect(r.phase).toBe('scanned')
    expect(qrCalls).toBe(2)
    expect(logins).toBe(2)               // 初次 + 401 后重换
  })

  it('OneBot 已在线则短路为 online，且不访问 WebUI、不泄露任何令牌', async () => {
    makeWebUiConfig(dir)
    let hit = false
    globalThis.fetch = (async () => { hit = true; return jsonRes(200, {}) }) as any
    const w = createNapCatWebUI({ installDir: () => dir, configuredPort: () => 6099, log: silentLog })
    const r = await w.loginStatus({ online: true, uin: '10001' })
    expect(r.phase).toBe('online')
    expect(r.uin).toBe('10001')
    expect(hit).toBe(false)
    expect(JSON.stringify(r)).not.toMatch(/credential|token|hash/i)
  })

  it('读不到 webui token（文件未生成）时返回 starting', async () => {
    globalThis.fetch = (async () => jsonRes(200, {})) as any
    const w = createNapCatWebUI({ installDir: () => dir, configuredPort: () => 6099, log: silentLog })
    const r = await w.loginStatus({ online: false })
    expect(r.phase).toBe('starting')
  })

  it('stdout 抓到的 token 在没有 webui.json 时兜底可用', async () => {
    globalThis.fetch = (async (url: any, init: any) => {
      const u = String(url)
      if (u.endsWith('/api/auth/login')) return jsonRes(200, { code: 0, data: { Credential: 'c' } })
      if (u.endsWith('/api/QQLogin/CheckLoginStatus')) return jsonRes(200, { code: 0, data: { loginPhase: 'initializing' } })
      return jsonRes(500, {})
    }) as any
    const w = createNapCatWebUI({ installDir: () => dir, configuredPort: () => 6099, log: silentLog })
    w.setDiscoveredToken('fromstdout')
    const r = await w.loginStatus({ online: false })
    expect(r.phase).toBe('initializing')
  })
})
