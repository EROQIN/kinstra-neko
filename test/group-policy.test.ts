import { describe, it, expect } from 'vitest'
import { decideGroupReply, inQuietHours, topicRelevance, policyFor } from '../src/chat/group-policy.js'
import type { GroupPolicy } from '../src/chat/group-policy.js'

const pol: GroupPolicy = {
  wakeWords: ['猫娘', 'neko'],
  interjectChance: 0.1,
  cooldownSec: 120,
  maxPerHour: 4,
  quietHours: [1, 8],
  minRecentMessages: 3,
  activeWindowSec: 300,
  interests: ['猫', '奶茶'],
  minRelevance: 0.25,
  burstMax: 6,
  burstWindowSec: 120,
  engagedMs: 180_000,
}

const now = 1_000_000_000_000
const base = {
  policy: pol, mentioned: false, repliedToBot: false, fromOwner: false, text: '今天天气不错',
  now, hour: 12, recentTimes: [], interjectTimes: [], botReplyTimes: [],
  relevance: 0, engagedUntil: 0, rand: () => 0.99, // 概率判定默认不命中
}

describe('decideGroupReply', () => {
  it('被 @ 必回', () => {
    const r = decideGroupReply({ ...base, mentioned: true })
    expect(r.reply).toBe(true)
    expect(r.mode).toBe('must')
  })

  it('引用了猫娘必回', () => {
    expect(decideGroupReply({ ...base, repliedToBot: true }).mode).toBe('must')
  })

  it('叫到叫醒词必回', () => {
    const r = decideGroupReply({ ...base, text: '猫娘在吗' })
    expect(r.reply).toBe(true)
    expect(r.reason).toContain('猫娘')
  })

  it('静默时段不插话（但被 @ 仍必回）', () => {
    expect(decideGroupReply({ ...base, hour: 3, recentTimes: [now - 1000, now - 2000, now - 3000] }).reply).toBe(false)
    expect(decideGroupReply({ ...base, hour: 3, mentioned: true }).reply).toBe(true)
  })

  it('群里消息不够多不插话', () => {
    const r = decideGroupReply({ ...base, recentTimes: [now - 1000] })
    expect(r.reply).toBe(false)
    expect(r.reason).toContain('没在聊')
  })

  it('冷却中不插话', () => {
    const r = decideGroupReply({
      ...base, relevance: 0.9, rand: () => 0,
      recentTimes: [now - 1000, now - 2000, now - 3000],
      interjectTimes: [now - 60_000], // 120 秒冷却内
    })
    expect(r.reply).toBe(false)
    expect(r.reason).toContain('冷却')
  })

  it('话题不相关不插话', () => {
    const r = decideGroupReply({
      ...base, relevance: 0.05, rand: () => 0,
      recentTimes: [now - 1000, now - 2000, now - 3000],
    })
    expect(r.reply).toBe(false)
    expect(r.reason).toContain('关系不大')
  })

  it('相关且概率命中则插话', () => {
    const r = decideGroupReply({
      ...base, relevance: 0.6, rand: () => 0,
      recentTimes: [now - 1000, now - 2000, now - 3000, now - 4000],
    })
    expect(r.reply).toBe(true)
    expect(r.mode).toBe('interject')
  })

  it('加入话题后顺着聊（不受冷却限制）', () => {
    const r = decideGroupReply({
      ...base, relevance: 0.5, rand: () => 0.99,
      recentTimes: [now - 1000],
      interjectTimes: [now - 10_000],
      engagedUntil: now + 60_000,
    })
    expect(r.reply).toBe(true)
    expect(r.mode).toBe('engaged')
  })

  it('防刷屏刹车：说太多就歇，但主人 @ 能叫动', () => {
    const many = Array.from({ length: 6 }, (_, i) => now - i * 10_000)
    expect(decideGroupReply({ ...base, botReplyTimes: many, mentioned: false, fromOwner: false }).reply).toBe(false)
    expect(decideGroupReply({ ...base, botReplyTimes: many, mentioned: true, fromOwner: true }).reply).toBe(true)
  })

  it('每小时插话上限', () => {
    const r = decideGroupReply({
      ...base, relevance: 0.9, rand: () => 0,
      recentTimes: [now - 1000, now - 2000, now - 3000],
      interjectTimes: Array.from({ length: 4 }, (_, i) => now - i * 60_000),
    })
    expect(r.reply).toBe(false)
    expect(r.reason).toContain('够多了')
  })
})

describe('辅助函数', () => {
  it('inQuietHours 跨午夜', () => {
    expect(inQuietHours(3, [1, 8])).toBe(true)
    expect(inQuietHours(10, [1, 8])).toBe(false)
    expect(inQuietHours(23, [23, 8])).toBe(true)
    expect(inQuietHours(0, [23, 8])).toBe(true)
  })

  it('topicRelevance 命中兴趣词与记忆分', () => {
    expect(topicRelevance(['今天喝了奶茶'], ['奶茶'])).toBeGreaterThan(0)
    expect(topicRelevance(['无关内容'], ['奶茶'])).toBe(0)
    expect(topicRelevance([''], ['奶茶'], 1)).toBeCloseTo(0.5)
  })

  it('policyFor 合并单群覆盖', () => {
    const p = policyFor(pol, { '123': { interjectChance: 0.5 } }, 123)
    expect(p.interjectChance).toBe(0.5)
    expect(p.wakeWords).toEqual(['猫娘', 'neko'])
    expect(policyFor(pol, {}, 999).interjectChance).toBe(0.1)
  })
})
