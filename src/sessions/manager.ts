// DSH 会话生命周期：每个 QQ 私聊 / 群聊一个持久会话；工作区统一；preset 分主人私聊与群聊。
// 会话映射持久化在 sessions.json，重启后第一条消息自动 resolveAgent 恢复。

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir, readJson, writeJson } from '../core/store.js'
import type { Logger } from '../core/logger.js'
import type { Config } from '../config/schema.js'

export const SOCIAL_PRESET = 'kinstra-social'
export const PRIVATE_PRESET = 'kinstra-private'
export const WORKSPACE_TITLE = 'Kinstra Neko · QQ'
const SOURCE_KIND = 'kinstra'

export interface ChatRef {
  chatId: string
  kind: 'private' | 'group'
  groupId?: string
  userId?: string
  nickname?: string
}

export interface PromptPart {
  type: 'text' | 'image'
  text?: string
  mediaType?: string
  data?: string
  name?: string
}

interface SessionEntry {
  sessionId: string
  preset: string
  level: 'full' | 'social'
  createdAt: number
  title: string
}

interface SessionMapFile { chats: Record<string, SessionEntry> }

/** 只声明我们真正用到的 DSH 表面；alpha 类型定义与 JS 宿主有出入时用最小结构类型。 */
export interface DshHost {
  get(name: 'sessionController'): any
  get(name: 'workspaceRegistry'): any
  get(name: 'agents'): any
  get(name: 'sessions'): any
  get(name: string): unknown
  agents: any
  sessions: any
  sessionController?: any
}

export interface SessionManagerOptions {
  dsh: DshHost
  config: () => Config
  log: Logger
}

export class SessionManager {
  private opts: SessionManagerOptions
  sessionToChat = new Map<string, string>()

  constructor(opts: SessionManagerOptions) {
    this.opts = opts
  }

  private mapFile = () => dataDir('sessions.json')
  private readMap(): SessionMapFile {
    return readJson<SessionMapFile>(this.mapFile(), { chats: {} })
  }
  private writeMap(m: SessionMapFile): void {
    writeJson(this.mapFile(), m)
  }

  workspaceDir(): string {
    const cfg = this.opts.config()
    const v = String(cfg.workspaceDir || '').trim()
    if (v && isAbsolute(v)) return v
    if (process.env.KINSTRA_NEKO_WORKSPACE) return process.env.KINSTRA_NEKO_WORKSPACE
    return join(homedir(), '.kinstra-neko', 'qq-chats')
  }

  levelFor(chat: ChatRef): 'full' | 'social' {
    const cfg = this.opts.config()
    if (chat.kind === 'private' && String(chat.userId) === String(cfg.ownerQQ) && cfg.ownerQQ) return 'full'
    return 'social'
  }

  presetFor(level: 'full' | 'social'): string {
    return level === 'full' ? PRIVATE_PRESET : SOCIAL_PRESET
  }

  titleFor(chat: ChatRef): string {
    const cfg = this.opts.config()
    if (chat.kind === 'group') return `QQ 群 · ${chat.nickname || chat.groupId}`
    if (String(chat.userId) === String(cfg.ownerQQ)) return `QQ · ${cfg.ownerName || '主人'}私聊`
    return `QQ 私聊 · ${chat.nickname || chat.userId}`
  }

  private controller() {
    const c = this.opts.dsh.get('sessionController') ?? this.opts.dsh.sessionController
    if (!c) throw new Error('宿主没有 sessionController（需要 DSH Web/Desktop 组合包）')
    return c
  }

  private registry() {
    return this.opts.dsh.get('workspaceRegistry')
  }

  private async ensureWorkspace(): Promise<{ id: string }> {
    const reg = this.registry()
    if (!reg) throw new Error('宿主没有 workspaceRegistry')
    const dir = this.workspaceDir()
    mkdirSync(dir, { recursive: true })
    const norm = (p: string) => String(p ?? '').replace(/[\\/]+$/, '').toLowerCase()
    const exists = reg.list?.().find((w: any) => norm(w.path) === norm(dir))
    if (exists) return exists
    const ws = await reg.create(dir, WORKSPACE_TITLE)
    this.opts.log.info(`建好了工作区「${WORKSPACE_TITLE}」：${dir}`)
    return ws
  }

