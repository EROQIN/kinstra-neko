// 首次启动向导：① 两个 QQ 号 ② 模型/协议端提示 ③ 试运行上线。未 setupDone 时覆盖。
import { createElement as h, useEffect, useState, Fragment } from 'react'
import { api } from './api.js'
import { NekoIcon, BRAND_COLOR } from './brand.js'

export function Onboarding() {
  const [state, setState] = useState<Any>(null)
  const [step, setStep] = useState(0)
  const [f, setF] = useState<Any>({ botQQ: '', ownerQQ: '', ownerName: '主人', dryRun: true })
  const [busy, setBusy] = useState(false)

  // 每 5 秒拉一次状态；setupDone 后自动消失
  useEffect(() => {
    const tick = () => api('/state').then((s: Any) => {
      setState(s)
      if (s?.config?.setupDone) setStep(-1)
    }).catch(() => {})
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  if (step < 0 || state?.config?.setupDone) return null

  const input: Any = { padding: '9px 12px', borderRadius: 8, border: '1px solid #555', background: '#1c1c1f', color: '#eee', fontSize: 14, width: '100%', boxSizing: 'border-box' }
  const btn: Any = { padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', background: BRAND_COLOR, color: '#fff', fontWeight: 600 }
  const btnGhost: Any = { padding: '9px 20px', borderRadius: 8, border: '1px solid #666', cursor: 'pointer', background: 'transparent', color: '#eee' }

  return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 } },
    h('div', { style: { width: 520, maxWidth: '92vw', background: '#202024', borderRadius: 16, padding: 28, color: '#eee', boxShadow: '0 20px 60px rgba(0,0,0,.5)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 } }, h(NekoIcon, { size: 30 }), h('span', { style: { fontSize: 20, fontWeight: 700 } }, '欢迎领养 Kinstra Neko')),
      h('div', { style: { opacity: 0.65, fontSize: 13, marginBottom: 20 } }, '三步把猫娘接进 QQ，预计 5 分钟'),

      step === 0 && h(Fragment, null,
        h('div', { style: { marginBottom: 14 } },
          h('div', { style: { marginBottom: 6, fontSize: 13, opacity: 0.85 } }, '猫娘小号的 QQ 号（建议专门注册一个小号）'),
          h('input', { style: input, value: f.botQQ, placeholder: '例如 100012345', onChange: (e: Any) => setF({ ...f, botQQ: e.target.value.replace(/\D/g, '') }) })),
        h('div', { style: { marginBottom: 14 } },
          h('div', { style: { marginBottom: 6, fontSize: 13, opacity: 0.85 } }, '你自己的 QQ 号（她的主人）'),
          h('input', { style: input, value: f.ownerQQ, onChange: (e: Any) => setF({ ...f, ownerQQ: e.target.value.replace(/\D/g, '') }) })),
        h('div', { style: { marginBottom: 14 } },
          h('div', { style: { marginBottom: 6, fontSize: 13, opacity: 0.85 } }, '她该怎么称呼你'),
          h('input', { style: input, value: f.ownerName, onChange: (e: Any) => setF({ ...f, ownerName: e.target.value }) })),
        h('div', { style: { fontSize: 12, opacity: 0.6, lineHeight: 1.7 } },
          '⚠ QQ 非官方接入存在账号风险，请务必使用小号。你需要自行承担小号被限制的可能。')),

      step === 1 && h(Fragment, null,
        h('div', { style: { fontSize: 14, lineHeight: 1.9, marginBottom: 16 } },
          h('div', null, '1. 在服务器上运行一键安装器（见项目 README）：'),
          h('pre', { style: { background: '#141416', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto' } }, 'bash <(curl -fsSL https://你的域名/install.sh)'),
          h('div', { style: { marginTop: 10 } }, '2. 安装器会装好 Node、DeepSeek Harness 和 NapCat。'),
          h('div', null, '3. 按提示在 NapCat 窗口用', h('b', { style: { color: BRAND_COLOR } }, '猫娘小号'), '扫码登录。'),
          h('div', { style: { marginTop: 8 } }, '4. 在 DSH 设置里配置好模型服务商和 API Key（或安装器已引导你填好）。'),
          h('div', { style: { marginTop: 12, fontSize: 12, opacity: 0.65 } }, '都就绪后点下面的"我已连好"，面板会自动核对登录的 QQ 号。')) as Any,
        state?.onebot && h('div', { style: { marginBottom: 12 } },
          '网关状态：',
          state.onebot.state === 'connected' && state.onebot.login
            ? h('span', { style: { color: '#46d369', fontWeight: 600 } }, `已连接 ${state.onebot.login.uin}`)
            : h('span', { style: { color: '#ff9d6c' } }, state.onebot.state ?? '未连接'))),

      step === 2 && h(Fragment, null,
        h('div', { style: { fontSize: 14, lineHeight: 1.9, marginBottom: 16 } },
          h('div', null, '猫娘出厂是', h('b', null, '低打扰性格'), '：@ 她才说话，偶尔按话题相关度插话。'),
          h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 } },
            h('input', { type: 'checkbox', checked: f.dryRun, onChange: (e: Any) => setF({ ...f, dryRun: e.target.checked }) }),
            '先试运行：她只在面板记录"本来会说什么"，不真的发到群里（推荐）')),
          h('div', { style: { fontSize: 12, opacity: 0.65, marginTop: 8 } }, '记得之后在「群聊与权限」里把要养她的群加进白名单，不然她对谁都不开口。')),

      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 22 } },
        step > 0 ? h('button', { style: btnGhost, disabled: busy, onClick: () => setStep(step - 1) }, '上一步') : h('span'),
        step < 2
          ? h('button', { style: btn, disabled: busy || (step === 0 && (!f.botQQ || !f.ownerQQ)), onClick: () => setStep(step + 1) }, '下一步')
          : h('button', {
              style: btn, disabled: busy,
              onClick: async () => {
                setBusy(true)
                const r = await api('/save', { body: { botQQ: f.botQQ, ownerQQ: f.ownerQQ, ownerName: f.ownerName || '主人' } })
                const done = await api('/setup/done', { body: { enabled: true, dryRun: f.dryRun } })
                setBusy(false)
                if (done.ok) { setStep(-1); alert('设置完成！先把群加进白名单，然后去 QQ 里 @ 她试试吧～') }
                else alert(done.message || '没保存成功')
              },
            }, busy ? '正在保存…' : '完成，开始试运行')),
    )
  )
}

type Any = any
