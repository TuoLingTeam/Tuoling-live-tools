import { BookOpen, Check, Minus } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// 平台功能支持数据
const PLATFORM_FEATURES = [
  { name: '抖音', autoReply: true, autoMessage: true, autoPopup: true, dataMonitor: true },
  { name: '抖音百应', autoReply: true, autoMessage: true, autoPopup: true, dataMonitor: true },
  { name: '视频号', autoReply: true, autoMessage: true, autoPopup: true, dataMonitor: true },
  { name: '小红书', autoReply: true, autoMessage: true, autoPopup: false, dataMonitor: true },
  { name: '淘宝', autoReply: true, autoMessage: true, autoPopup: false, dataMonitor: true },
  { name: '快手', autoReply: false, autoMessage: true, autoPopup: false, dataMonitor: false },
  { name: '抖店 EOS', autoReply: false, autoMessage: true, autoPopup: false, dataMonitor: false },
]

// 平台支持表格组件
function PlatformSupportTable() {
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-foreground">平台</th>
            <th className="px-3 py-3 text-center font-medium text-foreground">自动回复</th>
            <th className="px-3 py-3 text-center font-medium text-foreground">自动发言</th>
            <th className="px-3 py-3 text-center font-medium text-foreground">自动弹窗</th>
            <th className="px-3 py-3 text-center font-medium text-foreground">数据监控</th>
          </tr>
        </thead>
        <tbody>
          {PLATFORM_FEATURES.map((platform, index) => (
            <tr
              key={platform.name}
              className={cn(
                'border-t border-border transition-colors hover:bg-muted/30',
                index % 2 === 0 ? 'bg-background' : 'bg-muted/10',
              )}
            >
              <td className="px-4 py-2.5 font-medium text-foreground">{platform.name}</td>
              <td className="px-3 py-2.5 text-center">
                <FeatureIcon supported={platform.autoReply} />
              </td>
              <td className="px-3 py-2.5 text-center">
                <FeatureIcon supported={platform.autoMessage} />
              </td>
              <td className="px-3 py-2.5 text-center">
                <FeatureIcon supported={platform.autoPopup} />
              </td>
              <td className="px-3 py-2.5 text-center">
                <FeatureIcon supported={platform.dataMonitor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeatureIcon({ supported }: { supported: boolean }) {
  return supported ? (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
      <Check className="w-4 h-4" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-muted">
      <Minus className="w-4 h-4 text-muted-foreground" />
    </span>
  )
}

// 用户使用手册内容
const USER_GUIDE_CONTENT = `## 一、账号注册与登录

### 1.1 注册账号

1. 首次打开软件，点击 **「登录」** 按钮
2. 在弹窗底部点击 **「立即注册」**
3. 填写信息：
   - **手机号/邮箱**：输入有效的手机号或邮箱
   - **密码**：至少8位字符
   - **确认密码**：与密码保持一致
4. 点击 **「注册」** 完成

### 1.2 登录账号

1. 输入**手机号/邮箱**和**密码**
2. 勾选 **「记住登录状态」**（可选）
3. 点击 **「登录」** 进入主界面

---

## 二、功能模块使用指南

### 2.1 直播中控台（必须先连接）

**功能**：连接直播中控台，是使用其他功能的前提。

**操作步骤**：
1. 点击左侧 **「🎛️ 打开中控台」**
2. 选择直播平台（抖音/视频号/小红书/淘宝等）
3. 点击 **「连接中控台」**
4. 在弹出的浏览器中登录平台账号
5. 返回软件，显示 **「已连接」** 即可

**状态说明**：🔴未连接 | 🟡连接中 | 🟢已连接

---

### 2.2 自动发言

**功能**：自动发送预设消息。

**操作步骤**：
1. 点击左侧 **「💬 自动发言」**
2. 添加消息：点击 **「+ 添加新消息」**，输入内容后保存
3. 设置参数：
   - **发送间隔**：建议30-60秒
   - **随机发送**：勾选后随机选择消息
4. 点击 **「🟢 开始任务」** 启动

> 💡 **一键刷屏**：快速连续发送所有消息

---

### 2.3 自动弹窗

**功能**：自动弹出商品讲解窗口。

**操作步骤**：
1. 点击左侧 **「🖼️ 自动弹窗」**
2. 添加商品：点击 **「+ 添加商品」**，输入名称并设置快捷键
3. 配置参数：
   - **弹窗间隔**：建议60-120秒
   - **随机弹窗**：勾选后随机选择商品
   - **全局快捷键**：建议开启
4. 点击 **「🟢 开始任务」** 启动

**手动触发**：按设置的快捷键（如F1、F2）立即弹窗

---

### 2.4 自动回复

**功能**：自动监听评论并回复。

> ⚠️ 仅支持抖音、视频号、小红书、淘宝平台

**操作步骤**：
1. 点击左侧 **「🤖 自动回复」**
2. 点击 **「⚙️ 设置」** 配置规则：
   - **关键词回复**：设置触发词和回复内容
   - **AI回复**（可选）：选择AI服务商并配置API Key
   - **监听源**：根据平台选择（中控台/罗盘大屏/视频号/小红书）
3. 返回主界面，点击 **「🟢 开始任务」**

---

### 2.5 数据监控

**功能**：实时监控直播数据，支持导出。

> ⚠️ 需先连接中控台并启动自动回复

**操作步骤**：
1. 点击左侧 **「📊 数据监控」**
2. 点击 **「🟢 开始监控」**
3. 切换标签页查看：弹幕监控 / 粉丝团变化 / 事件时间线
4. 直播结束后点击 **「导出 CSV」** 保存默认文件；如需多工作表分析可选择 **「导出 Excel」**

---

### 2.6 AI助手

**功能**：AI对话获取直播建议。

**操作步骤**：
1. 点击左侧 **「🧠 AI助手」**
2. 首次使用点击 **「🔑 API设置」**：
   - 选择AI服务商（DeepSeek/OpenRouter/硅基流动等）
   - 输入API Key并测试连接
3. 在输入框提问，按 **Enter** 发送

**示例问题**：
- "怎么提高直播间人气？"
- "帮我写一段商品介绍"

---

### 2.7 应用设置

**功能**：管理应用配置。

**入口**：点击左侧 **「⚙️ 应用设置」**

**常用设置**：
- **浏览器路径**：保持默认
- **自动检查更新**：建议开启
- **退出登录**：切换账号时使用

---

## 三、功能依赖关系

\`\`\`
账号登录 → 直播控制台（必须先连接）
              ↓
    ┌─────────┼─────────┐
    ↓         ↓         ↓
 自动发言   自动弹窗   自动回复
    └─────────┬─────────┘
              ↓
          数据监控
\`\`\`

---

## 四、常见问题

| 问题 | 解决方法 |
|------|----------|
| 无法连接中控台 | 检查网络 → 重新连接 → 重启软件 |
| 自动功能无反应 | 确认已连接中控台 → 检查任务是否启动 → 确认列表不为空 |
| 自动回复不监听 | 选择正确的监听源 → 重新连接中控台 |
| AI助手不回复 | 检查API Key → 测试连接 → 切换服务商 |
| 软件卡顿 | 重启软件 → 关闭其他程序 → 检查更新 |

---

## 五、技术支持

| 方式 | 联系方式 | 说明 |
|------|----------|------|
| **邮箱** | support@xiuer.work | 工作日9:00-18:00，24小时内回复 |
| **微信** | 帮助与支持页面扫码 | 添加时备注「秀儿直播助手+问题简述」 |
| **帮助中心** | 点击「❓ 帮助与支持」 | 查看常见问题解答 |

---

## 六、使用技巧

**直播前**：
- 提前10分钟连接中控台
- 测试自动发言和弹窗功能
- 准备好话术和商品快捷键

**直播中**：
- 关注左侧导航栏绿色指示点
- 适时调整发送间隔
- 人工互动配合自动功能

**直播后**：
- 及时导出数据保存
- 分析弹幕优化话术

---

**祝您直播大卖！** 🎉
`

interface UserGuideDialogProps {
  trigger?: React.ReactNode
  className?: string
}

export function UserGuideDialog({ trigger, className }: UserGuideDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className={cn('gap-1.5', className)}>
            <BookOpen className="h-3.5 w-3.5" />
            使用教程
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5 text-primary" />
              使用教程
            </DialogTitle>
          </div>
        </DialogHeader>
        <ScrollArea className="flex-1 px-6 py-4">
          <div className="prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-table:my-2">
            {/* 标题和介绍 */}
            <h1 className="text-xl font-bold text-foreground border-b pb-2 mb-4">
              秀儿Xiuer直播助手 - 用户操作手册
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              欢迎使用秀儿Xiuer直播助手！本工具帮助主播提升直播效率，实现自动化运营。
            </p>

            {/* 支持平台（自定义组件） */}
            <h2 className="text-lg font-semibold text-foreground mt-6 mb-3 flex items-center gap-2">
              支持平台
            </h2>
            <PlatformSupportTable />

            <hr className="my-4 border-border" />

            {/* 其余 Markdown 内容 */}
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold text-foreground border-b pb-2 mb-4">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold text-foreground mt-6 mb-3 flex items-center gap-2">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-medium text-foreground mt-4 mb-2">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="text-sm text-muted-foreground space-y-1 ml-4 list-decimal">
                    {children}
                  </ol>
                ),
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">{children}</strong>
                ),
                hr: () => <hr className="my-4 border-border" />,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="w-full text-sm border-collapse border border-border rounded-lg overflow-hidden">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
                th: ({ children }) => (
                  <th className="border border-border px-3 py-2 text-left font-medium">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border px-3 py-2">{children}</td>
                ),
                code: ({ children }) => (
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                    {children}
                  </code>
                ),
              }}
            >
              {USER_GUIDE_CONTENT}
            </ReactMarkdown>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
