import { IPC_CHANNELS } from 'shared/ipcChannels'
import { SUB_ACCOUNT_WORKSPACE_ID } from 'shared/subAccountWorkspace'
import type { SubAccountGroup, SubAccount as SubAccountItem } from '@/hooks/useSubAccount'
import type { Actions, ToastApi } from './subAccountControllerActionTypes'
import {
  type BatchProgress,
  type EnterProgress,
  getReadyAccounts,
  getValidMessages,
  type VerificationNotice,
  validateLiveRoomUrl,
} from './subAccountControllerUtils'

export async function fetchLiveRoomUrlForSubAccount({
  currentAccountId,
  actions,
  toast,
}: {
  currentAccountId: string | null
  actions: Actions
  toast: ToastApi
}) {
  if (!currentAccountId) {
    toast.info({
      title: '请手动填写直播间地址',
      description: '当前未选择主账号，无法自动获取直播间链接。',
      dedupeKey: 'subaccount-live-room-manual',
    })
    return
  }
  try {
    const result = await window.ipcRenderer.invoke(
      IPC_CHANNELS.tasks.liveControl.getLiveRoomUrl,
      currentAccountId,
    )
    if (result.success && result.url) {
      actions.setLiveRoomUrl(result.url)
      console.log('[SubAccount] 自动获取直播间 URL 成功:', result.url)
    }
  } catch (error) {
    console.debug('获取直播间 URL 失败:', error)
    toast.info({
      title: '无法自动获取直播间地址',
      description: '请手动粘贴直播间分享链接。',
      dedupeKey: 'subaccount-live-room-fetch-failed',
    })
  }
}

export async function startOrStopSubAccountTask({
  isRunning,
  accounts,
  config,
  liveRoomUrl,
  actions,
  toast,
  setVerificationNotice,
}: {
  isRunning: boolean
  accounts: SubAccountItem[]
  config: {
    scheduler: { interval: [number, number] }
    messages: Array<{ content: string; weight: number }>
    random: boolean
    extraSpaces: boolean
    rotateAccounts: boolean
    rotateGroups: boolean
    groups: SubAccountGroup[]
  }
  liveRoomUrl: string
  actions: Actions
  toast: ToastApi
  setVerificationNotice: (value: VerificationNotice | null) => void
}) {
  if (!isRunning) {
    setVerificationNotice(null)
    if (accounts.length === 0) {
      toast.warning({
        title: '请先添加小号',
        description: '至少添加一个小号后才能启动互动任务。',
        dedupeKey: 'subaccount-account-required',
      })
      return
    }
    if (accounts.filter(account => account.status === 'connected').length === 0) {
      toast.warning({
        title: '请至少登录一个小号',
        description: '先让至少一个小号完成登录，再启动互动任务。',
        dedupeKey: 'subaccount-login-required',
      })
      return
    }

    const targetUrl = validateLiveRoomUrl({
      liveRoomUrl,
      toast,
      onInvalid: trimmedUrl => {
        toast.warning({
          title: '直播间地址无效',
          description: '请输入真实的直播间分享链接，例如 https://live.douyin.com/房间号。',
          dedupeKey: 'subaccount-live-room-invalid',
        })
        console.log('[SubAccount] 无效的直播间 URL:', trimmedUrl)
      },
    })
    if (!targetUrl) return

    const readyAccounts = getReadyAccounts(accounts, targetUrl)
    if (readyAccounts.length === 0) {
      toast.warning({
        title: '没有可发送的小号',
        description: '请先让至少一个已登录小号进入目标直播间。',
        dedupeKey: 'subaccount-enter-room-required',
      })
      return
    }

    const validMessages = getValidMessages(config.messages, toast)
    if (!validMessages) return

    const messagesForIPC = validMessages.map(message => ({
      content: message.content.trim(),
      weight: message.weight,
    }))
    const result = await window.ipcRenderer.invoke(
      IPC_CHANNELS.tasks.subAccount.start,
      SUB_ACCOUNT_WORKSPACE_ID,
      {
        scheduler: config.scheduler,
        liveRoomUrl: targetUrl,
        messages: messagesForIPC,
        random: config.random,
        extraSpaces: config.extraSpaces,
        rotateAccounts: config.rotateAccounts,
        rotateGroups: config.rotateGroups,
        accounts: accounts.map(account => ({
          id: account.id,
          name: account.name,
          platform: account.platform,
        })),
        groups: config.groups ?? [],
      },
    )
    if (result) {
      actions.setIsRunning(true)
      toast.success({
        title: '互动任务已启动',
        description: `${readyAccounts.length} 个小号将参与互动发送。`,
        dedupeKey: 'subaccount-task-started',
      })
    } else {
      toast.error({
        title: '启动失败',
        description: '小号互动任务启动失败，请稍后重试。',
        dedupeKey: 'subaccount-task-start-failed',
      })
    }
    return
  }

  const result = await window.ipcRenderer.invoke(
    IPC_CHANNELS.tasks.subAccount.stop,
    SUB_ACCOUNT_WORKSPACE_ID,
  )
  if (result) {
    actions.setIsRunning(false)
    toast.info({
      title: '互动任务已停止',
      description: '当前小号互动任务已停止。',
      dedupeKey: 'subaccount-task-stopped',
    })
  }
}

