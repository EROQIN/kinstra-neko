// 端到端烟测：内存假 OneBot 客户端 + 假 DSH host，
// 验证 群@消息 → 访问控制 → 分段 → DSH 会话 → turn/end → 试运行观察记录 的完整链路。

import { describe, it, expect, beforeEach } from 'vitest'
import { createHub } from '../src/chat/hub.js'
import { SessionManager } from '../src/sessions/manager.js'
import { MemoryStore } from '../src/memory/store.js'
import { createConfigStore } from '../src/config/store.js'
import { createLogger } from '../src/core/logger.js'
import type { MessageEvent } from '../src/onebot/types.js'

function makeFakeDsh() {
  const sessions = new Map<string, any>()
  let sessionHandler: ((session: any, event: any) => void) | null = null

  function mkAgent(sid: string) {
    const tools: any[] = []
    const contexts: any[] = []
    return {
      id: sid,
      session: { id: sid },
      status: 'idle',
      followup(_message: any) {
        // 假模型：下一拍吐出最终文本并正常结束这一轮
        setTimeout(() => {
          sessionHandler?.({ id: sid }, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '喵？在呢在呢' }] } } })
          sessionHandler?.({ id: sid }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
        }, 5)
      },
      steer() {},
      ctx: {
        tools: { register: (t: any) => { tools.push(t); return () => {} } },
        systemPrompt: { context: (c: any) => { contexts.push(c); return () => {} } },
      },
      _tools: tools,
      _contexts: contexts,
      model: { select() {}, current: () => undefined },
    }
  }

  const sessionController = {
    create: async () => ({ sessionId: 'sess-1' }),
    rename: async () => ({}) ,
    resolveAgent: async (sid: string) => {
      if (!sessions.has(sid)) sessions.set(sid, mkAgent(sid))
      return { agent: sessions.get(sid) }
    },
  }
  const workspaceRegistry = {
    list: () => [],
    create: async (path: string) => ({ id: 'ws-1', path }),
  }

  return {
    sessions,
    setHandler: (fn: (s: any, e: any) => void) => { sessionHandler = fn },
    dsh: {
      agents: { get: (id: string) => sessions.get(String(id).replace(/^session-/, '')) },
      sessions: { flush: async () => true },
      get(name: string) {
        return ({ sessionController, workspaceRegistry } as any)[name]
      },
      on(ev: string, fn: any) { if (ev === 'session/event') sessionHandler = fn; return () => {} },
    } as any,
  }
}

/** 内存假 OneBot：只实现 hub 用到的 call；记录"本来要发"的消息。 */
function fakeOneBot() {
  const calls: Array<{ action: string; params: any }> = []
  return {
    calls,
    async call(action: string, params: any = {}) {
      calls.push({ action, params })
      if (action === 'get_group_info') return { group_name: '测试群' }
      if (action === 'get_group_member_list') return [
        { user_id: 111, nickname: '主人', card: '' },
      ]
      if (action === 'get_msg') return { sender: { user_id: 999, nickname: '路人' }, message: [{ type: 'text', data: { text: '早' } }] }
      if (action === 'send_group_msg' || action === 'send_private_msg') return { message_id: 9000 + calls.length }
      if (action === 'set_input_status') return {}
      return null
    },
    get state() { return 'connected' },
    start() {}, stop() {}, restart() {},
  }
}

describe('端到端：群@ → DSH → 试运行观察', () => {
  beforeEach(() => {
    process.env.KINSTRA_NEKO_DATA_DIR = `/tmp/kn-e2e-${Date.now()}-${Math.random()}`
  })

  it('白名单群里被 @，她的回复进试运行记录而不是真发；工具与上下文已挂载', async () => {
    const configStore = createConfigStore()
    configStore.set({
      ...configStore.get(),
      enabled: true, dryRun: true, setupDone: true,
      botQQ: '10001', ownerQQ: '111',
      allow: { private: [], groups: ['300'] },
      merge: { ...configStore.get().merge, groupWaitSec: 0.1, waitSec: 0.1, maxSec: 1, groupMaxSec: 1 },
    } as any)

    const env = makeFakeDsh()
    const onebot = fakeOneBot()
    const log = createLogger('test')
    const memory = new MemoryStore({ log })
    const sm = new SessionManager({ dsh: env.dsh, config: () => configStore.get(), log })
    const hub = createHub({
      dsh: env.dsh,
      config: () => configStore.get(),
      setConfig: (p) => configStore.merge(p),
      onebot: () => onebot as any,
      sessions: sm,
      memory,
      log,
    })
    // 桥接 DSH session/event（生产中由 host.ts 绑定）
    env.setHandler((s, e) => (hub as any).onSessionEvent(s, e))

    const ev: MessageEvent = {
      post_type: 'message', message_type: 'group', message_id: 555,
      user_id: 111, self_id: 10001, group_id: 300,
      sender: { user_id: 111, nickname: '主人' },
      message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 在吗' } }],
    }
    await (hub as any).dispatchEvent(ev)
    await new Promise((r) => setTimeout(r, 400))

    // 会话被创建
    expect(env.sessions.size).toBe(1)
    const agent = [...env.sessions.values()][0] as any
    expect(agent._tools.length).toBeGreaterThan(0)
    expect(agent._contexts.length).toBe(1)

    // 试运行：没有调用任何 send_*
    expect(onebot.calls.some((c) => c.action.startsWith('send_'))).toBe(false)
    // 观察记录里有她本来会说的话
    const observe = (hub as any).recentObserve(10)
    expect(observe.length).toBe(1)
    expect(observe[0].reply).toContain('喵')
    expect(observe[0].mode).toBe('must')
  })

  it('非白名单群直接忽略，不建会话', async () => {
    const configStore = createConfigStore()
    configStore.set({ ...configStore.get(), enabled: true, dryRun: true, botQQ: '10001', ownerQQ: '111' } as any)
    const env = makeFakeDsh()
    const onebot = fakeOneBot()
    const log = createLogger('test')
    const memory = new MemoryStore({ log })
    const sm = new SessionManager({ dsh: env.dsh, config: () => configStore.get(), log })
    const hub = createHub({
      dsh: env.dsh, config: () => configStore.get(), setConfig: (p) => configStore.merge(p),
      onebot: () => onebot as any, sessions: sm, memory, log,
    })
    await (hub as any).dispatchEvent({
      post_type: 'message', message_type: 'group', message_id: 1,
      user_id: 222, self_id: 10001, group_id: 999,
      sender: { user_id: 222, nickname: '路人' },
      message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: ' 在吗' } }],
    } as MessageEvent)
    await new Promise((r) => setTimeout(r, 100))
    expect(env.sessions.size).toBe(0)
  })
})
