// Kinstra Neko 插件入口（host 半边）：
//   QQ(NapCat / SnowLuma / 任意 OneBot v11) ⇄ 本插件 ⇄ DSH 猫娘会话
// 面板管理 API 挂在 /kinstra/api/*；浏览器半边见 src/client。
//
// 安全默认：总开关关、试运行开、白名单空——装好不配置一句话都不会发。

import type { Context } from '@deepseek-ai/cordis'
import { createLogger, logBoard } from './core/logger.js'
import { createConfigStore } from './config/store.js'
import { publicConfig, type Config } from './config/schema.js'
import { createOneBotClient, type OneBotClient } from './onebot/client.js'
import type { EndpointConfig, OneBotEvent, OneBotState } from './onebot/types.js'
import { createNapCatManager } from './gateway/napcat.js'
import { createSnowLumaManager } from './gateway/snowluma.js'
import { createHub } from './chat/hub.js'
import { SessionManager } from './sessions/manager.js'
import { MemoryStore } from './memory/store.js'
import { currentPersonaText, listPersonas, readPersona, savePersona, deletePersona, seedPersonas } from './persona/store.js'
import { socialRules, privateRules } from './persona/rules.js'

export const name = 'kinstra-neko'
export const inject = ['agents', 'sessions', 'sessionController', 'workspaceRegistry', 'systemPrompt', 'webServer', 'timer', 'llm']

const PREFIX = '/kinstra/api'

