// Client 插件入口：侧栏品牌、侧栏入口、主面板、首启向导 overlay，以及白标外壳覆盖。
//
// 白标全部走 DSH 官方 slots 扩展面：descriptor 上 priority:-1（升序、最小者渲染，
// 官方 occupant 默认 0）即可 shadow 掉 hero 鲸鱼/工作区/标准模式/侧栏工作区与公告弹窗。
// 首启「登录 DeepSeek 账号」弹窗由 cordis.patch.yml 的 credentialOnboarding:false 关闭。

import { createElement as h, useEffect } from 'react'
import { NekoIcon, BrandMark, BrandName } from './brand.js'
import { KinstraPanel } from './app.js'
import { Onboarding } from './onboarding.js'

export const inject = ['slots', 'locale', 'layout']

const PANEL_ID = 'kinstra-neko'
const NS = 'kinstra-neko'

// 渲染即把该 onboarding 步骤标记完成并消失：兜掉 DSH 的版本公告弹窗（welcome-notice）。
function SwallowOnboarding(props: any) {
  useEffect(() => { try { props?.complete?.() } catch { /* ignore */ } }, [])
  return null
}

export function apply(ctx: any) {
  try {
    ctx.locale?.register?.(NS, {
      zh: { panel: 'Kinstra Neko', title: 'Kinstra Neko · 住在 QQ 里的猫娘' },
      en: { panel: 'Kinstra Neko', title: 'Kinstra Neko · catgirl in QQ' },
    })
  } catch { /* locale 是可选服务 */ }

  // 品牌：侧栏 logo 与名字（priority:-1，盖过 official 构建的官方品牌 occupant）
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1, locale: NS }, () => BrandMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', priority: -1, locale: NS }, () => BrandName))

  // 面板本体（独立 key，不与官方 conversation 冲突）。
  // register() 返回时该 key 已同步进入注册表，hasMainPanel 必为真——此刻同步选中，
  // 让打开 web 的首帧就是 Kinstra Neko。不能用 setTimeout 轮询：选在 ui-workspace
  // 首启恢复(beginNavigation await)窗口里会 abort 掉它、导致空白会话不绑定。
  ctx.slots.inject('main', () => {
    const disposeMain = ctx.slots.register(
      { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
      (props: any) => h(KinstraPanel, props),
    )
    try { ctx.layout?.selectPanel?.(PANEL_ID) } catch { /* layout 就绪前极小概率，忽略：侧栏仍可点进 */ }
    return disposeMain
  })

  // 侧栏入口
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => 'Kinstra Neko', locale: NS },
      (props: any) => h(NekoIcon, props),
    ))

  // 首启向导（未 setupDone 时全屏覆盖）
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'kinstra-onboarding', locale: NS, inject: () => ({}) },
      () => h(Onboarding),
    ))

  // —— 主屏「探索未至之境」白标 ——
  // hero 的鲸鱼换成猫耳
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register(
      { name: 'conversation.hero.brand.mark', priority: -1, locale: NS, inject: () => ({}) },
      (props: any) => h(NekoIcon, { size: props?.size ?? 34, className: props?.className }),
    ))
  // 去掉「选择工作区」「标准模式」两块
  ctx.slots.inject('conversation.hero.workspace', () =>
    ctx.slots.register({ name: 'conversation.hero.workspace', priority: -1, locale: NS }, () => null))
  ctx.slots.inject('conversation.hero.agentPreset', () =>
    ctx.slots.register({ name: 'conversation.hero.agentPreset', priority: -1, locale: NS }, () => null))
  // 去侧栏工作区浏览区（保留 ui-workspace 本体，新会话链路不受影响）
  ctx.slots.inject('sidebar.workspaces', () =>
    ctx.slots.register({ name: 'sidebar.workspaces', priority: -1, locale: NS }, () => null))

  // 兜掉版本公告弹窗（credentialOnboarding:false 已消账号弹窗，公告是另一个 list occupant）
  ctx.slots.inject('settings.onboarding', () =>
    ctx.slots.register(
      { name: 'settings.onboarding', id: 'welcome-notice', priority: -1, locale: NS },
      (props: any) => h(SwallowOnboarding, props),
    ))
}
