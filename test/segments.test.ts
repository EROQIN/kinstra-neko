import { describe, it, expect } from 'vitest'
import { parseMessageEvent, isStickerSegment, mimeOf } from '../src/onebot/segments.js'
import type { MessageEvent } from '../src/onebot/types.js'

const selfId = '10001'

function event(partial: Partial<MessageEvent>): MessageEvent {
  return {
    post_type: 'message', message_type: 'group', message_id: 1, user_id: 200,
    self_id: 10001, group_id: 300, sender: { user_id: 200, nickname: '小明' },
    message: [], ...partial,
  }
}

describe('parseMessageEvent', () => {
  it('纯文字群消息', () => {
    const p = parseMessageEvent(event({ message: [{ type: 'text', data: { text: '你好' } }] }), selfId)
    expect(p.kind).toBe('group')
    expect(p.chatId).toBe('group:300')
    expect(p.text).toBe('你好')
    expect(p.mentioned).toBe(false)
  })

  it('@ 机器人识别', () => {
    const p = parseMessageEvent(event({
      message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: '在吗' } }],
    }), selfId)
    expect(p.mentioned).toBe(true)
    expect(p.text).toBe('在吗')
  })

  it('@ 别人转成文字', () => {
    const p = parseMessageEvent(event({
      message: [{ type: 'at', data: { qq: '999', name: '小红' } }],
    }), selfId)
    expect(p.mentioned).toBe(false)
    expect(p.text).toContain('小红')
  })

  it('引用、图片、表情包、语音、合并转发', () => {
    const p = parseMessageEvent(event({
      message: [
        { type: 'reply', data: { id: '888' } },
        { type: 'image', data: { url: 'x' } },
        { type: 'mface', data: { url: 'y' } },
        { type: 'record', data: { file: 'a.silk' } },
        { type: 'forward', data: { id: 'res1' } },
      ],
    }), selfId)
    expect(p.replyId).toBe('888')
    expect(p.images).toHaveLength(1)
    expect(p.stickers).toHaveLength(1)
    expect(p.records).toHaveLength(1)
    expect(p.forwards).toEqual(['res1'])
  })

  it('sub_type=1 的 image 是表情包', () => {
    expect(isStickerSegment({ type: 'image', data: { sub_type: 1 } })).toBe(true)
    expect(isStickerSegment({ type: 'image', data: {} })).toBe(false)
    expect(isStickerSegment({ type: 'mface', data: {} })).toBe(true)
  })

  it('字符串 CQ 码消息兜底', () => {
    const p = parseMessageEvent(event({ message: '[CQ:at,qq=10001] 好' as unknown as any }), selfId)
    expect(p.text).toBe('好')
  })

  it('私聊', () => {
    const p = parseMessageEvent(event({ message_type: 'private', message: [{ type: 'text', data: { text: '嗨' } }] } as any), selfId)
    expect(p.chatId).toBe('private:200')
  })

  it('MIME 识别', () => {
    expect(mimeOf(Buffer.from([...[0x89, 0x50, 0x4e, 0x47], ...Array(10).fill(0)]))).toBe('image/png')
    expect(mimeOf(Buffer.from([...[0xff, 0xd8, 0xff], ...Array(10).fill(0)]))).toBe('image/jpeg')
    expect(mimeOf(Buffer.from([...[0x47, 0x49, 0x46], ...Array(10).fill(0)]))).toBe('image/gif')
    expect(mimeOf(Buffer.from(Array(12).fill(0)))).toBe('application/octet-stream')
  })
})
