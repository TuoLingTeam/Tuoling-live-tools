import { useState } from 'react'
import { Title } from '@/components/common/Title'
import { useAutoLoadPlatformPreference } from '@/hooks/usePlatformPreference'
import {
  FeedbackDialog,
  HelpDockTrigger,
  HelpDrawer,
  QuickStartTutorial,
  WechatQRDialog,
} from './components/HelpSidebar'
import InstructionsCard from './components/InstructionsCard'
import StatusCard from './components/StatusCard'

export default function BrowserControl() {
  // 自动加载当前账号的默认平台偏好
  useAutoLoadPlatformPreference()

  // 帮助抽屉状态
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  // 快速上手教程状态
  const [isTutorialOpen, setIsTutorialOpen] = useState(false)

  // 微信二维码弹窗状态
  const [isWechatQROpen, setIsWechatQROpen] = useState(false)

  // 反馈弹窗状态
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)
  const [isFeatureRequestOpen, setIsFeatureRequestOpen] = useState(false)

  const closeHelp = () => setIsHelpOpen(false)
  const toggleHelp = () => setIsHelpOpen(prev => !prev)

  const openTutorial = () => setIsTutorialOpen(true)
  const closeTutorial = () => setIsTutorialOpen(false)

  const openWechatQR = () => setIsWechatQROpen(true)
  const closeWechatQR = () => setIsWechatQROpen(false)

  const openFeedback = () => setIsFeedbackOpen(true)
  const closeFeedback = () => setIsFeedbackOpen(false)
  const openFeatureRequest = () => setIsFeatureRequestOpen(true)
  const closeFeatureRequest = () => setIsFeatureRequestOpen(false)

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div data-tour="live-control" className="flex min-h-full flex-col gap-6 py-6">
          <div className="shrink-0">
            <Title title="直播控制台" description="连接并管理您的直播控制台" />
          </div>

          {/* 主内容区 - 恢复单列布局 */}
          <div className="flex min-h-0 flex-1 flex-col gap-6 min-w-0">
            {/* 控制台状态卡片 */}
            <StatusCard />

            {/* 使用说明卡片 */}
            <InstructionsCard />
          </div>
        </div>
      </div>

      {/* 帮助抽屉触发器 - 吸附在右侧 */}
      <HelpDockTrigger onClick={toggleHelp} isOpen={isHelpOpen} hasNotification={false} />

      {/* 帮助抽屉 */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={closeHelp}
        onOpenTutorial={openTutorial}
        onOpenWechatQR={openWechatQR}
        onOpenFeedback={openFeedback}
        onOpenFeatureRequest={openFeatureRequest}
      />

      {/* 快速上手教程 */}
      <QuickStartTutorial
        isOpen={isTutorialOpen}
        onClose={closeTutorial}
        onStart={() => {
          // 点击"开始设置"后的回调
          // 可以引导用户到第一步：聚焦平台选择或自动打开连接
          console.log('[QuickStart] 用户点击开始设置')
        }}
      />

      {/* 微信二维码弹窗 */}
      <WechatQRDialog isOpen={isWechatQROpen} onClose={closeWechatQR} />

      {/* 问题反馈弹窗 */}
      <FeedbackDialog isOpen={isFeedbackOpen} onClose={closeFeedback} mode="issue" />

      {/* 功能需求弹窗 */}
      <FeedbackDialog isOpen={isFeatureRequestOpen} onClose={closeFeatureRequest} mode="feature" />
    </div>
  )
}
