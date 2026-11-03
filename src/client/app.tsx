// Kinstra Neko 主面板：朴素内联样式，不依赖 DSH UI 组件库，保证各版本宿主可用。
import { createElement as h, Fragment, useEffect, useState } from 'react'
import { api, usePoll } from './api.js'
import { NekoIcon, BRAND_COLOR } from './brand.js'

type AnyObj = Record<string, any>

function useStyles() {
  return {
    page: { padding: '20px 24px', maxWidth: 820, margin: '0 auto', color: 'var(--dsw-color-text, #e8e8ea)', fontSize: 14, lineHeight: 1.6 } as AnyObj,
    h1: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, margin: '0 0 4px' } as AnyObj,
    sub: { opacity: 0.65, marginBottom: 18, fontSize: 13 } as AnyObj,
    tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-color-border, #333)', marginBottom: 18, flexWrap: 'wrap' } as AnyObj,
    tab: { padding: '8px 14px', cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit', fontSize: 14, borderBottom: '2px solid transparent', opacity: 0.7 } as AnyObj,
    tabOn: { borderBottomColor: BRAND_COLOR, opacity: 1, fontWeight: 600 } as AnyObj,
    card: { border: '1px solid var(--dsw-color-border, #333)', borderRadius: 10, padding: 16, marginBottom: 14, background: 'var(--dsw-color-surface, rgba(255,255,255,0.03))' } as AnyObj,
    cardTitle: { fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as AnyObj,
    row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' } as AnyObj,
    label: { minWidth: 110, opacity: 0.8, fontSize: 13 } as AnyObj,
    input: { flex: 1, minWidth: 180, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--dsw-color-border, #444)', background: 'var(--dsw-color-input, #1c1c1f)', color: 'inherit', fontSize: 13 } as AnyObj,
    textarea: { width: '100%', minHeight: 220, fontFamily: 'monospace', padding: 10, borderRadius: 7, border: '1px solid var(--dsw-color-border, #444)', background: 'var(--dsw-color-input, #1c1c1f)', color: 'inherit', fontSize: 13, boxSizing: 'border-box' } as AnyObj,
    btn: { padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: BRAND_COLOR, color: '#fff', fontWeight: 600, fontSize: 13 } as AnyObj,
    btnGhost: { padding: '7px 16px', borderRadius: 7, border: '1px solid var(--dsw-color-border, #555)', cursor: 'pointer', background: 'transparent', color: 'inherit', fontSize: 13 } as AnyObj,
    ok: { color: '#46d369', fontWeight: 600 } as AnyObj,
    bad: { color: '#ff6b6b', fontWeight: 600 } as AnyObj,
    warn: { color: '#f5a623', fontWeight: 600 } as AnyObj,
    pill: { display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600 } as AnyObj,
    mono: { fontFamily: 'monospace', fontSize: 12, opacity: 0.85 } as AnyObj,
    log: { fontFamily: 'monospace', fontSize: 11.5, whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto', background: 'rgba(0,0,0,0.25)', borderRadius: 7, padding: 10 } as AnyObj,
  }
}

function Pill({ text, tone, s }: { text: string; tone: 'ok' | 'bad' | 'warn' | 'dim'; s: AnyObj }) {
  const bg = { ok: 'rgba(70,211,105,.15)', bad: 'rgba(255,107,107,.15)', warn: 'rgba(245,166,35,.15)', dim: 'rgba(128,128,128,.15)' }[tone]
  const col = { ok: s.ok, bad: s.bad, warn: s.warn, dim: { opacity: 0.7 } }[tone]
  return h('span', { style: { ...s.pill, background: bg, ...col } as AnyObj }, text)
}

function Field({ label, children, s }: { label: string; children?: any; s: AnyObj }) {
  return h('div', { style: s.row }, h('div', { style: s.label }, label), children)
}

function TextInput(props: any) {
  const s = useStyles()
  return h('input', { style: s.input, ...props })
}

export function KinstraPanel() {
  const s = useStyles()
  const { data, refresh } = usePoll<AnyObj>('/state', 4000)
  const [tab, setTab] = useState('overview')
  const [msg, setMsg] = useState('')

  useEffect(() => { if (data?.message) { setMsg(data.message); setTimeout(() => setMsg(''), 4000) } }, [data])

  if (!data) return h('div', { style: s.page }, '加载中…')
  const cfg = data.config as AnyObj

  const tabs = ['overview', 'connect', 'groups', 'persona', 'observe', 'logs', 'danger']
  const tabName: AnyObj = { overview: '概览', connect: '连接', groups: '群聊与权限', persona: '人格', observe: '试运行', logs: '日志', danger: '高级' }

  return h('div', { style: s.page },
    h('h1', { style: s.h1 }, h(NekoIcon, { size: 26 }), 'Kinstra Neko'),
    h('div', { style: s.sub }, '住在 QQ 群里的猫娘 · 默认低打扰 · 试运行保护'),
    msg && h('div', { style: { ...s.card, borderColor: BRAND_COLOR, padding: 10, marginBottom: 12 } }, msg),
    h('div', { style: s.tabs },
      tabs.map((t) => h('button', {
        key: t, style: { ...s.tab, ...(tab === t ? s.tabOn : {}) } as AnyObj, onClick: () => setTab(t),
      }, tabName[t]))),

    tab === 'overview' && h(Overview, { data, s, refresh }),
    tab === 'connect' && h(Connect, { cfg, s, refresh }),
    tab === 'groups' && h(Groups, { cfg, s, refresh }),
    tab === 'persona' && h(PersonaPage, { cfg, data, s, refresh }),
    tab === 'observe' && h(ObservePage, { s }),
    tab === 'logs' && h(LogsPage, { s }),
    tab === 'danger' && h(Danger, { s, refresh }),
  )
}

function Overview({ data, s, refresh }: any) {
  const c = data.config
  const connected = data.onebot?.state === 'connected' && data.onebot?.login
  return h(Fragment, null,
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '状态'),
      h('div', { style: s.row }, '总开关：',
        h(Pill, { text: c.enabled ? '已开启' : '关闭', tone: c.enabled ? 'ok' : 'dim', s }),
        h('span', { style: { marginLeft: 16 } }, '试运行（只看不说）：'),
        h(Pill, { text: c.dryRun ? '试运行中' : '正式发言', tone: c.dryRun ? 'warn' : 'ok', s })),
      h('div', { style: s.row }, 'QQ 网关：',
        h(Pill, { text: connected ? `已连接 ${data.onebot.login.nickname || ''}(${data.onebot.login.uin})` : data.onebot?.wrongAccount ? `连错号：${data.onebot.wrongAccount}` : (data.onebot?.state ?? '未知'), tone: connected ? 'ok' : 'bad', s }),
        h('button', { style: { ...s.btnGhost, marginLeft: 12 }, onClick: async () => { await api('/onebot/reconnect', { method: 'POST' }); refresh() } }, '重新连接'),
        h('button', { style: { ...s.btnGhost }, onClick: async () => { await api('/test-send', { method: 'POST' }).then((r) => alert(r.message)) } }, '发条自测')),
    ),
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '今天'),
      h('div', { style: s.mono },
        `收到 ${data.stats.received} 条 · 发出 ${data.stats.sent} 条 · 试运行拦截 ${data.stats.dryRun} 条 · 错误 ${data.stats.errors} 次`),
      h('div', { style: { ...s.mono, marginTop: 6 } }, `记忆 ${data.memory.facts} 条 · 人物档案 ${data.memory.profiles} 份`)),
    c.setupDone === false && h('div', { style: { ...s.card, borderColor: BRAND_COLOR } },
      h('strong', null, '还没完成首次设置 '), '左侧没有弹窗的话，点「连接」标签按引导填好猫娘小号和你的 QQ。'),
  )
}

