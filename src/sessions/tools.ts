// 挂到每个猫娘会话的社交工具：记事、回忆。
// 群聊会话也可以用——猫娘的"记性"是陪伴感的核心。

import type { MemoryStore } from '../memory/store.js'
import type { ChatRef } from './manager.js'

interface ToolContext {
  chat: ChatRef
  memory: MemoryStore
  speakers: () => string[]
}

// alpha 工具定义要求 output.schema/render；类型在各小版本有细微差异，用最小可用结构。
export function buildSocialTools(tc: ToolContext): any[] {
  return [
    {
      name: 'kinstra_remember',
      description: '记住一件值得留着的事：群友的喜好、约定、正在做的事、你们之间发生的小事。琐碎日常不用记。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句完整的话，把事情说清楚，例如「小明说他下周三要去成都出差」' },
          about: { type: 'string', description: '这件事主要关于谁的 QQ 号；是整个群的事就留空' },
          aboutName: { type: 'string', description: '这个人的名字/群名片（about 填了就填这个）' },
          importance: { type: 'number', description: '0~1，生日约定这类 0.9，普通喜好 0.5，闲聊碎片 0.3' },
          tags: { type: 'array', items: { type: 'string' }, description: '几个关键词' },
        },
        required: ['text'],
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: (value as any)?.ok ? '记住了' : '没记住' }],
      },
      execute: async (args: any) => {
        const text = String(args?.text ?? '').trim()
        if (!text) return { ok: false }
        tc.memory.add({
          text: text.slice(0, 500),
          chatId: tc.chat.chatId,
          about: String(args?.about ?? ''),
          aboutName: args?.aboutName ? String(args.aboutName) : undefined,
          importance: Number(args?.importance ?? 0.5),
          tags: Array.isArray(args?.tags) ? args.tags.map(String).slice(0, 8) : [],
        })
        return { ok: true }
      },
    },
    {
      name: 'kinstra_recall',
      description: '回忆跟当前话题有关的旧事，或者某个群友的相关信息。回复前想不起来时用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要回忆什么，例如「小明 出差」「奶茶」' },
        },
        required: ['query'],
      },
      output: {
        schema: { type: 'object', properties: { memories: { type: 'array', items: { type: 'string' } } } },
        render: (_args: unknown, value: unknown) => {
          const ms = (value as any)?.memories ?? []
          return [{ type: 'text', text: ms.length ? ms.join('\n') : '没想起来什么' }]
        },
      },
      execute: async (args: any) => {
        const query = String(args?.query ?? '').trim()
        if (!query) return { memories: [] }
        const hits = tc.memory.recall(query, { chatId: tc.chat.chatId, about: tc.speakers() })
        return {
          memories: hits.map((h) => {
            const who = h.fact.aboutName ? `（关于${h.fact.aboutName}）` : ''
            const stale = h.fact.invalid ? '【可能已过时】' : ''
            return `- ${stale}${h.fact.text}${who}`
          }),
        }
      },
    },
  ]
}
