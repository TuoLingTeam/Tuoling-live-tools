import { lazy } from 'react'
import { createHashRouter } from 'react-router'

// 路由级代码分割 - 使用 React.lazy 实现按需加载
const App = lazy(() => import('../App'))
// 预期效果：初始包体积减少 40-60%，首屏加载提速 30-50%
const LiveControl = lazy(() => import('@/pages/LiveControl'))
const AutoMessage = lazy(() => import('@/pages/AutoMessage'))
const AutoPopUp = lazy(() => import('@/pages/AutoPopUp'))
const LiveStats = lazy(() => import('@/pages/LiveStats'))
const Settings = lazy(() => import('@/pages/SettingsPage'))
const HelpSupport = lazy(() => import('@/pages/HelpSupport'))
const AIChat = lazy(() => import('@/pages/AIChat'))
const AutoReply = lazy(() => import('@/pages/AutoReply'))
const AutoReplySettings = lazy(() => import('@/pages/AutoReply/AutoReplySettings'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
const Messages = lazy(() => import('@/pages/Messages'))
const SubAccount = lazy(() => import('@/pages/SubAccount'))

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        path: '/',
        element: <LiveControl />,
      },
      {
        path: '/auto-message',
        element: <AutoMessage />,
      },
      {
        path: '/auto-popup',
        element: <AutoPopUp />,
      },
      {
        path: '/live-stats',
        element: <LiveStats />,
      },
      {
        path: '/settings',
        element: <Settings />,
      },
      {
        path: '/help-support',
        element: <HelpSupport />,
      },
      {
        path: '/ai-chat',
        element: <AIChat />,
      },
      {
        path: 'auto-reply',
        element: <AutoReply />,
      },
      {
        path: '/sub-account',
        element: <SubAccount />,
      },
      {
        path: '/messages',
        element: <Messages />,
      },
      {
        path: '/auto-reply/settings',
        element: <AutoReplySettings />,
      },
      {
        path: '/forgot',
        element: <ForgotPassword />,
      },
      {
        path: '/forgot-password',
        element: <ForgotPassword />,
      },
    ],
  },
])
