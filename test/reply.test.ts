import { describe, it, expect } from 'vitest'
import { parseReply, isSilence, stripMarkdown, splitLines, bubbleDelay } from '../src/chat/reply.js'

describe('parseReply', () => {
  it('沉默', () => {
    expect(parseReply('[沉默]').silent).toBe(true)
    expect(parseReply('').silent).toBe(true)
    expect(parseReply('（沉默）').silent).toBe(true)
  })

  it('普通文字', () => {
    const r = parseReply('你好呀')
    expect(r.silent).toBe(false)
    expect(r.items).toEqual([{ kind: 'text', value: '你好呀' }])
  })

  it('多气泡拆分', () => {
    const r = parseReply('第一句\n第二句')
    expect(r.items.filter((i) => i.kind === 'text')).toHaveLength(2)
  })

  it('||| 分隔', () => {
    const r = parseReply('a|||b')
    expect(r.items.map((i) => i.value)).toEqual(['a', 'b'])
  })

  it('引用标记挂到下一条气泡', () => {
    const r = parseReply('<reply:3> 就是这个')
    expect(r.items[0]?.replyTo).toBe('3')
  })

  it('戳一戳', () => {
    const r = parseReply('嗨<poke>')
    expect(r.items.some((i) => i.kind === 'poke')).toBe(true)
  })

  it('一轮最多引用一次', () => {
    const r = parseReply('<reply:1>a\n<reply:2>b')
    const quoted = r.items.filter((i) => i.replyTo)
    expect(quoted).toHaveLength(1)
  })

  it('洗掉 Markdown', () => {
    expect(stripMarkdown('**粗**和`code`')).toBe('粗和code')
    expect(stripMarkdown('# 标题')).toBe('标题')
  })

  it('短行拆开、代码块不拆', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
    expect(splitLines('```\nx\ny\n```')).toEqual(['```\nx\ny\n```'])
  })

  it('气泡延迟在 560~4500ms', () => {
    expect(bubbleDelay('', () => 0)).toBeGreaterThanOrEqual(560)
    expect(bubbleDelay('一长串文字'.repeat(50), () => 1)).toBeLessThanOrEqual(4500)
  })

  it('isSilence', () => {
    expect(isSilence('[沉默]')).toBe(true)
    expect(isSilence('  ［沉默］ ')).toBe(true)
    expect(isSilence('说话')).toBe(false)
  })
})
