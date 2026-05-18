import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import {
  connectMessageStream,
  getMessages,
  type MessageCenterItem,
  type MessageListResponse,
  markAllMessagesRead,
  markMessageRead,
} from '@/services/apiClient'
import { useAuthCheckDone, useAuthStore } from '@/stores/authStore'
import { useToast } from './useToast'

const STREAM_RETRY_DELAY_MS = 3_000
export const MESSAGE_CENTER_BACKSTOP_POLL_MS = 30_000

interface RefreshResult {
  success: boolean
  increased: number
  latestTitle?: string
}

interface MessageCenterState {
  items: MessageCenterItem[]
  unreadCount: number
  fetchedAt: string | null
  isLoading: boolean
  initialized: boolean
  streamConnected: boolean
  applySnapshot: (payload: MessageListResponse) => { increased: number; latestTitle?: string }
  setStreamConnected: (connected: boolean) => void
  refresh: () => Promise<RefreshResult>
  markRead: (id: string) => Promise<boolean>
  markAllRead: () => Promise<boolean>
  reset: () => void
}

const initialState = {
  items: [] as MessageCenterItem[],
  unreadCount: 0,
  fetchedAt: null as string | null,
  isLoading: false,
  initialized: false,
  streamConnected: false,
}

type NewMessageResult = Pick<RefreshResult, 'increased' | 'latestTitle'>

function getNewMessageDescription(result: NewMessageResult): string {
  if (result.increased > 1) {
    return `有 ${result.increased} 条新消息，请在消息中心查看。`
  }

  return result.latestTitle || '有 1 条新消息，请在消息中心查看。'
}

function showNewMessageToast(
  toast: ReturnType<typeof useToast>['toast'],
  result: NewMessageResult,
) {
  toast.info({
    title: '收到新消息',
    description: getNewMessageDescription(result),
    dedupeKey: `message-center:new:${result.latestTitle ?? 'batch'}`,
  })
}

export const useMessageCenterStore = create<MessageCenterState>()((set, get) => ({
  ...initialState,

  applySnapshot: payload => {
    const previousUnread = get().unreadCount
    const nextItems = payload.items ?? []
    const nextUnread = payload.unread_count ?? 0
    set({
      items: nextItems,
      unreadCount: nextUnread,
      fetchedAt: payload.fetched_at,
      initialized: true,
    })

    const latestUnreadTitle = nextItems.find(item => !item.is_read)?.title
    return {
      increased: Math.max(0, nextUnread - previousUnread),
      latestTitle: latestUnreadTitle,
    }
  },

  setStreamConnected: connected => {
    set({ streamConnected: connected })
  },

  refresh: async () => {
    if (get().isLoading) {
      return { success: true, increased: 0 }
    }

    set({ isLoading: true })

    try {
      const result = await getMessages()
      if (!result.ok) {
        return { success: false, increased: 0 }
      }

      const snapshot = get().applySnapshot(result.data)
      return {
        success: true,
        increased: snapshot.increased,
        latestTitle: snapshot.latestTitle,
      }
    } finally {
      set({ isLoading: false })
    }
  },

  markRead: async id => {
    const current = get().items.find(item => item.id === id)
    if (!current || current.is_read) {
      return true
    }

    const result = await markMessageRead(id)
    if (!result.ok) {
      return false
    }

    set(state => ({
      items: state.items.map(item => (item.id === id ? { ...item, is_read: true } : item)),
      unreadCount: result.data.unread_count,
    }))
    return true
  },

  markAllRead: async () => {
    const result = await markAllMessagesRead()
    if (!result.ok) {
      return false
    }

    set(state => ({
      items: state.items.map(item => ({ ...item, is_read: true })),
      unreadCount: result.data.unread_count,
    }))
    return true
  },

  reset: () => set(initialState),
}))

export function useMessageCenterPolling() {
  const { toast } = useToast()
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const userId = useAuthStore(state => state.user?.id ?? null)
  const authCheckDone = useAuthCheckDone()
  const reset = useMessageCenterStore(state => state.reset)
  const applySnapshot = useMessageCenterStore(state => state.applySnapshot)
  const setStreamConnected = useMessageCenterStore(state => state.setStreamConnected)
  const toastReadyRef = useRef(false)

  useEffect(() => {
    if (!authCheckDone) {
      return
    }

    if (!isAuthenticated || !userId) {
      toastReadyRef.current = false
      setStreamConnected(false)
      reset()
      return
    }

    let disposed = false
    let abortController: AbortController | null = null
    let backstopTimer: number | null = null

    const load = async () => {
      const result = await useMessageCenterStore.getState().refresh()
      if (disposed || !result.success) {
        return
      }

      if (toastReadyRef.current && result.increased > 0) {
        showNewMessageToast(toast, result)
      }

      toastReadyRef.current = true
    }

    backstopTimer = window.setInterval(() => {
      void load()
    }, MESSAGE_CENTER_BACKSTOP_POLL_MS)

    const run = async () => {
      await load()

      while (!disposed) {
        abortController = new AbortController()
        try {
          await connectMessageStream(event => {
            if (disposed || event.type !== 'snapshot') {
              return
            }

            setStreamConnected(true)
            const result = applySnapshot(event.payload)
            if (toastReadyRef.current && result.increased > 0) {
              showNewMessageToast(toast, result)
            }
            toastReadyRef.current = true
          }, abortController.signal)
        } catch (error) {
          if (disposed || abortController.signal.aborted) {
            break
          }
          console.warn('[MessageCenter] Stream disconnected:', error)
        } finally {
          setStreamConnected(false)
        }

        if (disposed) {
          break
        }

        await new Promise(resolve => {
          window.setTimeout(resolve, STREAM_RETRY_DELAY_MS)
        })
      }
    }

    void run()

    return () => {
      disposed = true
      if (backstopTimer) {
        window.clearInterval(backstopTimer)
      }
      abortController?.abort()
      setStreamConnected(false)
    }
  }, [applySnapshot, authCheckDone, isAuthenticated, reset, setStreamConnected, toast, userId])
}
