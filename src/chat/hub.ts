// 聊天中枢：QQ 事件 → 访问控制 → 群聊决策 → 分段聚合 → DSH 会话 → 回复拆条 → QQ。
// 裁剪自参考实现：去掉语音/表情库/文件/各娱乐平台，保留群聊分段、引用、@、戳一戳、
// 记忆注入、试运行观察与防刷屏。

import { randomUUID } from 'node:crypto'
import { mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../config/schema.js'
import type { Logger } from '../core/logger.js'
import { dataDir } from '../core/store.js'
import type { OneBotClient } from '../onebot/client.js'
import type { MessageEvent, NoticeEvent, OneBotEvent, Segment } from '../onebot/types.js'
import { parseMessageEvent } from '../onebot/segments.js'
import { checkAllowed, isOwner } from './access.js'
import { decideGroupReply, policyFor, topicRelevance, type ReplyMode } from './group-policy.js'
import { parseReply, bubbleDelay, type ReplyItem } from './reply.js'
import { expandMentions, hasMention } from './mentions.js'
import type { SessionManager, ChatRef, PromptPart } from '../sessions/manager.js'
import { buildSocialTools } from '../sessions/tools.js'
import type { MemoryStore } from '../memory/store.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const ENGAGE_FALLBACK = 3 * 60_000

interface GroupBufEntry {
  t: number; uid: string; nick: string; text: string; at: boolean; mid: string; replyId: string; fed?: boolean
}

interface PendingBatch {
  chat: ChatRef
  texts: string[]
  senders: Set<string>
  timer: NodeJS.Timeout | null
  firstAt: number
  mode: ReplyMode
  count: number
  waiting?: boolean
  autoReply?: { mid: string; uid: string }
}

interface TurnState {
  lastTurn: number
  text: string
  lastText: string
  speakers: string[]
}

export interface ObserveEntry {
  t: number
  chatId: string
  trigger: string
  reply: string
  items: Array<{ kind: string; value: string }>
  mode: ReplyMode | 'private'
}

export interface HubOptions {
  dsh: any
  config: () => Config
  setConfig: (patch: unknown) => Config
  /** 延迟取 OneBot 客户端（打破 hub↔client 构造循环）。 */
  onebot: () => OneBotClient
  sessions: SessionManager
  memory: MemoryStore
  log: Logger
}

export function createHub(opts: HubOptions) {
  const onebot = new Proxy({} as OneBotClient, {
    get(_t, prop) {
      const client = opts.onebot()
      const v = (client as any)[prop]
      return typeof v === 'function' ? v.bind(client) : v
    },
  })
  const sessions0 = opts.sessions
  const memory = opts.memory
  const log = opts.log
  const cfg = () => opts.config()

  const groupBuf = new Map<string, GroupBufEntry[]>()
  const groupInterjects = new Map<string, number[]>()
  const groupSaid = new Map<string, number[]>()
  const groupEngaged = new Map<string, number>()
  const groupNames = new Map<string, string>()
  const groupMembersCache = new Map<string, { at: number; list: any[] }>()
  const pokeAt = new Map<string, number>()

  const pending = new Map<string, PendingBatch>()
  const busy = new Map<string, number>()
  const running = new Set<string>()
  const turnState = new Map<string, TurnState>()
  const mountedTools = new Map<string, Array<() => void>>()

  const BUSY_MAX_MS = 4 * 60_000
  const isBusy = (chatId: string) => busy.has(chatId) && Date.now() - (busy.get(chatId) ?? 0) < BUSY_MAX_MS

  const stats = { received: 0, sent: 0, dryRun: 0, errors: 0, day: new Date().toDateString() }
  const bump = (k: keyof typeof stats) => {
    const d = new Date().toDateString()
    if (stats.day !== d) { stats.received = stats.sent = stats.dryRun = stats.errors = 0; stats.day = d }
    stats[k]++
  }

  // 试运行观察环形记录（最近 100 条"她本来会说什么"）
  const observeLog: ObserveEntry[] = []
  function recordObserve(e: ObserveEntry): void {
    observeLog.push(e)
    if (observeLog.length > 100) observeLog.shift()
    try {
      mkdirSync(dataDir(), { recursive: true })
      appendFileSync(dataDir('observe.jsonl'), JSON.stringify(e) + '\n', 'utf8')
    } catch { /* ignore */ }
  }
  function recentObserve(limit = 50): ObserveEntry[] {
    return observeLog.slice(-limit).reverse()
  }

  let selfId = ''

  // —— 群成员（真 @ 展开用，缓存 10 分钟）——
  async function membersOf(groupId: string): Promise<any[]> {
    const hit = groupMembersCache.get(groupId)
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list
    try {
      const r = await onebot.call('get_group_member_list', { group_id: Number(groupId) }, { timeoutMs: 15_000 })
      const list = Array.isArray(r) ? r : (r?.data ?? [])
      groupMembersCache.set(groupId, { at: Date.now(), list })
      return list
    } catch {
      return hit?.list ?? []
    }
  }

  async function groupName(gid: string): Promise<string> {
    if (groupNames.has(gid)) return groupNames.get(gid)!
    try {
      const info = await onebot.call('get_group_info', { group_id: Number(gid) }, { timeoutMs: 5000, retries: 0 })
      if (info?.group_name) groupNames.set(gid, info.group_name)
    } catch { /* ignore */ }
    return groupNames.get(gid) ?? gid
  }

  // —— 引用消息（拉取被引用的那条，转成简短文字）——
  async function quotedInfo(replyId: string): Promise<{ ok: boolean; who: string; uid: string; text: string; isBot: boolean } | null> {
    if (!replyId) return null
    try {
      const m = await onebot.call('get_msg', { message_id: Number(replyId) || replyId }, { timeoutMs: 5000, retries: 0 })
      const uid = String(m?.sender?.user_id ?? m?.user_id ?? '')
      const who = String(m?.sender?.card ?? m?.sender?.nickname ?? uid ?? '某人')
      const parsed = parseMessageEvent({
        post_type: 'message', message_type: 'group', user_id: Number(uid) || 0,
        sender: m?.sender ?? {}, message: m?.message ?? m?.raw_message ?? '', message_id: replyId,
      } as MessageEvent, selfId)
      return { ok: true, who, uid, text: (parsed.text || '（图片/表情）').slice(0, 200), isBot: uid === String(selfId) }
    } catch {
      return null
    }
  }

  // —— 发 QQ ——
  function targetOf(chatId: string): { kind: 'group' | 'private'; id: string } | null {
    const [kind, id] = chatId.split(':')
    if (kind !== 'group' && kind !== 'private') return null
    return { kind, id: id! }
  }

  async function sendSegments(chatId: string, message: Segment[], note: string): Promise<boolean> {
    const c = cfg()
    const tgt = targetOf(chatId)
    if (!tgt) return false
    if (!c.enabled) { log.info(`总开关关着，没发 → ${chatId}：${note}`); return false }
    if (c.dryRun) {
      log.info(`试运行（没真发）→ ${chatId}：${note}`)
      bump('dryRun')
      return false
    }
    const action = tgt.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
    const params = tgt.kind === 'group'
      ? { group_id: Number(tgt.id), message }
      : { user_id: Number(tgt.id), message }
    try {
      await onebot.call(action, params)
      bump('sent')
      return true
    } catch (error) {
      bump('errors')
      log.warn(`发到 ${chatId} 失败：${(error as Error).message}`)
      return false
    }
  }

  async function sendText(chatId: string, text: string, replyId?: string, mentionUid?: string): Promise<void> {
    let segs: Segment[] = [{ type: 'text', data: { text } }]
    if (chatId.startsWith('group:') && hasMention(text)) {
      segs = expandMentions(segs, await membersOf(chatId.slice(6)))
    }
    const head: Segment[] = []
    if (replyId) head.push({ type: 'reply', data: { id: String(replyId) } })
    if (mentionUid) head.push({ type: 'at', data: { qq: String(mentionUid) } }, { type: 'text', data: { text: ' ' } })
    const finalSegs = [...head, ...segs]
    if (finalSegs.every((s) => s.type === 'text' && !String(s.data.text ?? '').trim())) return
    await sendSegments(chatId, finalSegs, text.slice(0, 60))
  }

  // —— 回复落地 ——
  let refs = new Map<string, Map<number, { mid: string; uid: string }>>()

  async function deliver(chatId: string, text: string, opts: { autoReply?: { mid: string; uid: string }; mode: ReplyMode | 'private' }): Promise<void> {
    const c = cfg()
    const parsed = parseReply(text, c.reply.maxBubbles)
    if (parsed.silent) {
      log.info(`${chatId}：她选择不说话`)
      groupEngaged.delete(chatId.startsWith('group:') ? chatId.slice(6) : chatId)
      return
    }
    const items: ReplyItem[] = parsed.items
    const groupRefs = chatId.startsWith('group:') ? (refs.get(chatId) ?? new Map()) : new Map<number, { mid: string; uid: string }>()

    if (c.enabled && c.dryRun) {
      recordObserve({
        t: Date.now(), chatId, mode: opts.mode,
        trigger: '',
        reply: text.slice(0, 600),
        items: items.map((i) => ({ kind: i.kind, value: i.value.slice(0, 200) })),
      })
    }

    const firstTextIdx = items.findIndex((i) => i.kind === 'text')
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!
      let replyId: string | undefined
      let mentionUid: string | undefined
      if (it.replyTo) {
        const r = groupRefs.get(Number(it.replyTo))
        replyId = r?.mid
      } else if (i === firstTextIdx && opts.autoReply) {
        replyId = opts.autoReply.mid
        mentionUid = opts.autoReply.uid
      }
      if (it.kind === 'text') {
        await sendText(chatId, it.value, replyId, mentionUid)
      } else if (it.kind === 'poke') {
        const tgt = targetOf(chatId)
        if (tgt && c.enabled && !c.dryRun) {
          try {
            await onebot.call(tgt.kind === 'group' ? 'send_poke' : 'send_poke', tgt.kind === 'group'
              ? { group_id: Number(tgt.id), user_id: Number(mentionUid ?? groupLastSpeaker(chatId)) }
              : { user_id: Number(tgt.id) }, { timeoutMs: 10_000 })
          } catch (error) { log.debug(`戳一戳失败：${(error as Error).message}`) }
        } else {
          log.info(`试运行：想戳 ${chatId}`)
        }
      }
      if (i < items.length - 1 && c.reply.typingDelay && c.enabled && !c.dryRun) {
        await sleep(bubbleDelay(items[i + 1]!.kind === 'text' ? items[i + 1]!.value : ''))
      }
    }

    if (chatId.startsWith('group:')) {
      const gid = chatId.slice(6)
      const now = Date.now()
      const said = (groupSaid.get(gid) ?? []).filter((t) => now - t < 3600_000)
      said.push(now)
      groupSaid.set(gid, said)
      groupEngaged.set(gid, now + (c.group.engagedMs || ENGAGE_FALLBACK))
    }
  }

  function groupLastSpeaker(chatId: string): string {
    const gid = chatId.startsWith('group:') ? chatId.slice(6) : ''
    const buf = groupBuf.get(gid)
    return buf?.at(-1)?.uid ?? ''
  }

  // —— 群提示词 ——
  async function groupPrompt(chat: ChatRef, mode: ReplyMode): Promise<{ text: string; autoReply?: { mid: string; uid: string } }> {
    const c = cfg()
    const name = await groupName(chat.groupId!)
    const buf = groupBuf.get(chat.groupId!) ?? []
    const fresh = buf.filter((x) => !x.fed).slice(-20)
    const older = buf.filter((x) => x.fed).slice(-6)
    for (const x of buf) x.fed = true

    // 懒加载引用
    for (const x of fresh.filter((x) => x.replyId)) {
      if (!(x as any)._quote) {
        (x as any)._quote = await quotedInfo(x.replyId)
      }
    }

    const groupRefs = new Map<number, { mid: string; uid: string }>()
    refs.set(chat.chatId, groupRefs)
    const line = (x: GroupBufEntry) => {
      const q = (x as any)._quote as Awaited<ReturnType<typeof quotedInfo>> | undefined
      const quote = q?.ok ? `（引用 ${q.who}：「${q.text}」）` : ''
      return `${x.nick}(${x.uid})${x.at ? '@了你' : ''}：${x.text || '（图片/表情）'}${quote}`
    }
    const numbered = fresh.map((x, i) => {
      if (x.mid && x.mid !== '0') groupRefs.set(i + 1, { mid: x.mid, uid: x.uid })
      return `[${i + 1}] ${line(x)}`
    })

    const hint = mode === 'interject'
      ? '（没人叫你。只有你对这个话题真有话说、能自然接上时才插一句：接着话题说，别突然开新话题；接不上就只回 [沉默]）'
      : mode === 'engaged'
        ? '（你刚才在参与这个话题。想接着聊就接着说，话题和你没关系了就只回 [沉默]）'
        : '（有人在叫你，看完这一段再回）'

    const text =
      (older.length ? `【群聊 ${name}】之前在聊：\n${older.map(line).join('\n')}\n\n` : '') +
      `【群聊 ${name}】刚才新说的（${fresh.length} 条）${hint}\n${numbered.join('\n')}\n\n` +
      '把这一段当成整体来回：一般说一两句就好，回给最需要回的人或整个话题，不要一条条挨个回。\n' +
      '大多数时候直接说就行。只有想专门接某条、而直接说别人看不出你在回谁时，才在那句开头写 <reply:编号>；一次最多引用一条。\n' +
      '要 @ 某人写 <at:QQ号>，QQ 号就是名字后面括号里的数字。'

    const direct = fresh.filter((x) => x.at)
    const target = direct.length >= 1 ? direct.at(-1) : undefined
    return { text, autoReply: target && mode === 'must' ? { mid: target.mid, uid: target.uid } : undefined }
  }

  // —— 记忆注入 ——
  function memoryContext(chatId: string, query: string, speakers: string[]): string {
    if (!cfg().memory.enabled || !query.trim()) return ''
    const hits = memory.recall(query, { chatId, about: speakers })
    if (!hits.length) return ''
    const lines = hits.map((h) => `- ${h.fact.invalid ? '【可能已过时】' : ''}${h.fact.text}`)
    // 当前说话人的人物档案
    const profiles = [...new Set(speakers)].slice(0, 3).map((u) => {
      const t = memory.getProfile(u)
      return t ? `- 对 ${u} 的印象：${t}` : ''
    }).filter(Boolean)
    return `【你记得】（像自己想起来的一样自然地用，别照念）\n${[...lines, ...profiles].join('\n')}`
  }

  // —— 分段聚合 ——
  function enqueue(chat: ChatRef, text: string, senderId: string, mode: ReplyMode): void {
    const m = cfg().merge
    const p: PendingBatch = pending.get(chat.chatId) ?? {
      chat, texts: [], senders: new Set(), timer: null, firstAt: Date.now(), mode, count: 0,
    }
    p.count++
    if (mode === 'must') p.mode = 'must'
    else if (mode === 'engaged' && p.mode !== 'must') p.mode = 'engaged'
    p.texts.push(text)
    if (senderId) p.senders.add(String(senderId))
    pending.set(chat.chatId, p)
    if (p.timer) clearTimeout(p.timer)
    if (!m.enabled) { void flush(chat.chatId); return }
    const isGroup = chat.kind === 'group'
    const wait = (isGroup ? m.groupWaitSec : m.waitSec) * 1000
    const max = (isGroup ? m.groupMaxSec : m.maxSec) * 1000
    const left = Math.max(0, max - (Date.now() - p.firstAt))
    p.timer = setTimeout(() => { void flush(chat.chatId) }, Math.min(wait, left))
    p.timer.unref?.()
  }

  async function flush(chatId: string): Promise<void> {
    const p = pending.get(chatId)
    if (!p) return
    if (p.timer) clearTimeout(p.timer)

    // 她还在回上一段：攒着，回完由 release 触发
    if (isBusy(chatId)) { p.waiting = true; return }
    pending.delete(chatId)

    const speakers = [...p.senders]
    let promptText: string
    let autoReply: { mid: string; uid: string } | undefined
    if (p.chat.kind === 'group') {
      const gid = p.chat.groupId!
      if (p.mode === 'interject') {
        const arr = (groupInterjects.get(gid) ?? []).filter((t) => Date.now() - t < 3_600_000)
        arr.push(Date.now())
        groupInterjects.set(gid, arr)
      }
      const gp = await groupPrompt(p.chat, p.mode)
      promptText = gp.text
      autoReply = gp.autoReply
    } else {
      promptText = p.texts.join('\n')
    }

    busy.set(chatId, Date.now())
    running.add(chatId)
    try {
      const parts: PromptPart[] = []
      // 私聊记忆（群记忆也加，帮助接话）
      const queryForMemory = p.chat.kind === 'group'
        ? (groupBuf.get(p.chat.groupId!) ?? []).filter((x) => !x.fed).map((x) => x.text).join(' ') || promptText.slice(-400)
        : promptText.replace(/^【私聊】[^：]*：/, '').slice(-400)
      const mem = memoryContext(chatId, queryForMemory, speakers)
      if (mem) parts.push({ type: 'text', text: mem })
      parts.push({ type: 'text', text: promptText })
      const { agent } = await sessions0.agentFor(p.chat, mountOnce)
      const message = {
        id: randomUUID(), role: 'user' as const,
        content: parts.filter((x) => x.type === 'text' && x.text) as any,
        source: { kind: 'kinstra' } as any,
      }
      agent.followup(message)
      // 私聊"正在输入…"
      if (p.chat.kind === 'private' && cfg().reply.showInputStatus && cfg().enabled && !cfg().dryRun) {
        const tgt = targetOf(chatId)
        if (tgt) onebot.call('set_input_status', { user_id: Number(tgt.id), event_type: 1 }, { timeoutMs: 5000, retries: 0 }).catch(() => {})
      }
      ;(flushingAutoReply as any).set(chatId, autoReply)
      ;(flushingMode as any).set(chatId, p.mode)
      try { await opts.dsh.sessions?.flush?.(agent.session) } catch { /* ignore */ }
    } catch (error) {
      bump('errors')
      release(chatId)
      log.error(`转进 DSH 失败（${chatId}）：${(error as Error).message}`)
    }
  }

  const flushingAutoReply = new Map<string, { mid: string; uid: string } | undefined>()
  const flushingMode = new Map<string, ReplyMode | 'private'>()

  function release(chatId: string): void {
    busy.delete(chatId)
    running.delete(chatId)
    const p = pending.get(chatId)
    if (p?.waiting) { p.waiting = false; void flush(chatId) }
  }

  // 每个会话只挂一次社交工具 + 常驻上下文
  function mountOnce(agent: any, chat: ChatRef, level: 'full' | 'social'): void {
    const sid = sessions0.sessionKey(agent.session?.id ?? agent.id)
    if (mountedTools.has(sid)) return
    const disposers: Array<() => void> = []
    const speakersNow = () => turnState.get(sid)?.speakers ?? []
    for (const tool of buildSocialTools({ chat, memory, speakers: speakersNow })) {
      try {
        const off = agent.ctx.tools.register(tool)
        disposers.push(() => { try { off() } catch { /* ignore */ } })
      } catch (error) { log.debug(`工具 ${tool.name} 挂不上：${(error as Error).message}`) }
    }
    try {
      const off = agent.ctx.systemPrompt.context({
        name: 'kinstra-context',
        order: 905,
        text: () => {
          const st = turnState.get(sid)
          if (!st || !st.speakers.length) return ''
          const profiles = st.speakers.slice(0, 3).map((u) => {
            const t = memory.getProfile(u)
            return t ? `- QQ ${u}：${t}` : ''
          }).filter(Boolean)
          return profiles.length ? `【群里这些人的小档案】\n${profiles.join('\n')}` : ''
        },
      })
      disposers.push(() => { try { off() } catch { /* ignore */ } })
    } catch { /* ignore */ }
    mountedTools.set(sid, disposers)
  }

  // —— 收 DSH 会话事件 ——
  function textOf(message: any): string {
    if (!message || !Array.isArray(message.content)) return ''
    return message.content.filter((b: any) => b && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n').trim()
  }

  function onSessionEvent(session: any, event: any): void {
    const key = sessions0.sessionKey(session?.id)
    const chatId = sessions0.chatOfSession(session?.id)
    if (!chatId || !event) return
    const st: TurnState = turnState.get(key) ?? { lastTurn: -1, text: '', lastText: '', speakers: [] }
    turnState.set(key, st)

    if (event.type === 'assistant/message') {
      if (event.data?.interrupted) return
      const t = textOf(event.data?.message)
      if (t) { st.lastTurn = event.data.turn; st.text = t }
      return
    }
    if (event.type !== 'turn/end') return
    const completed = event.data?.reason?.kind === 'completed'
    const text = st.lastTurn === event.data?.turn ? st.text : ''
    const autoReply = flushingAutoReply.get(chatId)
    const mode = flushingMode.get(chatId) ?? 'private'
    flushingAutoReply.delete(chatId)
    flushingMode.delete(chatId)
    st.text = ''
    if (!completed) {
      log.warn(`${chatId} 这一轮没正常结束（${event.data?.reason?.kind ?? '?'}），不发`)
      release(chatId)
      return
    }
    if (!text) { release(chatId); return }
    void deliver(chatId, text, { autoReply, mode }).catch((e) => log.warn(`发送出错：${(e as Error).message}`)).finally(() => release(chatId))
  }

  // —— 收 QQ ——
  async function onMessage(event: MessageEvent): Promise<void> {
    selfId = String(event.self_id ?? selfId ?? cfg().botQQ)
    const c = cfg()
    const msg = parseMessageEvent(event, selfId)
    if (msg.userId === selfId) return
    bump('received')

    if (msg.kind === 'group') {
      const buf = groupBuf.get(msg.groupId) ?? []
      buf.push({ t: Date.now(), uid: msg.userId, nick: msg.nickname, text: msg.text, at: msg.mentioned, mid: msg.messageId, replyId: msg.replyId })
      while (buf.length > 40) buf.shift()
      groupBuf.set(msg.groupId, buf)
    }

    const allowed = checkAllowed(c, msg)
    if (!allowed.allowed) { log.debug(`忽略 ${msg.chatId}（${allowed.reason}）`); return }
    if (!c.enabled) { log.info(`总开关关着：${msg.chatId} ${msg.text.slice(0, 30)}`); return }

    const chat: ChatRef = {
      chatId: msg.chatId, kind: msg.kind,
      groupId: msg.groupId || undefined, userId: msg.userId, nickname: msg.nickname,
    }

    let mode: ReplyMode = 'must'
    if (msg.kind === 'group') {
      const pol0 = policyFor(c.group, c.group.overrides as any, msg.groupId)
      const now = Date.now()
      const recentTexts = (groupBuf.get(msg.groupId) ?? []).filter((x) => now - x.t < pol0.activeWindowSec * 1000).slice(-6).map((x) => x.text)
      const rel = topicRelevance(recentTexts, pol0.interests, 0)
      const quotedBot = msg.replyId ? ((await quotedInfo(msg.replyId))?.isBot ?? false) : false
      const decision = decideGroupReply({
        policy: pol0, mentioned: msg.mentioned, repliedToBot: quotedBot,
        fromOwner: isOwner(c, msg.userId), text: msg.text, now, hour: new Date().getHours(),
        recentTimes: (groupBuf.get(msg.groupId) ?? []).map((x) => x.t),
        interjectTimes: groupInterjects.get(msg.groupId) ?? [],
        botReplyTimes: groupSaid.get(msg.groupId) ?? [],
        relevance: rel, engagedUntil: groupEngaged.get(msg.groupId) ?? 0,
      })
      if (!decision.reply) {
        log.debug(`群 ${msg.groupId}：不回（${decision.reason}）`)
        return
      }
      mode = decision.mode
      log.info(`群 ${msg.groupId}：${decision.reason}`)
    }

    // 语音转写：NapCat/SnowLuma 通常已在消息段给出文字；没有文字时尝试 QQ 自带转写
    let text = msg.text
    if (!text && msg.records.length) {
      try {
        const r = await onebot.call('fetch_ptt_text', { message_id: Number(msg.messageId) || msg.messageId }, { timeoutMs: 15_000, retries: 0 })
        if (r?.text) text = `[语音] ${r.text}`
      } catch { text = '[发来一条语音，没听清]' }
      if (!text) text = '[发来一条语音]'
      const buf = groupBuf.get(msg.groupId ?? '')
      if (buf) { const last = buf.findLast?.((x) => x.uid === msg.userId); if (last) last.text = text }
    }
    if (!text) text = msg.images.length || msg.stickers.length ? '[图片/表情]' : ''

    // 拼私聊文案
    let body: string
    if (msg.kind === 'private') {
      const prefix = isOwner(c, msg.userId) ? `【私聊】${c.ownerName || '主人'}(${msg.userId})：` : `【私聊】${msg.nickname}(${msg.userId})：`
      let quoted = ''
      if (msg.replyId) {
        const q = await quotedInfo(msg.replyId)
        if (q?.ok) quoted = `\n（引用 ${q.who}：「${q.text}」）`
      }
      body = prefix + (text || '（图片/表情）') + quoted
      enqueue(chat, body, msg.userId, 'must')
    } else {
      enqueue(chat, text || '（图片/表情）', msg.userId, mode)
    }
  }

  async function onPoke(ev: NoticeEvent): Promise<void> {
    const self = String(ev.self_id ?? selfId ?? cfg().botQQ)
    if (String(ev.target_id ?? '') !== self) return
    const group = ev.group_id ? String(ev.group_id) : ''
    const poker = String(group ? ev.user_id : (ev.sender_id ?? ev.user_id))
    if (!poker || poker === self) return
    const chatId = group ? `group:${group}` : `private:${poker}`
    if (Date.now() - (pokeAt.get(chatId) ?? 0) < 20_000) return
    pokeAt.set(chatId, Date.now())
    log.info(`${chatId}：被戳了戳`)
    await onMessage({
      post_type: 'message', message_type: group ? 'group' : 'private',
      self_id: Number(self), user_id: Number(poker) || 0,
      ...(group ? { group_id: Number(group) } : {}),
      message_id: 0,
      sender: { user_id: Number(poker) || 0, nickname: poker },
      message: [{ type: 'at', data: { qq: self } }, { type: 'text', data: { text: ` [戳了戳你${ev.action ? '：' + ev.action : ''}]` } }],
    } as MessageEvent)
  }

  function dispatchEvent(ev: OneBotEvent): void {
    const e = ev as any
    if (e.post_type === 'message') void onMessage(e as MessageEvent)
    else if (e.post_type === 'notice' && e.notice_type === 'notify' && e.sub_type === 'poke') void onPoke(e as NoticeEvent)
  }

  return {
    dispatchEvent,
    onSessionEvent,
    recentObserve,
    stats: () => ({ ...stats }),
    resetChat: (chatId: string) => sessions0.resetChat(chatId),
    resetAll: () => sessions0.resetAll(),
    groupName,
  }
}

export type Hub = ReturnType<typeof createHub>
