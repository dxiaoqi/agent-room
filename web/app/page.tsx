'use client'

import { useState, useEffect } from 'react'
import { ConnectForm } from '@/components/ConnectForm'
import { ChatRoom } from '@/components/ChatRoom'
import { DebugPanel } from '@/components/DebugPanel'
import { 
  getSession, 
  saveSession, 
  clearSession, 
  setReconnectFlag, 
  getReconnectFlag,
  hasValidSession
} from '@/lib/storage'

export default function Home() {
  const [connected, setConnected] = useState(false)
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // 页面加载时检查 session
  useEffect(() => {
    console.log('🔍 Checking for saved session...')
    
    const shouldReconnect = getReconnectFlag()
    const session = getSession()
    
    // 验证 session 数据
    if (session) {
      if (!session.username || session.username.trim().length === 0) {
        console.error('❌ Invalid session: username is empty, clearing session')
        clearSession()
        setIsLoading(false)
        return
      }
      
      if (!session.serverUrl || session.serverUrl.trim().length === 0) {
        console.error('❌ Invalid session: serverUrl is empty, clearing session')
        clearSession()
        setIsLoading(false)
        return
      }
    }
    
    if (shouldReconnect && session) {
      console.log('🔄 Auto-reconnecting from saved session...', session)
      
      // 先设置 URL 和用户名，确保这些值已经设置
      setServerUrl(session.serverUrl)
      setUsername(session.username)
      
      // 延迟设置 connected，确保上面的状态已经更新
      setTimeout(() => {
        console.log('✅ Setting connected=true for auto-reconnect')
        setConnected(true)
      }, 0)
    } else if (session && !shouldReconnect) {
      console.log('💡 Found saved session, but not auto-reconnecting')
      // 可以在 ConnectForm 中预填充信息
      setServerUrl(session.serverUrl)
      setUsername(session.username)
    }
    
    setIsLoading(false)
  }, [])

  // 监听页面卸载（刷新或关闭）
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (connected) {
        // 设置重连标记（用于刷新页面后自动重连）
        setReconnectFlag(true)
        console.log('🔄 Page refresh detected, will auto-reconnect')
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [connected])

  const handleConnect = (url: string, user: string) => {
    console.log('🔗 Connecting...', { url, user })
    
    // 验证用户名
    const trimmedUser = user.trim()
    if (!trimmedUser || trimmedUser.length === 0) {
      console.error('❌ Cannot connect: username is empty')
      alert('请输入有效的用户名')
      return
    }
    
    // 验证 URL
    if (!url || url.trim().length === 0) {
      console.error('❌ Cannot connect: URL is empty')
      alert('请输入有效的服务器地址')
      return
    }
    
    // 先设置 URL 和用户名（使用 trim 后的值）
    setServerUrl(url)
    setUsername(trimmedUser)
    
    // 延迟设置 connected，确保上面的状态已经更新
    setTimeout(() => {
      setConnected(true)
      // 保存 session（使用 trim 后的值）
      saveSession(url, trimmedUser)
    }, 0)
  }

  const handleDisconnect = () => {
    console.log('👋 Disconnecting...')
    setConnected(false)
    setServerUrl('')
    setUsername('')
    
    // 清除 session（用户主动断开）
    clearSession()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <main>
        {connected && serverUrl && username ? (
          <ChatRoom
            serverUrl={serverUrl}
            username={username}
            onDisconnect={handleDisconnect}
          />
        ) : (
          <ConnectForm 
            onConnect={handleConnect}
            initialServerUrl={serverUrl}
            initialUsername={username}
          />
        )}
      </main>
      <DebugPanel />
    </>
  )
}
