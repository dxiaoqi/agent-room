'use client'

import { useState, useEffect, useRef } from 'react'
import { useAgentRoom } from '@/hooks/useAgentRoom'
import { saveLastRoom, getLastRoom, clearLastRoom } from '@/lib/storage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { 
  Send, 
  Users, 
  User,
  LogOut, 
  RefreshCw, 
  Plus,
  MessageSquare,
  Wifi,
  WifiOff,
  DoorOpen,
  Lock,
  Trash2
} from 'lucide-react'
import { ChatMessage, ServiceMessage } from '@/lib/types'
import { clearSession } from '@/lib/storage'

interface ChatRoomProps {
  serverUrl: string
  username: string
  onDisconnect: () => void
}

export function ChatRoom({ serverUrl, username, onDisconnect }: ChatRoomProps) {
  // 调试：检查 props
  useEffect(() => {
    console.log('🏠 ChatRoom mounted with:', { serverUrl, username })
  }, [])
  
  useEffect(() => {
    console.log('📝 ChatRoom props updated:', { serverUrl, username })
  }, [serverUrl, username])
  
  const {
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
  } = useAgentRoom(serverUrl, username)

  const [messageInput, setMessageInput] = useState('')
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [newRoomId, setNewRoomId] = useState('')
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomDesc, setNewRoomDesc] = useState('')
  const [newRoomPassword, setNewRoomPassword] = useState('')
  const [newRoomPersistent, setNewRoomPersistent] = useState(false)
  const [joinRoomId, setJoinRoomId] = useState('')
  const [joinRoomPassword, setJoinRoomPassword] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const [pendingJoin, setPendingJoin] = useState<{roomId: string, password?: string} | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 认证成功后刷新数据
  useEffect(() => {
    if (authenticated) {
      console.log('🔐 Authenticated! Fetching rooms and users...')
      refreshRooms()
      getUsers()
    }
  }, [authenticated, refreshRooms, getUsers])

  // 调试：监听房间列表变化
  useEffect(() => {
    console.log('🏠 Rooms updated:', rooms)
  }, [rooms])

  // 调试：监听认证状态
  useEffect(() => {
    console.log('🔑 Authentication status:', authenticated)
  }, [authenticated])

  // 进入房间后获取成员列表
  useEffect(() => {
    if (currentRoom) {
      getRoomMembers()
      // 保存最后的房间
      saveLastRoom(currentRoom)
    }
  }, [currentRoom, getRoomMembers])

  // 认证成功后尝试恢复最后的房间
  useEffect(() => {
    if (authenticated && rooms.length > 0 && !currentRoom) {
      // 如果是 token 重连且有恢复的房间，优先使用恢复的房间
      if (isSessionReconnected && restoredRooms.length > 0) {
        const lastRoom = getLastRoom()
        const targetRoom = lastRoom && restoredRooms.includes(lastRoom) ? lastRoom : restoredRooms[0]
        console.log('🔄 Reconnected — joining restored room:', targetRoom)
        joinRoom(targetRoom)
        return
      }

      const lastRoom = getLastRoom()
      if (lastRoom) {
        const roomExists = rooms.find(r => r.id === lastRoom)
        if (roomExists) {
          console.log('🔄 Auto-joining last room:', lastRoom)
          joinRoom(lastRoom)
        } else {
          console.log('⚠️ Last room not found, clearing:', lastRoom)
          clearLastRoom()
        }
      }
    }
  }, [authenticated, rooms, currentRoom, joinRoom, isSessionReconnected, restoredRooms])

  // 认证成功后处理待加入的房间
  useEffect(() => {
    if (authenticated && pendingJoin) {
      console.log('✅ Authenticated, joining pending room:', pendingJoin.roomId)
      joinRoom(pendingJoin.roomId, pendingJoin.password)
      setTimeout(() => {
        setIsJoining(false)
        setPendingJoin(null)
      }, 1000)
    }
    
    // 如果等待认证超时（10秒），清除等待状态
    if (pendingJoin && !authenticated) {
      const timeoutId = setTimeout(() => {
        console.warn('⏰ Authentication timeout, clearing pending join')
        setIsJoining(false)
        setPendingJoin(null)
      }, 10000)
      
      return () => clearTimeout(timeoutId)
    }
  }, [authenticated, pendingJoin, joinRoom])

  const handleSendMessage = () => {
    if (!messageInput.trim() || !currentRoom) return
    sendMessage(messageInput)
    setMessageInput('')
  }

  const handleJoinRoom = (roomId: string, password?: string) => {
    // 检查是否已连接
    if (!connected) {
      console.warn('⚠️ Not connected, cannot join room')
      return
    }
    
    // 检查房间是否需要密码
    const room = rooms.find(r => r.id === roomId)
    
    // 如果房间有密码但没有提供密码，弹出加入表单
    if (room?.hasPassword && !password) {
      setJoinRoomId(roomId)
      setShowJoinRoom(true)
      setShowCreateRoom(false) // 关闭创建表单
      return
    }
    
    // 检查认证状态
    if (!authenticated) {
      console.log('🔐 Not authenticated yet, waiting...')
      setIsJoining(true)
      setPendingJoin({ roomId, password })
      return
    }
    
    // 直接加入房间
    setIsJoining(true)
    joinRoom(roomId, password)
    
    // 加入后重置状态
    setTimeout(() => {
      setIsJoining(false)
      setPendingJoin(null)
    }, 1000)
  }

  const handleJoinRoomWithPassword = () => {
    if (!joinRoomId.trim()) return
    handleJoinRoom(joinRoomId, joinRoomPassword || undefined)
    setShowJoinRoom(false)
    setJoinRoomId('')
    setJoinRoomPassword('')
  }

  const handleLeaveRoom = () => {
    if (currentRoom) {
      leaveRoom()
      clearLastRoom() // 清除最后的房间记录
    }
  }

  const handleCreateRoom = () => {
    if (!newRoomId.trim() || !newRoomName.trim()) return
    
    // 创建房间，包含持久化和密码选项
    createRoom(
      newRoomId, 
      newRoomName, 
      newRoomDesc || undefined, 
      newRoomPassword || undefined,
      newRoomPersistent
    )
    
    setShowCreateRoom(false)
    setNewRoomId('')
    setNewRoomName('')
    setNewRoomDesc('')
    setNewRoomPassword('')
    setNewRoomPersistent(false)
    setTimeout(refreshRooms, 500)
  }

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    } catch {
      return ''
    }
  }

  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase()
  }

  const currentRoomInfo = rooms.find(r => r.id === currentRoom)

  return (
    <div className="flex h-screen bg-background">
      {/* 左侧边栏 - 房间列表 */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">AgentRoom</h2>
              <p className="text-sm text-muted-foreground">{username}</p>
            </div>
            <Badge 
              variant={connected ? 'default' : 'destructive'}
              className={connected ? 'animate-pulse-scale' : ''}
            >
              {connected ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3 animate-pulse" />
              )}
            </Badge>
          </div>
          
          {/* 加入房间等待提示 */}
          {isJoining && !authenticated && (
            <div className="mb-4 p-3 rounded-lg border animate-slide-up bg-blue-500/10 border-blue-500/20">
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                🔐 正在认证...
              </p>
              <p className="text-xs mt-1 text-blue-600/80 dark:text-blue-400/80">
                请稍候，认证完成后将自动加入房间
              </p>
              <div className="mt-2">
                <div className="h-1 bg-blue-500/20 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 animate-pulse-scale" style={{ width: '100%' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* 会话恢复提示 */}
          {isSessionReconnected && authenticated && (
            <div className="mb-4 p-3 rounded-lg border animate-slide-up bg-green-500/10 border-green-500/20">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                🔄 会话已恢复
              </p>
              <p className="text-xs mt-1 text-green-600/80 dark:text-green-400/80">
                通过 Token 自动重连成功
                {restoredRooms.length > 0 && (
                  <span>，已恢复房间: {restoredRooms.map(r => `#${r}`).join(', ')}</span>
                )}
              </p>
            </div>
          )}

          {/* 连接错误提示 */}
          {connectionError && (
            <div className={`mb-4 p-3 rounded-lg border animate-slide-up ${
              connectionError.includes('重连') 
                ? 'bg-yellow-500/10 border-yellow-500/20' 
                : 'bg-destructive/10 border-destructive/20'
            }`}>
              <p className={`text-sm font-medium ${
                connectionError.includes('重连') 
                  ? 'text-yellow-600 dark:text-yellow-400' 
                  : 'text-destructive'
              }`}>
                {connectionError.includes('重连') ? '🔄 正在重连' : '❌ 连接错误'}
              </p>
              <p className={`text-xs mt-1 ${
                connectionError.includes('重连')
                  ? 'text-yellow-600/80 dark:text-yellow-400/80'
                  : 'text-destructive/80'
              }`}>
                {connectionError}
              </p>
              {connectionError.includes('重连') && (
                <div className="mt-2">
                  <div className="h-1 bg-yellow-500/20 rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-500 animate-pulse-scale" style={{ width: '100%' }}></div>
                  </div>
                </div>
              )}
              {/* 用户名冲突时显示更换用户名按钮 */}
              {(connectionError.includes('已被占用') || connectionError.includes('already taken') || connectionError.includes('用户名冲突')) && (
                <div className="mt-3 space-y-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      disconnect()
                      onDisconnect()
                    }}
                    className="w-full transition-all hover:scale-105 active:scale-95"
                  >
                    <User className="w-4 h-4 mr-1" />
                    更换用户名
                  </Button>
                  <div className="text-xs text-muted-foreground p-2 bg-background/50 rounded border">
                    <p className="font-medium mb-1">💡 解决方法：</p>
                    <p>1. 点击"更换用户名"返回连接页面</p>
                    <p>2. 选择一个不同的用户名重新连接</p>
                    <p className="mt-2 text-blue-600 dark:text-blue-400">
                      💡 建议：在用户名后添加数字（如 {username}123）
                    </p>
                  </div>
                </div>
              )}
              
              {/* 其他认证错误时显示断开重连按钮 */}
              {(connectionError.includes('认证') || connectionError.includes('Authenticate') || connectionError.includes('auth')) && 
               !connectionError.includes('已被占用') && 
               !connectionError.includes('already taken') && 
               !connectionError.includes('用户名冲突') && 
               connected && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        disconnect()
                        onDisconnect()
                      }}
                      className="flex-1 transition-all hover:scale-105 active:scale-95"
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      断开重连
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (confirm('确定要清除所有保存的数据吗？清除后会返回连接页面。')) {
                          clearSession()
                          disconnect()
                          onDisconnect()
                        }
                      }}
                      className="flex-1 transition-all hover:scale-105 active:scale-95"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      清除数据
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground p-2 bg-background/50 rounded border">
                    <p className="font-medium mb-1">💡 故障排除：</p>
                    <p>1. 点击"断开重连"返回连接页面重新连接</p>
                    <p>2. 或点击"清除数据"清除所有保存的信息</p>
                    <p className="mt-2 text-yellow-600 dark:text-yellow-400">
                      ⚠️ 可能原因：Session 数据损坏或网络问题
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className="flex gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={refreshRooms}
              className="flex-1 transition-all hover:scale-105 active:scale-95 hover:shadow-md"
            >
              <RefreshCw className="w-4 h-4 mr-1 transition-transform group-hover:rotate-180" />
              刷新
            </Button>
          </div>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setShowCreateRoom(!showCreateRoom)}
              className="flex-1 transition-all hover:scale-105 active:scale-95 hover:shadow-md"
            >
              <Plus className="w-4 h-4 mr-1 transition-transform group-hover:rotate-90" />
              创建
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowJoinRoom(!showJoinRoom)}
              className="flex-1 transition-all hover:scale-105 active:scale-95 hover:shadow-md"
            >
              <DoorOpen className="w-4 h-4 mr-1 transition-transform group-hover:translate-x-1" />
              加入
            </Button>
          </div>
        </div>

        {/* 创建房间表单 */}
        {showJoinRoom && (
          <div className="p-4 border-b bg-muted/50 animate-slide-up">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <DoorOpen className="w-4 h-4" />
              加入房间
            </h3>
            
            {joinRoomId && rooms.find(r => r.id === joinRoomId) && (
              <div className="mb-3 p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2">
                  <Lock className="w-3 h-3 text-blue-500" />
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    房间 <span className="font-medium">#{joinRoomId}</span> 需要密码
                  </p>
                </div>
              </div>
            )}
            
            <Input
              placeholder="房间号 (例如: dev-ops)"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              className="mb-2 transition-all focus:scale-[1.01]"
              disabled={!!rooms.find(r => r.id === joinRoomId)}
            />
            <Input
              type="password"
              placeholder="密码（如果房间有密码保护）"
              value={joinRoomPassword}
              onChange={(e) => setJoinRoomPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && joinRoomId.trim()) {
                  handleJoinRoomWithPassword()
                }
              }}
              className="mb-3 transition-all focus:scale-[1.01]"
              autoFocus={!!joinRoomId}
            />
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleJoinRoomWithPassword} 
                className="flex-1 transition-all hover:scale-105 active:scale-95"
                disabled={!joinRoomId.trim()}
              >
                <DoorOpen className="w-4 h-4 mr-1" />
                加入
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  setShowJoinRoom(false)
                  setJoinRoomId('')
                  setJoinRoomPassword('')
                }}
                className="flex-1 transition-all hover:scale-105 active:scale-95"
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {showCreateRoom && (
          <div className="p-4 border-b bg-muted/50 animate-slide-up">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              创建新房间
            </h3>
            <Input
              placeholder="房间 ID (例如: dev-ops)"
              value={newRoomId}
              onChange={(e) => setNewRoomId(e.target.value)}
              className="mb-2 transition-all focus:scale-[1.01]"
            />
            <Input
              placeholder="房间名称"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              className="mb-2 transition-all focus:scale-[1.01]"
            />
            <Input
              placeholder="描述（可选）"
              value={newRoomDesc}
              onChange={(e) => setNewRoomDesc(e.target.value)}
              className="mb-2 transition-all focus:scale-[1.01]"
            />
            <Input
              type="password"
              placeholder="密码（可选，设置后需要密码才能加入）"
              value={newRoomPassword}
              onChange={(e) => setNewRoomPassword(e.target.value)}
              className="mb-3 transition-all focus:scale-[1.01]"
            />
            <div className="flex items-center space-x-2 mb-3 p-2 rounded-md bg-background/50">
              <Checkbox 
                id="persistent" 
                checked={newRoomPersistent}
                onCheckedChange={(checked) => setNewRoomPersistent(checked as boolean)}
              />
              <Label 
                htmlFor="persistent" 
                className="text-sm cursor-pointer select-none"
              >
                持久化房间（所有人离开后不会自动删除）
              </Label>
            </div>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleCreateRoom} 
                className="flex-1 transition-all hover:scale-105 active:scale-95"
                disabled={!newRoomId.trim() || !newRoomName.trim()}
              >
                创建
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  setShowCreateRoom(false)
                  setNewRoomId('')
                  setNewRoomName('')
                  setNewRoomDesc('')
                  setNewRoomPassword('')
                  setNewRoomPersistent(false)
                }}
                className="flex-1 transition-all hover:scale-105 active:scale-95"
              >
                取消
              </Button>
            </div>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-2">
            {authenticated ? (
              rooms.length > 0 ? (
                rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => handleJoinRoom(room.id)}
                    onDoubleClick={() => handleJoinRoom(room.id)}
                    disabled={isJoining || !connected}
                    className={`w-full text-left p-3 rounded-lg mb-1 transition-all duration-200 ${
                      currentRoom === room.id
                        ? 'bg-primary text-primary-foreground shadow-md scale-[1.02]'
                        : isJoining || !connected
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-muted hover:scale-[1.01] hover:shadow-sm active:scale-[0.99]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        <span className="font-medium">#{room.id}</span>
                        {room.hasPassword && (
                          <Lock className="w-3 h-3 opacity-70" title="需要密码" />
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {room.persistent && (
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            持久
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {room.memberCount || room.members?.length || 0}
                        </Badge>
                      </div>
                    </div>
                    {room.name && room.name !== room.id && (
                      <p className="text-xs text-muted-foreground mt-1 ml-6">
                        {room.name}
                      </p>
                    )}
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center p-4">
                  暂无房间
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground text-center p-4">
                连接中...
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t">
          <Button
            variant="outline"
            onClick={() => {
              disconnect() // 先断开 WebSocket
              onDisconnect() // 再通知父组件
            }}
            className="w-full transition-all hover:scale-105 active:scale-95 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive group"
          >
            <LogOut className="w-4 h-4 mr-2 transition-transform group-hover:translate-x-1" />
            断开连接
          </Button>
        </div>
      </div>

      {/* 主聊天区域 */}
      <div className="flex-1 flex flex-col">
        {currentRoom ? (
          <>
            {/* 房间头部 */}
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">#{currentRoom}</h2>
                {currentRoomInfo?.name && (
                  <p className="text-sm text-muted-foreground">
                    {currentRoomInfo.name}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="transition-all hover:scale-105">
                  <Users className="w-3 h-3 mr-1" />
                  {roomMembers.length} 成员
                </Badge>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={handleLeaveRoom}
                  className="transition-all hover:scale-105 active:scale-95 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                >
                  <LogOut className="w-4 h-4 mr-1" />
                  离开
                </Button>
              </div>
            </div>

            {/* 消息列表 */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="text-xs">
                        {getInitials(msg.from)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-medium text-sm">{msg.from}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(msg.timestamp)}
                        </span>
                        {msg.type === 'system' && (
                          <Badge variant="secondary" className="text-xs">
                            系统
                          </Badge>
                        )}
                      </div>
                      <p className={`text-sm ${
                        msg.type === 'system' 
                          ? 'text-muted-foreground italic' 
                          : ''
                      }`}>
                        {msg.message}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* 消息输入 */}
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Input
                  placeholder={`发送消息到 #${currentRoom}...`}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  className="flex-1 transition-all focus:scale-[1.01] focus:shadow-md"
                  size={undefined}                />
                <Button 
                  onClick={handleSendMessage}
                  className="transition-all hover:scale-110 active:scale-90 hover:shadow-lg"
                >
                  <Send className="w-4 h-4 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <Card className="w-96">
              <CardHeader>
                <CardTitle>欢迎来到 AgentRoom</CardTitle>
                <CardDescription>
                  从左侧选择或创建一个房间开始聊天
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">
                      {users.length} 个在线用户
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">
                      {rooms.length} 个活跃房间
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* 右侧边栏 - 成员列表（可选） */}
      {currentRoom && (
        <div className="w-64 border-l">
          <div className="p-4 border-b">
            <h3 className="font-semibold">房间成员</h3>
            <p className="text-sm text-muted-foreground">
              {roomMembers.length} 人在线
            </p>
          </div>
          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="p-2">
              {roomMembers.map((member) => (
                <div
                  key={member}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted transition-all hover:scale-[1.02] cursor-pointer"
                >
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-xs">
                      {getInitials(member)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{member}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