function Connect({ cfg, s, refresh }: any) {
  const [f, setF] = useState<AnyObj>(() => JSON.parse(JSON.stringify(cfg)))
  const set = (path: string, v: any) => {
    const next = JSON.parse(JSON.stringify(f))
    const parts = path.split('.')
    let o = next
    for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]!] ??= {})
    o[parts.at(-1)!] = v
    setF(next)
  }
  const save = async () => { const r = await api('/save', { body: f }); if (r.message) alert(r.message); refresh() }

  return h(Fragment, null,
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '账号'),
      h(Field, { label: '猫娘小号 QQ', s }, h('input', { style: s.input, value: f.botQQ, onChange: (e: any) => set('botQQ', e.target.value.replace(/\D/g, '')) })),
      h(Field, { label: '你的 QQ（主人）', s }, h('input', { style: s.input, value: f.ownerQQ, onChange: (e: any) => set('ownerQQ', e.target.value.replace(/\D/g, '')) })),
      h(Field, { label: '怎么称呼你', s }, h('input', { style: s.input, value: f.ownerName, onChange: (e: any) => set('ownerName', e.target.value) })),
    ),
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, 'QQ 协议端'),
      h(Field, { label: '接入方式', s },
        h('select', { style: s.input, value: f.gateway, onChange: (e: any) => set('gateway', e.target.value) },
          h('option', { value: 'napcat' }, 'NapCat（推荐，安装器自动装好）'),
          h('option', { value: 'onebot' }, '任意 OneBot v11 地址'))),
      f.gateway === 'napcat' && h(Fragment, null,
        h('div', { style: { ...s.sub, margin: '4px 0 10px' } }, '一键安装器已自动装好 NapCat（安装目录一般无需手改）。先填好小号 QQ 并保存，再点「生成配置」写入 OneBot 参数；首次启动会弹出 NapCat 窗口，在里面用小号扫码登录。'),
        h(Field, { label: '安装目录', s }, h('input', { style: s.input, value: f.napcat.dir, placeholder: '留空=数据目录/napcat', onChange: (e: any) => set('napcat.dir', e.target.value) })),
        h(Field, { label: '端口 HTTP/WS', s },
          h('input', { style: { ...s.input, maxWidth: 90 }, value: f.napcat.httpPort, onChange: (e: any) => set('napcat.httpPort', Number(e.target.value)) }),
          h('input', { style: { ...s.input, maxWidth: 90 }, value: f.napcat.wsPort, onChange: (e: any) => set('napcat.wsPort', Number(e.target.value)) })),
        h('div', { style: s.row },
          h('button', { style: s.btnGhost, onClick: async () => { const r = await api('/napcat/provision', { method: 'POST' }); alert(r.message); refresh() } }, '生成 OneBot 配置'),
          h('button', { style: s.btnGhost, onClick: async () => alert((await api('/napcat/start', { method: 'POST' })).message) }, '启动 NapCat'),
          h('button', { style: s.btnGhost, onClick: async () => alert((await api('/napcat/stop', { method: 'POST' })).message) }, '停止'))),
      f.gateway === 'onebot' && h(Fragment, null,
        h(Field, { label: 'HTTP 地址', s }, h('input', { style: s.input, value: f.onebot.httpUrl, placeholder: 'http://127.0.0.1:3000', onChange: (e: any) => set('onebot.httpUrl', e.target.value) })),
        h(Field, { label: 'WS 地址', s }, h('input', { style: s.input, value: f.onebot.wsUrl, placeholder: 'ws://127.0.0.1:3001', onChange: (e: any) => set('onebot.wsUrl', e.target.value) })),
        h(Field, { label: '访问令牌', s }, h('input', { style: s.input, type: 'password', value: f.onebot.wsTokenSet ? '' : f.onebot.wsToken, placeholder: f.onebot.wsTokenSet ? '已设置（留空不改）' : '', onChange: (e: any) => { set('onebot.wsToken', e.target.value); set('onebot.httpToken', e.target.value) } }))),
    ),
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '上线开关'),
      h(Field, { label: '启用插件', s }, h('input', { type: 'checkbox', checked: !!f.enabled, onChange: (e: any) => set('enabled', e.target.checked) })),
      h(Field, { label: '试运行（只记录）', s }, h('input', { type: 'checkbox', checked: !!f.dryRun, onChange: (e: any) => set('dryRun', e.target.checked) })),
      h('div', { style: { ...s.sub, margin: '4px 0 0' } }, '建议先试运行一段时间，在「试运行」页确认她会说什么，再关掉试运行开麦。')),
    h('button', { style: s.btn, onClick: save }, '保存设置'),
  )
}

