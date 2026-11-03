// 插件配置：zod schema（校验）+ DEFAULTS（深合并补默认）+ 面板合并 + 密钥脱敏。
// 配置文件：$DSH_HOME/plugins-data/kinstra-neko/config.json
//
// 安全默认：总开关关、试运行（observe）开、白名单空 —— 装好不配置一句话都不会发。
// 说明：zod 4 的嵌套 .default({}) 不会递归填内层默认，因此采用 DEFAULTS 深合并再校验。

import { z } from 'zod'

const qqString = z.preprocess((v) => String(v ?? '').replace(/\D/g, ''), z.string())
const qqList = z.preprocess(
  (v) => Array.isArray(v) ? v : String(v ?? '').split(/[\s,，;；]+/),
  z.array(qqString).transform((xs) => [...new Set(xs.map(String).filter(Boolean))]),
)

export const ConfigSchema = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  setupDone: z.boolean(),

  botQQ: qqString,
  ownerQQ: qqString,
  ownerName: z.string(),

  allow: z.object({
    private: qqList,
    groups: qqList,
  }),

  gateway: z.enum(['napcat', 'onebot']),

  onebot: z.object({
    httpUrl: z.string(),
    wsUrl: z.string(),
    httpToken: z.string(),
    wsToken: z.string(),
  }),

  napcat: z.object({
    dir: z.string(),
    httpPort: z.number().int().min(1).max(65535),
    wsPort: z.number().int().min(1).max(65535),
    token: z.string(),
  }),

  workspaceDir: z.string(),

  model: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.string(),
    vision: z.enum(['auto', 'on', 'off']),
  }),
  chatModels: z.object({
    privateDefault: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }),
    groupDefault: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() }),
    privates: z.record(z.string(), z.any()),
    groups: z.record(z.string(), z.any()),
  }),

  merge: z.object({
    enabled: z.boolean(),
    waitSec: z.number().min(0).max(30),
    maxSec: z.number().min(0).max(60),
    groupWaitSec: z.number().min(0).max(60),
    groupMaxSec: z.number().min(0).max(120),
  }),

  group: z.object({
    wakeWords: z.array(z.string()),
    interjectChance: z.number().min(0).max(1),
    cooldownSec: z.number().min(0).max(86400),
    maxPerHour: z.number().min(0).max(120),
    quietHours: z.tuple([z.number().min(0).max(23), z.number().min(0).max(23)]),
    minRecentMessages: z.number().min(0).max(100),
    activeWindowSec: z.number().min(30).max(86400),
    interests: z.array(z.string()),
    minRelevance: z.number().min(0).max(1),
    burstMax: z.number().min(1).max(50),
    burstWindowSec: z.number().min(10).max(3600),
    engagedMs: z.number().min(30_000).max(3_600_000),
    overrides: z.record(z.string(), z.any()),
  }),

  persona: z.object({ current: z.string() }),

  memory: z.object({
    enabled: z.boolean(),
    recallCount: z.number().min(0).max(20),
    hotIndexPerGroup: z.number().min(50).max(5000),
    hotGroups: z.number().min(1).max(50),
  }),

  reply: z.object({
    faces: z.boolean(),
    maxBubbles: z.number().min(1).max(10),
    typingDelay: z.boolean(),
    showInputStatus: z.boolean(),
  }),

  voice: z.object({ asr: z.boolean() }),

  tabs: z.record(z.string(), z.any()),
})

export type Config = z.infer<typeof ConfigSchema>

