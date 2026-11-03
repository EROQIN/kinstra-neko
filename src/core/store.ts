// 数据目录与原子 JSON 读写。所有插件数据落在 $DSH_HOME/plugins-data/kinstra-neko/。

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function dataDir(...parts: string[]): string {
  const base = process.env.KINSTRA_NEKO_DATA_DIR || join(dshHome(), 'plugins-data', 'kinstra-neko')
  return join(base, ...parts)
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true })
  return p
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    let text = readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** 先写临时文件再 rename：崩溃也不会留下半截 JSON。 */
export function writeJson(file: string, value: unknown): void {
  ensureDir(dirname(file))
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export { existsSync }
