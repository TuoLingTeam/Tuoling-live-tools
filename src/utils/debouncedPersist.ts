type PersistTask = {
  timer: number | null
  task: () => void
}

const persistTasks = new Map<string, PersistTask>()

function runTask(key: string) {
  const entry = persistTasks.get(key)
  if (!entry) return

  if (entry.timer !== null) {
    window.clearTimeout(entry.timer)
  }

  persistTasks.delete(key)
  try {
    entry.task()
  } catch (error) {
    console.error(`[Persist] Failed to run task for ${key}:`, error)
  }
}

export function schedulePersist(key: string, task: () => void, delayMs = 250): void {
  const existing = persistTasks.get(key)
  if (existing && existing.timer !== null) {
    window.clearTimeout(existing.timer)
  }

  const timer = window.setTimeout(() => {
    runTask(key)
  }, delayMs)

  persistTasks.set(key, {
    timer,
    task,
  })
}

export function flushPersist(key: string): void {
  runTask(key)
}

export function flushAllPersists(): void {
  for (const key of [...persistTasks.keys()]) {
    runTask(key)
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    flushAllPersists()
  })
}
