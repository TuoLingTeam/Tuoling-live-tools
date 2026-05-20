import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { TaskManagerImpl } from '../../src/tasks/TaskManager'
import { BaseTask, type StopReason, type TaskContext } from '../../src/tasks/types'

const ROOT = process.cwd()
const TMP_DIR = path.join(ROOT, 'tmp', 'perf-audit')

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function isTaskBenchmarkNoise(args: unknown[]) {
  const firstArg = args[0]
  return (
    typeof firstArg === 'string' &&
    (firstArg.startsWith('[TaskManager]') || firstArg.startsWith('[Task]'))
  )
}

async function withMutedTaskLogs<T>(work: () => Promise<T>): Promise<T> {
  const originalLog = console.log
  const originalWarn = console.warn
  try {
    console.log = ((...args: unknown[]) => {
      if (!isTaskBenchmarkNoise(args)) {
        originalLog(...args)
      }
    }) as typeof console.log
    console.warn = ((...args: unknown[]) => {
      if (!isTaskBenchmarkNoise(args)) {
        originalWarn(...args)
      }
    }) as typeof console.warn
    return await work()
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
}

const baseContext = (accountId: string): TaskContext => ({
  accountId,
  gateState: {
    connectionState: 'connected',
    streamState: 'live',
  },
  toast: {
    success: () => {},
    error: () => {},
  },
  ipcInvoke: async () => undefined as never,
})

class AutoReplyDummyTask extends BaseTask {
  constructor() {
    super('autoReply')
  }

  override async start(): Promise<void> {
    await sleep(5)
    this.status = 'running'
  }

  override async stop(reason: StopReason): Promise<void> {
    await sleep(2)
    super.stop(reason)
  }
}

class AutoPopupDummyTask extends BaseTask {
  constructor() {
    super('autoPopup')
  }

  override async start(): Promise<void> {
    await sleep(5)
    this.status = 'running'
  }

  override async stop(reason: StopReason): Promise<void> {
    await sleep(2)
    super.stop(reason)
  }
}

class AutoSpeakDummyTask extends BaseTask {
  constructor() {
    super('autoSpeak')
  }

  override async start(): Promise<void> {
    await sleep(5)
    this.status = 'running'
  }

  override async stop(reason: StopReason): Promise<void> {
    await sleep(2)
    super.stop(reason)
  }
}

class RaceTask extends BaseTask {
  static startedCalls = 0
  static maxConcurrentStarts = 0
  private inFlightStarts = 0

  constructor() {
    super('autoReply')
  }

  override async start(): Promise<void> {
    this.inFlightStarts += 1
    RaceTask.startedCalls += 1
    RaceTask.maxConcurrentStarts = Math.max(RaceTask.maxConcurrentStarts, this.inFlightStarts)
    await sleep(25)
    this.status = 'running'
    this.inFlightStarts -= 1
  }
}

async function measureStartStopThroughput() {
  const manager = new TaskManagerImpl()
  manager.register(AutoReplyDummyTask)
  manager.register(AutoPopupDummyTask)
  manager.register(AutoSpeakDummyTask)

  const accountIds = Array.from({ length: 100 }, (_, index) => `bench-account-${index}`)
  const taskIds = ['autoReply', 'autoPopup', 'autoSpeak'] as const

  const startLatencies: number[] = []
  const startStartedAt = performance.now()
  await Promise.all(
    accountIds.flatMap(accountId =>
      taskIds.map(async taskId => {
        const requestStartedAt = performance.now()
        const result = await manager.start(taskId, baseContext(accountId))
        startLatencies.push(performance.now() - requestStartedAt)
        if (!result.success) {
          throw new Error(`任务启动失败: ${accountId}:${taskId}:${result.reason}`)
        }
      }),
    ),
  )
  const startDurationMs = performance.now() - startStartedAt

  const stopLatencies: number[] = []
  const stopStartedAt = performance.now()
  await Promise.all(
    accountIds.map(async accountId => {
      const requestStartedAt = performance.now()
      await manager.stopAllForAccount(accountId, 'manual')
      stopLatencies.push(performance.now() - requestStartedAt)
    }),
  )
  const stopDurationMs = performance.now() - stopStartedAt

  return {
    scenario: 'start-stop-throughput',
    accountCount: accountIds.length,
    operationCount: accountIds.length * taskIds.length,
    startDurationMs: round(startDurationMs),
    stopDurationMs: round(stopDurationMs),
    startLatencyMs: {
      avg: round(average(startLatencies)),
      p95: round(percentile(startLatencies, 95)),
      max: round(Math.max(0, ...startLatencies)),
    },
    stopLatencyMs: {
      avg: round(average(stopLatencies)),
      p95: round(percentile(stopLatencies, 95)),
      max: round(Math.max(0, ...stopLatencies)),
    },
    heapUsedMb: round(process.memoryUsage().heapUsed / 1024 / 1024),
  }
}

async function measureDuplicateStartRace() {
  RaceTask.startedCalls = 0
  RaceTask.maxConcurrentStarts = 0

  const manager = new TaskManagerImpl()
  manager.register(RaceTask)

  const accountId = 'race-account'
  const calls = await Promise.all(
    Array.from({ length: 5 }, () => manager.start('autoReply', baseContext(accountId))),
  )

  return {
    scenario: 'duplicate-start-race',
    invocationCount: calls.length,
    successCount: calls.filter(call => call.success).length,
    startedCalls: RaceTask.startedCalls,
    maxConcurrentStarts: RaceTask.maxConcurrentStarts,
    indicatesRace:
      RaceTask.startedCalls > 1 ||
      RaceTask.maxConcurrentStarts > 1 ||
      calls.filter(call => call.success).length > 1,
  }
}

async function measureCleanupBehavior() {
  const manager = new TaskManagerImpl()
  manager.register(AutoReplyDummyTask)
  manager.register(AutoPopupDummyTask)
  manager.register(AutoSpeakDummyTask)

  const accountId = 'cleanup-account'
  await Promise.all([
    manager.start('autoReply', baseContext(accountId)),
    manager.start('autoPopup', baseContext(accountId)),
    manager.start('autoSpeak', baseContext(accountId)),
  ])

  manager.cleanupAccount(accountId)
  await sleep(10)

  return {
    scenario: 'cleanup-account',
    remainingStatusKeys: Object.keys(manager.getAllStatusForAccount(accountId)).length,
    heapUsedMb: round(process.memoryUsage().heapUsed / 1024 / 1024),
  }
}

async function main() {
  await fs.mkdir(TMP_DIR, { recursive: true })

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
    },
    scenarios: {
      startStopThroughput: await withMutedTaskLogs(measureStartStopThroughput),
      duplicateStartRace: await withMutedTaskLogs(measureDuplicateStartRace),
      cleanupBehavior: await withMutedTaskLogs(measureCleanupBehavior),
    },
  }

  const resultPath = path.join(
    TMP_DIR,
    `task-manager-benchmark-${report.generatedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`,
  )

  await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log('\nTaskManager Benchmark Summary')
  console.log(
    `start-stop-throughput\tstartP95=${report.scenarios.startStopThroughput.startLatencyMs.p95}ms\tstopP95=${report.scenarios.startStopThroughput.stopLatencyMs.p95}ms`,
  )
  console.log(
    `duplicate-start-race\tsuccess=${report.scenarios.duplicateStartRace.successCount}\tstartedCalls=${report.scenarios.duplicateStartRace.startedCalls}\tmaxConcurrentStarts=${report.scenarios.duplicateStartRace.maxConcurrentStarts}`,
  )
  console.log(`cleanup-account\tremainingStatusKeys=${report.scenarios.cleanupBehavior.remainingStatusKeys}`)
  console.log(`\nResult written to ${resultPath}`)
}

main().catch(error => {
  console.error('[benchmark-task-manager] FAILED')
  console.error(error)
  process.exitCode = 1
})
