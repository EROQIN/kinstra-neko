// 把模型一轮回复拆成一条条要发到 QQ 的消息。
//
// 模型输出约定（写进人格卡）：
//   |||          分隔多条气泡
//   [沉默]       整轮只输出它 = 这次不说话（群聊插话用）
//   <reply:编号> 写在某句前面 = 引用回复提示词里带编号的那条（一轮最多一条）
//   <poke>       = 戳一戳对方
// 顺手洗掉 Markdown（QQ 不渲染）。

export const SILENCE = '[沉默]'

export type ReplyItemKind = 'text' | 'poke'
export interface ReplyItem {
  kind: ReplyItemKind
  value: string
  replyTo?: string
}

export interface ParsedReply {
  silent: boolean
  items: ReplyItem[]
}

export function isSilence(text: string): boolean {
  const t = String(text ?? '').trim()
  return t === '' || t === SILENCE || t === '［沉默］' || t === '(沉默)' || t === '（沉默）'
}

export function stripMarkdown(text: string): string {
  return String(text ?? '')
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 一段文字拆几条气泡：真人一句一行；有代码块或长篇就整段发；列表式内容也整段发。 */
export function splitLines(text: string): string[] {
  const t = String(text ?? '').trim()
  if (!t) return []
  if (t.includes('```') || t.length > 240) return [t]
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  if (lines.length <= 1) return lines
  const listy = lines.filter((l) => /^(\d+[.、)]|[-*•·])/.test(l)).length
  if (listy >= Math.ceil(lines.length / 2)) return [t]
  return lines
}

function pushText(items: ReplyItem[], s: string, maxBubbles: number): void {
  const t = stripMarkdown(String(s ?? '').replace(/<\/?reply[^>]*>/g, ''))
  if (!t || isSilence(t)) return
  for (const line of splitLines(t)) {
    if (isSilence(line)) continue
    items.push({ kind: 'text', value: line })
  }
  // 气泡上限：保留前 N-1 条，其余文字并入最后一条
  const textIdx = items.map((it, i) => it.kind === 'text' ? i : -1).filter((i) => i >= 0)
  if (textIdx.length > maxBubbles) {
    const keepUntil = textIdx[maxBubbles - 2]!
    const tailIdxs = new Set(textIdx.slice(maxBubbles - 1))
    const tail = [...tailIdxs].map((i) => items[i]!.value).join('\n')
    for (const i of [...tailIdxs].reverse()) items.splice(i, 1)
    items.splice(keepUntil + 1, 0, { kind: 'text', value: tail })
  }
}

export function parseReply(text: string, maxBubbles = 3): ParsedReply {
  const raw = String(text ?? '').trim()
  if (isSilence(raw)) return { silent: true, items: [] }

  const items: ReplyItem[] = []
  let replyTo = ''
  const attach = (from: number) => {
    if (replyTo && items.length > from) {
      items[from]!.replyTo = replyTo
      replyTo = ''
    }
  }

  for (const bubble of raw.split('|||')) {
    const part = bubble.trim()
    if (!part) continue
    const re = /<poke\s*\/?>|<reply:\s*(\d+)\s*>/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(part)) !== null) {
      const from = items.length
      pushText(items, part.slice(last, m.index), maxBubbles)
      attach(from)
      if (m[0].startsWith('<poke')) {
        if (!items.some((i) => i.kind === 'poke')) items.push({ kind: 'poke', value: '' })
      } else if (m[1] !== undefined) {
        replyTo = m[1]
      }
      attach(from)
      last = re.lastIndex
    }
    const from = items.length
    pushText(items, part.slice(last), maxBubbles)
    attach(from)
  }

  // 一轮最多引用一次
  let quoted = false
  for (const it of items) {
    if (!it.replyTo) continue
    if (quoted) delete it.replyTo
    quoted = true
  }

  if (items.length === 0) return { silent: true, items: [] }
  return { silent: false, items }
}

/** 下一条气泡前停多久：模拟打字，约每秒 9 字，700ms~4.5s 带抖动（先缩放再夹值）。 */
export function bubbleDelay(next = '', rand: () => number = Math.random): number {
  const len = String(next ?? '').length
  const typing = (350 + len * 110) * (0.8 + rand() * 0.5)
  return Math.round(Math.min(4500, Math.max(700, typing)))
}

/** 对方是不是明确要语音（一期没有 TTS，仅用于人格提示，预留）。 */
export function wantsVoice(text: string): boolean {
  const t = String(text ?? '')
  if (t.includes('不要语音') || t.includes('别发语音')) return false
  return /(用|发|来|给我|录)[^，。？！\n]{0,4}语音|语音[^，。？！\n]{0,4}(说|发|讲|回|念|唱)/.test(t)
}
