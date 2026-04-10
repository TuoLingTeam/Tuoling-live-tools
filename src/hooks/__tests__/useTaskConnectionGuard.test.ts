import { describe, expect, it } from 'vitest'
import { shouldStopTasksForConnectionLoss } from '@/hooks/useTaskConnectionGuard'

describe('shouldStopTasksForConnectionLoss', () => {
  it('does not stop on initial disconnected state', () => {
    expect(
      shouldStopTasksForConnectionLoss({
        previousAccountId: null,
        currentAccountId: 'acc-1',
        previousStatus: null,
        currentStatus: 'disconnected',
        hasRunningTasks: true,
      }),
    ).toBe(false)
  })

  it('does not stop when switching to another account that is already disconnected', () => {
    expect(
      shouldStopTasksForConnectionLoss({
        previousAccountId: 'acc-1',
        currentAccountId: 'acc-2',
        previousStatus: 'connected',
        currentStatus: 'disconnected',
        hasRunningTasks: true,
      }),
    ).toBe(false)
  })

  it('stops when the same account falls from connected to disconnected', () => {
    expect(
      shouldStopTasksForConnectionLoss({
        previousAccountId: 'acc-1',
        currentAccountId: 'acc-1',
        previousStatus: 'connected',
        currentStatus: 'disconnected',
        hasRunningTasks: true,
      }),
    ).toBe(true)
  })

  it('stops when the same account falls from connecting to error', () => {
    expect(
      shouldStopTasksForConnectionLoss({
        previousAccountId: 'acc-1',
        currentAccountId: 'acc-1',
        previousStatus: 'connecting',
        currentStatus: 'error',
        hasRunningTasks: true,
      }),
    ).toBe(true)
  })

  it('stops when the same account falls from connected to reconnecting', () => {
    expect(
      shouldStopTasksForConnectionLoss({
        previousAccountId: 'acc-1',
        currentAccountId: 'acc-1',
        previousStatus: 'connected',
        currentStatus: 'reconnecting',
        hasRunningTasks: true,
      }),
    ).toBe(true)
  })

  it('does not stop when there are no running tasks', () => {
    expect(
      shouldStopTasksForConnectionLoss({
        previousAccountId: 'acc-1',
        currentAccountId: 'acc-1',
        previousStatus: 'connected',
        currentStatus: 'disconnected',
        hasRunningTasks: false,
      }),
    ).toBe(false)
  })
})
