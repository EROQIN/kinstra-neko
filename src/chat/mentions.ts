// 群里真 @：模型写的 <at:QQ号> 或顺手打的「@名字」，发送时换成 QQ 的 at 消息段。
// 对不上或重名就保留文字，绝不乱 @。

import type { Segment } from '../onebot/types.js'

interface GroupMember {
  user_id?: number | string
  nickname?: string
  card?: string
}

const AT_TAG = /<at:\s*([^>]{1,30}?)\s*>/g

export function memberNames(members: GroupMember[]): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>()
  const add = (name: unknown, qq: string) => {
    const n = String(name ?? '').trim()
    if (!n) return
    if (!byName.has(n)) byName.set(n, new Set())
    byName.get(n)!.add(qq)
  }
  for (const m of members ?? []) {
    const qq = String(m.user_id ?? '')
    if (!qq) continue
    add(m.card, qq)
    add(m.nickname, qq)
    add(String(m.card ?? m.nickname ?? '').replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*$/, ''), qq)
  }
  return byName
}

export function resolveMember(who: string, byName: Map<string, Set<string>>): string {
  const w = String(who ?? '').replace(/^@/, '').trim()
  if (/^\d{5,12}$/.test(w)) return w
  const hit = byName.get(w)
  return hit && hit.size === 1 ? [...hit][0]! : ''
}

function longestName(rest: string, byName: Map<string, Set<string>>): { qq: string; len: number } | null {
  const head = rest.match(/^[^\s@＠]{1,20}/)?.[0] ?? ''
  for (let n = head.length; n >= 1; n--) {
    const qq = resolveMember(head.slice(0, n), byName)
    if (qq) return { qq, len: n }
  }
  return null
}

/**
 * 把文字段里的 @ 标记展开成真 at 段。
 * @param missed 没对上的名字收集到这里（调用方可告知模型）
 */
export function expandMentions(segs: Segment[], members: GroupMember[], missed: string[] = []): Segment[] {
  const byName = memberNames(members)
  const out: Segment[] = []
  const pushText = (t: string) => { if (t) out.push({ type: 'text', data: { text: t } }) }

  for (const seg of segs) {
    if (seg.type !== 'text') { out.push(seg); continue }
    const s = String(seg.data.text ?? '')
    let buf = ''
    let i = 0
    while (i < s.length) {
      AT_TAG.lastIndex = i
      const tag = s[i] === '<' ? AT_TAG.exec(s) : null
      if (tag && tag.index === i) {
        const qq = resolveMember(tag[1]!, byName)
        if (qq) { pushText(buf); buf = ''; out.push({ type: 'at', data: { qq } }) }
        else { missed.push(tag[1]!.replace(/^@/, '')); buf += '@' + tag[1]!.replace(/^@/, '') }
        i += tag[0].length
        continue
      }
      if (s[i] === '@' || s[i] === '＠') {
        const hit = longestName(s.slice(i + 1), byName)
        if (hit) {
          pushText(buf); buf = ''
          out.push({ type: 'at', data: { qq: hit.qq } })
          i += 1 + hit.len
          if (i < s.length && !/\s/.test(s[i]!)) buf += ' '
          continue
        }
        const name = s.slice(i + 1).match(/^[^\s@，。！？,.!?、：:]{1,20}/)?.[0]
        if (name) missed.push(name)
      }
      buf += s[i]!
      i++
    }
    pushText(buf)
  }
  return out
}

export function hasMention(text: string): boolean {
  return /[@＠]|<at:/.test(String(text ?? ''))
}
