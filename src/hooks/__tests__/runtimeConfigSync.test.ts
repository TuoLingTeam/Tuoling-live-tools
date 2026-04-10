import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCommentListenerRuntimeStore } from '@/utils/commentListenerRuntime'
import { useAutoMessageStore } from '../useAutoMessage'
import { useAutoPopUpStore } from '../useAutoPopUp'
import { useAutoReplyConfigStore } from '../useAutoReplyConfig'

describe('runtime config sync guards', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        window?: {
          ipcRenderer?: {
            invoke: ReturnType<typeof vi.fn>
          }
        }
      }
    ).window = {
      ipcRenderer: {
        invoke: vi.fn().mockResolvedValue(true),
      },
    }

    useAutoMessageStore.setState({
      contexts: {},
      currentUserId: null,
    })
    useAutoPopUpStore.setState({
      contexts: {},
      currentUserId: null,
    })
    useAutoReplyConfigStore.setState({
      contexts: {},
      currentUserId: null,
    })
    useCommentListenerRuntimeStore.setState({ contexts: {} })
  })

  it('stops auto message when running config becomes empty', async () => {
    useAutoMessageStore.setState({
      contexts: {
        'acc-1': {
          isRunning: true,
          config: {
            scheduler: { interval: [1000, 1000] },
            messages: [{ id: 'm-1', content: 'hello', pinTop: false }],
            random: false,
            extraSpaces: false,
          },
        },
      },
      currentUserId: null,
    })

    useAutoMessageStore.getState().setConfig('acc-1', {
      messages: [{ id: 'm-1', content: '   ', pinTop: false }],
    })

    expect(useAutoMessageStore.getState().contexts['acc-1']?.isRunning).toBe(false)
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('tasks:autoMessage:stop', 'acc-1')
  })

  it('stops auto popup when running config becomes empty', async () => {
    useAutoPopUpStore.setState({
      contexts: {
        'acc-1': {
          isRunning: true,
          config: {
            scheduler: { interval: [1000, 1000] },
            goods: [{ id: 1001 }],
            random: false,
          },
          shortcuts: [],
          goodsAutoFillAttempted: false,
          goodsAutoFillLocked: false,
        },
      },
      currentUserId: null,
    })

    useAutoPopUpStore.getState().setConfig('acc-1', {
      goods: [],
    })

    expect(useAutoPopUpStore.getState().contexts['acc-1']?.isRunning).toBe(false)
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('tasks:autoPopUp:stop', 'acc-1')
  })

  it('re-syncs comment listener config when auto reply config changes during listening', async () => {
    useAutoReplyConfigStore.setState({
      contexts: {
        'acc-1': {
          config: {
            entry: 'control',
            blockList: [],
            hideUsername: false,
            comment: {
              enable: true,
              keywordReply: { enable: false, rules: [] },
              aiReply: { enable: false, useContext: false, contextCount: 3 },
            },
            room_enter: { enable: false, messages: [], options: {} },
            room_like: { enable: false, messages: [], options: {} },
            live_order: { enable: false, messages: [], options: {} },
            subscribe_merchant_brand_vip: { enable: false, messages: [], options: {} },
            room_follow: { enable: false, messages: [], options: {} },
            ecom_fansclub_participate: { enable: false, messages: [], options: {} },
            ws: { enable: false, port: 12354, token: 'ws-token-1' },
            pinComment: { enabled: false, keywords: [], mode: 'exact' },
          },
        },
      },
      currentUserId: null,
    })
    useCommentListenerRuntimeStore.getState().setStatus('acc-1', 'listening')

    useAutoReplyConfigStore.getState().updateConfig('acc-1', {
      entry: 'websocket',
      ws: { enable: true, port: 23456, token: 'ws-token-2' },
    })

    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('tasks:commentListener:start', 'acc-1', {
      source: 'control',
      ws: { port: 23456, token: 'ws-token-2' },
    })
  })
})
