import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import type { IpcChannels } from 'shared/electron-api'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { isSameSubAccountLiveRoomUrl } from 'shared/subAccountLiveRoom'
import { SUB_ACCOUNT_WORKSPACE_ID } from 'shared/subAccountWorkspace'
import { useAccounts } from '@/hooks/useAccounts'
import { useIpcListener } from '@/hooks/useIpc'
import type { SubAccountPresetCategory } from '@/hooks/useSubAccount'
import {
  useCurrentSubAccount,
  useSubAccountActions,
  useSyncSubAccountsOnMount,
} from '@/hooks/useSubAccount'
import { useToast } from '@/hooks/useToast'
import type { ViewerPlatformKey } from './constants'
import {
  addPresetCategory,
  addSubAccount,
  addSubAccountGroup,
  assignSubAccountToGroup,
  clearSubAccountLoginState,
  clearSubAccountMessages,
  disconnectSubAccount,
  enterAllSubAccountLiveRooms,
  enterSubAccountLiveRoom,
  exportSubAccounts,
  fetchLiveRoomUrlForSubAccount,
  importSubAccounts,
  loadSubAccountPreset,
  loginSubAccount,
  removePresetCategory,
  removeSubAccount,
  removeSubAccountGroup,
  sendSubAccountBatch,
  startOrStopSubAccountTask,
  syncAccountsFromBackend,
  toggleSubAccountGroup,
} from './subAccountControllerActions'
import {
  type BatchProgress,
  type EnterProgress,
  ensureSelectedPresetCategory,
  type VerificationNotice,
} from './subAccountControllerUtils'

