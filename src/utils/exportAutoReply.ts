export interface AutoReplyExportRow {
  sessionId?: string
  sessionStartedAt?: string
  sessionEndedAt?: string
  commentId: string
  commentTime: string
  nickname: string
  commentContent: string
  replyTime?: string
  replyContent?: string
  isSent: boolean
  source: 'ai' | 'product-kb' | 'none'
  replyIntent?: string
  questionType?: string
  factStatus?: string
  guardrailAction?: string
  guardrailReason?: string
  knowledgeMissReason?: string
  autoSendBlockedReason?: string
  matchedSlotIndex?: number
  matchedTitle?: string
  matchedFields?: string[]
}

export interface AutoReplyExportData {
  accountName: string
  exportedAt: number
  stats: {
    totalComments: number
    totalReplies: number
    sentReplies: number
    rewrittenReplies: number
  }
  knowledgeGovernance?: {
    pendingCount: number
    adoptedCount: number
    dismissedCount: number
    stabilizedGoodsCount: number
    goodsSummary: Array<{
      goodsId: number
      status: '效果好' | '待复查' | '仍有缺口'
      pendingSamples: number
      postAdoptionPendingSamples: number
      adoptedSamples: number
      description: string
    }>
  }
  rows: AutoReplyExportRow[]
}

export type AutoReplyExportFormat = 'csv' | 'json'

export async function exportAutoReplyData(
  data: AutoReplyExportData,
  format: AutoReplyExportFormat = 'csv',
): Promise<{
  success: boolean
  filePath?: string
  error?: string
}> {
  try {
    const result = await window.autoReplyAPI.exportData({
      data,
      format,
    })
    return result
  } catch (error) {
    console.error('[ExportAutoReply] Failed to export:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '导出失败',
    }
  }
}

export async function openAutoReplyExportFolder(): Promise<void> {
  try {
    await window.autoReplyAPI.openExportFolder()
  } catch (error) {
    console.error('[ExportAutoReply] Failed to open folder:', error)
  }
}
