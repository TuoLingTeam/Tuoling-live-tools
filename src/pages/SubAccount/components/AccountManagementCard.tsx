import { Download, Plus, Trash2, Upload, Users } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { isSameSubAccountLiveRoomUrl } from 'shared/subAccountLiveRoom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  SubAccountGroup,
  SubAccount as SubAccountItem,
  useSubAccountActions,
} from '@/hooks/useSubAccount'
import { cn } from '@/lib/utils'
import {
  type LoginStateBadgeVariant,
  UNGROUPED_SELECT_VALUE,
  VIEWER_PLATFORMS,
  type ViewerPlatformKey,
} from '../constants'

function getLoginStateBadge(account: SubAccountItem) {
  if (account.status === 'connected') {
    return {
      label: account.hasStorageState ? '登录态有效' : '已登录未保存',
      variant: (account.hasStorageState ? 'success' : 'warning') as LoginStateBadgeVariant,
    }
  }

  if (account.hasStorageState && account.status === 'connecting') {
    return {
      label: '校验登录态中',
      variant: 'warning' as LoginStateBadgeVariant,
    }
  }

  if (account.hasStorageState && account.status === 'error') {
    return {
      label: '登录态可能失效',
      variant: 'warning' as LoginStateBadgeVariant,
    }
  }

  if (account.hasStorageState) {
    return {
      label: '已保存登录态',
      variant: 'secondary' as const,
    }
  }

  return {
    label: '未保存登录态',
    variant: 'neutral' as const,
  }
}

function getAccountStatusDotClass(status: SubAccountItem['status']) {
  if (status === 'connected') return 'bg-emerald-400'
  if (status === 'connecting') return 'bg-amber-400 animate-pulse'
  if (status === 'error') return 'bg-red-400'
  return 'bg-muted-foreground/40'
}

type AccountManagementCardProps = {
  accounts: SubAccountItem[]
  groups: SubAccountGroup[]
  selectedGroup: string | null
  setSelectedGroup: (value: string | null) => void
  showGroupManager: boolean
  newGroupName: string
  setNewGroupName: (value: string) => void
  liveRoomUrl: string
  rotateGroups: boolean
  isAdding: boolean
  setIsAdding: (value: boolean) => void
  newAccountName: string
  setNewAccountName: (value: string) => void
  newAccountPlatform: ViewerPlatformKey
  setNewAccountPlatform: (value: ViewerPlatformKey) => void
  actions: ReturnType<typeof useSubAccountActions>
  handleExportAccounts: () => Promise<void>
  handleImportAccounts: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleAddGroup: () => void
  handleRemoveGroup: (groupId: string) => void
  handleToggleGroup: (groupId: string, enabled: boolean) => void
  handleAssignToGroup: (accountId: string, groupId: string | undefined) => void
  handleEnterLiveRoom: (accountId: string) => Promise<void>
  handleClearSavedLoginState: (accountId: string) => Promise<void>
  handleDisconnectAccount: (accountId: string) => Promise<void>
  handleLoginAccount: (accountId: string) => Promise<void>
  handleRemoveAccount: (accountId: string) => Promise<void>
  handleAddAccount: () => Promise<void>
}

