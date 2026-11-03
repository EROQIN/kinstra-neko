// OneBot v11 协议类型（只覆盖本插件用到的部分）。
// 参考：https://github.com/botuniverse/onebot-11

/** OneBot 消息段。 */
export interface Segment {
  type: string
  data: Record<string, string | number | undefined>
}

/** 消息事件（群聊 / 私聊）。 */
export interface MessageEvent {
  post_type: 'message' | 'message_sent'
  message_type: 'private' | 'group'
  sub_type?: string
  message_id: number | string
  user_id: number
  self_id?: number
  group_id?: number
  sender?: {
    user_id?: number
    nickname?: string
    card?: string
    role?: 'owner' | 'admin' | 'member' | string
  }
  /** 多数实现给数组形态；字符串 CQ 码形态也兼容。 */
  message: Segment[] | string
  raw_message?: string
  time?: number
}

/** 通知事件（戳一戳等）。 */
export interface NoticeEvent {
  post_type: 'notice'
  notice_type: string
  sub_type?: string
  self_id?: number
  user_id?: number
  sender_id?: number
  target_id?: number
  group_id?: number
  action?: string
  suffix?: string
}

/** 任意 OneBot 事件。 */
export type OneBotEvent = MessageEvent | NoticeEvent | { post_type: string; [k: string]: unknown }

/** OneBot API 标准应答。 */
export interface OneBotResponse<T = unknown> {
  status: 'ok' | 'async' | 'failed'
  retcode: number
  data: T
  msg?: string
  wording?: string
  echo?: string
}

/** 连接配置。 */
export interface EndpointConfig {
  httpUrl: string
  wsUrl: string
  httpToken: string
  wsToken: string
}

/** 连接状态。 */
export type OneBotState = 'stopped' | 'unconfigured' | 'connecting' | 'connected' | 'disconnected'
