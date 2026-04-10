import { createElement, useEffect, useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { isBrowserClosedReason } from 'shared/liveControlDisconnect'
import type { StreamStatus } from 'shared/streamStatus'
import { ToastAction } from '@/components/ui/toast'
import { useAccounts } from '@/hooks/useAccounts'
import { useAutoMessageStore } from '@/hooks/useAutoMessage'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReply, useAutoReplyStore } from '@/hooks/useAutoReply'
import { useChromeConfigStore } from '@/hooks/useChromeConfig'
import { useIpcListener } from '@/hooks/useIpc'
import { useLiveControlStore } from '@/hooks/useLiveControl'
import { useLiveStatsStore } from '@/hooks/useLiveStats'
import { useToast } from '@/hooks/useToast'
import { useUpdateConfigStore, useUpdateStore } from '@/hooks/useUpdate'
import { taskManager } from '@/tasks'
import { markCommentListenerStopped } from '@/utils/commentListenerRuntime'
import { getFriendlyErrorMessage } from '@/utils/errorMessages'
import { stopAllLiveTasks } from '@/utils/stopAllLiveTasks'

export function useAppIpcBootstrap() {
  useCommentIpcSync()
  useTaskEventIpcSync()
  useLiveControlIpcSync()
  useChromeIpcSync()
  useUpdateIpcSync()
}

function useCommentIpcSync() {
  const { handleComment } = useAutoReply()

  useIpcListener(IPC_CHANNELS.tasks.commentListener.showComment, ({ comment, accountId }) => {
    handleComment(comment, accountId)
  })
}

function useTaskEventIpcSync() {
  const accounts = useAccounts(s => s.accounts)
  const setIsListening = useAutoReplyStore(s => s.setIsListening)
  const setIsRunningAutoReply = useAutoReplyStore(s => s.setIsRunning)
  const setIsRunningAutoMessage = useAutoMessageStore(s => s.setIsRunning)
  const setIsRunningAutoPopUp = useAutoPopUpStore(s => s.setIsRunning)
  const setLiveStatsListening = useLiveStatsStore(s => s.setListening)

  useEffect(() => {
    if (!window.ipcRenderer?.on) return

    const cleanupFns: Array<() => void> = []

    for (const account of accounts) {
      cleanupFns.push(
        window.ipcRenderer.on(
          IPC_CHANNELS.tasks.autoMessage.stoppedFor(
            account.id,
          ) as `tasks:autoMessage:stopped:${string}`,
          (id: string) => {
            setIsRunningAutoMessage(id, false)
            taskManager.syncStatus('autoSpeak', 'stopped', id)
          },
        ),
      )

      cleanupFns.push(
        window.ipcRenderer.on(
          IPC_CHANNELS.tasks.autoPopUp.stoppedFor(
            account.id,
          ) as `tasks:autoPopUp:stopped:${string}`,
          (id: string) => {
            setIsRunningAutoPopUp(id, false)
            taskManager.syncStatus('autoPopup', 'stopped', id)
          },
        ),
      )

      cleanupFns.push(
        window.ipcRenderer.on(
          IPC_CHANNELS.tasks.commentListener.stoppedFor(
            account.id,
          ) as `tasks:commentListener:stopped:${string}`,
          (id: string) => {
            markCommentListenerStopped(id)
            setIsListening(id, 'stopped')
            setIsRunningAutoReply(id, false)
            setLiveStatsListening(id, false)
            taskManager.syncStatus('autoReply', 'stopped', id)
          },
        ),
      )
    }

    return () => {
      for (const cleanup of cleanupFns) {
        cleanup()
      }
    }
  }, [
    accounts,
    setIsListening,
    setIsRunningAutoReply,
    setIsRunningAutoMessage,
    setIsRunningAutoPopUp,
    setLiveStatsListening,
  ])
}

