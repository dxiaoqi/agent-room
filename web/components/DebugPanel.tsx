'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Terminal, X, Copy, Check } from 'lucide-react'

interface DebugLog {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'success'
  message: string
}

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [logs, setLogs] = useState<DebugLog[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    // 拦截 console 方法
    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn

    const addLog = (level: DebugLog['level'], ...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ')
      
      setLogs(prev => [...prev, {
        timestamp: new Date().toLocaleTimeString('zh-CN'),
        level,
        message
      }].slice(-100)) // 只保留最近 100 条
    }

    console.log = (...args) => {
      originalLog(...args)
      if (args[0]?.includes?.('WebSocket') || args[0]?.includes?.('🔌') || args[0]?.includes?.('✅') || args[0]?.includes?.('📤')) {
        addLog('info', ...args)
      }
    }

    console.error = (...args) => {
      originalError(...args)
      if (args[0]?.includes?.('WebSocket') || args[0]?.includes?.('❌') || args[0]?.includes?.('Error')) {
        addLog('error', ...args)
      }
    }

    console.warn = (...args) => {
      originalWarn(...args)
      addLog('warn', ...args)
    }

    return () => {
      console.log = originalLog
      console.error = originalError
      console.warn = originalWarn
    }
  }, [isOpen])

  const copyLogs = () => {
    const logText = logs.map(log => 
      `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n')
    
    navigator.clipboard.writeText(logText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const clearLogs = () => {
    setLogs([])
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-110 active:scale-90 hover:shadow-2xl hover:rotate-12 z-50 group"
        title="打开调试面板"
      >
        <Terminal className="w-5 h-5 transition-transform group-hover:scale-110" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 w-96 z-50">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">调试面板</CardTitle>
              <CardDescription className="text-xs">
                WebSocket 连接日志
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={copyLogs}
                disabled={logs.length === 0}
                className="h-7 px-2 transition-all hover:scale-110 active:scale-90 disabled:hover:scale-100"
                title="复制日志"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearLogs}
                disabled={logs.length === 0}
                className="h-7 px-2 transition-all hover:scale-110 active:scale-90 hover:text-destructive disabled:hover:scale-100"
                title="清空日志"
              >
                清空
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsOpen(false)}
                className="h-7 px-2 transition-all hover:scale-110 active:scale-90 hover:rotate-90"
                title="关闭"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-64 px-4">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                等待日志...
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {logs.map((log, index) => (
                  <div key={index} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0">
                      {log.timestamp}
                    </span>
                    <Badge 
                      variant={
                        log.level === 'error' ? 'destructive' :
                        log.level === 'warn' ? 'outline' :
                        log.level === 'success' ? 'default' :
                        'secondary'
                      }
                      className="h-5 shrink-0"
                    >
                      {log.level}
                    </Badge>
                    <span className="flex-1 break-all font-mono">
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
