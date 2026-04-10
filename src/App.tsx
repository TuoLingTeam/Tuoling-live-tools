import { RefreshCwIcon, TerminalIcon } from 'lucide-react'
import { Outlet } from 'react-router'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { DefaultErrorFallback, ErrorBoundary } from '@/components/common/ErrorBoundary'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/toaster'
import { useDevMode } from '@/hooks/useDevMode'
import { Header } from './components/common/Header'
import './App.css'
import React, { lazy, Suspense, useEffect, useState } from 'react'
import {
  getQuickStartCompleted,
  getWelcomeCompleted,
  setQuickStartCompleted,
  setWelcomeCompleted,
} from '@/constants/authStorageKeys'
import { configSyncService } from '@/services/configSyncService'
import { useAuthCheckDone, useIsAuthenticated } from '@/stores/authStore'
import { useAccounts } from './hooks/useAccounts'
import { useLiveControlStore } from './hooks/useLiveControl'
import { useToast } from './hooks/useToast'

const UpdateDialog = lazy(async () => {
  const module = await import('./components/update/UpdateDialog')
  return { default: module.UpdateDialog }
})

const WelcomeDialog = lazy(async () => {
  const module = await import('@/components/onboarding/WelcomeDialog')
  return { default: module.WelcomeDialog }
})

const QuickStartDialog = lazy(async () => {
  const module = await import('@/components/onboarding/QuickStartDialog')
  return { default: module.QuickStartDialog }
})

const AppRuntimeBoot = lazy(async () => import('@/components/app/AppRuntimeBoot'))

const Sidebar = lazy(async () => import('@/components/common/Sidebar'))
const AccountStatusDock = lazy(async () => import('@/components/account/AccountStatusDock'))

const AuthProvider = lazy(async () => {
  const module = await import('@/components/auth/AuthProvider')
  return { default: module.AuthProvider }
})

function AppBootFallback() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      <Skeleton className="h-8 w-8 rounded-full" />
      <span className="text-muted-foreground text-sm">加载中…</span>
    </div>
  )
}

