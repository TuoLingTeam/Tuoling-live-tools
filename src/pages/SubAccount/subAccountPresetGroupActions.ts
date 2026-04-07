import type { SubAccountGroup, SubAccountPresetCategory } from '@/hooks/useSubAccount'
import type { Actions, ToastApi } from './subAccountControllerActionTypes'

export function loadSubAccountPreset({
  categoryKey,
  presetCategories,
  currentMessages,
  actions,
  toast,
  setShowPresetLibrary,
}: {
  categoryKey: string
  presetCategories: SubAccountPresetCategory[]
  currentMessages: Array<{ id: string; content: string; weight: number }>
  actions: Actions
  toast: ToastApi
  setShowPresetLibrary: (value: boolean) => void
}) {
  const category = presetCategories.find(item => item.id === categoryKey)
  if (!category) {
    toast.error({
      title: '未找到分类',
      description: '对应的话术分类不存在，请刷新后重试。',
      dedupeKey: 'subaccount-preset-not-found',
    })
    return
  }

  const existingContents = new Set(
    currentMessages.map(message => message.content.trim().toLowerCase()),
  )
  const newMessages = category.messages
    .filter(message => message.content.trim().length > 0)
    .filter(message => !existingContents.has(message.content.trim().toLowerCase()))
    .map(message => {
      existingContents.add(message.content.trim().toLowerCase())
      return {
        id: crypto.randomUUID(),
        content: message.content,
        weight: message.weight,
      }
    })

  actions.setMessages([...currentMessages, ...newMessages])

  const label = category.name || '话术'
  if (newMessages.length === 0) {
    toast.info({
      title: '没有新增话术',
      description: `所选${label}与现有消息重复，未追加新内容。`,
      dedupeKey: `subaccount-preset-duplicate:${category.id}`,
    })
  } else {
    toast.success({
      title: '话术已加载',
      description: `已追加 ${newMessages.length} 条${label}话术。`,
      dedupeKey: `subaccount-preset-loaded:${category.id}`,
    })
  }

  setShowPresetLibrary(false)
}

export function addPresetCategory(
  presetCategories: SubAccountPresetCategory[],
  actions: Actions,
  setSelectedPresetCategoryId: (value: string | null) => void,
) {
  const newCategory: SubAccountPresetCategory = {
    id: crypto.randomUUID(),
    name: `自定义分类${presetCategories.length + 1}`,
    description: '可编辑的话术分类',
    messages: [{ id: crypto.randomUUID(), content: '', weight: 1 }],
  }
  actions.setPresetCategories([...presetCategories, newCategory])
  setSelectedPresetCategoryId(newCategory.id)
}

export function removePresetCategory({
  categoryId,
  presetCategories,
  selectedPresetCategoryId,
  actions,
  toast,
  setSelectedPresetCategoryId,
}: {
  categoryId: string
  presetCategories: SubAccountPresetCategory[]
  selectedPresetCategoryId: string | null
  actions: Actions
  toast: ToastApi
  setSelectedPresetCategoryId: (value: string | null) => void
}) {
  if (presetCategories.length <= 1) {
    toast.warning({
      title: '至少保留一个分类',
      description: '最后一个话术分类不能删除。',
      dedupeKey: 'subaccount-preset-last-category',
    })
    return
  }

  actions.setPresetCategories(presetCategories.filter(category => category.id !== categoryId))
  if (selectedPresetCategoryId === categoryId) {
    const fallback = presetCategories.find(category => category.id !== categoryId)
    setSelectedPresetCategoryId(fallback?.id ?? null)
  }
}

export function clearSubAccountMessages(
  messages: Array<{ id: string; content: string; weight: number }>,
  actions: Actions,
  toast: ToastApi,
) {
  if (messages.length <= 1) return
  actions.setMessages([{ id: crypto.randomUUID(), content: '', weight: 1 }])
  toast.info({
    title: '消息列表已清空',
    description: '已保留一条空白消息，方便继续编辑。',
    dedupeKey: 'subaccount-messages-cleared',
  })
}

export function addSubAccountGroup(
  newGroupName: string,
  actions: Actions,
  toast: ToastApi,
  setNewGroupName: (value: string) => void,
) {
  if (!newGroupName.trim()) {
    toast.warning({
      title: '请输入分组名称',
      description: '填写名称后才能创建分组。',
      dedupeKey: 'subaccount-group-name-required',
    })
    return
  }

  const newGroup: SubAccountGroup = {
    id: crypto.randomUUID(),
    name: newGroupName.trim(),
    accountIds: [],
    enabled: true,
  }

  actions.addGroup(newGroup)
  toast.success({
    title: '分组已创建',
    description: `已创建分组“${newGroup.name}”。`,
    dedupeKey: `subaccount-group-added:${newGroup.id}`,
  })
  setNewGroupName('')
}

export function removeSubAccountGroup(groupId: string, actions: Actions, toast: ToastApi) {
  actions.removeGroup(groupId)
  toast.info({
    title: '分组已删除',
    description: '所选分组已移除。',
    dedupeKey: `subaccount-group-removed:${groupId}`,
  })
}

export function toggleSubAccountGroup(groupId: string, enabled: boolean, actions: Actions) {
  actions.updateGroup(groupId, { enabled })
}

export function assignSubAccountToGroup(
  accountId: string,
  groupId: string | undefined,
  actions: Actions,
  toast: ToastApi,
) {
  actions.setAccountGroup(accountId, groupId)
  toast.info({
    title: groupId ? '已加入分组' : '已移出分组',
    description: groupId ? '小号分组已更新。' : '小号已从当前分组移除。',
    dedupeKey: `subaccount-group-assignment:${accountId}`,
  })
}
