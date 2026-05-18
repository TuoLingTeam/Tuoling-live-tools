import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export const LOG_RETENTION_DAYS = 7

export type DatedLogBaseName = 'main' | 'startup'

const DATED_LOG_FILE_RE = /^(main|startup)-(\d{4}-\d{2}-\d{2})\.log$/

export function formatLogDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDatedLogPath(
  logDir: string,
  baseName: DatedLogBaseName,
  date = new Date(),
): string {
  return path.join(logDir, `${baseName}-${formatLogDate(date)}.log`)
}

function getCutoffDateKey(now: Date, retentionDays: number): string {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  cutoff.setDate(cutoff.getDate() - (retentionDays - 1))
  return formatLogDate(cutoff)
}

function normalizeRetentionDays(retentionDays: number): number {
  if (!Number.isFinite(retentionDays)) return LOG_RETENTION_DAYS
  return Math.max(1, Math.floor(retentionDays))
}

export function cleanupOldDatedLogs(
  logDirs: string[],
  options: {
    now?: Date
    retentionDays?: number
    beforeDelete?: (filePath: string) => void
  } = {},
): string[] {
  const deletedPaths: string[] = []
  const retentionDays = normalizeRetentionDays(options.retentionDays ?? LOG_RETENTION_DAYS)
  const cutoffDateKey = getCutoffDateKey(options.now ?? new Date(), retentionDays)
  const uniqueDirs = Array.from(new Set(logDirs.filter(Boolean)))

  for (const logDir of uniqueDirs) {
    try {
      if (!existsSync(logDir)) continue

      for (const fileName of readdirSync(logDir)) {
        const match = DATED_LOG_FILE_RE.exec(fileName)
        if (!match) continue

        const dateKey = match[2]
        if (dateKey >= cutoffDateKey) continue

        const filePath = path.join(logDir, fileName)
        try {
          options.beforeDelete?.(filePath)
          unlinkSync(filePath)
          deletedPaths.push(filePath)
        } catch {
          // Log cleanup must never interrupt application startup or runtime logging.
        }
      }
    } catch {
      // Ignore unreadable log directories and keep logging to the remaining paths.
    }
  }

  return deletedPaths
}