function Groups({ cfg, s, refresh }: any) {
  const [f, setF] = useState<AnyObj>(() => JSON.parse(JSON.stringify(cfg)))
  const g = f.group
  return h(Fragment, null,
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '谁能跟她说话（每行一个 QQ 号 / 群号）'),
      h(Field, { label: '允许的群', s }, h('textarea', { style: { ...s.textarea, minHeight: 70 }, value: (f.allow.groups ?? []).join('\n'), onChange: (e: any) => setF({ ...f, allow: { ...f.allow, groups: e.target.value.split(/\s+/).filter(Boolean) } }) })),
      h(Field, { label: '允许的私聊', s }, h('textarea', { style: { ...s.textarea, minHeight: 70 }, value: (f.allow.private ?? []).join('\n'), onChange: (e: any) => setF({ ...f, allow: { ...f.allow, private: e.target.value.split(/\s+/).filter(Boolean) } }) })),
      h('div', { style: s.sub }, '主人私聊永远放行，不用填。白名单为空时她对谁都不回应。')),
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '群聊性格'),
      h(Field, { label: '叫醒词', s }, h('input', { style: s.input, value: (g.wakeWords ?? []).join(','), onChange: (e: any) => setF({ ...f, group: { ...g, wakeWords: e.target.value.split(/[,，]/).map((x: string) => x.trim()).filter(Boolean) } }) })),
      h(Field, { label: '插话概率', s }, h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: g.interjectChance, onChange: (e: any) => setF({ ...f, group: { ...g, interjectChance: Number(e.target.value) } }) }), h('span', { style: s.mono }, String(g.interjectChance))),
      h(Field, { label: '每小时上限', s }, h('input', { type: 'number', value: g.maxPerHour, onChange: (e: any) => setF({ ...f, group: { ...g, maxPerHour: Number(e.target.value) } }) })),
      h(Field, { label: '插话冷却(秒)', s }, h('input', { type: 'number', value: g.cooldownSec, onChange: (e: any) => setF({ ...f, group: { ...g, cooldownSec: Number(e.target.value) } }) })),
      h(Field, { label: '相关度门槛', s }, h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: g.minRelevance, onChange: (e: any) => setF({ ...f, group: { ...g, minRelevance: Number(e.target.value) } }) }), h('span', { style: s.mono }, String(g.minRelevance))),
      h(Field, { label: '兴趣词', s }, h('input', { style: s.input, value: (g.interests ?? []).join(','), onChange: (e: any) => setF({ ...f, group: { ...g, interests: e.target.value.split(/[,，]/).map((x: string) => x.trim()).filter(Boolean) } }) })),
      h(Field, { label: '静默时段', s }, h('span', { style: s.mono }, `${g.quietHours?.[0]}:00 - ${g.quietHours?.[1]}:00 不主动插话`))),
    h('button', { style: s.btn, onClick: async () => { const r = await api('/save', { body: f }); alert(r.message ?? '已保存'); refresh() } }, '保存'),
  )
}

