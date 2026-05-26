import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserSession } from '../managers/BrowserSessionManager'
import type { IPlatform } from '../platforms/IPlatform'
import { StreamStateDetector } from '../services/StreamStateDetector'
import windowManager from '../windowManager'

vi.mock('../windowManager', () => ({
  default: {
    send: vi.fn(),
  },
}))

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createPlatform(isLive: IPlatform['isLive']): IPlatform {
  return {
    platformName: 'test-platform',
    connect: vi.fn(),
    login: vi.fn(),
    getAccountName: vi.fn(),
    isLive,
    disconnect: vi.fn(),
  }
}

describe('StreamStateDetector', () => {
  const browserSession = { page: {} } as BrowserSession

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('live 状态下第一次离线信号不应立刻切到 offline', async () => {
    const platform = createPlatform(vi.fn().mockResolvedValue(false))
    const logger = createLogger()
    const detector = new StreamStateDetector(platform, browserSession, 'account-a', logger as any)
    const onStreamEnded = vi.fn()

    detector.setOnStreamEndedCallback(onStreamEnded)
    detector.setState('live')
    vi.mocked(windowManager.send).mockClear()

    await (detector as any).checkStreamState()

    expect(windowManager.send).not.toHaveBeenCalled()
    expect(onStreamEnded).not.toHaveBeenCalled()
  })

  it('live 状态下连续五次离线信号后才切到 offline 并触发回调', async () => {
    const platform = createPlatform(vi.fn().mockResolvedValue(false))
    const logger = createLogger()
    const detector = new StreamStateDetector(platform, browserSession, 'account-a', logger as any)
    const onStreamEnded = vi.fn()

    detector.setOnStreamEndedCallback(onStreamEnded)
    detector.setState('live')
    vi.mocked(windowManager.send).mockClear()

    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    expect(windowManager.send).not.toHaveBeenCalled()

    await (detector as any).checkStreamState()

    expect(windowManager.send).toHaveBeenCalledTimes(1)
    expect(windowManager.send).toHaveBeenCalledWith(
      'tasks:liveControl:streamStateChanged',
      'account-a',
      'offline',
    )
    expect(onStreamEnded).toHaveBeenCalledTimes(1)
    expect(onStreamEnded).toHaveBeenCalledWith('直播已结束')
  })

  it('unknown 信号不应累计离线确认', async () => {
    const platform = createPlatform(
      vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce('unknown')
        .mockResolvedValue(false),
    )
    const logger = createLogger()
    const detector = new StreamStateDetector(platform, browserSession, 'account-a', logger as any)
    const onStreamEnded = vi.fn()

    detector.setOnStreamEndedCallback(onStreamEnded)
    detector.setState('live')
    vi.mocked(windowManager.send).mockClear()

    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()

    expect(windowManager.send).not.toHaveBeenCalled()
    expect(onStreamEnded).not.toHaveBeenCalled()
  })

  it('第一次离线后恢复 live 时应清空确认计数，不触发误停', async () => {
    const platform = createPlatform(
      vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    )
    const logger = createLogger()
    const detector = new StreamStateDetector(platform, browserSession, 'account-a', logger as any)
    const onStreamEnded = vi.fn()

    detector.setOnStreamEndedCallback(onStreamEnded)
    detector.setState('live')
    vi.mocked(windowManager.send).mockClear()

    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()
    await (detector as any).checkStreamState()

    expect(windowManager.send).not.toHaveBeenCalled()
    expect(onStreamEnded).not.toHaveBeenCalled()
  })

  it('unknown 状态下也需要连续两次离线确认，避免首次误判直接挡住任务启动', async () => {
    const platform = createPlatform(vi.fn().mockResolvedValue(false))
    const logger = createLogger()
    const detector = new StreamStateDetector(platform, browserSession, 'account-a', logger as any)

    await (detector as any).checkStreamState()
    expect(windowManager.send).not.toHaveBeenCalled()

    await (detector as any).checkStreamState()
    expect(windowManager.send).toHaveBeenCalledTimes(1)
    expect(windowManager.send).toHaveBeenCalledWith(
      'tasks:liveControl:streamStateChanged',
      'account-a',
      'offline',
    )
  })
})
