'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'

interface TestResult {
  name: string
  status: 'pending' | 'success' | 'error' | 'warning'
  message: string
  details?: string
}

export function ConnectionTest({ serverUrl }: { serverUrl: string }) {
  const [testing, setTesting] = useState(false)
  const [results, setResults] = useState<TestResult[]>([])

  const addResult = (result: TestResult) => {
    setResults(prev => [...prev, result])
  }

  const runTests = async () => {
    setTesting(true)
    setResults([])

    // 测试 1: URL 格式
    addResult({
      name: '1. URL 格式检查',
      status: 'pending',
      message: '检查中...'
    })

    try {
      const url = new URL(serverUrl)
      const isWebSocket = url.protocol === 'ws:' || url.protocol === 'wss:'
      
      if (!isWebSocket) {
        setResults(prev => prev.map((r, i) => 
          i === prev.length - 1 
            ? { ...r, status: 'error', message: '不是 WebSocket URL', details: `协议是 ${url.protocol}，应该是 ws: 或 wss:` }
            : r
        ))
        setTesting(false)
        return
      }

      setResults(prev => prev.map((r, i) => 
        i === prev.length - 1 
          ? { ...r, status: 'success', message: 'URL 格式正确', details: `${url.protocol}//${url.host}${url.pathname}` }
          : r
      ))
    } catch (error) {
      setResults(prev => prev.map((r, i) => 
        i === prev.length - 1 
          ? { ...r, status: 'error', message: 'URL 格式错误', details: String(error) }
          : r
      ))
      setTesting(false)
      return
    }

    // 测试 2: HTTP 健康检查
    addResult({
      name: '2. HTTP 健康检查',
      status: 'pending',
      message: '检查中...'
    })

    try {
      const httpUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://')
      const response = await fetch(`${httpUrl}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      
      if (response.ok) {
        const data = await response.json()
        setResults(prev => prev.map((r, i) => 
          i === prev.length - 1 
            ? { ...r, status: 'success', message: '服务器运行正常', details: `运行时长: ${data.uptime || '未知'}` }
            : r
        ))
      } else {
        setResults(prev => prev.map((r, i) => 
          i === prev.length - 1 
            ? { ...r, status: 'warning', message: `HTTP ${response.status}`, details: response.statusText }
            : r
        ))
      }
    } catch (error: any) {
      setResults(prev => prev.map((r, i) => 
        i === prev.length - 1 
          ? { ...r, status: 'error', message: 'HTTP 请求失败', details: error.message }
          : r
      ))
    }

    // 测试 3: WebSocket 连接
    addResult({
      name: '3. WebSocket 连接测试',
      status: 'pending',
      message: '尝试连接...'
    })

    const wsTest = new Promise<void>((resolve, reject) => {
      let ws: WebSocket
      const timeout = setTimeout(() => {
        if (ws) ws.close()
        reject(new Error('连接超时（5秒）'))
      }, 5000)

      try {
        ws = new WebSocket(serverUrl)

        ws.onopen = () => {
          clearTimeout(timeout)
          setResults(prev => prev.map((r, i) => 
            i === prev.length - 1 
              ? { ...r, status: 'success', message: 'WebSocket 连接成功！', details: '连接已建立' }
              : r
          ))
          ws.close()
          resolve()
        }

        ws.onerror = (event) => {
          clearTimeout(timeout)
          reject(new Error('WebSocket 连接错误'))
        }

        ws.onclose = (event) => {
          if (!event.wasClean) {
            reject(new Error(`连接异常关闭 (代码: ${event.code})`))
          }
        }
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })

    try {
      await wsTest
    } catch (error: any) {
      setResults(prev => prev.map((r, i) => 
        i === prev.length - 1 
          ? { ...r, status: 'error', message: 'WebSocket 连接失败', details: error.message }
          : r
      ))
    }

    // 测试 4: 浏览器环境
    addResult({
      name: '4. 浏览器环境检查',
      status: 'pending',
      message: '检查中...'
    })

    const isSecureContext = window.isSecureContext
    const protocol = window.location.protocol
    const wsProtocol = serverUrl.startsWith('wss://') ? 'wss:' : 'ws:'

    let envStatus: 'success' | 'warning' | 'error' = 'success'
    let envMessage = '环境正常'
    let envDetails = ''

    if (protocol === 'https:' && wsProtocol === 'ws:') {
      envStatus = 'error'
      envMessage = '混合内容阻止'
      envDetails = 'HTTPS 页面不能连接 WS（非加密），请使用 WSS 或在 HTTP 页面测试'
    } else if (protocol === 'https:' && wsProtocol === 'wss:') {
      envStatus = 'success'
      envMessage = '安全连接'
      envDetails = 'HTTPS → WSS ✓'
    } else if (protocol === 'http:' && wsProtocol === 'ws:') {
      envStatus = 'success'
      envMessage = '非加密连接'
      envDetails = 'HTTP → WS ✓（开发环境可用）'
    }

    setResults(prev => prev.map((r, i) => 
      i === prev.length - 1 
        ? { ...r, status: envStatus, message: envMessage, details: envDetails }
        : r
    ))

    setTesting(false)
  }

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
      case 'pending':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>连接诊断工具</CardTitle>
        <CardDescription>
          测试到 {serverUrl} 的连接
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={runTests} 
          disabled={testing} 
          className="w-full transition-all hover:scale-105 active:scale-95 hover:shadow-lg disabled:hover:scale-100 group"
        >
          {testing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              测试中...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
              开始诊断
            </>
          )}
        </Button>

        {results.length > 0 && (
          <ScrollArea className="h-[300px] rounded-lg border p-4">
            <div className="space-y-3">
              {results.map((result, index) => (
                <div key={index} className="flex gap-3">
                  {getStatusIcon(result.status)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{result.name}</span>
                      <Badge 
                        variant={
                          result.status === 'success' ? 'default' :
                          result.status === 'error' ? 'destructive' :
                          result.status === 'warning' ? 'outline' :
                          'secondary'
                        }
                        className="text-xs"
                      >
                        {result.message}
                      </Badge>
                    </div>
                    {result.details && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {result.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {results.length > 0 && !testing && (
          <div className="text-sm text-muted-foreground space-y-2 border-t pt-4">
            <p className="font-medium">建议：</p>
            {results.some(r => r.status === 'error' && r.name.includes('WebSocket')) && (
              <ul className="list-disc list-inside space-y-1">
                <li>检查浏览器控制台（F12）查看详细错误</li>
                <li>尝试禁用浏览器扩展（广告拦截器等）</li>
                <li>检查防火墙或代理设置</li>
                <li>尝试使用本地服务器：ws://localhost:9000</li>
              </ul>
            )}
            {results.some(r => r.status === 'error' && r.message.includes('混合内容')) && (
              <ul className="list-disc list-inside space-y-1">
                <li>使用 WSS（加密 WebSocket）代替 WS</li>
                <li>或在 HTTP 环境下测试（http://localhost:3000）</li>
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
