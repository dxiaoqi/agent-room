// Session 存储管理

const STORAGE_KEYS = {
  SESSION: 'agentroom_session',
  LAST_ROOM: 'agentroom_last_room',
  RECONNECT: 'agentroom_reconnect',
  TOKEN: 'agentroom_tokens',
}

export interface SessionData {
  serverUrl: string
  username: string
  connectedAt: string
  lastActivity: string
}

/** Token store: maps "url|name" → reconnect token */
interface TokenStore {
  [key: string]: string
}

export interface ReconnectData {
  shouldReconnect: boolean
  timestamp: string
}

// 保存 session
export function saveSession(serverUrl: string, username: string): void {
  // 验证数据
  if (!username || username.trim().length === 0) {
    console.error('❌ Cannot save session: username is empty')
    return
  }
  
  const session: SessionData = {
    serverUrl,
    username: username.trim(),  // 确保 trim
    connectedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  }
  
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session))
    console.log('💾 Session saved:', session)
  } catch (error) {
    console.error('Failed to save session:', error)
  }
}

// 获取 session
export function getSession(): SessionData | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SESSION)
    if (!data) return null
    
    const session: SessionData = JSON.parse(data)
    
    // 验证 session 数据
    if (!session.username || session.username.trim().length === 0) {
      console.error('❌ Invalid session: username is empty')
      clearSession()
      return null
    }
    
    if (!session.serverUrl || session.serverUrl.trim().length === 0) {
      console.error('❌ Invalid session: serverUrl is empty')
      clearSession()
      return null
    }
    
    // 检查 session 是否过期（24小时）
    const connectedAt = new Date(session.connectedAt).getTime()
    const now = Date.now()
    const hoursPassed = (now - connectedAt) / (1000 * 60 * 60)
    
    if (hoursPassed > 24) {
      console.log('🕐 Session expired (24h)')
      clearSession()
      return null
    }
    
    console.log('📂 Session loaded:', session)
    return session
  } catch (error) {
    console.error('Failed to load session:', error)
    return null
  }
}

// 更新活动时间
export function updateActivity(): void {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SESSION)
    if (!data) return
    
    const session: SessionData = JSON.parse(data)
    session.lastActivity = new Date().toISOString()
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session))
  } catch (error) {
    console.error('Failed to update activity:', error)
  }
}

// 清除 session
export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION)
    localStorage.removeItem(STORAGE_KEYS.RECONNECT)
    console.log('🗑️ Session cleared')
  } catch (error) {
    console.error('Failed to clear session:', error)
  }
}

// 保存最后的房间
export function saveLastRoom(roomId: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_ROOM, roomId)
  } catch (error) {
    console.error('Failed to save last room:', error)
  }
}

// 获取最后的房间
export function getLastRoom(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_ROOM)
  } catch (error) {
    console.error('Failed to get last room:', error)
    return null
  }
}

// 清除最后的房间
export function clearLastRoom(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.LAST_ROOM)
  } catch (error) {
    console.error('Failed to clear last room:', error)
  }
}

// 设置重连标记
export function setReconnectFlag(shouldReconnect: boolean): void {
  try {
    const data: ReconnectData = {
      shouldReconnect,
      timestamp: new Date().toISOString()
    }
    localStorage.setItem(STORAGE_KEYS.RECONNECT, JSON.stringify(data))
  } catch (error) {
    console.error('Failed to set reconnect flag:', error)
  }
}

// 获取重连标记
export function getReconnectFlag(): boolean {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.RECONNECT)
    if (!data) return false
    
    const reconnect: ReconnectData = JSON.parse(data)
    
    // 检查是否在 5 秒内（页面刷新场景）
    const timestamp = new Date(reconnect.timestamp).getTime()
    const now = Date.now()
    const secondsPassed = (now - timestamp) / 1000
    
    if (secondsPassed > 5) {
      localStorage.removeItem(STORAGE_KEYS.RECONNECT)
      return false
    }
    
    return reconnect.shouldReconnect
  } catch (error) {
    console.error('Failed to get reconnect flag:', error)
    return false
  }
}

// 检查是否有有效 session
export function hasValidSession(): boolean {
  return getSession() !== null
}

// ─── Reconnect Token Management ──────────────────────────────────────

function tokenKey(serverUrl: string, username: string): string {
  return `${serverUrl}|${username}`
}

/** Save a reconnect token for a server+username pair */
export function saveReconnectToken(serverUrl: string, username: string, token: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TOKEN)
    const store: TokenStore = raw ? JSON.parse(raw) : {}
    store[tokenKey(serverUrl, username)] = token
    localStorage.setItem(STORAGE_KEYS.TOKEN, JSON.stringify(store))
    console.log('🔑 Reconnect token saved for', username, '@', serverUrl)
  } catch (error) {
    console.error('Failed to save reconnect token:', error)
  }
}

/** Get the stored reconnect token for a server+username pair */
export function getReconnectToken(serverUrl: string, username: string): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TOKEN)
    if (!raw) return null
    const store: TokenStore = JSON.parse(raw)
    return store[tokenKey(serverUrl, username)] ?? null
  } catch (error) {
    console.error('Failed to get reconnect token:', error)
    return null
  }
}

/** Remove a specific reconnect token */
export function clearReconnectToken(serverUrl: string, username: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TOKEN)
    if (!raw) return
    const store: TokenStore = JSON.parse(raw)
    delete store[tokenKey(serverUrl, username)]
    localStorage.setItem(STORAGE_KEYS.TOKEN, JSON.stringify(store))
    console.log('🗑️ Reconnect token cleared for', username, '@', serverUrl)
  } catch (error) {
    console.error('Failed to clear reconnect token:', error)
  }
}

/** Clear all stored reconnect tokens */
export function clearAllReconnectTokens(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.TOKEN)
    console.log('🗑️ All reconnect tokens cleared')
  } catch (error) {
    console.error('Failed to clear all reconnect tokens:', error)
  }
}
