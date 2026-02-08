'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { getSession, clearSession } from '@/lib/storage'

export function AuthDiagnostic() {
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null)

  const runDiagnostic = () => {
    console.log('🔍 Running authentication diagnostic...')
    
    const result: any = {
      timestamp: new Date().toISOString(),
      checks: []
    }

    // 检查 1：localStorage 可用性
    try {
      localStorage.setItem('test', 'test')
      localStorage.removeItem('test')
      result.checks.push({
        name: 'localStorage 可用',
        status: 'success',
        message: 'localStorage 正常工作'
      })
    } catch (error) {
      result.checks.push({
        name: 'localStorage 可用',
        status: 'error',
        message: 'localStorage 不可用：' + error
      })
    }

    // 检查 2：Session 数据
    const session = getSession()
    if (session) {
      result.checks.push({
        name: 'Session 存在',
        status: 'success',
        message: `找到 session: ${JSON.stringify(session, null, 2)}`
      })

      // 检查 2.1：serverUrl
      if (session.serverUrl && session.serverUrl.trim().length > 0) {
        result.checks.push({
          name: 'serverUrl 有效',
          status: 'success',
          message: `serverUrl: ${session.serverUrl}`
        })
      } else {
        result.checks.push({
          name: 'serverUrl 有效',
          status: 'error',
          message: 'serverUrl 为空'
        })
      }

      // 检查 2.2：username
      if (session.username && session.username.trim().length > 0) {
        result.checks.push({
          name: 'username 有效',
          status: 'success',
          message: `username: "${session.username}" (长度: ${session.username.length})`
        })
      } else {
        result.checks.push({
          name: 'username 有效',
          status: 'error',
          message: `username 无效: "${session.username}" (长度: ${session.username?.length || 0})`
        })
      }

      // 检查 2.3：时间戳
      const hoursAgo = (Date.now() - new Date(session.connectedAt).getTime()) / (1000 * 60 * 60)
      if (hoursAgo < 24) {
        result.checks.push({
          name: 'Session 未过期',
          status: 'success',
          message: `创建于 ${hoursAgo.toFixed(1)} 小时前`
        })
      } else {
        result.checks.push({
          name: 'Session 未过期',
          status: 'warning',
          message: `已过期 (${hoursAgo.toFixed(1)} 小时前)`
        })
      }
    } else {
      result.checks.push({
        name: 'Session 存在',
        status: 'warning',
        message: '没有找到保存的 session'
      })
    }

    // 检查 3：重连标记
    try {
      const reconnectData = localStorage.getItem('agentroom_reconnect')
      if (reconnectData) {
        const reconnect = JSON.parse(reconnectData)
        result.checks.push({
          name: '重连标记',
          status: 'info',
          message: `重连标记: ${reconnect.shouldReconnect}`
        })
      } else {
        result.checks.push({
          name: '重连标记',
          status: 'info',
          message: '无重连标记'
        })
      }
    } catch (error) {
      result.checks.push({
        name: '重连标记',
        status: 'error',
        message: '读取重连标记失败'
      })
    }

    setDiagnosticResult(result)
    console.log('✅ Diagnostic complete:', result)
  }

  const handleClearSession = () => {
    clearSession()
    setDiagnosticResult(null)
    console.log('🗑️ All session data cleared')
    alert('Session 已清除！请刷新页面重新连接。')
  }

  return (
    <Card className="w-full max-w-2xl mx-auto mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          认证诊断工具
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={runDiagnostic} className="flex-1">
              <RefreshCw className="w-4 h-4 mr-2" />
              运行诊断
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleClearSession}
              className="flex-1"
            >
              <XCircle className="w-4 h-4 mr-2" />
              清除 Session
            </Button>
          </div>

          {diagnosticResult && (
            <div className="space-y-3 mt-4">
              <div className="text-sm text-muted-foreground">
                诊断时间: {new Date(diagnosticResult.timestamp).toLocaleString('zh-CN')}
              </div>

              {diagnosticResult.checks.map((check: any, index: number) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${
                    check.status === 'success'
                      ? 'bg-green-500/10 border-green-500/20'
                      : check.status === 'error'
                      ? 'bg-red-500/10 border-red-500/20'
                      : check.status === 'warning'
                      ? 'bg-yellow-500/10 border-yellow-500/20'
                      : 'bg-blue-500/10 border-blue-500/20'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {check.status === 'success' ? (
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                    ) : check.status === 'error' ? (
                      <XCircle className="w-4 h-4 text-red-600 mt-0.5" />
                    ) : check.status === 'warning' ? (
                      <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{check.name}</span>
                        <Badge
                          variant={
                            check.status === 'success'
                              ? 'default'
                              : check.status === 'error'
                              ? 'destructive'
                              : 'secondary'
                          }
                          className="text-xs"
                        >
                          {check.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                        {check.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* 总结 */}
              <div className="pt-4 border-t">
                {diagnosticResult.checks.some((c: any) => c.status === 'error') ? (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm font-medium text-destructive">
                      ⚠️ 发现问题
                    </p>
                    <p className="text-xs text-destructive/80 mt-1">
                      请点击"清除 Session"按钮，然后刷新页面重新连接。
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <p className="text-sm font-medium text-green-600">
                      ✅ 所有检查通过
                    </p>
                    <p className="text-xs text-green-600/80 mt-1">
                      如果仍有问题，请检查服务器是否正常运行。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