/** 出厂默认值。 */
export const DEFAULTS = {
  enabled: false,
  dryRun: true,
  setupDone: false,
  botQQ: '',
  ownerQQ: '',
  ownerName: '主人',
  allow: { private: [], groups: [] },
  gateway: 'napcat' as const,
  onebot: { httpUrl: '', wsUrl: '', httpToken: '', wsToken: '' },
  napcat: { dir: '', httpPort: 3000, wsPort: 3001, token: '' },
  workspaceDir: '',
  model: { provider: '', model: '', reasoningEffort: 'low', vision: 'auto' as const },
  chatModels: {
    privateDefault: { provider: '', model: '', reasoningEffort: '' },
    groupDefault: { provider: '', model: '', reasoningEffort: '' },
    privates: {}, groups: {},
  },
  merge: { enabled: true, waitSec: 2.5, maxSec: 8, groupWaitSec: 5, groupMaxSec: 15 },
  group: {
    wakeWords: ['猫娘', 'neko', 'Neko'],
    interjectChance: 0.08,
    cooldownSec: 120,
    maxPerHour: 4,
    quietHours: [1, 8] as [number, number],
    minRecentMessages: 3,
    activeWindowSec: 300,
    interests: ['猫', '小鱼干', '晒太阳', '睡觉', '游戏', '动漫', '奶茶', '好吃的', '熬夜', '下雨', '可爱'],
    minRelevance: 0.25,
    burstMax: 6,
    burstWindowSec: 120,
    engagedMs: 3 * 60_000,
    overrides: {},
  },
  persona: { current: 'neko' },
  memory: { enabled: true, recallCount: 5, hotIndexPerGroup: 400, hotGroups: 8 },
  reply: { faces: true, maxBubbles: 3, typingDelay: true, showInputStatus: true },
  voice: { asr: true },
  tabs: {},
}

const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export function deepMerge(base: any, over: any): any {
  if (!isObj(over)) return structuredClone(base)
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue
    if (isObj(v) && isObj(out[k]) && !Array.isArray(v)) out[k] = deepMerge(out[k], v)
    else out[k] = v
  }
  return out
}

/** 解析 + 深合并默认 + 校验。非法整段配置回退默认值并抢救关键字段。 */
export function normalize(raw: unknown): Config {
  const merged = deepMerge(DEFAULTS, raw ?? {})
  const result = ConfigSchema.safeParse(merged)
  if (result.success) return result.data
  // 某层类型坏了：逐块回退
  const fallback = structuredClone(DEFAULTS) as Record<string, any>
  const r = (raw ?? {}) as Record<string, unknown>
  if (typeof r.botQQ === 'string') fallback.botQQ = String(r.botQQ).replace(/\D/g, '')
  if (typeof r.ownerQQ === 'string') fallback.ownerQQ = String(r.ownerQQ).replace(/\D/g, '')
  if (typeof r.ownerName === 'string' && r.ownerName.trim()) fallback.ownerName = r.ownerName
  // 旧版本可能写过已移除的 gateway（如 'snowluma'）：不在白名单内就回落默认 'napcat'，
  // 绝不把非法枚举塞回 schema（否则 parse 抛异常、插件无法启动）。
  if (r.gateway === 'napcat' || r.gateway === 'onebot') fallback.gateway = r.gateway
  if (typeof r.workspaceDir === 'string') fallback.workspaceDir = r.workspaceDir
  if (isObj(r.persona) && typeof r.persona.current === 'string') fallback.persona = { current: r.persona.current }
  if (isObj(r.allow) && Array.isArray(r.allow.groups)) fallback.allow = r.allow
  return ConfigSchema.parse(fallback)
}

/** 不回传明文的密钥字段。 */
export const SECRET_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['onebot', 'httpToken'],
  ['onebot', 'wsToken'],
  ['napcat', 'token'],
]

/** 面板回传配置：空串的密钥字段保留原值；null 表示清空。 */
export function mergeFromPanel(current: Config, incoming: unknown): Config {
  const next = deepMerge(current, incoming ?? {})
  for (const [g, k] of SECRET_PATHS) {
    const v = isObj(incoming) ? (incoming[g] as Record<string, unknown> | undefined)?.[k] : undefined
    if (!isObj(next[g])) continue
    if (v === null) next[g][k] = ''
    else if (v === undefined || v === '') next[g][k] = (current as any)[g]?.[k] ?? ''
  }
  // 白名单整表替换
  if (isObj(incoming) && isObj((incoming as any).allow)) {
    next.allow = { ...current.allow, ...(incoming as any).allow }
  }
  if (isObj(incoming) && isObj((incoming as any).group) && isObj((incoming as any).group.overrides)) {
    next.group.overrides = (incoming as any).group.overrides
  }
  return normalize(next)
}

/** 给面板的配置：密钥只告诉"有没有"，不回传原文。 */
export function publicConfig(cfg: Config): Record<string, unknown> {
  const c = structuredClone(cfg) as any
  for (const [g, k] of SECRET_PATHS) {
    if (!isObj(c[g])) continue
    c[g][`${k}Set`] = Boolean(c[g][k])
    c[g][k] = ''
  }
  return c
}
