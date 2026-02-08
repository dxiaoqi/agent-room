'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Wifi, User, AlertCircle, History } from 'lucide-react'
import { ConnectionTest } from './ConnectionTest'
import { hasValidSession } from '@/lib/storage'

interface ConnectFormProps {
  onConnect: (url: string, username: string) => void
  initialServerUrl?: string
  initialUsername?: string
}

export function ConnectForm({ onConnect, initialServerUrl = 'ws://8.140.63.143:9000', initialUsername = '' }: ConnectFormProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl)
  const [username, setUsername] = useState(initialUsername)
  const [urlError, setUrlError] = useState('')
  const [showTest, setShowTest] = useState(false)
  const [hasSavedSession, setHasSavedSession] = useState(false)

  // 检查是否有保存的 session
  useEffect(() => {
    setHasSavedSession(hasValidSession() && (initialServerUrl !== '' || initialUsername !== ''))
  }, [initialServerUrl, initialUsername])

  const validateUrl = (url: string) => {
    if (!url.trim()) {
      setUrlError('请输入服务器地址')
      return false
    }
    
    try {
      const protocols = ['ws:', 'wss:', 'http:', 'https:']
      const hasValidProtocol = protocols.some(p => url.toLowerCase().startsWith(p))
      
      if (!hasValidProtocol) {
        setUrlError('地址必须以 ws://, wss://, http:// 或 https:// 开头')
        return false
      }
      
      // 尝试解析 URL
      new URL(url)
      setUrlError('')
      return true
    } catch {
      setUrlError('无效的 URL 格式')
      return false
    }
  }

  const handleConnect = () => {
    // 验证用户名
    if (!username || !username.trim()) {
      setUrlError('请输入用户名')
      return
    }
    
    // 验证 URL
    if (!validateUrl(serverUrl)) {
      // validateUrl 内部已经设置了 urlError
      return
    }
    
    // 传递 trim 后的值
    const trimmedUsername = username.trim()
    console.log('🔗 ConnectForm.handleConnect:', { serverUrl, username: trimmedUsername })
    onConnect(serverUrl, trimmedUsername)
  }
  
  const handleUrlChange = (value: string) => {
    setServerUrl(value)
    if (urlError) {
      setUrlError('')
    }
  }

  const quickConnect = (url: string) => {
    setServerUrl(url)
    setUrlError('')
    
    // 如果用户名已经填写，自动触发连接
    if (username && username.trim()) {
      // 使用 setTimeout 确保 state 更新后再连接
      setTimeout(() => {
        const trimmedUsername = username.trim()
        console.log('🔗 Quick Connect:', { url, username: trimmedUsername })
        onConnect(url, trimmedUsername)
      }, 0)
    }
  }

  const generateRandomUsername = () => {
    const adjectives = ['快乐', '聪明', '勇敢', '友好', '酷炫', '神秘', '幸运', '闪亮']
    const nouns = ['小熊', '小鸟', '小猫', '小狗', '兔子', '狐狸', '松鼠', '企鹅']
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)]
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)]
    const randomNum = Math.floor(Math.random() * 1000)
    return `${randomAdj}${randomNoun}${randomNum}`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-2xl space-y-4">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">连接到 AgentRoom</CardTitle>
              <CardDescription>
                输入 WebSocket/SSE 服务器地址和用户名
              </CardDescription>
            </div>
            {hasSavedSession && (
              <Badge variant="outline" className="animate-pulse-scale">
                <History className="w-3 h-3 mr-1" />
                恢复会话
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">服务器地址</label>
            <Input
              placeholder="ws://localhost:9000 或 http://localhost:9000"
              value={serverUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              className={`font-mono transition-all focus:scale-[1.01] focus:shadow-md ${urlError ? 'border-destructive animate-shake' : ''}`}
              size={undefined}            />
            {urlError && (
              <p className="text-xs text-destructive">{urlError}</p>
            )}
            <div className="flex gap-2 flex-wrap">
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all hover:scale-105 active:scale-95"
                onClick={() => quickConnect('ws://localhost:9000')}
              >
                本地
              </Badge>
              <Badge
                variant="outline"
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all hover:scale-105 active:scale-95"
                onClick={() => quickConnect('ws://8.140.63.143:9000')}
              >
                公共服务器
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">用户名</label>
            <Input
              placeholder="输入你的用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleConnect()
                }
              }}
              className="transition-all focus:scale-[1.01] focus:shadow-md"
              size={undefined}            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleConnect}
              disabled={!serverUrl.trim() || !username.trim()}
              className="flex-1 transition-all hover:scale-105 active:scale-95 hover:shadow-lg disabled:hover:scale-100 group"
            >
              <Wifi className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
              连接
            </Button>
            <Button
              onClick={() => setShowTest(!showTest)}
              variant="outline"
              className="transition-all hover:scale-105 active:scale-95 hover:shadow-md group"
            >
              <AlertCircle className={`w-4 h-4 mr-2 transition-transform ${showTest ? 'rotate-180' : ''}`} />
              {showTest ? '隐藏' : '诊断'}
            </Button>
          </div>

          <div className="pt-4 border-t">
            <h3 className="text-sm font-medium mb-2">协议说明</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• WebSocket: <code className="text-xs bg-muted px-1 py-0.5 rounded">ws://</code> 或 <code className="text-xs bg-muted px-1 py-0.5 rounded">wss://</code></li>
              <li>• SSE: <code className="text-xs bg-muted px-1 py-0.5 rounded">http://</code> 或 <code className="text-xs bg-muted px-1 py-0.5 rounded">https://</code></li>
              <li>• 支持 AgentRoom Service 协议</li>
            </ul>
          </div>

          <div className="pt-2">
            <h3 className="text-sm font-medium mb-2">功能特性</h3>
            <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
              <div>✓ 实时聊天</div>
              <div>✓ 多房间</div>
              <div>✓ 用户列表</div>
              <div>✓ 房间管理</div>
              <div>✓ Session 持久化</div>
              <div>✓ 自动重连</div>
              <div>✓ 心跳保活</div>
              <div>✓ 状态恢复</div>
            </div>
          </div>
          
          {hasSavedSession && (
            <div className="pt-2 border-t">
              <div className="flex items-start gap-2 text-sm bg-blue-500/10 p-3 rounded-lg border border-blue-500/20">
                <History className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-blue-600 dark:text-blue-400 font-medium">检测到上次会话</p>
                  <p className="text-blue-600/80 dark:text-blue-400/80 text-xs mt-1">
                    已为你填充上次的连接信息。点击连接即可快速恢复。
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showTest && <ConnectionTest serverUrl={serverUrl} />}
      </div>
    </div>
  )
}