  private async createSession(chat: ChatRef, level: 'full' | 'social'): Promise<string> {
    const ws = await this.ensureWorkspace()
    const preset = this.presetFor(level)
    const r = await this.controller().create({ workspaceId: ws.id, agentPreset: preset })
    const sid = String(r.sessionId)
    try { await this.controller().rename({ sessionId: sid, title: this.titleFor(chat) }) } catch { /* 标题失败无所谓 */ }
    const m = this.readMap()
    m.chats[chat.chatId] = { sessionId: sid, preset, level, createdAt: Date.now(), title: this.titleFor(chat) }
    this.writeMap(m)
    this.opts.log.info(`为 ${chat.chatId} 新建会话 ${sid.slice(-8)}（${preset}）`)
    return sid
  }

  private async resolveAgent(sid: string): Promise<any> {
    const live = this.opts.dsh.agents?.get?.(sid) ?? this.opts.dsh.agents?.get?.(`session-${sid}`)
    if (live) return live
    const r = await this.controller().resolveAgent(sid)
    if (r?.agent) return r.agent
    throw new Error(r?.error?.message ?? '恢复会话失败')
  }

  /** 拿到聊天对应的活 agent；权限档变了/会话损坏则新建。onReady 在 agent 可用后调用（挂工具/上下文）。 */
  async agentFor(chat: ChatRef, onReady?: (agent: any, chat: ChatRef, level: 'full' | 'social') => void): Promise<{ agent: any; sessionId: string; level: 'full' | 'social' }> {
    const level = this.levelFor(chat)
    const preset = this.presetFor(level)
    const m = this.readMap()
    let entry = m.chats[chat.chatId]
    let sid = entry && entry.preset === preset && entry.level === level ? entry.sessionId : ''
    let agent: any = null
    if (sid) {
      try {
        agent = await this.resolveAgent(sid)
      } catch (error) {
        this.opts.log.warn(`会话 ${sid.slice(-8)} 恢复不了（${(error as Error).message}），换新会话`)
        sid = ''
      }
    }
    if (!sid) {
      sid = await this.createSession(chat, level)
      agent = await this.resolveAgent(sid)
    }
    this.sessionToChat.set(this.sessionKey(sid), chat.chatId)
    onReady?.(agent, chat, level)
    return { agent, sessionId: sid, level }
  }

  sessionKey(id: string): string {
    const s = String(id ?? '')
    return s.startsWith('session-') ? s.slice(8) : s
  }

  chatOfSession(sessionId: string): string {
    const key = this.sessionKey(sessionId)
    const live = this.sessionToChat.get(key)
    if (live) return live
    try {
      for (const [chatId, e] of Object.entries(this.readMap().chats)) {
        if (e && this.sessionKey(e.sessionId) === key) return chatId
      }
    } catch { /* ignore */ }
    return ''
  }

  sessions(): Record<string, SessionEntry> {
    return this.readMap().chats
  }

  /** 归档某聊天的会话，下条消息重新开始。 */
  resetChat(chatId: string): boolean {
    const m = this.readMap()
    const e = m.chats[chatId]
    if (!e) return false
    try { this.registry()?.archiveSession?.(e.sessionId) } catch { /* ignore */ }
    this.sessionToChat.delete(this.sessionKey(e.sessionId))
    delete m.chats[chatId]
    this.writeMap(m)
    return true
  }

  resetAll(): number {
    const reg = this.registry()
    const m = this.readMap()
    let n = 0
    for (const [chatId, e] of Object.entries(m.chats)) {
      try { Promise.resolve(reg?.archiveSession?.(e.sessionId)).catch(() => {}) } catch { /* ignore */ }
      this.sessionToChat.delete(this.sessionKey(e.sessionId))
      delete m.chats[chatId]
      n++
    }
    this.writeMap(m)
    return n
  }

  /** 投递一条用户消息给会话。steer=运行中插队；否则排队开新一轮。 */
  async deliver(agent: any, parts: PromptPart[], opts: { steer?: boolean } = {}): Promise<void> {
    const message = {
      id: randomUUID(),
      role: 'user',
      content: parts.filter(Boolean),
      source: { kind: SOURCE_KIND },
    }
    if (opts.steer && typeof agent.steer === 'function') await agent.steer(message)
    else agent.followup(message)
    try { await this.opts.dsh.sessions?.flush?.(agent.session) } catch { /* 落盘失败不影响对话 */ }
  }
}