function PersonaPage({ cfg, data, s, refresh }: any) {
  const [current, setCurrent] = useState(cfg.persona.current)
  const [persona, setPersona] = useState<AnyObj | null>(null)
  const [body, setBody] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    api(`/persona/get?id=${encodeURIComponent(current)}`).then((r) => {
      if (r.ok) { setPersona(r.persona); setBody(r.persona.body); setName(r.persona.name) }
    })
  }, [current])

  return h(Fragment, null,
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '人格'),
      h(Field, { label: '选择人格', s },
        h('select', { style: s.input, value: current, onChange: (e: any) => { setCurrent(e.target.value); api('/persona/use', { body: { id: e.target.value } }) } },
          (data.personas ?? []).map((p: AnyObj) => h('option', { key: p.id, value: p.id }, `${p.name}（${p.id}）`))))),
    persona && h('div', { style: s.card },
      h(Field, { label: '显示名', s }, h('input', { style: s.input, value: name, onChange: (e: any) => setName(e.target.value) })),
      h('div', { style: { ...s.label, marginBottom: 6 } }, '人格提示词（直接改，下一轮生效）'),
      h('textarea', { style: s.textarea, value: body, onChange: (e: any) => setBody(e.target.value) }),
      h('div', { style: { ...s.row, marginTop: 10 } },
        h('button', { style: s.btn, onClick: async () => { const r = await api('/persona/save', { body: { id: persona.id, name, tags: persona.tags, body } }); alert(r.message); refresh() } }, '保存人格'),
        persona.id !== 'neko' && h('button', { style: s.btnGhost, onClick: async () => { if (confirm('删除这个人格？')) { await api('/persona/delete', { body: { id: persona.id } }); refresh() } } }, '删除'))),
  )
}

function ObservePage({ s }: any) {
  const { data } = usePoll<AnyObj>('/observe?limit=50', 5000)
  const entries: AnyObj[] = data?.entries ?? []
  return h('div', { style: s.card },
    h('div', { style: s.cardTitle }, '试运行：她本来会说什么',
      h(Pill, { text: '只记录不发送', tone: 'warn', s })),
    entries.length === 0 ? h('div', { style: s.sub }, '还没有记录。开启「总开关」并保持「试运行」打开，在群里 @ 她，这里就会出现她本来会发的话。')
      : h('div', null, entries.map((e, i) => h('div', { key: i, style: { borderBottom: '1px solid var(--dsw-color-border,#2a2a2a)', padding: '8px 0' } },
        h('div', { style: { ...s.mono, marginBottom: 4 } }, `${new Date(e.t).toLocaleString()} · ${e.chatId} · ${e.mode}`),
        h('div', null, e.reply)))))
}

function LogsPage({ s }: any) {
  const [entries, setEntries] = useState<AnyObj[]>([])
  useEffect(() => { const id = setInterval(() => api('/logs?limit=300').then((r) => setEntries(r.entries ?? [])), 3000); api('/logs?limit=300').then((r) => setEntries(r.entries ?? [])); return () => clearInterval(id) }, [])
  return h('div', { style: s.log }, entries.slice().reverse().map((e, i) => `${new Date(e.t).toLocaleString()} ${e.level.toUpperCase()} ${e.area} | ${e.msg}`).join('\n'))
}

function Danger({ s, refresh }: any) {
  return h(Fragment, null,
    h('div', { style: s.card },
      h('div', { style: s.cardTitle }, '重置对话'),
      h('div', { style: s.sub }, '归档所有 QQ 会话，下一条消息她会重新认识这个群（不删长期记忆）。'),
      h('button', { style: s.btnGhost, onClick: async () => { if (confirm('让她忘掉所有当前对话？')) alert((await api('/sessions/reset', { body: {} })).message) } }, '重置全部对话')),
  )
}