export function AccountManagementCard({
  accounts,
  groups,
  selectedGroup,
  setSelectedGroup,
  showGroupManager,
  newGroupName,
  setNewGroupName,
  liveRoomUrl,
  rotateGroups,
  isAdding,
  setIsAdding,
  newAccountName,
  setNewAccountName,
  newAccountPlatform,
  setNewAccountPlatform,
  actions,
  handleExportAccounts,
  handleImportAccounts,
  handleAddGroup,
  handleRemoveGroup,
  handleToggleGroup,
  handleAssignToGroup,
  handleEnterLiveRoom,
  handleClearSavedLoginState,
  handleDisconnectAccount,
  handleLoginAccount,
  handleRemoveAccount,
  handleAddAccount,
}: AccountManagementCardProps) {
  return (
    <Card>
      <CardHeader className="bg-muted/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            小号管理
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleExportAccounts()}
              disabled={accounts.length === 0}
            >
              <Download className="h-4 w-4 mr-1" />
              导出
            </Button>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".json"
                onChange={event => void handleImportAccounts(event)}
                className="hidden"
              />
              <Button variant="ghost" size="sm" asChild>
                <span>
                  <Upload className="h-4 w-4 mr-1" />
                  导入
                </span>
              </Button>
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        {showGroupManager && (
          <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">分组管理</h4>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="分组名称"
                  value={newGroupName}
                  onChange={event => setNewGroupName(event.target.value)}
                  className="w-32 h-8"
                />
                <Button size="sm" onClick={handleAddGroup}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {groups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {groups.map(group => (
                  <div
                    key={group.id}
                    className={`ui-hover-item flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${
                      group.enabled
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <span>{group.name}</span>
                    <span className="text-muted-foreground">({group.accountIds.length})</span>
                    <button
                      onClick={() => handleToggleGroup(group.id, !group.enabled)}
                      className="ui-hover-nav rounded px-1 py-0.5 hover:underline"
                    >
                      {group.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => handleRemoveGroup(group.id)}
                      className="ui-hover-nav rounded px-1 py-0.5 text-destructive hover:underline"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}

            {groups.length > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <Checkbox
                  id="rotateGroups"
                  checked={rotateGroups}
                  onCheckedChange={checked => actions.setRotateGroups(checked === true)}
                />
                <label htmlFor="rotateGroups" className="text-sm">
                  启用分组轮换（按分组顺序使用小号）
                </label>
              </div>
            )}
          </div>
        )}

        {groups.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">筛选:</span>
            <button
              onClick={() => setSelectedGroup(null)}
              className={`ui-hover-nav rounded px-2 py-1 text-sm ${
                selectedGroup === null ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              全部
            </button>
            {groups.map(group => (
              <button
                key={group.id}
                onClick={() => setSelectedGroup(group.id)}
                className={`ui-hover-nav rounded px-2 py-1 text-sm ${
                  selectedGroup === group.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {group.name}
              </button>
            ))}
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="border rounded-lg p-8 text-center space-y-4 bg-muted/20">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium">还没有添加小号</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                添加小号后，可以让它们在直播间发送弹幕进行互动，帮助您活跃直播间气氛
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              添加第一个小号
            </button>
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                已连接
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                连接中
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                未连接
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts
              .filter(account => {
                if (selectedGroup === null) return true
                const group = groups.find(item => item.id === selectedGroup)
                return group?.accountIds.includes(account.id)
              })
              .map(account => {
                const loginStateBadge = getLoginStateBadge(account)

                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          getAccountStatusDotClass(account.status),
                        )}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{account.name}</span>
                          <Badge
                            variant={loginStateBadge.variant}
                            className="px-2 py-0.5 text-[11px] font-medium"
                          >
                            {loginStateBadge.label}
                          </Badge>
                          {account.group && (
                            <Badge variant="secondary" className="px-2 py-0.5 text-[11px]">
                              {account.group}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {VIEWER_PLATFORMS[account.platform as ViewerPlatformKey] ||
                            account.platform}
                          {' · '}
                          {account.status === 'connected'
                            ? '已连接'
                            : account.status === 'connecting'
                              ? account.error || '连接中'
                              : account.status === 'error'
                                ? `错误: ${account.error}`
                                : '未连接'}
                          {account.status === 'connected' && (
                            <span className="ml-2">
                              ·{' '}
                              {account.liveRoomStatus === 'entered' &&
                              isSameSubAccountLiveRoomUrl(account.liveRoomUrl, liveRoomUrl.trim())
                                ? '已进入目标直播间'
                                : account.liveRoomStatus === 'entering'
                                  ? '进入中'
                                  : account.liveRoomStatus === 'error'
                                    ? `进入失败: ${account.lastEnterError || '未知错误'}`
                                    : '未进入直播间'}
                            </span>
                          )}
                          {account.stats.totalSent > 0 && (
                            <span className="ml-2 text-emerald-300">
                              发送{account.stats.successCount}/{account.stats.totalSent}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {groups.length > 0 && (
                        <Select
                          value={
                            groups.find(group => group.accountIds.includes(account.id))?.id ||
                            UNGROUPED_SELECT_VALUE
                          }
                          onValueChange={value =>
                            handleAssignToGroup(
                              account.id,
                              value === UNGROUPED_SELECT_VALUE ? undefined : value,
                            )
                          }
                        >
                          <SelectTrigger className="h-8 min-w-[7rem] text-xs">
                            <SelectValue placeholder="未分组" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNGROUPED_SELECT_VALUE}>未分组</SelectItem>
                            {groups.map(group => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {account.status === 'connected' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleEnterLiveRoom(account.id)}
                            disabled={!liveRoomUrl.trim() || account.liveRoomStatus === 'entering'}
                          >
                            {account.liveRoomStatus === 'entering' ? '进入中...' : '进入直播间'}
                          </Button>
                          {account.hasStorageState && (
                            <Button
                              variant="subtle"
                              size="sm"
                              onClick={() => void handleClearSavedLoginState(account.id)}
                            >
                              清除登录态
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDisconnectAccount(account.id)}
                          >
                            断开
                          </Button>
                        </>
                      )}
                      {account.status !== 'connected' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleLoginAccount(account.id)}
                          disabled={account.status === 'connecting'}
                        >
                          {account.status === 'connecting' ? '验证中...' : '登录'}
                        </Button>
                      )}
                      {account.status !== 'connected' && account.hasStorageState && (
                        <Button
                          variant="subtle"
                          size="sm"
                          onClick={() => void handleClearSavedLoginState(account.id)}
                        >
                          清除登录态
                        </Button>
                      )}
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => void handleRemoveAccount(account.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
          </div>
        )}

        {isAdding ? (
          <div className="flex items-center gap-2 p-3 border rounded-lg">
            <Input
              placeholder="小号名称"
              value={newAccountName}
              onChange={event => setNewAccountName(event.target.value)}
              className="flex-1"
            />
            <Select
              value={newAccountPlatform}
              onValueChange={value => setNewAccountPlatform(value as ViewerPlatformKey)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VIEWER_PLATFORMS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => void handleAddAccount()}>
              确认
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
              取消
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-2" />
            添加小号
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