export function useSubAccountController() {
  const { toast } = useToast()
  const currentAccountId = useAccounts(state => state.currentAccountId)

  const isRunning = useCurrentSubAccount(ctx => ctx.isRunning)
  const config = useCurrentSubAccount(ctx => ctx.config)
  const accounts = useCurrentSubAccount(ctx => ctx.accounts)
  const batchCount = useCurrentSubAccount(ctx => ctx.batchCount)
  const liveRoomUrl = useCurrentSubAccount(ctx => ctx.liveRoomUrl)
  const presetCategories = useCurrentSubAccount(ctx => ctx.presetCategories)
  const actions = useSubAccountActions()

  useSyncSubAccountsOnMount()

  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountPlatform, setNewAccountPlatform] = useState<ViewerPlatformKey>('douyin')
  const [isAdding, setIsAdding] = useState(false)
  const [showPresetLibrary, setShowPresetLibrary] = useState(false)
  const [selectedPresetCategoryId, setSelectedPresetCategoryId] = useState<string | null>(null)
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [enterProgress, setEnterProgress] = useState<EnterProgress | null>(null)
  const [verificationNotice, setVerificationNotice] = useState<VerificationNotice | null>(null)

  const syncAccounts = useMemoizedFn(async () => {
    await syncAccountsFromBackend(accounts, actions)
  })

  useIpcListener(IPC_CHANNELS.tasks.subAccount.batchProgress, (workspaceId, data) => {
    if (workspaceId === SUB_ACCOUNT_WORKSPACE_ID) {
      setBatchProgress(data)
    }
  })

  useIpcListener(IPC_CHANNELS.tasks.subAccount.enterAllProgress, (workspaceId, data) => {
    if (workspaceId === SUB_ACCOUNT_WORKSPACE_ID) {
      setEnterProgress(data)
    }
  })

  useIpcListener(
    IPC_CHANNELS.tasks.subAccount.stoppedFor(SUB_ACCOUNT_WORKSPACE_ID) as keyof IpcChannels,
    () => {
      actions.setIsRunning(false)
    },
  )

  useIpcListener(IPC_CHANNELS.tasks.subAccount.accountStatusChanged, (workspaceId, data) => {
    if (workspaceId !== SUB_ACCOUNT_WORKSPACE_ID) {
      return
    }

    if (data.verificationRequired) {
      const message =
        data.verificationMessage || '检测到平台安全验证，请先在浏览器完成处理后再重新启动任务'
      setVerificationNotice({
        accountId: data.accountId,
        accountName: data.accountName,
        message,
        timestamp: data.timestamp,
      })
      actions.setIsRunning(false)
      toast.warning({
        title: '检测到平台安全验证',
        description: `${data.accountName || '小号'} 需要先在浏览器中完成人工验证后再继续。`,
        dedupeKey: `subaccount-verification:${data.accountId}`,
      })
    }

    if (data.status) {
      console.log('[SubAccount] ✅ 收到状态变更事件:', {
        accountId: data.accountId,
        accountName: data.accountName,
        status: data.status,
        error: data.error,
        timestamp: new Date().toISOString(),
      })
    }
    void syncAccounts()
  })

  useEffect(() => {
    if (batchProgress && batchProgress.current >= batchProgress.total && batchProgress.total > 0) {
      const timer = setTimeout(() => setBatchProgress(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [batchProgress])

  useEffect(() => {
    if (enterProgress && enterProgress.current >= enterProgress.total && enterProgress.total > 0) {
      const timer = setTimeout(() => setEnterProgress(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [enterProgress])

  useEffect(() => {
    void syncAccounts()
  }, [syncAccounts])

  const fetchLiveRoomUrl = useMemoizedFn(async () => {
    await fetchLiveRoomUrlForSubAccount({
      currentAccountId,
      actions,
      toast,
    })
  })

  const handleTaskButtonClick = useMemoizedFn(async () => {
    await startOrStopSubAccountTask({
      isRunning,
      accounts,
      config,
      liveRoomUrl,
      actions,
      toast,
      setVerificationNotice,
    })
  })

  const handleAddAccount = useMemoizedFn(async () => {
    await addSubAccount({
      newAccountName,
      newAccountPlatform,
      actions,
      toast,
      setNewAccountName,
      setIsAdding,
    })
  })

  const handleRemoveAccount = useMemoizedFn(async (accountId: string) => {
    await removeSubAccount(accountId, accounts, actions, toast)
  })

  const handleLoginAccount = useMemoizedFn(async (accountId: string) => {
    await loginSubAccount(accountId, accounts, actions, toast)
  })

  const handleDisconnectAccount = useMemoizedFn(async (accountId: string) => {
    await disconnectSubAccount(accountId, accounts, actions, toast)
  })

  const handleClearSavedLoginState = useMemoizedFn(async (accountId: string) => {
    await clearSubAccountLoginState({
      accountId,
      accounts,
      toast,
      syncAccountsFromBackend: syncAccounts,
    })
  })

  const handleEnterLiveRoom = useMemoizedFn(async (accountId: string) => {
    await enterSubAccountLiveRoom({
      accountId,
      accounts,
      liveRoomUrl,
      toast,
      syncAccountsFromBackend: syncAccounts,
    })
  })

  const handleEnterAllLiveRoom = useMemoizedFn(async () => {
    await enterAllSubAccountLiveRooms({
      accounts,
      liveRoomUrl,
      toast,
      setEnterProgress,
      syncAccountsFromBackend: syncAccounts,
    })
  })

  const handleLoadPreset = useMemoizedFn((categoryKey: string) => {
    loadSubAccountPreset({
      categoryKey,
      presetCategories,
      currentMessages: config.messages,
      actions,
      toast,
      setShowPresetLibrary,
    })
  })

  const selectedPresetCategory = useMemo(
    () =>
      presetCategories.find(category => category.id === selectedPresetCategoryId) ??
      presetCategories[0] ??
      null,
    [presetCategories, selectedPresetCategoryId],
  )

  useEffect(() => {
    ensureSelectedPresetCategory({
      presetCategories,
      selectedPresetCategoryId,
      setSelectedPresetCategoryId,
    })
  }, [presetCategories, selectedPresetCategoryId])

  const updatePresetCategory = useMemoizedFn(
    (
      categoryId: string,
      updater: (category: SubAccountPresetCategory) => SubAccountPresetCategory,
    ) => {
      actions.setPresetCategories(
        presetCategories.map(category =>
          category.id === categoryId ? updater(category) : category,
        ),
      )
    },
  )

  const handleAddPresetCategory = useMemoizedFn(() => {
    addPresetCategory(presetCategories, actions, setSelectedPresetCategoryId)
  })

  const handleRemovePresetCategory = useMemoizedFn((categoryId: string) => {
    removePresetCategory({
      categoryId,
      presetCategories,
      selectedPresetCategoryId,
      actions,
      toast,
      setSelectedPresetCategoryId,
    })
  })

  const handleClearMessages = useMemoizedFn(() => {
    clearSubAccountMessages(config.messages, actions, toast)
  })

  const handleSendBatch = useMemoizedFn(async () => {
    await sendSubAccountBatch({
      accounts,
      batchCount,
      configMessages: config.messages,
      liveRoomUrl,
      toast,
      setBatchProgress,
    })
  })

  const handleAddGroup = useMemoizedFn(() => {
    addSubAccountGroup(newGroupName, actions, toast, setNewGroupName)
  })

  const handleRemoveGroup = useMemoizedFn((groupId: string) => {
    removeSubAccountGroup(groupId, actions, toast)
  })

  const handleToggleGroup = useMemoizedFn((groupId: string, enabled: boolean) => {
    toggleSubAccountGroup(groupId, enabled, actions)
  })

  const handleAssignToGroup = useMemoizedFn((accountId: string, groupId: string | undefined) => {
    assignSubAccountToGroup(accountId, groupId, actions, toast)
  })

  const handleExportAccounts = useMemoizedFn(async () => {
    await exportSubAccounts(toast)
  })

  const handleImportAccounts = useMemoizedFn(async (event: React.ChangeEvent<HTMLInputElement>) => {
    await importSubAccounts({
      event,
      toast,
      syncAccountsFromBackend: syncAccounts,
    })
  })

  const connectedCount = accounts.filter(account => account.status === 'connected').length
  const enteredCount = accounts.filter(
    account =>
      account.status === 'connected' &&
      account.liveRoomStatus === 'entered' &&
      isSameSubAccountLiveRoomUrl(account.liveRoomUrl, liveRoomUrl.trim()),
  ).length
  const isEnteringAll =
    !!enterProgress && enterProgress.total > 0 && enterProgress.current < enterProgress.total

  const showMessageTooLong = useMemoizedFn(() => {
    toast.warning({
      title: '消息内容过长',
      description: '单条消息不能超过 50 个字符。',
      dedupeKey: 'subaccount-message-too-long',
    })
  })

  const showKeepLastMessage = useMemoizedFn(() => {
    toast.warning({
      title: '至少保留一条消息',
      description: '最后一条消息不能删除。',
      dedupeKey: 'subaccount-message-last',
    })
  })

  return {
    actions,
    accounts,
    batchCount,
    batchProgress,
    config,
    connectedCount,
    enterProgress,
    enteredCount,
    fetchLiveRoomUrl,
    handleAddAccount,
    handleAddGroup,
    handleAddPresetCategory,
    handleAssignToGroup,
    handleClearMessages,
    handleClearSavedLoginState,
    handleDisconnectAccount,
    handleEnterAllLiveRoom,
    handleEnterLiveRoom,
    handleExportAccounts,
    handleImportAccounts,
    handleLoadPreset,
    handleLoginAccount,
    handleRemoveAccount,
    handleRemoveGroup,
    handleRemovePresetCategory,
    handleSendBatch,
    handleTaskButtonClick,
    handleToggleGroup,
    isAdding,
    isEnteringAll,
    isRunning,
    liveRoomUrl,
    newAccountName,
    newAccountPlatform,
    newGroupName,
    presetCategories,
    selectedGroup,
    selectedPresetCategory,
    selectedPresetCategoryId,
    setIsAdding,
    setNewAccountName,
    setNewAccountPlatform,
    setNewGroupName,
    setSelectedGroup,
    setSelectedPresetCategoryId,
    setShowGroupManager,
    setShowPresetLibrary,
    showGroupManager,
    showKeepLastMessage,
    showMessageTooLong,
    showPresetLibrary,
    updatePresetCategory,
    verificationNotice,
    setVerificationNotice,
  }
}
