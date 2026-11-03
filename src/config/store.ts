// 配置装载、持久化与变更订阅。

import { dataDir, readJson, writeJson } from '../core/store.js'
import { AsyncMutex } from '../core/lock.js'
import { ConfigSchema, mergeFromPanel, normalize } from './schema.js'
import type { Config } from './schema.js'

const FILE = () => dataDir('config.json')

export interface ConfigStore {
  get(): Config
  set(next: Config): Config
  /** 面板保存：密钥空串保留、深合并、重新校验。 */
  merge(incoming: unknown): Config
  subscribe(fn: (next: Config, prev: Config) => void): () => void
}

export function createConfigStore(): ConfigStore {
  let cfg = normalize(readJson<unknown>(FILE(), {}))
  const mutex = new AsyncMutex()
  const listeners = new Set<(next: Config, prev: Config) => void>()

  const persist = (next: Config) => {
    writeJson(FILE(), next)
  }

  return {
    get: () => cfg,
    set(next: Config) {
      const prev = cfg
      cfg = normalize(next)
      persist(cfg)
      for (const fn of listeners) {
        try { fn(cfg, prev) } catch { /* 监听者异常不影响配置写入 */ }
      }
      return cfg
    },
    merge(incoming: unknown) {
      const prev = cfg
      cfg = mergeFromPanel(cfg, incoming)
      persist(cfg)
      for (const fn of listeners) {
        try { fn(cfg, prev) } catch { /* ignore */ }
      }
      return cfg
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** 供 CLI/安装器在插件进程外直接写配置（向导落盘用）。 */
export function writeRawConfig(raw: unknown): Config {
  const cfg = normalize(raw)
  writeJson(FILE(), cfg)
  return cfg
}

export { ConfigSchema }
