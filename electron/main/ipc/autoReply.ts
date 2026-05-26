import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { typedIpcMainHandle } from '#/utils'
import { resolveSafePath } from '#/utils/securityValidators'

interface AutoReplyExportRow {
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
  source: 'ai' | 'product-kb' | 'manual' | 'none'
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

interface AutoReplyExportData {
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
      status: string
      pendingSamples: number
      postAdoptionPendingSamples: number
      adoptedSamples: number
      description: string
    }>
  }
  rows: AutoReplyExportRow[]
}

type AutoReplyExportFormat = 'csv' | 'json'

function getExportFolder(): string {
  const documentsPath = app.getPath('documents')
  const exportFolder = path.join(documentsPath, 'TASI自动回复')

  if (!fs.existsSync(exportFolder)) {
    fs.mkdirSync(exportFolder, { recursive: true })
  }

  return exportFolder
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
}

function sanitizeFileName(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._\- ]/g, '_')
  const truncated = sanitized.slice(0, 100)
  return truncated || 'unknown'
}

function validateFilePath(filePath: string, baseDir: string): void {
  const resolvedFilePath = path.resolve(filePath)
  const resolvedBaseDir = path.resolve(baseDir)
  if (!resolvedFilePath.startsWith(resolvedBaseDir + path.sep)) {
    throw new Error('Invalid file path: path traversal detected')
  }
}

function toCsvCell(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? '' : String(value)
  const escaped = normalized.replace(/"/g, '""')
  return `"${escaped}"`
}

function buildCsvRow(values: Array<string | number | boolean | null | undefined>): string {
  return values.map(toCsvCell).join(',')
}

function createFilePath(
  exportFolder: string,
  accountName: string,
  exportedAt: number,
  ext: 'csv' | 'json',
) {
  const safeAccountName = sanitizeFileName(accountName || '未知账号')
  const fileName = `自动回复_${safeAccountName}_${formatDateTime(exportedAt)}.${ext}`
  const pathValidation = resolveSafePath(exportFolder, fileName)
  if (!pathValidation.valid) {
    throw new Error(`Invalid file path: ${pathValidation.error}`)
  }
  const filePath = pathValidation.fullPath!
  validateFilePath(filePath, exportFolder)
  return filePath
}

function exportToCsv(data: AutoReplyExportData): string {
  const exportFolder = getExportFolder()
  const filePath = createFilePath(exportFolder, data.accountName, data.exportedAt, 'csv')

  const rows: string[] = []
  rows.push('\uFEFF')

  rows.push('概览')
  rows.push(buildCsvRow(['账号', data.accountName]))
  rows.push(buildCsvRow(['导出时间', new Date(data.exportedAt).toLocaleString('zh-CN')]))
  rows.push(buildCsvRow(['评论数', data.stats.totalComments]))
  rows.push(buildCsvRow(['回复数', data.stats.totalReplies]))
  rows.push(buildCsvRow(['已发送回复', data.stats.sentReplies]))
  rows.push(buildCsvRow(['拦截重写', data.stats.rewrittenReplies]))
  rows.push('')

  if (data.knowledgeGovernance) {
    rows.push('商品知识治理摘要')
    rows.push(buildCsvRow(['待处理样本', data.knowledgeGovernance.pendingCount]))
    rows.push(buildCsvRow(['已采纳样本', data.knowledgeGovernance.adoptedCount]))
    rows.push(buildCsvRow(['已忽略样本', data.knowledgeGovernance.dismissedCount]))
    rows.push(buildCsvRow(['已稳定商品', data.knowledgeGovernance.stabilizedGoodsCount]))
    rows.push('')
    rows.push('商品治理明细')
    rows.push(
      buildCsvRow([
        '商品号',
        '治理状态',
        '待处理样本',
        '采纳后新增待处理样本',
        '已采纳样本',
        '说明',
      ]),
    )

    for (const item of data.knowledgeGovernance.goodsSummary) {
      rows.push(
        buildCsvRow([
          item.goodsId,
          item.status,
          item.pendingSamples,
          item.postAdoptionPendingSamples,
          item.adoptedSamples,
          item.description,
        ]),
      )
    }

    rows.push('')
  }

  rows.push('当前会话明细')
  rows.push(
    buildCsvRow([
      '评论ID',
      '场次ID',
      '场次开始',
      '场次结束',
      '评论时间',
      '昵称',
      '评论内容',
      '回复时间',
      '回复内容',
      '是否已发送',
      '回复来源',
      '回复意图',
      '问答类型',
      '事实状态',
      'Guardrail动作',
      'Guardrail原因',
      '知识回退原因',
      '自动发送拦截原因',
      '命中商品号',
      '命中商品标题',
      '命中字段',
    ]),
  )

  for (const item of data.rows) {
    rows.push(
      buildCsvRow([
        item.commentId,
        item.sessionId,
        item.sessionStartedAt,
        item.sessionEndedAt,
        item.commentTime,
        item.nickname,
        item.commentContent,
        item.replyTime,
        item.replyContent,
        item.isSent ? '是' : '否',
        item.source,
        item.replyIntent,
        item.questionType,
        item.factStatus,
        item.guardrailAction,
        item.guardrailReason,
        item.knowledgeMissReason,
        item.autoSendBlockedReason,
        item.matchedSlotIndex,
        item.matchedTitle,
        item.matchedFields?.join('|'),
      ]),
    )
  }

  fs.writeFileSync(filePath, rows.join('\n'), 'utf8')
  return filePath
}

function exportToJson(data: AutoReplyExportData): string {
  const exportFolder = getExportFolder()
  const filePath = createFilePath(exportFolder, data.accountName, data.exportedAt, 'json')
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  return filePath
}

export function setupAutoReplyIpcHandlers() {
  typedIpcMainHandle(
    IPC_CHANNELS.tasks.autoReply.exportData,
    async (_, payload: { data: AutoReplyExportData; format?: AutoReplyExportFormat }) => {
      const format = payload.format || 'csv'

      try {
        const filePath = format === 'json' ? exportToJson(payload.data) : exportToCsv(payload.data)
        return { success: true, filePath }
      } catch (error) {
        console.error('[AutoReply] Export failed:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '导出失败',
        }
      }
    },
  )

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoReply.openExportFolder, () => {
    const exportFolder = getExportFolder()
    shell.openPath(exportFolder)
  })
}
