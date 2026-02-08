// AgentRoom Service 协议类型定义

export interface ServiceMessage {
  id?: string
  type: 'action' | 'chat' | 'system' | 'response' | 'error'
  from: string
  to?: string
  timestamp?: string
  payload: any
}

export interface Room {
  id: string                    // 房间 ID（服务端返回的是 id，不是 room_id）
  name: string
  description?: string
  memberCount?: number          // 成员数量（服务端返回的是数字，不是数组）
  members?: string[]            // 成员列表（某些情况下返回）
  persistent?: boolean
  hasPassword?: boolean         // 是否有密码（服务端字段名）
  password_protected?: boolean  // 兼容旧字段名
  createdAt?: string           // 创建时间（服务端字段名）
  created_at?: string          // 兼容旧字段名
  createdBy?: string           // 创建者
}

export interface User {
  name: string
  id?: string
  rooms?: string[]
}

export interface ChatMessage {
  id: string
  from: string
  to: string
  message: string
  timestamp: string
  type: 'chat' | 'system' | 'dm'
}
