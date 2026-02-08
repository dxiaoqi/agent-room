import { useState, useEffect, useCallback, useRef } from 'react'
import { ServiceMessage, Room, User, ChatMessage } from '@/lib/types'
import { updateActivity, getReconnectToken, saveReconnectToken } from '@/lib/storage'

// 数据转换函数：统一服务端返回的房间数据格式
function normalizeRoom(room: any): Room {
  return {
    id: room.id || room.room_id,
    name: room.name,
    description: room.description,
    memberCount: room.memberCount || room.member_count || room.members?.length || 0,
    members: room.members,
    persistent: room.persistent,
    hasPassword: room.hasPassword || room.has_password || room.password_protected,
    createdAt: room.createdAt || room.created_at,
    createdBy: room.createdBy || room.created_by
  }
}

export function useAgentRoom(url: string, username: string) {
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [rooms, setRooms] = useState<Room[]>([])
  const [currentRoom, setCurrentRoom] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [roomMembers, setRoomMembers] = useState<string[]>([])
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isSessionReconnected, setIsSessionReconnected] = useState(false)
  const [restoredRooms, setRestoredRooms] = useState<string[]>([])
  const messageIdCounter = useRef(0)
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null)
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5
  const isReconnecting = useRef(false)
  const manualDisconnect = useRef(false)
  
  // 使用 ref 来存储最新的 url 和 username，避免依赖问题
  const urlRef = useRef(url)
  const usernameRef = useRef(username)
  
  // ★ 关键：用 ref 始终持有最新的 WebSocket 和认证状态，避免闭包陈旧引用
  const wsRef = useRef<WebSocket | null>(null)
  const authenticatedRef = useRef(false)
  const currentRoomRef = useRef<string | null>(null)
  
  // 包装 setWs / setAuthenticated / setCurrentRoom，同步更新 ref
  const updateWs = useCallback((newWs: WebSocket | null) => {
    wsRef.current = newWs
    setWs(newWs)
    console.log('🔄 updateWs called:', {
      hasWs: !!newWs,
      readyState: newWs?.readyState,
      stack: new Error().stack?.split('\n')[2]?.trim(),
    })
  }, [])
  
  const updateAuthenticated = useCallback((value: boolean) => {
    authenticatedRef.current = value
    setAuthenticated(value)
  }, [])
  
  const updateCurrentRoom = useCallback((roomId: string | null) => {
    currentRoomRef.current = roomId
    setCurrentRoom(roomId)
  }, [])
  
  useEffect(() => {
    urlRef.current = url
    usernameRef.current = username
  }, [url, username])

  // 心跳机制
  const startHeartbeat = useCallback((websocket: WebSocket) => {
    // 清除之前的心跳
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current)
      heartbeatInterval.current = null
    }
    
    console.log('💗 Starting heartbeat (30s interval)')
    heartbeatInterval.current = setInterval(() => {
      if (websocket.readyState === WebSocket.OPEN) {
        try {
          const pingMsg: ServiceMessage = {
            type: 'action',
            from: usernameRef.current,
            payload: { action: 'ping' }
          }
          websocket.send(JSON.stringify(pingMsg))
          console.log('💓 Heartbeat sent')
          updateActivity()
        } catch (error) {
          console.error('Failed to send heartbeat:', error)
        }
      } else {
        console.warn('⚠️ WebSocket not open, stopping heartbeat')
        if (heartbeatInterval.current) {
          clearInterval(heartbeatInterval.current)
          heartbeatInterval.current = null
        }
      }
    }, 30000)
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current)
      heartbeatInterval.current = null
      console.log('💔 Heartbeat stopped')
    }
  }, [])

  // 自动重连
  const attemptReconnect = useCallback(() => {
    // 防止重复触发
    if (isReconnecting.current) {
      console.log('⚠️ Already reconnecting, skipping...')
      return
    }
    
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      console.error('❌ Max reconnect attempts reached')
      setConnectionError(`重连失败，已尝试 ${maxReconnectAttempts} 次。请手动重新连接。`)
      isReconnecting.current = false
      setConnected(false) // 重连失败，标记为未连接
      return
    }

    isReconnecting.current = true
    reconnectAttempts.current++
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current - 1), 30000)
    
    console.log(`🔄 Attempting reconnect (${reconnectAttempts.current}/${maxReconnectAttempts}) in ${delay}ms...`)
    setConnectionError(`连接断开，${delay / 1000}秒后重连...（第 ${reconnectAttempts.current} 次尝试）`)

    reconnectTimeout.current = setTimeout(() => {
      console.log('🔄 Reconnecting now...')
      isReconnecting.current = false
      
      // 直接创建新的 WebSocket 连接
      try {
        const newWs = new WebSocket(urlRef.current)
        
        newWs.onopen = () => {
          console.log('✅ Reconnected successfully')
          
          // 先验证 username
          if (!usernameRef.current || usernameRef.current.trim().length === 0) {
            console.error('❌ Cannot authenticate on reconnect: username is empty')
            setConnectionError('重连失败：用户名为空')
            newWs.close()
            return
          }
          
          // 验证通过，设置连接状态
          setConnected(true)
          setConnectionError(null)
          updateWs(newWs)
          reconnectAttempts.current = 0
          
          // 发送认证（附带 reconnect token）
          const storedToken = getReconnectToken(urlRef.current, usernameRef.current)
          const authPayload: Record<string, unknown> = { action: 'auth', name: usernameRef.current }
          if (storedToken) {
            authPayload.token = storedToken
            console.log('🔑 Reconnect: Using stored reconnect token')
          }
          const authMsg: ServiceMessage = {
            type: 'action',
            from: usernameRef.current,
            payload: authPayload
          }
          console.log('📤 Reconnect: Sending authentication request:', { username: usernameRef.current, hasToken: !!storedToken })
          newWs.send(JSON.stringify(authMsg))
          
          // 启动心跳
          startHeartbeat(newWs)
          updateActivity()
        }
        
        // 复用相同的消息处理器
        newWs.onmessage = (event) => {
          try {
            const msg: ServiceMessage = JSON.parse(event.data)
            handleMessage(msg)
          } catch (error) {
            console.error('Failed to parse message:', error)
          }
        }
        
        newWs.onerror = (event) => {
          console.error('❌ Reconnection failed')
          setConnectionError('重连失败')
        }
        
        newWs.onclose = (event) => {
          console.log('🔌 Reconnected WebSocket closed:', event.code)
          stopHeartbeat()
          
          // Code 4001 = session taken over by another reconnect (expected, don't retry)
          if (event.code === 4001) {
            console.log('🔄 Session taken over by another connection')
            return
          }
          
          if (!manualDisconnect.current && !event.wasClean) {
            // 再次尝试重连
            attemptReconnect()
          }
        }
        
      } catch (error) {
        console.error('❌ Failed to create reconnection WebSocket:', error)
        isReconnecting.current = false
        attemptReconnect() // 继续尝试
      }
    }, delay)
  }, [startHeartbeat, stopHeartbeat])

  // 处理收到的消息
  const handleMessage = useCallback((msg: ServiceMessage) => {
    console.log('📨 Received:', msg)
    console.log('📌 Message type:', msg.type)
    if (msg.type === 'response') {
      console.log('📌 Action:', msg.payload.action)
      console.log('📌 Payload:', msg.payload)
    }

    switch (msg.type) {
      case 'response':
        if (msg.payload.action === 'auth') {
          // 检查认证是否成功
          if (msg.payload.success !== false) {
            console.log('✅ Authentication successful')
            
            // 防御性检查：确保 WebSocket 仍然存在且连接
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
              console.warn('⚠️ Auth success but WebSocket is gone, ignoring')
              return
            }
            
            updateAuthenticated(true)
            setConnectionError(null)

            // 存储服务端返回的 reconnect token
            const serverToken = msg.payload.data?.token || msg.payload.token
            if (serverToken) {
              saveReconnectToken(urlRef.current, usernameRef.current, serverToken)
              console.log('🔑 Reconnect token stored')
            }

            // 检查是否是 token 重连（session 恢复）
            const wasReconnected = msg.payload.data?.reconnected === true
            const restored = msg.payload.data?.restored_rooms as string[] | undefined
            if (wasReconnected) {
              console.log('🔄 Session reconnected! Restored rooms:', restored)
              setIsSessionReconnected(true)
              setRestoredRooms(restored ?? [])
            } else {
              setIsSessionReconnected(false)
              setRestoredRooms([])
            }

            const authRooms = msg.payload.data?.rooms || msg.payload.rooms
            if (authRooms) {
              const normalizedRooms = authRooms.map(normalizeRoom)
              console.log('🔐 Auth rooms normalized:', normalizedRooms)
              setRooms(normalizedRooms)
            }
          } else {
            // 认证失败
            console.error('❌ Authentication failed:', msg.payload)
            updateAuthenticated(false)
            
            // 检查是否是 token 无效（Invalid reconnect token）
            const errorMsg = msg.payload.message || msg.payload.error || '认证失败，请检查用户名'
            if (errorMsg.includes('Invalid reconnect token')) {
              // Token 无效，清除本地 token 后不带 token 重试
              console.warn('🔑 Stored reconnect token is invalid, clearing and retrying without token...')
              try {
                const raw = localStorage.getItem('agentroom_tokens')
                if (raw) {
                  const store = JSON.parse(raw)
                  const key = `${urlRef.current}|${usernameRef.current}`
                  delete store[key]
                  localStorage.setItem('agentroom_tokens', JSON.stringify(store))
                }
              } catch { /* ignore */ }
              
              // 不带 token 重新认证
              setConnectionError('Token 已失效，正在重新认证...')
              return // 下面的 attemptReconnect 会自动不带 token 重连
            }
            
            // 检查是否是用户名冲突
            if (errorMsg.includes('already taken') || errorMsg.includes('已被占用') || errorMsg.includes('已存在')) {
              const conflictMsg = `用户名 "${usernameRef.current}" 已被其他用户占用\n\n💡 请点击"更换用户名"按钮，选择一个不同的用户名`
              setConnectionError(conflictMsg)
              
              // 用户名冲突时，清除 session 和 reconnect flag，避免刷新后继续冲突
              try {
                localStorage.removeItem('agentroom_session')
                localStorage.removeItem('agentroom_reconnect')
                console.log('🗑️ Cleared session due to username conflict')
              } catch (error) {
                console.error('Failed to clear session:', error)
              }
              
              // 标记为手动断开，避免自动重连
              manualDisconnect.current = true
            } else {
              setConnectionError(errorMsg)
            }
          }
        } else if (msg.payload.action === 'room.list') {
          const roomList = msg.payload.data?.rooms || msg.payload.rooms || []
          console.log('📋 Room list received (raw):', roomList)
          const normalizedRooms = roomList.map(normalizeRoom)
          console.log('📋 Room list normalized:', normalizedRooms)
          setRooms(normalizedRooms)
        } else if (msg.payload.action === 'room.join') {
          if (msg.payload.success) {
            const roomId = msg.payload.data?.room_id || msg.payload.room_id
            console.log('✅ Joined room:', roomId)
            updateCurrentRoom(roomId)
          } else {
            const errorMessage = msg.payload.message || msg.payload.error || '加入房间失败'
            
            // "Already in this room" — 不是真正的错误，直接切换到该房间
            if (errorMessage.includes('Already in this room')) {
              const roomId = msg.payload.data?.room_id || msg.payload.room_id
              console.log('ℹ️ Already in room, switching to:', roomId)
              if (roomId) {
                updateCurrentRoom(roomId)
              }
              return
            }
            
            // 真正的加入失败
            console.error('❌ Failed to join room:', msg.payload)
            setConnectionError(errorMessage)
            
            // 如果是认证错误，重新认证
            if (errorMessage.includes('Authenticate') || errorMessage.includes('auth')) {
              updateAuthenticated(false)
            }
          }
        } else if (msg.payload.action === 'room.members') {
          const members = msg.payload.data?.members || msg.payload.members || []
          console.log('👥 Room members:', members)
          setRoomMembers(members)
        } else if (msg.payload.action === 'users.list') {
          const userList = msg.payload.data?.users || msg.payload.users || []
          console.log('👤 User list:', userList)
          setUsers(userList)
        }
        break

      case 'chat':
        const chatMsg: ChatMessage = {
          id: `msg-${messageIdCounter.current++}`,
          from: msg.from,
          to: msg.to || '',
          message: msg.payload.message || '',
          timestamp: msg.timestamp || new Date().toISOString(),
          type: 'chat'
        }
        setMessages(prev => [...prev, chatMsg])
        break

      case 'system':
        const systemMsg: ChatMessage = {
          id: `sys-${messageIdCounter.current++}`,
          from: 'System',
          to: msg.to || '',
          message: msg.payload.message || JSON.stringify(msg.payload),
          timestamp: msg.timestamp || new Date().toISOString(),
          type: 'system'
        }
        
        if (msg.payload.event === 'user.joined' || msg.payload.event === 'user.left') {
          setMessages(prev => [...prev, systemMsg])
        } else if (msg.payload.event === 'room.history') {
          const history = msg.payload.messages || []
          const historyMsgs: ChatMessage[] = history.map((m: any, i: number) => ({
            id: `hist-${i}`,
            from: m.from,
            to: m.to || '',
            message: m.payload?.message || '',
            timestamp: m.timestamp,
            type: 'chat'
          }))
          setMessages(prev => [...historyMsgs, ...prev])
        }
        break

      case 'error':
        console.error('Server error:', msg.payload)
        
        // 如果是认证错误，设置连接错误提示
        if (msg.payload.message?.includes('Authenticate') || msg.payload.message?.includes('auth')) {
          setConnectionError('认证失败：' + msg.payload.message)
          updateAuthenticated(false)
        }
        
        const errorMsg: ChatMessage = {
          id: `err-${messageIdCounter.current++}`,
          from: 'Error',
          to: '',
          message: msg.payload.message || 'Unknown error',
          timestamp: msg.timestamp || new Date().toISOString(),
          type: 'system'
        }
        setMessages(prev => [...prev, errorMsg])
        break
    }
  }, [])

  // 连接 WebSocket
  useEffect(() => {
    // 验证 URL 和用户名
    if (!url || url.trim().length === 0) {
      console.log('⚠️ Skipping connection - missing url')
      return
    }
    
    if (!username || username.trim().length === 0) {
      console.error('⚠️ Skipping connection - username is empty or invalid:', username)
      setConnectionError('用户名无效，请重新输入')
      return
    }

    console.log('Attempting to connect to:', url, 'with username:', username)
    setConnectionError(null)

    let websocket: WebSocket
    
    try {
      websocket = new WebSocket(url)
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      setConnectionError('无效的服务器地址')
      return
    }
    
    websocket.onopen = () => {
      console.log('✅ WebSocket connected successfully')
      
      // 先验证 username，验证通过后再设置状态
      if (!username || username.trim().length === 0) {
        console.error('❌ Cannot authenticate: username is empty')
        setConnectionError('认证失败：用户名为空')
        websocket.close()
        return
      }
      
      // 验证通过，设置连接状态
      setConnected(true)
      setConnectionError(null)
      updateWs(websocket)
      reconnectAttempts.current = 0
      isReconnecting.current = false
      
      // 构建 auth payload，附带 reconnect token（如果有）
      const storedToken = getReconnectToken(url, usernameRef.current)
      const authPayload: Record<string, unknown> = { action: 'auth', name: usernameRef.current }
      if (storedToken) {
        authPayload.token = storedToken
        console.log('🔑 Using stored reconnect token for initial auth')
      }
      const authMsg: ServiceMessage = {
        type: 'action',
        from: usernameRef.current,
        payload: authPayload
      }
      console.log('📤 Sending authentication request:', { username: usernameRef.current, hasToken: !!storedToken })
      websocket.send(JSON.stringify(authMsg))
      console.log('✅ Sent authentication request')
      
      startHeartbeat(websocket)
      updateActivity()
    }

    websocket.onmessage = (event) => {
      try {
        const msg: ServiceMessage = JSON.parse(event.data)
        handleMessage(msg)
      } catch (error) {
        console.error('Failed to parse message:', error)
      }
    }

    websocket.onerror = (event) => {
      console.error('❌ WebSocket error occurred')
      console.error('URL:', url)
      console.error('ReadyState:', websocket.readyState)
    }

    websocket.onclose = (event) => {
      console.log('🔌 WebSocket disconnected')
      console.log('Close code:', event.code)
      console.log('Close reason:', event.reason || '(no reason)')
      console.log('Manual disconnect:', manualDisconnect.current)
      
      stopHeartbeat()
      
      const closeCodeExplanations: { [key: number]: string } = {
        1000: '正常关闭',
        1001: '端点离开（如服务器关闭）',
        1006: '异常关闭（无法连接或连接中断）',
        4001: '会话已被新连接接管',
      }
      
      // Code 4001 = session taken over by another reconnect (expected, don't retry)
      if (event.code === 4001) {
        console.log('🔄 Session taken over by another connection, not reconnecting')
        setConnected(false)
        updateAuthenticated(false)
        updateWs(null)
        setConnectionError('会话已被新的连接接管')
        return
      }
      
      const explanation = closeCodeExplanations[event.code] || '未知原因'
      console.log('说明:', explanation)
      
      // 用户主动断开或组件卸载
      if (manualDisconnect.current || event.reason === 'Component unmounting') {
        console.log('👋 Manual disconnect or unmounting')
        setConnected(false)
        updateAuthenticated(false)
        updateWs(null)
        manualDisconnect.current = false
        return
      }
      
      // 非主动断开
      updateAuthenticated(false)
      updateWs(null)
      
      // 异常关闭才自动重连
      if (!event.wasClean && (event.code === 1006 || event.code === 1001)) {
        setConnectionError(`连接异常关闭 - ${explanation}`)
        if (!isReconnecting.current) {
          attemptReconnect()
        }
      } else {
        // 其他情况标记为未连接
        setConnected(false)
        setConnectionError(`连接关闭: ${explanation}`)
      }
    }

    return () => {
      console.log('🧹 Cleaning up WebSocket connection...')
      stopHeartbeat()
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current)
        reconnectTimeout.current = null
      }
      isReconnecting.current = false
      
      // 显式清理状态，防止 onclose 竞态导致的状态不一致
      updateWs(null)
      updateAuthenticated(false)
      setConnected(false)
      
      if (websocket.readyState === WebSocket.OPEN || 
          websocket.readyState === WebSocket.CONNECTING) {
        websocket.close(1000, 'Component unmounting')
      }
    }
  }, [url, username, startHeartbeat, stopHeartbeat, handleMessage, attemptReconnect, updateWs, updateAuthenticated])

  // 断开连接（供外部调用）
  const disconnect = useCallback(() => {
    console.log('🔌 Manual disconnect requested')
    manualDisconnect.current = true
    
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }
    
    stopHeartbeat()
    
    const currentWs = wsRef.current
    if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
      currentWs.close(1000, 'User disconnect')
    }
    
    setConnected(false)
    updateAuthenticated(false)
    updateWs(null)
    setConnectionError(null)
    reconnectAttempts.current = 0
    isReconnecting.current = false
  }, [stopHeartbeat, updateAuthenticated, updateWs])

  // ─── 发送辅助：始终使用 ref 获取最新 ws，避免闭包陈旧引用 ────────

  /** 安全发送：检查 ws 是否存在且 OPEN */
  const safeSend = useCallback((data: ServiceMessage): boolean => {
    const currentWs = wsRef.current
    const isAuth = authenticatedRef.current
    
    // 检测不一致状态：authenticated 为 true 但 ws 为 null
    if (isAuth && !currentWs) {
      console.error('🔴 State inconsistency detected: authenticated but no WebSocket!', {
        authenticated: isAuth,
        ws: !!currentWs,
      })
      // 自动修复：重置 authenticated 状态
      updateAuthenticated(false)
      setConnectionError('连接状态异常，请刷新页面或重新连接')
      return false
    }
    
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Cannot send: WebSocket is not open', {
        ws: !!currentWs,
        readyState: currentWs?.readyState,
        authenticated: isAuth,
      })
      return false
    }
    if (!isAuth) {
      console.warn('⚠️ Cannot send: not authenticated')
      return false
    }
    try {
      currentWs.send(JSON.stringify(data))
      return true
    } catch (error) {
      console.error('❌ WebSocket send error:', error)
      return false
    }
  }, [updateAuthenticated])

  // 发送消息
  const sendMessage = useCallback((message: string, to?: string) => {
    const room = currentRoomRef.current
    const msg: ServiceMessage = {
      type: 'chat',
      from: usernameRef.current,
      to: to || `room:${room}`,
      payload: { message }
    }
    const sent = safeSend(msg)
    if (!sent) {
      console.error('❌ Message not sent:', { room, message: message.slice(0, 50) })
    }
  }, [safeSend])

  // 加入房间
  const joinRoom = useCallback((roomId: string, password?: string) => {
    const msg: ServiceMessage = {
      type: 'action',
      from: usernameRef.current,
      payload: { 
        action: 'room.join', 
        room_id: roomId,
        ...(password && { password })
      }
    }
    if (safeSend(msg)) {
      setMessages([])
    }
  }, [safeSend])

  // 离开房间
  const leaveRoom = useCallback((roomId?: string) => {
    const targetRoom = roomId || currentRoomRef.current
    if (!targetRoom) return

    const msg: ServiceMessage = {
      type: 'action',
      from: usernameRef.current,
      payload: { action: 'room.leave', room_id: targetRoom }
    }
    if (safeSend(msg)) {
      if (targetRoom === currentRoomRef.current) {
        updateCurrentRoom(null)
        setMessages([])
        setRoomMembers([])
      }
    }
  }, [safeSend, updateCurrentRoom])

  // 创建房间
  const createRoom = useCallback((roomId: string, name: string, description?: string, password?: string, persistent?: boolean) => {
    const msg: ServiceMessage = {
      type: 'action',
      from: usernameRef.current,
      payload: {
        action: 'room.create',
        room_id: roomId,
        name,
        ...(description && { description }),
        ...(password && { password }),
        ...(persistent !== undefined && { persistent })
      }
    }
    safeSend(msg)
  }, [safeSend])

  // 刷新房间列表
  const refreshRooms = useCallback(() => {
    const msg: ServiceMessage = {
      type: 'action',
      from: usernameRef.current,
      payload: { action: 'room.list' }
    }
    safeSend(msg)
  }, [safeSend])

  // 获取房间成员
  const getRoomMembers = useCallback((roomId?: string) => {
    const targetRoom = roomId || currentRoomRef.current
    if (!targetRoom) return

    const msg: ServiceMessage = {
      type: 'action',
      from: usernameRef.current,
      payload: { action: 'room.members', room_id: targetRoom }
    }
    safeSend(msg)
  }, [safeSend])

  // 获取在线用户列表
  const getUsers = useCallback(() => {
    const msg: ServiceMessage = {
      type: 'action',
      from: usernameRef.current,
      payload: { action: 'users.list' }
    }
    safeSend(msg)
  }, [safeSend])

  return {
    connected,
    authenticated,
    rooms,
    currentRoom,
    messages,
    users,
    roomMembers,
    connectionError,
    isSessionReconnected,
    restoredRooms,
    sendMessage,
    joinRoom,
    leaveRoom,
    createRoom,
    refreshRooms,
    getRoomMembers,
    getUsers,
    disconnect
  }
}