export function apply(ctx: Context) {
  const logger = createLogger('core')
  const log = logger
  const configStore = createConfigStore()
  const getConfig = () => configStore.get()
  seedPersonas()

  // —— 人格与规则变量 ——
  const variable = (n: string, fn: () => string) =>
    ctx.effect(() => (ctx as any).systemPrompt.variable(n, fn), `kinstra: 变量 ${n}`)
  variable('kinstra_persona', () => currentPersonaText(getConfig().persona.current))
  variable('kinstra_rules_social', () => socialRules(getConfig()))
  variable('kinstra_rules_private', () => privateRules(getConfig()))

  // —— 网关 ——
  const napcat = createNapCatManager({
    config: () => getConfig().napcat,
    botQQ: () => getConfig().botQQ,
    onToken: (token) => configStore.set({ ...getConfig(), napcat: { ...getConfig().napcat, token } }),
    log: logger.child('napcat'),
  })
  const snowluma = createSnowLumaManager({
    config: () => getConfig().snowluma,
    botQQ: () => getConfig().botQQ,
    savePassword: (pw) => configStore.set({ ...getConfig(), snowluma: { ...getConfig().snowluma, webuiPassword: pw } }),
    log: logger.child('snowluma'),
  })

  function endpoint(): EndpointConfig {
    const c = getConfig()
    if (c.gateway === 'onebot') {
      return { httpUrl: c.onebot.httpUrl, wsUrl: c.onebot.wsUrl, httpToken: c.onebot.httpToken, wsToken: c.onebot.wsToken }
    }
    if (c.gateway === 'snowluma') {
      const s = c.snowluma
      if (s.httpUrl || s.wsUrl) return { httpUrl: s.httpUrl, wsUrl: s.wsUrl, httpToken: s.httpToken, wsToken: s.wsToken }
      try {
        const auto = snowluma.endpoint()
        return { httpUrl: auto.httpUrl, wsUrl: auto.wsUrl, httpToken: auto.httpToken, wsToken: auto.wsToken }
      } catch {
        return { httpUrl: '', wsUrl: '', httpToken: '', wsToken: '' }
      }
    }
    return napcat.endpoint()
  }

  const memory = new MemoryStore({
    hotGroups: getConfig().memory.hotGroups,
    hotIndexPerGroup: getConfig().memory.hotIndexPerGroup,
    recallCount: getConfig().memory.recallCount,
    log: logger.child('memory'),
  })

  // —— OneBot 客户端与登录号核对 ——
  let onebotState: OneBotState = 'stopped'
  let loginOk = false
  let wrongAccount = ''
  let verifying = false
  let pendingEvents: OneBotEvent[] = []

  const sessionManager = new SessionManager({ dsh: ctx as any, config: getConfig, log: logger.child('session') })
  const hub = createHub({
    dsh: ctx as any,
    config: getConfig,
    setConfig: (patch) => configStore.merge(patch),
    onebot: () => onebotRef.client,
    sessions: sessionManager,
    memory,
    log: logger.child('chat'),
  })

  async function checkLogin(client: OneBotClient): Promise<void> {
    verifying = true
    pendingEvents = []
    try {
      let uin = ''
      try {
        const info = await client.call('get_login_info', {}, { timeoutMs: 10_000 })
        uin = String(info?.user_id ?? '')
      } catch (error) {
        logger.child('onebot').warn(`核对登录 QQ 号失败：${(error as Error).message}`)
      }
      if (client.state !== 'connected') return
      const bot = getConfig().botQQ
      if (!uin) { client.stop(); return }
      if (getConfig().gateway === 'snowluma') {
        const ok = await snowluma.confirmLogin(uin)
        if (!ok) { wrongAccount = uin; client.stop(); return }
      } else if (bot && uin !== bot) {
        wrongAccount = uin
        client.stop()
        return
      }
      loginOk = true
      wrongAccount = ''
      const queued = pendingEvents
      pendingEvents = []
      for (const ev of queued) (hub as any).dispatchEvent?.(ev)
    } finally {
      verifying = false
    }
  }

  const onebotRef: { client: OneBotClient } = { client: null as unknown as OneBotClient }
  const onebot = createOneBotClient({
    endpoint,
    log: logger.child('onebot'),
    onState: (s, detail) => {
      onebotState = s
      if (s !== 'connected') { loginOk = false; pendingEvents = [] }
      else void checkLogin(onebotRef.client)
      logger.child('onebot').info(`QQ 网关：${s}${detail ? `（${detail}）` : ''}`)
    },
    onEvent: (ev) => {
      if (!loginOk) {
        if (verifying) {
          pendingEvents.push(ev)
          if (pendingEvents.length > 200) pendingEvents.shift()
        }
        return
      }
      hub.dispatchEvent(ev)
    },
  })
  onebotRef.client = onebot

  // 会话事件 → 中枢
  ctx.effect(() => {
    const off = (ctx as any).on('session/event', (session: any, event: any) => {
      try { hub.onSessionEvent(session, event) } catch (error) { log.warn(`会话事件处理出错：${(error as Error).message}`) }
    })
    return () => { try { typeof off === 'function' && off() } catch { /* ignore */ } }
  }, 'kinstra: 盯会话')

  // —— 看门狗 ——
  async function watchdog(): Promise<void> {
    const c = getConfig()
    if (!c.enabled) {
      if (onebot.state !== 'stopped') onebot.stop()
      return
    }
    if (wrongAccount) return
    if (c.gateway === 'napcat') {
      const d = napcat.detect()
      if (d.installed) {
        if (!(await napcat.healthy())) {
          if (!(await napcat.running())) {
            const r = await napcat.start()
            if (r.ok) log.info('NapCat：' + r.message)
          }
        }
      }
    } else if (c.gateway === 'snowluma') {
      const inst = snowluma.detect()
      if (inst.installed && c.snowluma.autoStart && !(await snowluma.running())) {
        const r = await snowluma.start()
        if (r.ok) log.info('SnowLuma：' + r.message)
      }
      if (c.snowluma.autoAttach && onebotState !== 'connected' && (await snowluma.running()) && Date.now() - snowluma.lastAttach.at > 60_000) {
        const r = await snowluma.attachBot()
        log.info('接入机器人号：' + r.message)
      }
    }
    if (onebot.state === 'stopped') onebot.start()
  }
  const safeWatchdog = () => { watchdog().catch((e) => log.warn(`看门狗出错：${(e as Error).message}`)) }
  ctx.effect(() => (ctx as any).interval(safeWatchdog, 30_000), 'kinstra: 看门狗')
  setTimeout(safeWatchdog, 3000).unref?.()

  ctx.effect(() => () => {
    onebot.stop()
    snowluma.dispose()
    napcat.dispose()
  }, 'kinstra: 收尾')

  // —— 管理 API ——
  const send = (res: any, code: number, body: unknown) => {
    try {
      res.statusCode = code
      res.setHeader?.('content-type', 'application/json; charset=utf-8')
      res.setHeader?.('cache-control', 'no-store')
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    } catch { /* ignore */ }
  }
  const readBody = async (req: any): Promise<any> => {
    let s = ''
    try { for await (const chunk of req) s += chunk } catch { /* ignore */ }
    try { return JSON.parse(s || '{}') } catch { return {} }
  }
  const answer = async (res: any, fn: () => Promise<unknown> | unknown) => {
    try {
      const r = await fn()
      if (r !== undefined) send(res, 200, r)
    } catch (error) {
      send(res, 200, { ok: false, message: (error as Error).message })
    }
  }
  const route = (path: string, handler: (req: any) => Promise<unknown> | unknown) =>
    ctx.effect(
      () => (ctx as any).webServer.register({ kind: 'exact', path: PREFIX + path, handler: (req: any, res: any) => answer(res, () => handler(req)) }),
      `kinstra: 路由 ${path}`,
    )

  async function overview() {
    const c = getConfig()
    let login: { uin: string; nickname: string } | null = null
    if (onebotState === 'connected') {
      try {
        const info = await onebot.call('get_login_info', {}, { timeoutMs: 5000, retries: 0 })
        login = { uin: String(info?.user_id ?? ''), nickname: info?.nickname ?? '' }
      } catch { /* ignore */ }
    }
    return {
      ok: true,
      version: '1.0.0',
      config: publicConfig(c),
      onebot: { state: onebotState, login, wrongAccount, endpoint: { httpUrl: endpoint().httpUrl, wsUrl: endpoint().wsUrl } },
      napcat: { ...napcat.detect(), healthy: await napcat.healthy().catch(() => false) },
      stats: hub.stats(),
      memory: memory.stats(),
      personas: listPersonas(),
    }
  }

  route('/state', () => overview())

  route('/save', async (req) => {
    const body = await readBody(req)
    const before = getConfig()
    configStore.merge(body)
    const after = getConfig()
    if (before.gateway !== after.gateway || before.botQQ !== after.botQQ
      || JSON.stringify(before.onebot) !== JSON.stringify(after.onebot)
      || JSON.stringify(before.napcat) !== JSON.stringify(after.napcat)
      || JSON.stringify(before.snowluma) !== JSON.stringify(after.snowluma)) {
      wrongAccount = ''
      onebot.restart()
    }
    if (!before.enabled && after.enabled) setTimeout(safeWatchdog, 100)
    if (before.enabled && !after.enabled) onebot.stop()
    return { ...(await overview()), message: '保存好了' }
  })

  route('/setup/done', async (req) => {
    const body = await readBody(req)
    const c = getConfig()
    if (!c.botQQ || !c.ownerQQ) return { ok: false, message: '先填好猫娘小号和你的 QQ 号' }
    configStore.set({ ...getConfig(), setupDone: true, enabled: body.enabled === true, dryRun: body.dryRun !== false })
    return { ...(await overview()), message: '设置完成' }
  })

  route('/onebot/test', async () => {
    try {
      const info = await onebot.call('get_login_info', {}, { timeoutMs: 8000 })
      const uin = String(info?.user_id ?? '')
      const bot = getConfig().botQQ
      return { ok: !bot || uin === bot, message: bot && uin !== bot ? `连上的是 ${uin}，不是猫娘号 ${bot}` : `连上了：${info.nickname ?? ''}（${uin}）`, info }
    } catch (error) { return { ok: false, message: (error as Error).message } }
  })

  route('/onebot/reconnect', async () => {
    wrongAccount = ''
    onebot.restart()
    for (let i = 0; i < 16 && !(onebotState === 'connected' && loginOk); i++) await new Promise((r) => setTimeout(r, 500))
    return onebotState === 'connected' && loginOk ? { ok: true, message: '连上了' } : { ok: false, message: '没连上，检查协议端和令牌' }
  })

  route('/napcat/provision', async () => {
    const ep = napcat.provision()
    return { ok: true, endpoint: { httpUrl: ep.httpUrl, wsUrl: ep.wsUrl }, message: '已生成 OneBot 配置和访问令牌' }
  })
  route('/napcat/start', async () => napcat.start())
  route('/napcat/stop', async () => napcat.stop())

  route('/snowluma/start', async () => snowluma.start())
  route('/snowluma/stop', async () => snowluma.stop())
  route('/snowluma/attach', async () => {
    wrongAccount = ''
    snowluma.clearRejected()
    const r = await snowluma.attachBot()
    if (getConfig().enabled && onebot.state === 'stopped') onebot.start()
    return r
  })
  route('/snowluma/processes', async () => ({ ok: true, list: await snowluma.processes().catch((e) => { throw new Error((e as Error).message) }) }))
  route('/snowluma/agreements', async () => {
    try { return { ok: true, ...(await snowluma.agreements()) } } catch (error) { return { ok: false, message: (error as Error).message } }
  })
  route('/snowluma/consent', async (req) => {
    const b = await readBody(req)
    if (b.agree !== true) return { ok: false, message: '要先勾选同意' }
    return snowluma.consent(b.version)
  })

  route('/personas', () => ({ ok: true, list: listPersonas(), current: getConfig().persona.current }))
  route('/persona/get', async (req) => {
    const id = new URL(req.url, 'http://x').searchParams.get('id') ?? ''
    const p = readPersona(id)
    return p ? { ok: true, persona: { id: p.id, name: p.name, tags: p.tags, body: p.body, raw: p.raw } } : { ok: false, message: '没有这个人格' }
  })
  route('/persona/save', async (req) => {
    const b = await readBody(req)
    const p = savePersona(String(b.id ?? ''), { name: String(b.name ?? ''), tags: Array.isArray(b.tags) ? b.tags.map(String) : [], body: String(b.body ?? '') })
    return { ok: true, persona: { id: p.id, name: p.name }, message: '人格已保存，下一轮起生效' }
  })
  route('/persona/delete', async (req) => {
    const b = await readBody(req)
    if (b.id === getConfig().persona.current) return { ok: false, message: '正在用的人格不能删' }
    deletePersona(String(b.id ?? ''))
    return { ok: true, list: listPersonas() }
  })
  route('/persona/use', async (req) => {
    const b = await readBody(req)
    if (!readPersona(b.id)) return { ok: false, message: '没有这个人格' }
    configStore.set({ ...getConfig(), persona: { current: String(b.id) } })
    return { ok: true, current: b.id }
  })

  route('/observe', async (req) => {
    const limit = Number(new URL(req.url, 'http://x').searchParams.get('limit') ?? 50)
    return { ok: true, entries: hub.recentObserve(limit) }
  })

  route('/sessions/reset', async (req) => {
    const b = await readBody(req).catch(() => ({}))
    if (b.chatId) return { ok: true, reset: hub.resetChat(String(b.chatId)) }
    return { ok: true, count: hub.resetAll(), message: '已让她忘掉所有当前对话，下条消息重新开始' }
  })

  route('/test-send', async () => {
    const c = getConfig()
    if (!c.enabled) return { ok: false, message: '先打开总开关' }
    if (c.dryRun) return { ok: false, message: '现在是试运行，先关了试运行再测' }
    const r = await onebot.call('send_private_msg', { user_id: Number(c.ownerQQ), message: [{ type: 'text', data: { text: '【Kinstra Neko 自测】喵~ 我在。' } }] }, { timeoutMs: 10_000 })
    return r ? { ok: true, message: '发给主人了，去 QQ 看看' } : { ok: false, message: '没发出去' }
  })

  route('/logs', async (req) => {
    const u = new URL(req.url, 'http://x')
    return { ok: true, entries: logBoard.recent(Number(u.searchParams.get('limit') ?? 300), { level: u.searchParams.get('level') ?? '', area: u.searchParams.get('area') ?? '' }) }
  })

  route('/models', async () => {
    try {
      const llm = (ctx as any).llm
      const out: Array<{ provider: string; model: string; name: string }> = []
      for (const p of llm.listProviders() ?? []) {
        const provider = typeof p === 'string' ? p : (p.provider ?? p.id ?? p.name)
        try {
          for (const m of (await llm.listModels(provider)) ?? []) out.push({ provider, model: m.id ?? m.model, name: m.name ?? (m.id ?? m.model) })
        } catch { /* 单个 provider 失败不阻塞 */ }
      }
      return { ok: true, list: out }
    } catch (error) { return { ok: false, list: [], message: (error as Error).message } }
  })

  log.info(`Kinstra Neko v1.0.0 已加载｜总开关 ${getConfig().enabled ? '开' : '关'}｜试运行 ${getConfig().dryRun ? '开' : '关'}`)

  return { hub, onebot, getConfig, memory, ready: Promise.resolve() }
}