function useLiveControlIpcSync() {
  const setConnectState = useLiveControlStore(state => state.setConnectState)
  const setAccountName = useLiveControlStore(state => state.setAccountName)
  const setStreamState = useLiveControlStore(state => state.setStreamState)
  const { toast } = useToast()
  const reconnectingAccountsRef = useRef(new Set<string>())
  const reconnectFailedAccountsRef = useRef(new Set<string>())

  useIpcListener(IPC_CHANNELS.tasks.liveControl.disconnectedEvent, async (id, reason) => {
    const reasonStr = (reason || '') as string
    const isFatalDisconnect =
      isBrowserClosedReason(reasonStr) ||
      reasonStr.includes('连接已取消') ||
      reasonStr.includes('连接超时') ||
      reasonStr.includes('网络连接失败')

    const currentStatus = useLiveControlStore.getState().contexts[id]?.connectState
    if (currentStatus?.phase === 'waiting_for_login' && !isFatalDisconnect) {
      return
    }

    const skipToast = reconnectFailedAccountsRef.current.delete(id)
    reconnectingAccountsRef.current.delete(id)

    if (!skipToast && reason && !reasonStr.includes('用户主动断开')) {
      const latestConnectState = useLiveControlStore.getState().contexts[id]?.connectState
      toast.error({
        title: latestConnectState?.status === 'error' ? '连接失败' : '连接已断开',
        description: getFriendlyErrorMessage(reason),
        dedupeKey: `live-control-disconnected:${id}`,
      })
    }

    await stopAllLiveTasks(id, 'disconnected', false)
  })

  useIpcListener(
    IPC_CHANNELS.tasks.liveControl.stateChanged,
    async ({ accountId, connectState }) => {
      const prevContext = useLiveControlStore.getState().contexts[accountId]
      const isRecoveringAccount = reconnectingAccountsRef.current.has(accountId)
      const enteredReconnecting =
        connectState.status === 'reconnecting' &&
        prevContext?.connectState.status !== 'reconnecting'
      const shouldToastConnected =
        connectState.status === 'connected' &&
        connectState.phase === 'streaming' &&
        !isRecoveringAccount &&
        (prevContext?.connectState.status !== 'connected' ||
          prevContext?.connectState.phase !== 'streaming')

      setConnectState(accountId, connectState)

      if (enteredReconnecting) {
        reconnectingAccountsRef.current.add(accountId)
        toast.info({
          description: '中控台连接中断，正在尝试恢复',
          dedupeKey: `live-control-reconnecting:${accountId}`,
        })
        await stopAllLiveTasks(accountId, 'disconnected', false)
        return
      }

      if (shouldToastConnected) {
        toast.success({
          description: '已成功连接到直播控制台',
          dedupeKey: `live-control-connected:${accountId}`,
        })
      }
    },
  )

  useIpcListener(IPC_CHANNELS.tasks.liveControl.reconnectedEvent, accountId => {
    if (!reconnectingAccountsRef.current.delete(accountId)) {
      return
    }

    toast.success({
      description: '中控台连接已恢复',
      dedupeKey: `live-control-recovered:${accountId}`,
    })
  })

  useIpcListener(IPC_CHANNELS.tasks.liveControl.reconnectFailedEvent, (accountId, payload) => {
    reconnectingAccountsRef.current.delete(accountId)
    reconnectFailedAccountsRef.current.add(accountId)
    toast.error({
      title: '自动重连失败',
      description: payload.message,
      dedupeKey: `live-control-reconnect-failed:${accountId}`,
    })
  })

  useIpcListener(IPC_CHANNELS.tasks.liveControl.notifyAccountName, params => {
    if (!params.ok) {
      console.warn('[conn][event] notifyAccountName 返回失败')
      return
    }

    setAccountName(params.accountId, params.accountName)
  })

  useIpcListener(
    IPC_CHANNELS.tasks.liveControl.streamStateChanged,
    async (accountId: string, streamState: StreamStatus) => {
      const prevState = useLiveControlStore.getState().contexts[accountId]?.streamState
      setStreamState(accountId, streamState)

      if (prevState === 'live' && streamState !== 'live') {
        await stopAllLiveTasks(accountId, 'stream_ended', false)
      }
    },
  )
}

function useChromeIpcSync() {
  const setStorageState = useChromeConfigStore(s => s.setStorageState)

  useIpcListener(IPC_CHANNELS.chrome.saveState, (id, state) => {
    setStorageState(id, state)
  })
}

function useUpdateIpcSync() {
  const enableAutoCheckUpdate = useUpdateConfigStore(s => s.enableAutoCheckUpdate)
  const handleUpdate = useUpdateStore.use.handleUpdate()
  const handleCheckResult = useUpdateStore.use.handleCheckResult()
  const checkUpdateInBackground = useUpdateStore.use.checkUpdateInBackground()
  const { toast } = useToast()

  const openUpdateDetails = () => {
    useUpdateStore.getState().setDetailsOpen(true)
  }

  useIpcListener(IPC_CHANNELS.updater.updateAvailable, info => {
    const currentStatus = useUpdateStore.getState().status
    const isManualCheck = currentStatus === 'checking'

    if (info?.update && !isManualCheck) {
      toast.info({
        title: '发现新版本',
        description: `检测到新版本 v${info.newVersion}，可查看详情并选择更新时间。`,
        dedupeKey: `update-available:${info.newVersion}`,
        duration: 5000,
        action: createElement(
          ToastAction,
          {
            altText: '查看更新详情',
            onClick: openUpdateDetails,
          },
          '查看',
        ),
      })
    }

    handleCheckResult(info)
  })

  useIpcListener(IPC_CHANNELS.updater.updateDownloaded, () => {
    const { versionInfo, runtime, installUpdate } = useUpdateStore.getState()
    const nextVersion = versionInfo?.latestVersion
    const actionLabel = runtime.platform === 'win32' ? '重启并更新' : '查看详情'
    const handleReadyAction =
      runtime.platform === 'win32'
        ? () => {
            void installUpdate()
          }
        : openUpdateDetails

    toast.success({
      title: '更新已就绪',
      description: nextVersion
        ? `v${nextVersion} 已准备完成，可随时${actionLabel}。`
        : `更新已准备完成，可随时${actionLabel}。`,
      dedupeKey: nextVersion ? `update-ready:${nextVersion}` : 'update-ready',
      duration: 5000,
      action: createElement(
        ToastAction,
        {
          altText: actionLabel,
          onClick: handleReadyAction,
        },
        actionLabel,
      ),
    })
  })

  useIpcListener(IPC_CHANNELS.app.notifyUpdate, info => {
    if (enableAutoCheckUpdate) {
      handleUpdate(info)
    }
  })

  useEffect(() => {
    if (!enableAutoCheckUpdate) {
      return
    }

    void checkUpdateInBackground()
  }, [enableAutoCheckUpdate, checkUpdateInBackground])
}
