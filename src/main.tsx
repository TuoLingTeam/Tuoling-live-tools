import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { ElectronErrorBoundary } from './components/common/ElectronErrorBoundary'
import { initializeTheme } from './hooks/useTheme'
import { router } from './router'
import './index.css'

function renderBootError(container: HTMLElement, message: string) {
  const errorBox = document.createElement('div')
  errorBox.style.padding = '20px'
  errorBox.style.fontFamily = 'system-ui'
  errorBox.style.whiteSpace = 'pre-wrap'
  errorBox.textContent = message
  container.replaceChildren(errorBox)
}

async function bootstrap() {
  if (import.meta.env.DEV) {
    const warmups = await Promise.allSettled([
      import('./lib/wdyr'),
      // 预热壳层异步 chunk，避免 DEV 首次启动时头部/侧边栏出现明显空白。
      import('./components/auth/AuthProvider'),
      import('./components/common/Sidebar'),
      import('./components/common/AccountSwitcher'),
      import('./components/app/AppRuntimeBoot'),
    ])

    for (const result of warmups) {
      if (result.status === 'rejected') {
        console.warn('[UI] DEV chunk warmup skipped:', result.reason)
      }
    }
  }

  // 启动诊断：若 Console 有 [UI] 日志说明页面已加载到我们的应用
  console.log('[UI] main.tsx 执行中')

  // 应用持久化主题，避免首屏闪烁
  initializeTheme()

  const rootEl = document.getElementById('root')
  if (!rootEl) {
    console.error('[UI] 未找到 #root，页面结构异常')
    renderBootError(document.body, '[UI] 未找到 #root')
  } else {
    try {
      // 移除 HTML 里的"加载中…"占位，由 React 接管
      const loading = document.getElementById('app-loading')
      if (loading) loading.remove()
      ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
          <ElectronErrorBoundary>
            <RouterProvider router={router} />
          </ElectronErrorBoundary>
        </React.StrictMode>,
      )
      console.log('[UI] React 已挂载')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[UI] 渲染失败', err)
      renderBootError(rootEl, `[UI] 渲染失败: ${msg}`)
    }
  }

  postMessage({ payload: 'removeLoading' }, '*')
}

void bootstrap()
