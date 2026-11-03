// 人格卡：数据目录 personas/*.md（带 --- frontmatter），首次启动从内置 personas/ 复制。
// 当前人格通过系统提示词变量 {{kinstra_persona}} 注入到猫娘 preset。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir } from '../core/store.js'

const BUNDLED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'personas')
const dir = () => dataDir('personas')

export interface PersonaMeta {
  id: string
  name: string
  tags: string[]
}
export interface Persona extends PersonaMeta {
  body: string
}
export interface PersonaFile extends Persona {
  raw: string
}

export function seedPersonas(): void {
  mkdirSync(dir(), { recursive: true })
  try {
    for (const n of readdirSync(BUNDLED)) {
      if (n.endsWith('.md') && !existsSync(join(dir(), n))) copyFileSync(join(BUNDLED, n), join(dir(), n))
    }
  } catch { /* 打包后没有 personas 目录也不致命 */ }
}

export function parsePersona(id: string, raw: string): Persona {
  let text = String(raw ?? '').replace(/^﻿/, '')
  const meta: PersonaMeta = { id, name: id, tags: [] }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (m) {
    for (const line of m[1]!.split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (!kv) continue
      if (kv[1] === 'name') meta.name = kv[2]!.trim()
      if (kv[1] === 'tags') meta.tags = kv[2]!.replace(/^\[|\]$/g, '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    }
    text = text.slice(m[0]!.length)
  }
  return { ...meta, body: text.trim() }
}

const safeId = (id: string) => String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)

export function listPersonas(): Array<PersonaMeta & { chars: number }> {
  seedPersonas()
  const out: Array<PersonaMeta & { chars: number }> = []
  for (const n of readdirSync(dir())) {
    if (!n.endsWith('.md')) continue
    const id = n.slice(0, -3)
    try {
      const p = parsePersona(id, readFileSync(join(dir(), n), 'utf8'))
      out.push({ id, name: p.name, tags: p.tags, chars: p.body.length })
    } catch { /* 跳过坏文件 */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function readPersona(id: string): PersonaFile | null {
  seedPersonas()
  const f = join(dir(), `${safeId(id)}.md`)
  if (!existsSync(f)) return null
  const raw = readFileSync(f, 'utf8')
  return { ...parsePersona(safeId(id), raw), raw }
}

export function savePersona(id: string, input: { name?: string; tags?: string[]; body: string }): PersonaFile {
  const sid = safeId(id)
  if (!sid) throw new Error('人格 id 只能用英文字母、数字、- 和 _')
  if (!String(input.body ?? '').trim()) throw new Error('人格内容不能是空的')
  mkdirSync(dir(), { recursive: true })
  const head = `---\nname: ${String(input.name ?? sid).replace(/\n/g, ' ').slice(0, 40)}\ntags: [${(input.tags ?? []).join(', ')}]\n---\n\n`
  writeFileSync(join(dir(), `${sid}.md`), head + String(input.body).trim() + '\n', 'utf8')
  return readPersona(sid)!
}

export function deletePersona(id: string): void {
  const f = join(dir(), `${safeId(id)}.md`)
  if (existsSync(f)) unlinkSync(f)
}

const FALLBACK = '你是 Kinstra Neko，一只住在 QQ 群里的猫娘，说话简短、口语、有一点点黏人。'

export function currentPersonaText(currentId: string): string {
  const p = readPersona(currentId)
    ?? (listPersonas()[0] && readPersona(listPersonas()[0]!.id))
  return p ? p.body : FALLBACK
}
