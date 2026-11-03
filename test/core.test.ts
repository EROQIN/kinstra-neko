import { describe, it, expect } from 'vitest'
import { checkAllowed, isOwner } from '../src/chat/access.js'
import { expandMentions, resolveMember, memberNames, hasMention } from '../src/chat/mentions.js'
import { normalize } from '../src/config/schema.js'
import type { Config } from '../src/config/schema.js'

describe('access', () => {
  const cfg = { ...normalize({}), ownerQQ: '111', allow: { private: ['222'], groups: ['333'] } } as Config

  it('主人私聊永远放行', () => {
    expect(checkAllowed(cfg, { kind: 'private', userId: '111', groupId: '' }).allowed).toBe(true)
  })
  it('白名单私聊放行', () => {
    expect(checkAllowed(cfg, { kind: 'private', userId: '222', groupId: '' }).allowed).toBe(true)
  })
  it('陌生人私聊拒绝', () => {
    expect(checkAllowed(cfg, { kind: 'private', userId: '999', groupId: '' }).allowed).toBe(false)
  })
  it('群白名单', () => {
    expect(checkAllowed(cfg, { kind: 'group', userId: '1', groupId: '333' }).allowed).toBe(true)
    expect(checkAllowed(cfg, { kind: 'group', userId: '1', groupId: '444' }).allowed).toBe(false)
  })
  it('isOwner', () => {
    expect(isOwner(cfg, '111')).toBe(true)
    expect(isOwner(cfg, '')).toBe(false)
  })
})

describe('mentions', () => {
  const members = [{ user_id: 200001, nickname: '小明', card: '' }, { user_id: 300002, nickname: '阿强', card: '' }]
  it('数字 QQ 直接解析', () => {
    expect(resolveMember('200001', memberNames(members))).toBe('200001')
  })
  it('唯一名解析到 QQ', () => {
    expect(resolveMember('小明', memberNames(members))).toBe('200001')
  })
  it('重名不解析', () => {
    expect(resolveMember('小明', memberNames([...members, { user_id: 400003, nickname: '小明' }]))).toBe('')
  })
  it('展开 <at:QQ>', () => {
    const segs = expandMentions([{ type: 'text', data: { text: '嗨 <at:200001> 看这个' } }], members)
    expect(segs.some((s) => s.type === 'at' && s.data.qq === '200001')).toBe(true)
  })
  it('展开 @名字', () => {
    const segs = expandMentions([{ type: 'text', data: { text: '@阿强 早' } }], members)
    expect(segs.some((s) => s.type === 'at' && s.data.qq === '300002')).toBe(true)
  })
  it('对不上的名字保留文字', () => {
    const missed: string[] = []
    const segs = expandMentions([{ type: 'text', data: { text: '@不存在 嗨' } }], members, missed)
    expect(segs.some((s) => s.type === 'at')).toBe(false)
    expect(missed).toContain('不存在')
  })
  it('hasMention', () => {
    expect(hasMention('<at:1>')).toBe(true)
    expect(hasMention('@小明')).toBe(true)
    expect(hasMention('普通')).toBe(false)
  })
})

describe('config', () => {
  it('安全默认：关闭 + 试运行 + 空白名单', () => {
    const c = normalize({})
    expect(c.enabled).toBe(false)
    expect(c.dryRun).toBe(true)
    expect(c.allow.groups).toEqual([])
    expect(c.allow.private).toEqual([])
    expect(c.gateway).toBe('napcat')
  })

  it('QQ 号只保留数字', () => {
    const c = normalize({ botQQ: 'abc12345', ownerQQ: '99-9' })
    expect(c.botQQ).toBe('12345')
    expect(c.ownerQQ).toBe('999')
  })

  it('白名单支持逗号/换行并去重', () => {
    const c = normalize({ allow: { groups: '111, 222\n111，333' } } as any)
    expect(c.allow.groups.sort()).toEqual(['111', '222', '333'])
  })

  it('坏配置回退默认并抢救关键字段', () => {
    const c = normalize({ botQQ: '123', group: '不是对象' } as any)
    expect(c.botQQ).toBe('123')
    expect(typeof c.group.interjectChance).toBe('number')
  })
})
