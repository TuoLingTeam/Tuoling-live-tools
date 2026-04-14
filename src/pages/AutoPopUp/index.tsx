import { useMemoizedFn } from 'ahooks'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { Title } from '@/components/common/Title'
import { useAccounts } from '@/hooks/useAccounts'
import { useCurrentAutoPopUp, useShortcutListener } from '@/hooks/useAutoPopUp'
import { useAutoStopOnGateLoss } from '@/hooks/useAutoStopOnGateLoss'
import { useLiveFeatureGate } from '@/hooks/useLiveFeatureGate'
import { useTaskManager } from '@/hooks/useTaskManager'
import { stopAllLiveTasks } from '@/utils/stopAllLiveTasks'
import GoodsListCard from './components/GoodsListCard'
import TaskControlCard from './components/TaskControlCard'

export default function AutoPopUp() {
  const isRunning = useCurrentAutoPopUp(context => context.isRunning)
  const { startTask, stopTask } = useTaskManager()
  const gate = useLiveFeatureGate()
  const currentAccountId = useAccounts(state => state.currentAccountId)
  const [searchParams] = useSearchParams()
  const editGoodsId = useMemo(() => {
    const raw = searchParams.get('editGoodsId')
    if (!raw) return null
    const parsed = Number.parseInt(raw, 10)
    return Number.isNaN(parsed) ? null : parsed
  }, [searchParams])
  const assistContext = useMemo(
    () => ({
      title: searchParams.get('assistTitle'),
      description: searchParams.get('assistDescription'),
      sampleQuestion: searchParams.get('assistQuestion'),
      sampleAnswer: searchParams.get('assistAnswer'),
      filter: searchParams.get('assistFilter'),
    }),
    [searchParams],
  )

  // 自动停机：当 Gate 条件不满足时，自动停止任务
  useAutoStopOnGateLoss({
    gate,
    taskIsRunning: isRunning,
    stopAll: useMemoizedFn(async reason => {
      await stopAllLiveTasks(currentAccountId, reason, false)
    }),
  })

  const handleTaskButtonClick = useMemoizedFn(async () => {
    if (!isRunning) {
      await startTask('autoPopup')
    } else {
      await stopTask('autoPopup', 'manual')
    }
  })

  useShortcutListener()

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-6 py-6">
          <div className="shrink-0">
            <Title title="自动弹窗" description="配置自动弹出商品的规则" />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-6 min-w-0">
            {/* 任务控制卡片（包含弹窗间隔、随机弹窗） */}
            <TaskControlCard
              isRunning={isRunning}
              gate={gate}
              onStartStop={handleTaskButtonClick}
            />

            {/* 商品列表卡片 */}
            <GoodsListCard
              initialEditingGoodsId={editGoodsId}
              initialAssistContext={assistContext}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
