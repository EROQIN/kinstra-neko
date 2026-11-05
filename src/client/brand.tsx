// 品牌资产：原创 SVG 猫耳图标 + 侧栏品牌。无第三方素材依赖。
import { createElement as h } from 'react'

export const BRAND_COLOR = '#ff7eb3'

export function NekoIcon({ size = 20, className }: { size?: number; className?: string }) {
  return h('svg', { className, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-label': 'Kinstra Neko' },
    // 两只猫耳
    h('path', { d: 'M4 7 L6.5 3 L9.5 7 Z', fill: BRAND_COLOR }),
    h('path', { d: 'M14.5 7 L17.5 3 L20 7 Z', fill: BRAND_COLOR }),
    // 脸
    h('circle', { cx: 12, cy: 13.5, r: 8, stroke: BRAND_COLOR, strokeWidth: 1.8, fill: 'rgba(255,126,179,0.12)' }),
    // 眼
    h('circle', { cx: 9, cy: 13, r: 1.1, fill: BRAND_COLOR }),
    h('circle', { cx: 15, cy: 13, r: 1.1, fill: BRAND_COLOR }),
    // 嘴
    h('path', { d: 'M10.4 16.2 Q12 17.6 13.6 16.2', stroke: BRAND_COLOR, strokeWidth: 1.4, strokeLinecap: 'round' }),
  )
}

export function BrandMark() {
  return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' } },
    h(NekoIcon, { size: 26 }))
}

export function BrandName() {
  return h('span', {
    style: { fontWeight: 700, fontSize: 15, letterSpacing: 0.3, background: `linear-gradient(90deg, ${BRAND_COLOR}, #ff9d6c)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', whiteSpace: 'nowrap' },
  }, 'Kinstra Neko')
}