export async function enterSubAccountLiveRoom({
  accountId,
  accounts,
  liveRoomUrl,
  toast,
  syncAccountsFromBackend,
}: {
  accountId: string
  accounts: SubAccountItem[]
  liveRoomUrl: string
  toast: ToastApi
  syncAccountsFromBackend: () => Promise<void>
}) {
  const targetUrl = validateLiveRoomUrl({
    liveRoomUrl,
    requireActualLiveRoom: true,
    toast,
    onInvalid: trimmedUrl => {
      toast.warning({
        title: '直播间地址无效',
        description: '请输入真实的直播间分享链接，例如 https://live.douyin.com/房间号。',
        dedupeKey: 'subaccount-live-room-invalid',
      })
      console.log('[SubAccount] 无效的直播间 URL:', trimmedUrl)
    },
  })
  if (!targetUrl) return

  const account = accounts.find(item => item.id === accountId)
  if (!account) return

  if (account.status !== 'connected') {
    toast.warning({
      title: '小号尚未准备完成',
      description: `“${account.name}”当前状态为${account.status === 'connecting' ? '等待验证' : account.status}，暂时无法进房。`,
      dedupeKey: `subaccount-not-ready:${accountId}`,
    })
    return
  }

  toast.info({
    title: '正在进入直播间',
    description: `小号“${account.name}”正在进入目标直播间。`,
    dedupeKey: `subaccount-enter-start:${accountId}`,
  })

  const result = await window.ipcRenderer.invoke(
    IPC_CHANNELS.tasks.subAccount.enterLiveRoom,
    SUB_ACCOUNT_WORKSPACE_ID,
    accountId,
    targetUrl,
  )

  if (result.success) {
    await syncAccountsFromBackend()
    toast.success({
      title: '已进入直播间',
      description: `小号“${account.name}”已进入目标直播间。`,
      dedupeKey: `subaccount-enter-success:${accountId}`,
    })
  } else {
    await syncAccountsFromBackend()
    toast.error({
      title: '进入直播间失败',
      description: `小号“${account.name}”进入直播间失败：${result.error || '请稍后重试。'}`,
      dedupeKey: `subaccount-enter-failed:${accountId}`,
    })
  }
}

