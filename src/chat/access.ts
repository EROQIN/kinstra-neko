// 访问控制：谁能跟她说话。主人私聊永远放行；群和其他人靠白名单。

import type { Config } from '../config/schema.js'

export interface ChatRef {
  kind: 'private' | 'group'
  userId: string
  groupId: string
}

export function checkAllowed(cfg: Config, msg: ChatRef): { allowed: boolean; reason: string } {
  const owner = String(cfg.ownerQQ ?? '')
  if (msg.kind === 'private') {
    if (msg.userId === owner && owner) return { allowed: true, reason: '主人' }
    if (cfg.allow.private.map(String).includes(msg.userId)) return { allowed: true, reason: '私聊白名单' }
    return { allowed: false, reason: '不在私聊白名单' }
  }
  if (cfg.allow.groups.map(String).includes(msg.groupId)) return { allowed: true, reason: '群白名单' }
  return { allowed: false, reason: '不在群白名单' }
}

export function isOwner(cfg: Config, userId: string): boolean {
  return String(userId ?? '') !== '' && String(userId) === String(cfg.ownerQQ ?? '')
}
