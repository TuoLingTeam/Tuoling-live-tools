import { execFile } from 'node:child_process'
import process from 'node:process'
import { createLogger } from './logger'

const MEMORY_LOG_INTERVAL_MS = 60_000
const PS_MAX_BUFFER = 2 * 1024 * 1024

interface ProcessSample {
  pid: number
  ppid: number
  rssKb: number
  cpu: number
  command: string
}

interface ProcessTreeStats {
  totalCount: number
  totalRssMb: number
  childCount: number
  childRssMb: number
  browserCount: number
  browserRssMb: number
}

function parseProcessSamples(stdout: string): ProcessSample[] {
  return stdout
    .split('\n')
    .map(line => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/)
      if (!match) {
        return null
      }

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssKb: Number(match[3]),
        cpu: Number(match[4]),
        command: match[5] ?? '',
      }
    })
    .filter((sample): sample is ProcessSample => Boolean(sample))
}

function isBrowserLikeProcess(command: string): boolean {
  const lower = command.toLowerCase()
  return (
    lower.includes('google chrome') ||
    lower.includes('chromium') ||
    lower.includes('msedge') ||
    lower.includes('chrome helper') ||
    lower.includes('electron helper')
  )
}

function summarizeProcessTree(rootPid: number, samples: ProcessSample[]): ProcessTreeStats | null {
  const byParent = new Map<number, ProcessSample[]>()
  const byPid = new Map<number, ProcessSample>()

  for (const sample of samples) {
    byPid.set(sample.pid, sample)
    const children = byParent.get(sample.ppid) ?? []
    children.push(sample)
    byParent.set(sample.ppid, children)
  }

  const root = byPid.get(rootPid)
  if (!root) {
    return null
  }

  const tree: ProcessSample[] = []
  const stack = [root]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.pid)) {
      continue
    }
    seen.add(current.pid)
    tree.push(current)
    for (const child of byParent.get(current.pid) ?? []) {
      stack.push(child)
    }
  }

  const children = tree.filter(sample => sample.pid !== rootPid)
  const browserProcesses = tree.filter(sample => isBrowserLikeProcess(sample.command))
  const totalRssKb = tree.reduce((sum, sample) => sum + sample.rssKb, 0)
  const childRssKb = children.reduce((sum, sample) => sum + sample.rssKb, 0)
  const browserRssKb = browserProcesses.reduce((sum, sample) => sum + sample.rssKb, 0)

  return {
    totalCount: tree.length,
    totalRssMb: Math.round(totalRssKb / 1024),
    childCount: children.length,
    childRssMb: Math.round(childRssKb / 1024),
    browserCount: browserProcesses.length,
    browserRssMb: Math.round(browserRssKb / 1024),
  }
}

function collectProcessTreeStats(rootPid: number): Promise<ProcessTreeStats | null> {
  if (process.platform === 'win32') {
    return Promise.resolve(null)
  }

  return new Promise(resolve => {
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,rss=,%cpu=,command='],
      { maxBuffer: PS_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }

        resolve(summarizeProcessTree(rootPid, parseProcessSamples(stdout)))
      },
    )
  })
}

export function createAppMemoryLogger(getConnectionCount: () => number) {
  let memoryLogInterval: NodeJS.Timeout | null = null
  let isCollectingProcessStats = false

  function startMemoryLogInterval() {
    if (memoryLogInterval) return

    memoryLogInterval = setInterval(() => {
      const count = getConnectionCount()
      if (count === 0) return

      const memoryUsage = process.memoryUsage()
      createLogger('资源').info(
        `[资源] 连接数=${count} heapUsed=${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB rss=${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      )
      if (isCollectingProcessStats) {
        return
      }

      isCollectingProcessStats = true
      void collectProcessTreeStats(process.pid)
        .then(stats => {
          if (!stats) {
            return
          }

          createLogger('资源').info(
            `[资源] 进程树 total=${stats.totalCount} rss=${stats.totalRssMb}MB children=${stats.childCount}/${stats.childRssMb}MB browserLike=${stats.browserCount}/${stats.browserRssMb}MB`,
          )
        })
        .finally(() => {
          isCollectingProcessStats = false
        })
    }, MEMORY_LOG_INTERVAL_MS)
  }

  function stopMemoryLogInterval() {
    if (memoryLogInterval) {
      clearInterval(memoryLogInterval)
      memoryLogInterval = null
    }
  }

  return {
    startMemoryLogInterval,
    stopMemoryLogInterval,
  }
}