function SidebarFallback() {
  return (
    <aside
      className="relative z-[1] flex w-16 min-w-16 flex-col md:w-56 md:min-w-[14rem]"
      style={{
        backgroundColor: 'var(--sidebar-bg)',
        boxShadow: 'var(--sidebar-edge-shadow)',
      }}
    >
      <div className="flex-1 px-2 py-5 md:px-4">
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 md:justify-start"
            >
              <Skeleton className="h-5 w-5 rounded-md" />
              <Skeleton className="hidden h-4 w-20 rounded md:block" />
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-border/40 px-2 py-3 md:px-4">
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-center gap-3 rounded-lg px-3 py-2 md:justify-start"
            >
              <Skeleton className="h-4 w-4 rounded-md" />
              <Skeleton className="hidden h-4 w-16 rounded md:block" />
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function AppContent() {
  const { enabled: devMode } = useDevMode()
  const { accounts, currentAccountId } = useAccounts()
  // 【修复】直接解构 setConnectState，避免 selector 返回新对象导致无限循环
  const setConnectState = useLiveControlStore(state => state.setConnectState)

  // Check if running in Electron environment
  useEffect(() => {
    if (!window.ipcRenderer && import.meta.env.DEV) {
      console.warn('[UI] window.ipcRenderer is unavailable in browser-only DEV preview.')
    }
  }, [])

  // 修复：只在 currentAccountId 变化时执行，避免 accounts 数组引用变化导致的无限循环
  // 使用 useRef 跟踪上一次的 account，只在 account 真正变化时才执行 IPC 调用
  const prevAccountIdRef = React.useRef<string | null>(null)
  const prevAccountRef = React.useRef<{ id: string; name: string } | null>(null)

  useEffect(() => {
    // 如果 currentAccountId 没有变化，不执行
    if (prevAccountIdRef.current === currentAccountId) {
      return
    }

    const account = accounts.find(acc => acc.id === currentAccountId)

    // 如果找到了账号，且账号信息有变化，才执行 IPC 调用
    if (account && window.ipcRenderer) {
      // 检查账号信息是否真的变化了（避免相同账号的重复调用）
      const accountChanged =
        !prevAccountRef.current ||
        prevAccountRef.current.id !== account.id ||
        prevAccountRef.current.name !== account.name

      if (accountChanged) {
        window.ipcRenderer.invoke(IPC_CHANNELS.account.switch, { account })
        // 【修复】切换账号时，只重置临时状态（如 connecting），保留已连接状态
        // 避免持久化的临时状态影响新账号，但保持已连接账号的状态显示
        const currentState = useLiveControlStore.getState().contexts[account.id]?.connectState
        if (currentState?.status === 'connecting' || currentState?.status === 'reconnecting') {
          // 如果状态是 connecting，重置为 disconnected（防止无效状态残留）
          setConnectState(account.id, {
            status: 'disconnected',
            phase: 'idle',
            error: null,
            session: null,
            lastVerifiedAt: null,
          })
        }
        // 注意：如果状态是 connected，保持原状态，不重置
        // 这样切换回已连接的账号时，状态显示正确
        prevAccountRef.current = { id: account.id, name: account.name }
      }
    }

    prevAccountIdRef.current = currentAccountId
    // 只依赖 currentAccountId，不依赖 accounts 数组（避免数组引用变化导致的循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentAccountId,
    accounts.find,
    // 避免持久化的旧状态（如 connecting）影响新账号
    // 注意：只重置当前账号的 UI 状态，不影响其他账号的后台连接/任务
    setConnectState,
    accounts,
  ])

  const handleRefresh = () => {
    window.location.reload()
  }

  const handleToggleDevTools = async () => {
    if (window.ipcRenderer) {
      await window.ipcRenderer.invoke(IPC_CHANNELS.chrome.toggleDevTools)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger disabled={!devMode} className="min-h-screen">
          <div
            className="flex flex-col h-screen overflow-hidden"
            style={{ backgroundColor: 'var(--app-bg)' }}
          >
            <Suspense fallback={null}>
              <AppRuntimeBoot />
            </Suspense>

            {/* 头部标题：固定高度；主内容区高度 = 100vh - 头部 - 底部日志，无全局滚动 */}
            <Header />

            <div className="flex flex-1 min-h-0 overflow-hidden gap-0">
              {/* 侧边栏 */}
              <Suspense fallback={<SidebarFallback />}>
                <Sidebar />
              </Suspense>

              <main
                className="min-h-0 flex-1 flex flex-col overflow-hidden p-3 md:p-6"
                style={{
                  backgroundColor: 'var(--content-bg)',
                  borderTopLeftRadius: '1rem',
                  boxShadow: 'var(--content-edge-shadow)',
                  paddingBottom: 'calc(env(safe-area-inset-bottom) + 3rem)',
                }}
              >
                <div className="mx-auto w-full max-w-full xl:max-w-7xl 2xl:max-w-screen-2xl flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <Suspense
                      fallback={
                        <div className="flex flex-1 min-h-0 flex-col gap-4 py-2">
                          <Skeleton className="h-8 w-48 rounded-lg" />
                          <div className="grid gap-4 md:grid-cols-2">
                            <Skeleton className="h-40 rounded-2xl" />
                            <Skeleton className="h-40 rounded-2xl" />
                          </div>
                          <Skeleton className="h-56 rounded-2xl" />
                        </div>
                      }
                    >
                      {/* 全屏页(如自动回复)用 h-full 填满后内部滚动；其它页内容过长时此层滚动 */}
                      <div className="h-full min-h-0 overflow-y-auto">
                        <Outlet />
                      </div>
                    </Suspense>
                  </div>
                </div>
              </main>
            </div>

            <Suspense fallback={null}>
              <AccountStatusDock />
            </Suspense>

            <Suspense fallback={null}>
              <UpdateDialog />
            </Suspense>
          </div>
        </ContextMenuTrigger>
        {devMode && (
          <ContextMenuContent>
            <ContextMenuItem onClick={handleRefresh}>
              <RefreshCwIcon className="mr-2 h-4 w-4" />
              <span>刷新页面</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleToggleDevTools}>
              <TerminalIcon className="mr-2 h-4 w-4" />
              <span>开发者工具</span>
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      <Toaster />
    </>
  )
}

function AppWithOnboarding() {
  const [showWelcome, setShowWelcome] = useState(false)
  const [showQuickStart, setShowQuickStart] = useState(false)
  const isAuthenticated = useIsAuthenticated()
  const authCheckDone = useAuthCheckDone()
  const { toast } = useToast()

  // 首次启动显示欢迎引导
  useEffect(() => {
    if (authCheckDone && !isAuthenticated) {
      const hasCompleted = getWelcomeCompleted()
      if (!hasCompleted) {
        setShowWelcome(true)
      }
    }
  }, [authCheckDone, isAuthenticated])

  // 首次登录后显示快速开始引导
  useEffect(() => {
    if (isAuthenticated) {
      const hasCompletedQuickStart = getQuickStartCompleted()
      if (!hasCompletedQuickStart) {
        setShowQuickStart(true)
      }
    }
  }, [isAuthenticated])

  // 【跨设备同步】认证完成后设置自动同步，并立即从云端加载配置
  const hasLoadedFromCloudRef = React.useRef(false)
  useEffect(() => {
    if (authCheckDone && isAuthenticated) {
      // 设置自动同步（监听配置变化并上传）
      const cleanup = configSyncService.setupAutoSync()

      // 【修复】登录成功后立即从云端加载配置（只执行一次）
      if (!hasLoadedFromCloudRef.current) {
        hasLoadedFromCloudRef.current = true
        configSyncService
          .loadFromCloud()
          .then(() => {})
          .catch(err => {
            console.error('[App] Failed to load config from cloud:', err)
          })
      }

      return cleanup
    }
  }, [authCheckDone, isAuthenticated])

  const handleWelcomeClose = () => {
    setShowWelcome(false)
    setWelcomeCompleted(true)
  }

  const handleWelcomeStart = () => {
    setShowWelcome(false)
    setWelcomeCompleted(true)
    // 触发登录对话框
    window.dispatchEvent(new CustomEvent('auth:required', { detail: { feature: 'login' } }))
  }

  const handleQuickStartClose = () => {
    setShowQuickStart(false)
    setQuickStartCompleted(true)
  }

  const handleQuickStartConnect = () => {
    setShowQuickStart(false)
    setQuickStartCompleted(true)
    // 触发连接中控台
    window.dispatchEvent(new CustomEvent('live-control:connect-required'))
    toast.success('请点击左侧「打开中控台」开始连接')
  }

  return (
    <>
      <AppContent />
      <Suspense fallback={null}>
        <WelcomeDialog
          isOpen={showWelcome}
          onClose={handleWelcomeClose}
          onStart={handleWelcomeStart}
        />
      </Suspense>
      <Suspense fallback={null}>
        <QuickStartDialog
          isOpen={showQuickStart}
          onClose={handleQuickStartClose}
          onConnect={handleQuickStartConnect}
        />
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary fallback={DefaultErrorFallback}>
      <Suspense fallback={<AppBootFallback />}>
        <AuthProvider>
          <AppWithOnboarding />
        </AuthProvider>
      </Suspense>
    </ErrorBoundary>
  )
}
