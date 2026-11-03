// 把 OneBot v11 消息事件拆成插件好用的形状。纯函数，便于测试。
// 移植自参考实现的 inbound 解析，并收敛到本项目需要的消息类型。

import type { MessageEvent, Segment } from './types.js'

export interface ParsedMessage {
  kind: 'private' | 'group'
  chatId: string
  userId: string
  groupId: string
  nickname: string
  role: string
  messageId: string
  text: string
  mentioned: boolean
  replyId: string
  images: Segment[]
  stickers: Segment[]
  records: Segment[]
  forwards: string[]
}

function segmentsOf(event: MessageEvent): Segment[] {
  const m = event.message
  if (Array.isArray(m)) return m.filter((s): s is Segment => Boolean(s) && typeof s === 'object')
  if (typeof m === 'string') return [{ type: 'text', data: { text: m.replace(/\[CQ:[^\]]*\]/g, '') } }]
  return []
}

/** 表情包判定：mface，或带 emoji_id / sub_type=1 的 image。必须严格，普通照片不算。 */
export function isStickerSegment(seg: Segment): boolean {
  if (!seg?.data) return false
  if (seg.type === 'mface') return true
  if (seg.type !== 'image') return false
  const d = seg.data
  if (String(d.sub_type ?? '') === '1') return true
  return Boolean(d.emoji_id ?? d.emojiId)
}

/** QQ 分享卡片里提取标题和链接，认不出就是「[卡片消息]」。 */
function cardText(raw: unknown): string {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>)
    const meta = (j?.meta ?? {}) as Record<string, any>
    const m = meta.detail_1 ?? meta.news ?? meta.music ?? Object.values(meta)[0] ?? {}
    const title = String(m.desc ?? m.title ?? j?.prompt ?? '').trim()
    const url = String(m.qqdocurl ?? m.jumpUrl ?? m.url ?? '').split('?')[0]
    const from = String(m.title && m.desc ? m.title : (m.tag ?? '')).trim()
    if (!title && !url) return '[卡片消息]'
    return `[分享卡片${from ? `（${from}）` : ''}：${title}${url ? ` ${url}` : ''}]`
  } catch {
    return '[卡片消息]'
  }
}

export function parseMessageEvent(event: MessageEvent, selfId: string | number, faceName?: (id: unknown) => string): ParsedMessage {
  const self = String(selfId || event.self_id || '')
  const kind: 'private' | 'group' = event.message_type === 'group' ? 'group' : 'private'
  const userId = String(event.user_id ?? event.sender?.user_id ?? '')
  const groupId = kind === 'group' ? String(event.group_id ?? '') : ''
  const sender = event.sender ?? {}
  let mentioned = false
  let replyId = ''
  const texts: string[] = []
  const images: Segment[] = []
  const stickers: Segment[] = []
  const records: Segment[] = []
  const forwards: string[] = []

  for (const seg of segmentsOf(event)) {
    const d = seg.data || {}
    switch (seg.type) {
      case 'text':
        texts.push(String(d.text ?? ''))
        break
      case 'at':
        if (String(d.qq) === self) mentioned = true
        else if (String(d.qq) === 'all') { /* @全体 不算@猫娘 */ }
        else texts.push(`@${d.name ?? d.qq} `)
        break
      case 'reply':
        replyId = String(d.id ?? '')
        break
      case 'face': {
        const name = faceName?.(d.id)
        texts.push(name ? `[${name}]` : String(d.faceText ?? '[表情]'))
        break
      }
      case 'image':
      case 'mface':
        if (isStickerSegment(seg)) {
          stickers.push(seg)
          texts.push(d.summary ? String(d.summary) : '[表情包]')
        } else {
          images.push(seg)
          texts.push('[图片]')
        }
        break
      case 'record':
        records.push(seg)
        break
      case 'video':
        texts.push('[视频]')
        break
      case 'file':
        texts.push(`[文件 ${d.name ?? d.file ?? ''}]`)
        break
      case 'json':
        texts.push(cardText(d.data))
        break
      case 'xml':
        texts.push('[卡片消息]')
        break
      case 'poke':
        texts.push('[戳一戳]')
        break
      case 'forward': {
        const id = String(d.id ?? d.res_id ?? d.forward_id ?? '')
        if (id) forwards.push(id)
        texts.push('[合并转发]')
        break
      }
      default:
        break
    }
  }

  const text = texts.join('').replace(/\s+\n/g, '\n').trim()
  return {
    kind,
    chatId: kind === 'group' ? `group:${groupId}` : `private:${userId}`,
    userId,
    groupId,
    nickname: String(sender.card ?? sender.nickname ?? userId),
    role: String(sender.role ?? ''),
    messageId: String(event.message_id ?? ''),
    text,
    mentioned,
    replyId,
    images,
    stickers,
    records,
    forwards,
  }
}

/** 图片字节的 MIME 识别。 */
export function mimeOf(buf: Buffer): string {
  if (!buf || buf.length < 12) return 'application/octet-stream'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  return 'application/octet-stream'
}
