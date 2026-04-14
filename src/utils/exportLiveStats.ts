/**
 * 直播数据导出工具
 * 默认导出 CSV，按需导出 Excel。
 */

import type { FansClubChange, LiveEvent, MessageStats } from '@/hooks/useLiveStats'

// 导出数据结构
export interface LiveStatsExportData {
  // 账号信息
  accountName: string
  // 监控时间信息
  startTime: number | null
  endTime: number
  duration: number // 秒
  // 统计概览
  stats: MessageStats
  // 弹幕列表
  danmuList: Array<{
    nickName: string
    content: string
    time: string
  }>
  // 粉丝团变化
  fansClubChanges: FansClubChange[]
  // 事件时间线
  events: LiveEvent[]
}

export type LiveStatsExportFormat = 'csv' | 'excel'

/**
 * 导出直播监控数据
 * @param data 导出数据
 * @param format 导出格式，默认 csv
 * @returns 导出结果
 */
export async function exportLiveStats(
  data: LiveStatsExportData,
  format: LiveStatsExportFormat = 'csv',
): Promise<{
  success: boolean
  filePath?: string
  error?: string
}> {
  try {
    const result = await window.liveStatsAPI.exportData({
      data,
      format,
    })
    return result
  } catch (error) {
    console.error('[ExportLiveStats] Failed to export:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '导出失败',
    }
  }
}

/**
 * 打开导出目录
 */
export async function openExportFolder(): Promise<void> {
  try {
    await window.liveStatsAPI.openExportFolder()
  } catch (error) {
    console.error('[ExportLiveStats] Failed to open folder:', error)
  }
}

/**
 * 格式化时长
 */
export function formatDurationText(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}小时${minutes}分${secs}秒`
  }
  if (minutes > 0) {
    return `${minutes}分${secs}秒`
  }
  return `${secs}秒`
}
