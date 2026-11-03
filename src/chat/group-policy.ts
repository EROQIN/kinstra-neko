// 群聊发言策略：什么时候必回、什么时候插话、什么时候闭嘴。纯函数，完整单测覆盖。
//
// 出厂性格是"低打扰"：被 @ / 引用 / 叫名字必回；未被叫到时只在话题相关、
// 群里正在热闹、且过了冷却期时，以一个小概率自然插话。她说过话后的短时间内
// 处于"加入话题"状态，别人接着聊她会顺着说（不受冷却限制）。

export type ReplyMode = 'must' | 'interject' | 'engaged' | 'none'

export interface GroupPolicy {
  wakeWords: string[]
  interjectChance: number
  cooldownSec: number
  maxPerHour: number
  quietHours: [number, number]
  minRecentMessages: number
  activeWindowSec: number
  interests: string[]
  minRelevance: number
  burstMax: number
  burstWindowSec: number
  engagedMs: number
}

export interface DecideInput {
  policy: GroupPolicy
  mentioned: boolean
  repliedToBot: boolean
  fromOwner: boolean
  text: string
  now: number
  hour: number
  recentTimes: number[]          // 本群最近消息时间戳
  interjectTimes: number[]      // 本群最近"插话"时间戳
  botReplyTimes: number[]       // 本群她每次说话的时间戳
  relevance?: number            // 0~1，外部（记忆/关键词）算出的话题相关度
  engagedUntil?: number         // 她加入话题到何时
  rand?: () => number
}

export interface DecideResult {
  reply: boolean
  mode: ReplyMode
  reason: string
}

export function inQuietHours(hour: number, quiet: [number, number]): boolean {
  const [a, b] = quiet
  if (a === b) return false
  return a < b ? hour >= a && hour < b : hour >= a || hour < b
}

/** 群里最近的话题与她的兴趣/记忆有多相关（0~1）。 */
export function topicRelevance(recentTexts: string[], interests: string[], memoryScore = 0): number {
  const txt = (recentTexts ?? []).join(' ')
  let hits = 0
  for (const w of interests ?? []) if (w && txt.includes(w)) hits++
  return Math.min(1, hits * 0.3 + Math.max(0, Math.min(1, memoryScore)) * 0.5)
}

export function decideGroupReply(input: DecideInput): DecideResult {
  const pol = input.policy
  const rand = input.rand ?? Math.random
  const said = input.botReplyTimes ?? []

  // 安全刹车：短时间说太多就歇会儿，只有主人 @ 能叫动
  const burst = said.filter((t) => input.now - t < pol.burstWindowSec * 1000).length
  if (burst >= pol.burstMax && !(input.fromOwner && (input.mentioned || input.repliedToBot))) {
    return { reply: false, mode: 'none', reason: `刚刚说了太多（${burst} 次），歇一会儿` }
  }

  if (input.mentioned) return { reply: true, mode: 'must', reason: '被 @' }
  if (input.repliedToBot) return { reply: true, mode: 'must', reason: '引用了猫娘的消息' }
  const hit = (pol.wakeWords ?? []).find((w) => w && input.text.includes(w))
  if (hit) return { reply: true, mode: 'must', reason: `叫到了「${hit}」` }

  const rel = typeof input.relevance === 'number' ? input.relevance : 1
  if (!(pol.interjectChance > 0)) return { reply: false, mode: 'none', reason: '插话关着' }
  if (inQuietHours(input.hour, pol.quietHours)) return { reply: false, mode: 'none', reason: '静默时段' }

  // 已加入话题：顺着聊，不受冷却/每小时上限限制
  if (input.engagedUntil && input.now < input.engagedUntil && rel >= pol.minRelevance) {
    return { reply: true, mode: 'engaged', reason: `正聊得起劲，接着说（相关度 ${rel.toFixed(2)}）` }
  }

  const lastHour = (input.interjectTimes ?? []).filter((t) => input.now - t < 3_600_000).length
  if (lastHour >= pol.maxPerHour) return { reply: false, mode: 'none', reason: '这小时插话够多了' }
  const last = (input.interjectTimes ?? []).length ? Math.max(...input.interjectTimes!) : 0
  if (input.now - last < pol.cooldownSec * 1000) return { reply: false, mode: 'none', reason: '插话冷却中' }

  const recent = (input.recentTimes ?? []).filter((t) => input.now - t < pol.activeWindowSec * 1000).length
  if (recent < pol.minRecentMessages) return { reply: false, mode: 'none', reason: '群里没在聊' }
  if (pol.minRelevance > 0 && rel < pol.minRelevance) {
    return { reply: false, mode: 'none', reason: `话题和她关系不大（相关度 ${rel.toFixed(2)}）` }
  }

  // 越相关越容易插，封顶 80%
  const chance = pol.minRelevance > 0
    ? Math.min(0.8, pol.interjectChance * (1 + 4 * rel))
    : pol.interjectChance
  if (rand() < chance) return { reply: true, mode: 'interject', reason: `话题相关，插一句（相关度 ${rel.toFixed(2)}）` }
  return { reply: false, mode: 'none', reason: '这次不插话' }
}

/** 合并全局策略与单群覆盖。 */
export function policyFor<G extends GroupPolicy>(global: G, overrides: Record<string, Partial<G>> | undefined, groupId: string | number): G {
  const o = overrides?.[String(groupId)]
  return o ? { ...global, ...o } : { ...global }
}
