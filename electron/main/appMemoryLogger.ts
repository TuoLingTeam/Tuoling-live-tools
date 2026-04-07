import process from 'node:process'
import { createLogger } from './logger'

const MEMORY_LOG_INTERVAL_MS = 60_000

export function createAppMemoryLogger(getConnectionCount: () => number) {
  let memoryLogInterval: NodeJS.Timeout | null = null

  function startMemoryLogInterval() {
    if (memoryLogInterval) return

    memoryLogInterval = setInterval(() => {
      const count = getConnectionCount()
      if (count === 0) return

      const memoryUsage = process.memoryUsage()
      createLogger('资源').info(
        `[资源] 连接数=${count} heapUsed=${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB rss=${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      )
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
