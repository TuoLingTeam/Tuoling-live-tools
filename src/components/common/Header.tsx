import { User } from 'lucide-react'
import { lazy, memo, Suspense, useCallback } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/authStore'
import { ThemeSelector } from './ThemeSelector'

const UpdateStatusChip = lazy(async () => {
  const module = await import('@/components/update/UpdateStatusChip')
  return { default: module.UpdateStatusChip }
})

const MessageCenterButton = lazy(async () => {
  const module = await import('./MessageCenterButton')
  return { default: module.MessageCenterButton }
})

const AccountSwitcher = lazy(async () => {
  const module = await import('./AccountSwitcher')
  return { default: module.AccountSwitcher }
})

export const Header = memo(function Header() {
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)

  const handleOpenUserCenter = useCallback(() => {
    window.dispatchEvent(new CustomEvent('auth:user-center'))
  }, [])

  const handleLoginClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('auth:required', { detail: { feature: 'login' } }))
  }, [])

  return (
    <header
      className="relative z-10 flex h-[3.75rem] min-h-[3.75rem] w-full shrink-0 items-center justify-between gap-3 px-3 md:px-6"
      style={{
        backgroundColor: 'var(--header-bg)',
        boxShadow: 'var(--header-top-shadow), var(--header-separator)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center overflow-hidden">
          <img src="./favicon.svg" alt="秀儿直播助手标志" className="h-full w-full" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1
            className="truncate text-sm font-semibold tracking-tight sm:text-lg"
            style={{ color: 'var(--text-primary)' }}
          >
            秀儿直播助手
          </h1>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <Suspense fallback={null}>
          <UpdateStatusChip />
        </Suspense>
        <ThemeSelector />
        <Suspense fallback={null}>
          <MessageCenterButton />
        </Suspense>

        <div data-tour="account-switcher" className="w-[8.5rem] md:w-[12.5rem]">
          <Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
            <AccountSwitcher />
          </Suspense>
        </div>

        {isAuthenticated && user ? (
          <div
            className="flex h-9 items-center rounded-lg px-2"
            style={{
              backgroundColor: 'var(--header-action-bg)',
              border: '1px solid var(--header-action-border)',
              color: 'var(--header-action-fg)',
            }}
          >
            <button
              type="button"
              onClick={handleOpenUserCenter}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-[var(--header-action-fg)] transition-colors duration-150 hover:bg-[color:var(--sidebar-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--header-action-bg)]"
              style={{
                color: 'var(--header-action-fg)',
              }}
            >
              <User className="h-4 w-4" />
              <span className="max-w-[5.5rem] truncate text-sm font-medium md:max-w-[7.5rem]">
                {user.username}
              </span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleLoginClick}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-[var(--primary-hover)] active:bg-[var(--primary-pressed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <User className="h-4 w-4" />
            <span>登录</span>
          </button>
        )}
      </div>
    </header>
  )
})
