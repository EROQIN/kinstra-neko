// 轻量长期记忆：JSONL 磁盘事实库 + 热群有限内存倒排索引（中文二元切词 BM25），
// 叠加「关于谁 / 重要度 / 遗忘曲线」加权。
//
// 2G 内存策略：
// - 事实全部在磁盘（append-only JSONL，定期 compaction）；
// - 只有最近活跃的「热群」在内存保有倒排索引，按 LRU 淘汰（默认 8 群 × 400 条）；
// - 冷群查询只扫最近 K 条建一次性索引，用完即弃；
// - 人物档案是小 JSON（白名单群的人数量级），常驻。

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, ensureDir, writeJson } from '../core/store.js'
import type { Logger } from '../core/logger.js'

// —— 纯函数：切词与打分 ——

const STOP = new Set('的了是我你他她它们在有和就不也都很吗吧呢啊呀哦嗯这那个一上下来去说要会能着过'.split(''))

export function tokenize(text: string): string[] {
  const out: string[] = []
  const s = String(text ?? '').toLowerCase()
  for (const m of s.matchAll(/[a-z0-9_]{2,}|[一-鿿]+/g)) {
    const w = m[0]
    if (/^[a-z0-9_]+$/.test(w)) { out.push(w); continue }
    if (w.length === 1) { if (!STOP.has(w)) out.push(w); continue }
    for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2))
  }
  return out
}

export interface Fact {
  id: string
  t: number                 // 记住的时间
  chatId: string
  about: string             // 关于谁的 QQ 号（空 = 群公共记忆）
  aboutName?: string
  text: string
  tags: string[]
  importance: number        // 0~1
  lastRecall: number
  recallCount: number
  invalid?: boolean         // 过时不删，只标记
}

interface IndexDoc { tf: Map<string, number>; len: number; fact: Fact }
interface Index { docs: IndexDoc[]; df: Map<string, number>; avgLen: number; n: number }

export function buildIndex(facts: Fact[]): Index {
  const df = new Map<string, number>()
  const docs: IndexDoc[] = facts.map((fact) => {
    const toks = tokenize(`${fact.text} ${fact.tags.join(' ')} ${fact.aboutName ?? ''}`)
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    return { tf, len: toks.length || 1, fact }
  })
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1)
  return { docs, df, avgLen, n: docs.length }
}

/** 记得多牢：多久没想起、被想起次数、重要度 —— 常聊到的忘得慢。返回 0~1。 */
export function retention(f: Fact, now = Date.now()): number {
  const daysSince = Math.max(0, (now - f.lastRecall) / 86_400_000)
  const strength = 0.35 + 0.4 * f.importance + Math.min(0.25, f.recallCount * 0.05)
  // 指数遗忘：半衰期随记忆强度 3~30 天
  const halfLifeDays = 3 + strength * 27
  return strength * Math.pow(0.5, daysSince / halfLifeDays)
}

export interface SearchHit { fact: Fact; score: number }

export function searchIndex(
  idx: Index,
  query: string,
  options: { about?: string[]; now?: number; limit?: number; minScore?: number; includeInvalid?: boolean } = {},
): SearchHit[] {
  const now = options.now ?? Date.now()
  const aboutSet = new Set((options.about ?? []).map(String))
  const limit = options.limit ?? 5
  const q = [...new Set(tokenize(query))]
  const k1 = 1.4
  const b = 0.7
  const hits: SearchHit[] = []
  for (const d of idx.docs) {
    if (d.fact.invalid && !options.includeInvalid) continue
    let s = 0
    for (const t of q) {
      const f = d.tf.get(t)
      if (!f) continue
      const dfCount = idx.df.get(t) ?? 0
      const idf = Math.log(1 + (idx.n - dfCount + 0.5) / (dfCount + 0.5))
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / idx.avgLen))
    }
    // 关于当前说话人的记忆加权
    if (aboutSet.has(String(d.fact.about))) s *= 1.4
    s *= 0.4 + retention(d.fact, now)
    if (s > 0) hits.push({ fact: d.fact, score: s })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

// —— 存储 ——

export interface MemoryOptions {
  hotGroups?: number
  hotIndexPerGroup?: number
  recallCount?: number
  log: Logger
}

export interface AddInput {
  text: string
  chatId: string
  about?: string
  aboutName?: string
  tags?: string[]
  importance?: number
}

export class MemoryStore {
  private factsFile = () => dataDir('memory', 'facts.jsonl')
  private profilesFile = () => dataDir('memory', 'profiles.json')
  private all: Fact[] = []
  private loaded = false
  private hot = new Map<string, Index>()       // chatId → 热索引
  private lru: string[] = []                   // 热群 LRU 顺序，尾部最新
  private profiles = new Map<string, { name: string; text: string; t: number }>()
  private opts: Required<Omit<MemoryOptions, 'log'>> & { log: Logger }

