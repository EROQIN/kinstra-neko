import { describe, it, expect } from 'vitest'
import { tokenize, buildIndex, searchIndex, retention, type Fact } from '../src/memory/store.js'

describe('记忆切词与检索', () => {
  it('英文整词、中文二元组、停用字', () => {
    const t = tokenize('我喜欢奶茶和anime')
    expect(t).toContain('anime')
    expect(t).toContain('喜欢')
    expect(t).toContain('奶茶')
    expect(t).not.toContain('我')
  })

  it('BM25 检索能找到相关事实', () => {
    const facts: Fact[] = [
      { id: '1', t: 1, chatId: 'g', about: '', text: '小明喜欢喝奶茶', tags: [], importance: 0.5, lastRecall: Date.now(), recallCount: 0 },
      { id: '2', t: 2, chatId: 'g', about: '', text: '今天下雨了', tags: [], importance: 0.5, lastRecall: Date.now(), recallCount: 0 },
    ]
    const idx = buildIndex(facts)
    const hits = searchIndex(idx, '奶茶', { limit: 5 })
    expect(hits[0]?.fact.id).toBe('1')
  })

  it('关于谁的记忆加权', () => {
    const facts: Fact[] = [
      { id: '1', t: 1, chatId: 'g', about: '200', text: '小红在养猫', tags: [], importance: 0.5, lastRecall: Date.now(), recallCount: 0 },
      { id: '2', t: 2, chatId: 'g', about: '300', text: '养猫很开心', tags: [], importance: 0.5, lastRecall: Date.now(), recallCount: 0 },
    ]
    const idx = buildIndex(facts)
    const hits = searchIndex(idx, '养猫', { about: ['200'] })
    expect(hits[0]?.fact.about).toBe('200')
  })

  it('过时事实默认不召回', () => {
    const facts: Fact[] = [
      { id: '1', t: 1, chatId: 'g', about: '', text: '奶茶', tags: [], importance: 0.5, lastRecall: Date.now(), recallCount: 0, invalid: true },
    ]
    const idx = buildIndex(facts)
    expect(searchIndex(idx, '奶茶')).toHaveLength(0)
    expect(searchIndex(idx, '奶茶', { includeInvalid: true })).toHaveLength(1)
  })

  it('遗忘曲线：越久没想起记得越不牢', () => {
    const now = Date.now()
    const strong: Fact = { id: '1', t: now, chatId: '', about: '', text: 'x', tags: [], importance: 0.9, lastRecall: now, recallCount: 5 }
    const weak: Fact = { id: '2', t: now - 100 * 86_400_000, chatId: '', about: '', text: 'x', tags: [], importance: 0.1, lastRecall: now - 100 * 86_400_000, recallCount: 0 }
    expect(retention(strong, now)).toBeGreaterThan(retention(weak, now))
    expect(retention(weak, now)).toBeLessThan(0.05)
  })
})
