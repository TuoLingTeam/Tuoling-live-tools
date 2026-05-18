import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsState = vi.hoisted(() => ({
  filesByDir: new Map<string, Set<string>>(),
  deletedPaths: [] as string[],
}))

vi.mock('node:fs', () => ({
  existsSync: (dirPath: string) => fsState.filesByDir.has(dirPath),
  readdirSync: (dirPath: string) => Array.from(fsState.filesByDir.get(dirPath) ?? []),
  unlinkSync: (filePath: string) => {
    const splitIndex = filePath.lastIndexOf('/')
    const dirPath = filePath.slice(0, splitIndex)
    const fileName = filePath.slice(splitIndex + 1)
    fsState.filesByDir.get(dirPath)?.delete(fileName)
    fsState.deletedPaths.push(filePath)
  },
}))

const pathMock = vi.hoisted(() => ({
  join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
}))

vi.mock('node:path', () => ({
  default: pathMock,
  ...pathMock,
}))

const { cleanupOldDatedLogs, formatLogDate, getDatedLogPath, LOG_RETENTION_DAYS } = await import(
  '../logFilePolicy'
)

function addFile(dirPath: string, fileName: string) {
  const files = fsState.filesByDir.get(dirPath) ?? new Set<string>()
  files.add(fileName)
  fsState.filesByDir.set(dirPath, files)
}

function hasFile(dirPath: string, fileName: string): boolean {
  return fsState.filesByDir.get(dirPath)?.has(fileName) ?? false
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1)
}

beforeEach(() => {
  fsState.filesByDir.clear()
  fsState.deletedPaths.length = 0
})

describe('logFilePolicy', () => {
  it('formats log dates with the local calendar day', () => {
    expect(formatLogDate(new Date(2026, 4, 8, 23, 59, 59))).toBe('2026-05-08')
  })

  it('builds dated log file names', () => {
    const logDir = '/tmp/logs'

    expect(getDatedLogPath(logDir, 'main', new Date(2026, 4, 18))).toBe(
      '/tmp/logs/main-2026-05-18.log',
    )
    expect(getDatedLogPath(logDir, 'startup', new Date(2026, 4, 18))).toBe(
      '/tmp/logs/startup-2026-05-18.log',
    )
  })

  it('keeps the latest seven local calendar days and deletes only dated runtime logs', () => {
    const logDir = '/tmp/logs'
    const keptFiles = [
      'main.log',
      'startup.log',
      'main.old.log',
      'main-2026-05-12.log',
      'startup-2026-05-12.log',
      'main-2026-05-18.log',
      'startup-2026-05-18.log',
      'browser-2026-05-01.log',
      'screenshot-2026-05-01.png',
    ]
    const deletedFiles = ['main-2026-05-11.log', 'startup-2026-05-01.log']

    for (const fileName of [...keptFiles, ...deletedFiles]) {
      addFile(logDir, fileName)
    }

    const beforeDelete = vi.fn()
    const deletedPaths = cleanupOldDatedLogs([logDir], {
      now: new Date(2026, 4, 18, 9, 0, 0),
      retentionDays: LOG_RETENTION_DAYS,
      beforeDelete,
    })

    expect(deletedPaths.map(basename).sort()).toEqual(deletedFiles.sort())
    expect(beforeDelete).toHaveBeenCalledTimes(deletedFiles.length)
    expect(fsState.deletedPaths.map(basename).sort()).toEqual(deletedFiles.sort())

    for (const fileName of keptFiles) {
      expect(hasFile(logDir, fileName)).toBe(true)
    }
    for (const fileName of deletedFiles) {
      expect(hasFile(logDir, fileName)).toBe(false)
    }
  })

  it('treats retention as at least one day', () => {
    const logDir = '/tmp/logs'
    addFile(logDir, 'main-2026-05-17.log')
    addFile(logDir, 'main-2026-05-18.log')

    cleanupOldDatedLogs([logDir], {
      now: new Date(2026, 4, 18),
      retentionDays: 0,
    })

    expect(hasFile(logDir, 'main-2026-05-17.log')).toBe(false)
    expect(hasFile(logDir, 'main-2026-05-18.log')).toBe(true)
  })
})
