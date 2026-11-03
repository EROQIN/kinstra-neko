// Client 插件入口：侧栏品牌、侧栏入口、主面板、首启向导 overlay。

import { createElement as h } from 'react'
import { NekoIcon, BrandMark, BrandName } from './brand.js'
import { KinstraPanel } from './app.js'
import { Onboarding } from './onboarding.js'

export const inject = ['slots', 'locale']

const PANEL_ID = 'kinstra-neko'
const NS = 'kinstra-neko'

export function apply(ctx: any) {
  try {
    ctx.locale?.register?.(NS, {
      zh: { panel: 'Kinstra Neko', title: 'Kinstra Neko · 住在 QQ 里的猫娘' },
      en: { panel: 'Kinstra Neko', title: 'Kinstra Neko · catgirl in QQ' },
    })
  } catch { /* locale 是可选服务 */ }

  // 品牌：侧栏 logo 与名字
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark', locale: NS }, () => BrandMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, () => BrandName))

  // 面板本体
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
      (props: any) => h(KinstraPanel, props),
    ))

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
}
