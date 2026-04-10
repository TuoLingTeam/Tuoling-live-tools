import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireCommentListener,
  useCommentListenerRuntimeStore,
} from '@/utils/commentListenerRuntime'

describe('commentListenerRuntime', () => {
  beforeEach(() => {
    useCommentListenerRuntimeStore.setState({ contexts: {} })
  })

  it('re-syncs config through start IPC when listener is already active', async () => {
    useCommentListenerRuntimeStore.getState().setStatus('acc-1', 'listening')

    const ipcInvoke = vi.fn().mockResolvedValue(true)

    const ok = await acquireCommentListener(
      'acc-1',
      'autoReply',
      {
        source: 'websocket',
        ws: { port: 12345, token: 'ws-token-1' },
      },
      ipcInvoke,
    )

    expect(ok).toBe(true)
    expect(ipcInvoke).toHaveBeenCalledTimes(1)
    expect(ipcInvoke).toHaveBeenCalledWith(
      'tasks:commentListener:start',
      'acc-1',
      expect.objectContaining({
        source: 'websocket',
        ws: { port: 12345, token: 'ws-token-1' },
      }),
    )
  })
})
