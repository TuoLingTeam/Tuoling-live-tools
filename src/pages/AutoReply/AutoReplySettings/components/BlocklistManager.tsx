import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'

export function BlocklistManager() {
  const { updateBlockList, config } = useAutoReplyConfig()
  const blockedUsers = config.blockList
  const [newUser, setNewUser] = useState('')

  const handleAddUser = () => {
    if (!newUser.trim()) {
      return
    }
    const updatedList = [...blockedUsers, newUser.trim()]
    updateBlockList(updatedList)
    setNewUser('')
  }

  const handleRemoveUser = (index: number) => {
    const updatedList = blockedUsers.filter((_, i) => i !== index)
    updateBlockList(updatedList)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">用户屏蔽列表</h3>
          <p className="text-xs text-muted-foreground">列表中的用户不会被自动回复</p>
        </div>
        {blockedUsers.length > 0 ? (
          <span className="text-xs text-muted-foreground">{blockedUsers.length} 人</span>
        ) : null}
      </div>

      <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border bg-background/40 p-2">
        {blockedUsers.length === 0 ? (
          <div className="py-2 text-center text-sm text-muted-foreground">暂无屏蔽用户</div>
        ) : (
          blockedUsers.map((user, index) => (
            <div key={index} className="flex items-center gap-2">
              <div className="min-w-0 flex-1 rounded bg-muted/50 px-2 py-1.5 text-sm">{user}</div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                aria-label={`移除屏蔽用户 ${user}`}
                onClick={() => handleRemoveUser(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="输入用户名..."
          value={newUser}
          onChange={e => setNewUser(e.target.value)}
          className="flex-1"
        />
        <Button variant="outline" onClick={handleAddUser}>
          添加
        </Button>
      </div>
    </div>
  )
}
