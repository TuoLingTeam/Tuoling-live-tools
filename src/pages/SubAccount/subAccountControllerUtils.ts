import { isSameSubAccountLiveRoomUrl } from 'shared/subAccountLiveRoom'
import type { SubAccount as SubAccountItem, SubAccountPresetCategory } from '@/hooks/useSubAccount'

type ToastApi = ReturnType<typeof import('@/hooks/useToast').useToast>['toast']

export type BatchProgress = {
  current: number
  total: number
  completed: number
  failed: number
}

export type EnterProgress = {
  current: number
  total: number
  completed: number
  failed: number
  accountId: string
  accountName: string
  success: boolean
  error?: string
}

export type VerificationNotice = {
  accountId: string
  accountName?: string
  message: string
  timestamp: number
}

export function validateLiveRoomUrl({
  liveRoomUrl,
  requireActualLiveRoom = false,
  onInvalid,
  toast,
}: {
  liveRoomUrl: string
  requireActualLiveRoom?: boolean
  onInvalid: (trimmedUrl: string) => void
  toast: ToastApi
}) {
  const trimmedUrl = liveRoomUrl.trim()
  if (!trimmedUrl) {
    toast.warning({
      title: '请先输入直播间地址',
      description: '填写目标直播间链接后，小号才能进房或发送互动消息。',
      dedupeKey: 'subaccount-live-room-required',
    })
    return null
  }

  try {
    new URL(trimmedUrl)
  } catch {
    onInvalid(trimmedUrl)
    return null
  }

  if (requireActualLiveRoom) {
    const isLiveRoom =
      (trimmedUrl.includes('live.douyin.com') ||
        trimmedUrl.includes('live.kuaishou.com') ||
        (trimmedUrl.includes('/live/') && !trimmedUrl.includes('dashboard'))) &&
      !trimmedUrl.includes('dashboard') &&
      !trimmedUrl.includes('control') &&
      !trimmedUrl.includes('compass')

    if (!isLiveRoom) {
      onInvalid(trimmedUrl)
      return null
    }
  }

  return trimmedUrl
}

export function getReadyAccounts(accounts: SubAccountItem[], targetUrl: string) {
  return accounts.filter(
    account =>
      account.status === 'connected' &&
      account.liveRoomStatus === 'entered' &&
      isSameSubAccountLiveRoomUrl(account.liveRoomUrl, targetUrl),
  )
}

export function getValidMessages(
  messages: Array<{ content: string; weight: number }>,
  toast: ToastApi,
) {
  const validMessages = messages.filter(message => message.content.trim().length > 0)
  const ignoredCount = messages.length - validMessages.length

  if (validMessages.length === 0) {
    toast.warning({
      title: '请至少添加一条有效消息',
      description: '空白消息不会参与发送，请补充至少一条非空内容。',
      dedupeKey: 'subaccount-valid-messages-required',
    })
    return null
  }

  if (ignoredCount > 0) {
    toast.info({
      title: '已忽略空白消息',
      description: `${ignoredCount} 条空白内容不会参与发送。`,
      dedupeKey: 'subaccount-blank-messages-ignored',
    })
  }

  return validMessages
}

export function ensureSelectedPresetCategory({
  presetCategories,
  selectedPresetCategoryId,
  setSelectedPresetCategoryId,
}: {
  presetCategories: SubAccountPresetCategory[]
  selectedPresetCategoryId: string | null
  setSelectedPresetCategoryId: (value: string | null) => void
}) {
  if (!presetCategories.length) {
    setSelectedPresetCategoryId(null)
    return
  }

  if (
    !selectedPresetCategoryId ||
    !presetCategories.some(item => item.id === selectedPresetCategoryId)
  ) {
    setSelectedPresetCategoryId(presetCategories[0].id)
  }
}