  constructor(options: MemoryOptions) {
    this.opts = {
      hotGroups: options.hotGroups ?? 8,
      hotIndexPerGroup: options.hotIndexPerGroup ?? 400,
      recallCount: options.recallCount ?? 5,
      log: options.log,
    }
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    const f = this.factsFile()
    if (existsSync(f)) {
      try {
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          const t = line.trim()
          if (!t) continue
          try { this.all.push(JSON.parse(t) as Fact) } catch { /* 跳过坏行 */ }
        }
      } catch (error) {
        this.opts.log.warn(`记忆库读取失败，从空记忆开始：${(error as Error).message}`)
      }
    }
    // 内存上限保护：磁盘全量保留，内存只装最近一段（远大于热索引预算即可，供 compaction）
    if (this.all.length > this.opts.hotGroups * this.opts.hotIndexPerGroup * 2) {
      this.all = this.all.slice(-this.opts.hotGroups * this.opts.hotIndexPerGroup * 2)
    }
    if (existsSync(this.profilesFile())) {
      try {
        const obj = JSON.parse(readFileSync(this.profilesFile(), 'utf8')) as Record<string, { name: string; text: string; t: number }>
        this.profiles = new Map(Object.entries(obj))
      } catch { /* ignore */ }
    }
  }

  add(input: AddInput): Fact {
    this.load()
    const now = Date.now()
    const fact: Fact = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      t: now,
      chatId: input.chatId,
      about: String(input.about ?? ''),
      aboutName: input.aboutName,
      text: String(input.text).slice(0, 500),
      tags: (input.tags ?? []).slice(0, 8),
      importance: Math.max(0, Math.min(1, input.importance ?? 0.5)),
      lastRecall: now,
      recallCount: 0,
    }
    this.all.push(fact)
    try {
      ensureDir(join(dataDir('memory')))
      appendFileSync(this.factsFile(), JSON.stringify(fact) + '\n', 'utf8')
    } catch (error) {
      this.opts.log.warn(`记忆落盘失败：${(error as Error).message}`)
    }
    this.hot.delete(fact.chatId) // 该群索引失效，下次查询惰性重建
    return fact
  }

  private factsOfChat(chatId: string): Fact[] {
    return this.all.filter((f) => f.chatId === chatId).slice(-this.opts.hotIndexPerGroup)
  }

  private touchLru(chatId: string): void {
    const i = this.lru.indexOf(chatId)
    if (i >= 0) this.lru.splice(i, 1)
    this.lru.push(chatId)
    while (this.lru.length > this.opts.hotGroups) {
      const evict = this.lru.shift()!
      if (evict !== chatId) this.hot.delete(evict)
    }
  }

  /** 取某群索引（热群缓存）。 */
  private indexFor(chatId: string): Index {
    const cached = this.hot.get(chatId)
    if (cached) { this.touchLru(chatId); return cached }
    const idx = buildIndex(this.factsOfChat(chatId))
    this.hot.set(chatId, idx)
    this.touchLru(chatId)
    return idx
  }

  recall(query: string, options: { chatId: string; about?: string[] }): SearchHit[] {
    this.load()
    if (!query.trim()) return []
    const idx = this.indexFor(options.chatId)
    const hits = searchIndex(idx, query, { about: options.about, limit: this.opts.recallCount })
    const now = Date.now()
    for (const h of hits) {
      h.fact.lastRecall = now
      h.fact.recallCount++
    }
    if (hits.length) this.scheduleFlush()
    return hits
  }

  private flushTimer: NodeJS.Timeout | null = null
  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.compact()
    }, 30_000)
    this.flushTimer.unref?.()
  }

  getProfile(qq: string): string {
    this.load()
    return this.profiles.get(String(qq))?.text ?? ''
  }

  setProfile(qq: string, name: string, text: string): void {
    this.load()
    this.profiles.set(String(qq), { name, text: String(text).slice(0, 800), t: Date.now() })
    try {
      writeJson(this.profilesFile(), Object.fromEntries(this.profiles))
    } catch (error) {
      this.opts.log.warn(`人物档案保存失败：${(error as Error).message}`)
    }
  }

  listProfiles(): Array<{ qq: string; name: string; text: string }> {
    this.load()
    return [...this.profiles.entries()].map(([qq, v]) => ({ qq, ...v }))
  }

  /** 重写 facts.jsonl：把 lastRecall / recallCount / invalid 等更新落盘。 */
  compact(): void {
    this.load()
    try {
      mkdirSync(dataDir('memory'), { recursive: true })
      const lines = this.all.map((x) => JSON.stringify(x)).join('\n') + '\n'
      writeJson(this.factsFile() + '.snap', {}) // 确保原子写目录存在
      writeFileSync(this.factsFile(), lines, 'utf8')
      try { unlinkSync(this.factsFile() + '.snap') } catch { /* ignore */ }
    } catch (error) {
      this.opts.log.warn(`记忆整理失败：${(error as Error).message}`)
    }
  }

  stats(): { facts: number; hotGroups: number; profiles: number } {
    this.load()
    return { facts: this.all.length, hotGroups: this.hot.size, profiles: this.profiles.size }
  }
}