export async function enterAllSubAccountLiveRooms({
  accounts,
  liveRoomUrl,
  toast,
  setEnterProgress,
  syncAccountsFromBackend,
}: {
  accounts: SubAccountItem[]
  liveRoomUrl: string
  toast: ToastApi
  setEnterProgress: (value: EnterProgress | null) => void
  syncAccountsFromBackend: () => Promise<void>
}) {
  const targetUrl = validateLiveRoomUrl({
    liveRoomUrl,
    requireActualLiveRoom: true,
    toast,
    onInvalid: trimmedUrl => {
      toast.warning({
        title: '直播间地址无效',
        description: '请输入真实的直播间分享链接，例如 https://live.douyin.com/房间号。',
        dedupeKey: 'subaccount-live-room-invalid',
      })
      console.log('[SubAccount] 无效的直播间 URL:', trimmedUrl)
    },
  })
  if (!targetUrl) return

  const connected = accounts.filter(account => account.status === 'connected')
  if (connected.length === 0) {
    toast.warning({
      title: '没有可进房的小号',
      description: '请先让至少一个小号完成登录。',
      dedupeKey: 'subaccount-no-connected-accounts',
    })
    return
  }

  toast.info({
    title: '批量进房已开始',
    description: `正在让 ${connected.length} 个已登录小号进入目标直播间。`,
    dedupeKey: 'subaccount-enter-all-start',
  })
  setEnterProgress({
    current: 0,
    total: connected.length,
    completed: 0,
    failed: 0,
    accountId: '',
    accountName: '',
    success: true,
  })

  const result = await window.ipcRenderer.invoke(
    IPC_CHANNELS.tasks.subAccount.enterAllLiveRooms,
    SUB_ACCOUNT_WORKSPACE_ID,
    targetUrl,
    connected.map(account => account.id),
  )

  await syncAccountsFromBackend()

  if (result.successCount > 0) {
    toast.success({
      title: '批量进房已完成',
      description:
        result.failedCount > 0
          ? `${result.successCount}/${connected.length} 个小号进入成功，其余账号请查看列表状态。`
          : `${result.successCount}/${connected.length} 个小号已全部进入直播间。`,
      dedupeKey: 'subaccount-enter-all-finished',
    })
  } else if (!result.success && result.error) {
    toast.error({
      title: '批量进房失败',
      description: result.error,
      dedupeKey: 'subaccount-enter-all-failed',
    })
  }
}

export async function sendSubAccountBatch({
  accounts,
  batchCount,
  configMessages,
  liveRoomUrl,
  toast,
  setBatchProgress,
}: {
  accounts: SubAccountItem[]
  batchCount: number
  configMessages: Array<{ content: string; weight: number }>
  liveRoomUrl: string
  toast: ToastApi
  setBatchProgress: (value: BatchProgress | null) => void
}) {
  const targetUrl = validateLiveRoomUrl({
    liveRoomUrl,
    toast,
    onInvalid: trimmedUrl => {
      toast.warning({
        title: '直播间地址无效',
        description: '请输入真实的直播间分享链接，例如 https://live.douyin.com/房间号。',
        dedupeKey: 'subaccount-live-room-invalid',
      })
      console.log('[SubAccount] 无效的直播间 URL:', trimmedUrl)
    },
  })
  if (!targetUrl) return

  const readyAccounts = getReadyAccounts(accounts, targetUrl)
  const readyCount = readyAccounts.length
  if (readyCount === 0) {
    toast.warning({
      title: '没有可发送的小号',
      description: '请先让至少一个小号成功进入目标直播间。',
      dedupeKey: 'subaccount-batch-ready-required',
    })
    return
  }

  const validMessages = getValidMessages(configMessages, toast)
  if (!validMessages) return

  setBatchProgress({ current: 0, total: readyCount * batchCount, completed: 0, failed: 0 })

  toast.info({
    title: '批量发送已开始',
    description: `${readyCount} 个小号将各发送 ${batchCount} 条消息。`,
    dedupeKey: 'subaccount-batch-start',
  })

  const messagesForIPC = validMessages.map(message => ({
    content: message.content.trim(),
    weight: message.weight,
  }))

  const result = await window.ipcRenderer.invoke(
    IPC_CHANNELS.tasks.subAccount.sendBatch,
    SUB_ACCOUNT_WORKSPACE_ID,
    batchCount,
    messagesForIPC,
  )

  if (result.success) {
    toast.success({
      title: '批量发送已启动',
      description: '发送进度可在当前卡片中查看。',
      dedupeKey: 'subaccount-batch-started',
    })
  } else {
    toast.error({
      title: '批量发送失败',
      description: result.error || '请稍后重试。',
      dedupeKey: 'subaccount-batch-failed',
    })
    setBatchProgress(null)
  }
}
