import { useMemoizedFn } from 'ahooks'
import { useState } from 'react'
import type { IpcInvoke } from 'shared/electron-api'
import { Title } from '@/components/common/Title'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAccounts } from '@/hooks/useAccounts'
import { getSafeAutoReplyEntry, useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useAutoStopOnGateLoss } from '@/hooks/useAutoStopOnGateLoss'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'
import { useLiveFeatureGate } from '@/hooks/useLiveFeatureGate'
import { useLiveStats } from '@/hooks/useLiveStats'
import { useToast } from '@/hooks/useToast'
import { acquireCommentListener, releaseCommentListener } from '@/utils/commentListenerRuntime'
import {
  exportLiveStats,
  type LiveStatsExportData,
  openExportFolder,
} from '@/utils/exportLiveStats'
import { stopAllLiveTasks } from '@/utils/stopAllLiveTasks'
import DanmuMonitor from './components/DanmuMonitor'
import EventTimeline from './components/EventTimeline'
import FansGroupChanges from './components/FansGroupChanges'
import StatsOverview from './components/StatsOverview'

export default function LiveStats() {
  const {
    stats,
    isListening,
    resetStats,
    setListening,
    danmuList,
    fansClubChanges,
    events,
    startTime,
  } = useLiveStats()
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const { config } = useAutoReplyConfig()
  const gate = useLiveFeatureGate()
  const { toast } = useToast()
  const [isExporting, setIsExporting] = useState(false)
  const invokeCommentListenerIpc: IpcInvoke = window.taskIPC.invoke

  // 获取账号名称
  const accountName = useCurrentLiveControl(ctx => ctx.accountName)

  // 自动停止：当直播结束或断开连接时，自动停止数据监控
  useAutoStopOnGateLoss({
    gate,
    taskIsRunning: isListening,
    stopAll: useMemoizedFn(async reason => {
      console.log(`[LiveStats] Gate lost, reason: ${reason}, isListening: ${isListening}`)
      await stopAllLiveTasks(currentAccountId, reason, false)
    }),
  })

  // 开始监听
  const startListening = async () => {
    try {
      setListening(true)
      resetStats()

      const result = await acquireCommentListener(
        currentAccountId,
        'liveStats',
        {
          source: getSafeAutoReplyEntry(currentAccountId, config.entry),
          ws: config.ws?.enable ? { port: config.ws.port, token: config.ws.token } : undefined,
        },
        invokeCommentListenerIpc,
      )

      if (!result) {
        throw new Error('启动监听失败')
      }

      toast.success('数据监控已启动')
    } catch (error) {
      setListening(false)
      toast.error('启动监控失败')
      console.error('[LiveStats] Failed to start listening:', error)
    }
  }

  // 实际停止监听
  const doStopListening = async () => {
    try {
      // 停止前先自动保存数据
      await autoSaveOnStop()

      await releaseCommentListener(currentAccountId, 'liveStats', invokeCommentListenerIpc)
      setListening(false)
      toast.success('数据监控已停止')
    } catch (error) {
      toast.error('停止监控失败')
      console.error('[LiveStats] Failed to stop listening:', error)
    }
  }

  // 重置数据
  const handleReset = () => {
    resetStats()
    toast.success('数据已重置')
  }

  // 构建导出数据
  const buildExportData = (): LiveStatsExportData => {
    return {
      accountName: accountName || '未知账号',
      startTime,
      endTime: Date.now(),
      duration: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
      stats,
      danmuList: danmuList.map(item => ({
        nickName: item.nick_name,
        content: (item as any).content || '',
        time: item.time,
      })),
      fansClubChanges,
      events,
    }
  }

  const runExport = async (format: 'csv' | 'excel') => {
    if (isExporting) return

    setIsExporting(true)
    try {
      const data = buildExportData()
      const result = await exportLiveStats(data, format)

      if (result.success) {
        toast.success({
          title: '导出完成',
          description:
            format === 'csv'
              ? '监控数据已导出为 CSV，可点击“打开导出目录”查看文件。'
              : '监控数据已导出为 Excel，可点击“打开导出目录”查看文件。',
          dedupeKey: `live-stats-export:${format}:${currentAccountId}`,
        })
      } else {
        toast.error({
          title: '导出失败',
          description: result.error || '数据导出失败，请稍后重试。',
          dedupeKey: `live-stats-export-failed:${format}:${currentAccountId}`,
        })
      }
    } catch (error) {
      toast.error({
        title: '导出失败',
        description: '数据导出失败，请稍后重试。',
        dedupeKey: `live-stats-export-error:${format}:${currentAccountId}`,
      })
      console.error('[LiveStats] Export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportCsv = () => runExport('csv')

  const handleExportExcel = () => runExport('excel')

  // 打开导出目录
  const handleOpenFolder = () => {
    openExportFolder()
  }

  // 停止时自动保存数据
  const autoSaveOnStop = async () => {
    // 只有有数据时才自动保存
    if (stats.commentCount > 0 || stats.likeCount > 0 || stats.enterCount > 0) {
      try {
        const data = buildExportData()
        const result = await exportLiveStats(data, 'csv')
        if (result.success) {
          console.log('[LiveStats] Auto save success:', result.filePath)
        }
      } catch (error) {
        console.error('[LiveStats] Auto save failed:', error)
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-6 py-6">
          <div className="shrink-0">
            <Title title="数据监控" description="查看直播间的实时数据变化与事件记录" />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-6">
            <StatsOverview
              stats={stats}
              isListening={isListening}
              onStart={startListening}
              onStop={doStopListening}
              onReset={handleReset}
              onExportCsv={handleExportCsv}
              onExportExcel={handleExportExcel}
              onOpenFolder={handleOpenFolder}
              isExporting={isExporting}
              gate={gate}
            />

            <Tabs defaultValue="danmu" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="grid w-full grid-cols-3 shrink-0">
                <TabsTrigger value="danmu">弹幕监控</TabsTrigger>
                <TabsTrigger value="fansclub">粉丝团变化</TabsTrigger>
                <TabsTrigger value="timeline">事件时间线</TabsTrigger>
              </TabsList>

              <TabsContent value="danmu" className="mt-4 flex-1 min-h-0">
                <DanmuMonitor />
              </TabsContent>

              <TabsContent value="fansclub" className="mt-4 flex-1 min-h-0">
                <FansGroupChanges />
              </TabsContent>

              <TabsContent value="timeline" className="mt-4 flex-1 min-h-0">
                <EventTimeline />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}
