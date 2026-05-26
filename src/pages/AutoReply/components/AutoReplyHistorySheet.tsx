import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  KeyRound,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { isPersistableAutoReplyViewerComment } from '@/hooks/autoReplyCommentShared'
import { stripMentionedReplyContent } from '@/hooks/autoReplyRuntime'
import type { AutoReplyContext } from '@/hooks/autoReplyStoreHelpers'
import type { Message, ReplyPreview } from '@/hooks/autoReplyTypes'
import { useAIChatStore } from '@/hooks/useAIChat'
import type { AutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { cn } from '@/lib/utils'
import {
  formatAutoReplyConversationTime,
  getAutoReplyHistoryRuleCandidateState,
  getAutoReplyHistorySemanticGroupKey,
  getAutoReplyHistorySemanticKeywordAliases,
  getAutoReplyMessageDetail,
  getAutoReplyMessageDisplayName,
  getAutoReplyMessageSortTime,
  isAutoReplyTextComment,
  normalizeAutoReplyHistoryQuestionKey,
} from './autoReplyWorkbenchModel'

const ALL_HISTORY_SCOPE = 'all'
const EMPTY_ACCOUNT_CONFIGS: Record<string, AutoReplyConfig | undefined> = {}
const MAX_AI_GROUPING_ITEMS = 240
const MAX_HISTORY_KEYWORDS = 24
const HISTORY_BROAD_KEYWORDS = new Set([
  '可以吗',
  '能用吗',
  '好用吗',
  '有用吗',
  '这个可以吗',
  '这个能用吗',
  '真的吗',
  '是真的吗',
  '多少钱',
  '价格',
  '有没有',
  '还有吗',
])

type HistoryMode = 'candidates' | 'all'

export type AutoReplyHistoryAccount = {
  accountId: string
  accountName: string
  platformLabel: string
  comments: Message[]
  replies: ReplyPreview[]
  historySessions: AutoReplyContext['historySessions']
  currentSessionStartedAt: string | null
  currentSessionEndedAt: string | null
}

type HistoryRow = {
  key: string
  accountId: string
  accountName: string
  platformLabel: string
  comment: Message
  reply?: ReplyPreview
  sessionLabel: string
  sortTime: number
  timeLabel: string
}

type EnrichedHistoryRow = HistoryRow & {
  candidate: ReturnType<typeof getAutoReplyHistoryRuleCandidateState>
  relatedRows?: EnrichedHistoryRow[]
  questionSamples?: string[]
  aiReplyDraft?: string
}

type HistoryDraftState = {
  rowKey: string
  keywords: string
  content: string
}

export type AutoReplyHistoryKeywordRuleDraft = {
  accountId: string
  commentId: string
  commentText: string
  keywords: string[]
  contents: string[]
}

type HistoryAiInputItem = {
  id: string
  accountId: string
  accountName: string
  semanticKey: string
  text: string
  count: number
  rowKeys: string[]
  replyContent?: string
}

type HistoryAiGroup = {
  title: string
  representativeQuestion: string
  keywords: string[]
  sampleComments: string[]
  itemIds: string[]
  replyDraft?: string
  reason?: string
}

type HistoryAiGroupingState = {
  key: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  groups: HistoryAiGroup[]
  error?: string
}

function formatHistoryDate(value?: string | null) {
  if (!value) return '当前场次'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '当前场次'
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseTimeOnSessionDate(value: string | undefined, sessionStartedAt: string | null) {
  const clockMatch = value?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i)
  if (!clockMatch) return null

  const anchor = sessionStartedAt ? new Date(sessionStartedAt) : new Date()
  if (Number.isNaN(anchor.getTime())) return null

  const meridiem = clockMatch[4]?.toUpperCase()
  let hours = Number(clockMatch[1])
  if (meridiem === 'PM' && hours < 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0
  anchor.setHours(hours, Number(clockMatch[2]), Number(clockMatch[3] ?? 0), 0)
  return anchor.getTime()
}

function getHistoryRowSortTime(
  comment: Message,
  sessionStartedAt: string | null,
  fallbackOrder: number,
) {
  const parsed = comment.time ? new Date(comment.time).getTime() : Number.NaN
  if (!Number.isNaN(parsed)) return parsed
  return (
    parseTimeOnSessionDate(comment.time, sessionStartedAt) ??
    getAutoReplyMessageSortTime(comment, fallbackOrder)
  )
}

function buildHistoryRows(accounts: AutoReplyHistoryAccount[]) {
  const rows: HistoryRow[] = []

  accounts.forEach((account, accountIndex) => {
    const seenCommentIds = new Set<string>()
    const repliesByCommentId = new Map<string, ReplyPreview>()
    for (const reply of [
      ...account.replies,
      ...account.historySessions.flatMap(session => session.replies),
    ]) {
      if (!repliesByCommentId.has(reply.commentId)) {
        repliesByCommentId.set(reply.commentId, reply)
      }
    }

    const addRows = (params: {
      comments: Message[]
      sessionLabel: string
      sessionStartedAt: string | null
      sourceOrder: number
    }) => {
      params.comments.forEach((comment, commentIndex) => {
        if (
          !isAutoReplyTextComment(comment) ||
          !isPersistableAutoReplyViewerComment(comment, account.accountName)
        ) {
          return
        }
        const rowKey = `${account.accountId}:${comment.msg_id}`
        if (seenCommentIds.has(rowKey)) return
        seenCommentIds.add(rowKey)

        const fallbackOrder =
          (accounts.length - accountIndex) * 100000 +
          (params.sourceOrder + 1) * 1000 +
          params.comments.length -
          commentIndex

        rows.push({
          key: rowKey,
          accountId: account.accountId,
          accountName: account.accountName,
          platformLabel: account.platformLabel,
          comment,
          reply: repliesByCommentId.get(comment.msg_id),
          sessionLabel: params.sessionLabel,
          sortTime: getHistoryRowSortTime(comment, params.sessionStartedAt, fallbackOrder),
          timeLabel: formatAutoReplyConversationTime(comment.time),
        })
      })
    }

    addRows({
      comments: account.comments,
      sessionLabel: `当前场次 · ${formatHistoryDate(account.currentSessionStartedAt)}`,
      sessionStartedAt: account.currentSessionStartedAt,
      sourceOrder: account.historySessions.length + 1,
    })

    account.historySessions.forEach((session, sessionIndex) => {
      addRows({
        comments: session.comments,
        sessionLabel: `历史场次 · ${formatHistoryDate(session.startedAt)}`,
        sessionStartedAt: session.startedAt,
        sourceOrder: account.historySessions.length - sessionIndex,
      })
    })
  })

  return rows.sort((left, right) => {
    if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
    return left.key.localeCompare(right.key)
  })
}

function filterHistoryRows<T extends HistoryRow>(rows: T[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return rows

  return rows.filter(row => {
    const text = [
      row.accountName,
      row.platformLabel,
      getAutoReplyMessageDisplayName(row.comment),
      getAutoReplyMessageDetail(row.comment),
      row.reply?.replyContent,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return text.includes(normalizedQuery)
  })
}

function getReplyBadge(reply?: ReplyPreview) {
  if (reply?.isSent) return { label: '已回复', variant: 'success' as const }
  if (reply) return { label: '有建议', variant: 'info' as const }
  return { label: '未回复', variant: 'neutral' as const }
}

function splitKeywordDraft(value: string) {
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const item of value.split(/[、,，/\n]+/u)) {
    const keyword = item.trim()
    const key = keyword.replace(/\s+/g, '')
    if (!keyword || seen.has(key)) continue
    seen.add(key)
    keywords.push(keyword)
    if (keywords.length >= MAX_HISTORY_KEYWORDS) break
  }

  return keywords
}

function uniqueHistoryTexts(values: string[], limit = 8) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    const key = normalized.replace(/\s+/g, '').toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= limit) break
  }

  return result
}

function normalizeHistoryKeywordKey(value: string) {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function isBroadHistoryKeyword(value: string) {
  const key = normalizeHistoryKeywordKey(value)
  if (key.length <= 1) return true
  if (HISTORY_BROAD_KEYWORDS.has(key)) return true
  return /^(这个|那个|这款|那款)?(可以|能用|好用|有用|多少钱|价格|怎么用)(吗|不)?$/u.test(key)
}

function getHistoryDraftKeywordWarnings(keywords: string[], config?: AutoReplyConfig) {
  const existingKeywordKeys = new Set<string>()

  for (const rule of config?.comment.keywordReply.rules ?? []) {
    for (const keyword of rule.keywords) {
      const key = normalizeHistoryKeywordKey(keyword)
      if (key) existingKeywordKeys.add(key)
    }
  }

  return {
    duplicates: uniqueHistoryTexts(
      keywords.filter(keyword => existingKeywordKeys.has(normalizeHistoryKeywordKey(keyword))),
      10,
    ),
    broad: uniqueHistoryTexts(
      keywords.filter(keyword => isBroadHistoryKeyword(keyword)),
      10,
    ),
  }
}

function getHistoryRowGroupRows(row: EnrichedHistoryRow) {
  return row.relatedRows?.length ? row.relatedRows : [row]
}

function getHistoryRowGroupReply(row: EnrichedHistoryRow) {
  return getHistoryRowGroupRows(row).find(item => item.reply?.replyContent.trim())?.reply
}

function getHistoryQuestionSamples(rows: EnrichedHistoryRow[]) {
  return uniqueHistoryTexts(
    rows.map(row => getAutoReplyMessageDetail(row.comment)).filter(Boolean),
    6,
  )
}

function getCandidateGroupKey(row: EnrichedHistoryRow) {
  const semanticKey = getAutoReplyHistorySemanticGroupKey(getAutoReplyMessageDetail(row.comment))
  return semanticKey ? `${row.accountId}:${semanticKey}` : row.key
}

function buildCandidateHistoryRows(rows: EnrichedHistoryRow[]) {
  const groups = new Map<string, EnrichedHistoryRow[]>()
  for (const row of rows) {
    if (!row.candidate.isCandidate) continue
    const groupKey = getCandidateGroupKey(row)
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row])
  }

  return Array.from(groups.values())
    .map(groupRows => {
      const sortedRows = [...groupRows].sort((left, right) => {
        if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
        return left.key.localeCompare(right.key)
      })
      const representative = sortedRows[0]
      const questionSamples = getHistoryQuestionSamples(sortedRows)
      const semanticAliases = sortedRows.flatMap(row =>
        getAutoReplyHistorySemanticKeywordAliases(getAutoReplyMessageDetail(row.comment)),
      )
      const keywords = uniqueHistoryTexts(
        [
          ...semanticAliases,
          ...questionSamples,
          ...sortedRows.flatMap(row => row.candidate.keywords),
        ],
        MAX_HISTORY_KEYWORDS,
      )
      const reasons = uniqueHistoryTexts(
        [
          sortedRows.length > 1 ? `同类 ${sortedRows.length} 条` : '',
          ...sortedRows.flatMap(row =>
            row.candidate.reasons.filter(reason => !/^同类/u.test(reason)),
          ),
        ],
        5,
      )

      return {
        ...representative,
        candidate: {
          ...representative.candidate,
          duplicateCount: sortedRows.length,
          hasReply: sortedRows.some(row => row.candidate.hasReply),
          hasReusableIntent: sortedRows.some(row => row.candidate.hasReusableIntent),
          reasons,
          keywords,
        },
        relatedRows: sortedRows,
        questionSamples,
      } satisfies EnrichedHistoryRow
    })
    .sort((left, right) => {
      if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
      return left.key.localeCompare(right.key)
    })
}

function getAiInputItemSemanticKey(row: EnrichedHistoryRow) {
  const semanticKey = getAutoReplyHistorySemanticGroupKey(getAutoReplyMessageDetail(row.comment))
  if (semanticKey) return semanticKey
  const normalized = normalizeAutoReplyHistoryQuestionKey(getAutoReplyMessageDetail(row.comment))
  return normalized ? `exact:${normalized}` : row.key
}

function createHistoryAiInputItemId(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return `h${Math.abs(hash).toString(36)}`
}

function buildHistoryAiInputItems(rows: EnrichedHistoryRow[]) {
  const groups = new Map<string, HistoryAiInputItem & { sortTime: number }>()

  for (const row of rows) {
    if (!row.candidate.isCandidate) continue

    const text = getAutoReplyMessageDetail(row.comment).trim()
    if (!text) continue

    const semanticKey = getAiInputItemSemanticKey(row)
    const itemKey = `${row.accountId}:${semanticKey}`
    const existing = groups.get(itemKey)
    if (existing) {
      existing.count += 1
      existing.rowKeys.push(row.key)
      if (!existing.replyContent && row.reply?.replyContent.trim()) {
        existing.replyContent = row.reply.replyContent.trim()
      }
      if (row.sortTime > existing.sortTime) {
        existing.sortTime = row.sortTime
      }
      continue
    }

    groups.set(itemKey, {
      id: createHistoryAiInputItemId(itemKey),
      accountId: row.accountId,
      accountName: row.accountName,
      semanticKey,
      text,
      count: 1,
      rowKeys: [row.key],
      replyContent: row.reply?.replyContent.trim() || undefined,
      sortTime: row.sortTime,
    })
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
      return right.count - left.count
    })
    .slice(0, MAX_AI_GROUPING_ITEMS)
}

export function buildHistoryAiGroupingKey(
  items: Array<Pick<HistoryAiInputItem, 'accountId' | 'semanticKey'>>,
  scope: string,
) {
  return `${scope}:${items
    .map(item => `${item.accountId}:${item.semanticKey}`)
    .sort()
    .join('|')}`
}

function buildHistoryAiGroupingPrompt(items: HistoryAiInputItem[]) {
  return `你是直播历史评论的语义整理助手。请把观众评论按“可以共用同一条关键词回复”的语义分组，并推荐关键词。

必须遵守：
1. 只能合并同一 accountId 下的评论，不能跨直播账号合并。
2. 按语义分组，不按用户名分组；用户名不重要。
3. 同一组必须适合使用同一条回复。语义相似但回复口径可能不同的，不要强行合并。
4. 例如“下单了”“已下单”“拍了”“已拍”“刚拍了一单”属于一组。
5. 例如“19.8几盒”和“29.9几盒”如果答案可能不同，应分开。
6. 用户个人订单问题、闲聊、夸赞、无明确意图的评论，不要放进建议配置组。
7. 只返回 JSON，不要 Markdown，不要解释。

返回格式：
{
  "groups": [
    {
      "title": "下单确认",
      "representativeQuestion": "已下单",
      "itemIds": ["i1", "i2"],
      "keywords": ["下单了", "已下单", "拍了", "已拍"],
      "sampleComments": ["下单了", "已下单"],
      "replyDraft": "",
      "reason": "这些评论都表示用户已完成下单，可共用同一类回复"
    }
  ]
}

待整理评论：
${JSON.stringify(
  items.map(item => ({
    id: item.id,
    accountId: item.accountId,
    accountName: item.accountName,
    text: item.text,
    count: item.count,
    existingReply: item.replyContent ?? '',
  })),
)}`.trim()
}

function extractJsonObject(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/u, '')
    .replace(/```$/u, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return trimmed
  return trimmed.slice(start, end + 1)
}

function parseHistoryAiGroups(raw: string, items: HistoryAiInputItem[]): HistoryAiGroup[] {
  const itemIds = new Set(items.map(item => item.id))
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    groups?: Array<Partial<HistoryAiGroup>>
  }

  if (!Array.isArray(parsed.groups)) return []

  return parsed.groups
    .map<HistoryAiGroup | null>(group => {
      const validItemIds = uniqueHistoryTexts(
        Array.isArray(group.itemIds)
          ? group.itemIds.filter(id => typeof id === 'string' && itemIds.has(id))
          : [],
        30,
      )
      const keywords = uniqueHistoryTexts(
        Array.isArray(group.keywords)
          ? group.keywords.filter(keyword => typeof keyword === 'string')
          : [],
        MAX_HISTORY_KEYWORDS,
      )
      if (validItemIds.length === 0 || keywords.length === 0) return null

      return {
        title: typeof group.title === 'string' ? group.title.trim() : '同类问题',
        representativeQuestion:
          typeof group.representativeQuestion === 'string'
            ? group.representativeQuestion.trim()
            : '',
        keywords,
        sampleComments: uniqueHistoryTexts(
          Array.isArray(group.sampleComments)
            ? group.sampleComments.filter(comment => typeof comment === 'string')
            : [],
          6,
        ),
        itemIds: validItemIds,
        replyDraft: typeof group.replyDraft === 'string' ? group.replyDraft.trim() : '',
        reason: typeof group.reason === 'string' ? group.reason.trim() : '',
      } satisfies HistoryAiGroup
    })
    .filter((group): group is HistoryAiGroup => group !== null)
}

async function requestHistoryAiGroups(items: HistoryAiInputItem[]) {
  const store = useAIChatStore.getState()
  const provider = store.config.provider
  const apiKey = store.apiKeys[provider]?.trim()
  if (!apiKey || !window.aiChatAPI) {
    return []
  }

  const raw = await window.aiChatAPI.normalChat({
    messages: [
      {
        role: 'system',
        content: '你只负责直播历史评论的语义归类和关键词推荐。不要保存规则，不要输出非 JSON 内容。',
      },
      {
        role: 'user',
        content: buildHistoryAiGroupingPrompt(items),
      },
    ],
    provider,
    model: store.config.model,
    apiKey,
    customBaseURL: store.customBaseURL,
    temperature: 0.2,
  })

  return raw ? parseHistoryAiGroups(raw, items) : []
}

function buildAiCandidateHistoryRows(
  rows: EnrichedHistoryRow[],
  items: HistoryAiInputItem[],
  groups: HistoryAiGroup[],
) {
  if (groups.length === 0) return []

  const rowsByKey = new Map(rows.map(row => [row.key, row]))
  const itemById = new Map(items.map(item => [item.id, item]))
  const groupedRows: EnrichedHistoryRow[] = []

  for (const group of groups) {
    const groupRows = group.itemIds.flatMap(itemId => {
      const item = itemById.get(itemId)
      if (!item) return []
      return item.rowKeys
        .map(rowKey => rowsByKey.get(rowKey))
        .filter((row): row is EnrichedHistoryRow => Boolean(row))
    })

    const sortedRows = [...groupRows].sort((left, right) => {
      if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
      return left.key.localeCompare(right.key)
    })
    const representative = sortedRows[0]
    if (!representative) continue

    const samples = uniqueHistoryTexts(
      [
        group.representativeQuestion,
        ...group.sampleComments,
        ...getHistoryQuestionSamples(sortedRows),
      ],
      6,
    )
    const keywords = uniqueHistoryTexts(
      [
        ...group.keywords,
        group.representativeQuestion,
        ...group.sampleComments,
        ...getHistoryQuestionSamples(sortedRows),
        ...sortedRows.flatMap(row => row.candidate.keywords),
      ],
      MAX_HISTORY_KEYWORDS,
    )

    groupedRows.push({
      ...representative,
      candidate: {
        ...representative.candidate,
        duplicateCount: sortedRows.length,
        hasReply: sortedRows.some(row => row.candidate.hasReply),
        hasReusableIntent: true,
        reasons: uniqueHistoryTexts(
          [
            sortedRows.length > 1 ? `同类 ${sortedRows.length} 条` : '',
            'AI归类',
            group.reason ?? '',
          ],
          5,
        ),
        keywords,
      },
      relatedRows: sortedRows,
      questionSamples: samples,
      aiReplyDraft: group.replyDraft,
    })
  }

  return groupedRows.sort((left, right) => {
    if (left.sortTime !== right.sortTime) return right.sortTime - left.sortTime
    return left.key.localeCompare(right.key)
  })
}

function buildHistoryDraft(row: EnrichedHistoryRow, config?: AutoReplyConfig) {
  if (row.aiReplyDraft?.trim()) {
    return {
      rowKey: row.key,
      keywords: row.candidate.keywords.join('、'),
      content: row.aiReplyDraft.trim(),
    }
  }

  const replySourceRow = getHistoryRowGroupRows(row).find(item => item.reply?.replyContent.trim())
  const replyContent = replySourceRow?.reply?.replyContent
    ? stripMentionedReplyContent(
        replySourceRow.reply.replyContent,
        replySourceRow.comment.nick_name,
        Boolean(config?.hideUsername),
      )
    : ''

  return {
    rowKey: row.key,
    keywords: row.candidate.keywords.join('、'),
    content: replyContent,
  }
}

export default function AutoReplyHistorySheet({
  accounts,
  defaultScope = ALL_HISTORY_SCOPE,
  accountConfigs = EMPTY_ACCOUNT_CONFIGS,
  onSaveKeywordRule,
  triggerClassName,
}: {
  accounts: AutoReplyHistoryAccount[]
  defaultScope?: string
  accountConfigs?: Record<string, AutoReplyConfig | undefined>
  onSaveKeywordRule?: (draft: AutoReplyHistoryKeywordRuleDraft) => void
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(defaultScope)
  const [mode, setMode] = useState<HistoryMode>('candidates')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<HistoryDraftState | null>(null)
  const isApiKeysHydrated = useAIChatStore(state => state.isApiKeysHydrated)
  const aiProvider = useAIChatStore(state => state.config.provider)
  const aiModel = useAIChatStore(state => state.config.model)
  const aiApiKey = useAIChatStore(state => state.apiKeys[state.config.provider])
  const aiCustomBaseURL = useAIChatStore(state => state.customBaseURL)
  const aiConfigSignature = `${aiProvider}:${aiModel}:${Boolean(aiApiKey?.trim())}:${aiCustomBaseURL}`
  const hasAiCredentials = isApiKeysHydrated && Boolean(aiApiKey?.trim())
  const aiRequestSeqRef = useRef(0)
  const [aiGrouping, setAiGrouping] = useState<HistoryAiGroupingState>({
    key: '',
    status: 'idle',
    groups: [],
  })
  const accountOptions = useMemo(
    () =>
      accounts.map(account => ({
        accountId: account.accountId,
        accountName: account.accountName,
        count: buildHistoryRows([account]).length,
      })),
    [accounts],
  )
  const allRows = useMemo(() => buildHistoryRows(accounts), [accounts])
  const occurrenceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of allRows) {
      const semanticKey = getAutoReplyHistorySemanticGroupKey(
        getAutoReplyMessageDetail(row.comment),
      )
      if (!semanticKey) continue
      const groupKey = `${row.accountId}:${semanticKey}`
      counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1)
    }
    return counts
  }, [allRows])
  const enrichedRows = useMemo<EnrichedHistoryRow[]>(
    () =>
      allRows.map(row => {
        const semanticKey = getAutoReplyHistorySemanticGroupKey(
          getAutoReplyMessageDetail(row.comment),
        )
        const groupKey = semanticKey ? `${row.accountId}:${semanticKey}` : ''
        return {
          ...row,
          candidate: getAutoReplyHistoryRuleCandidateState({
            comment: row.comment,
            reply: row.reply,
            config: accountConfigs[row.accountId],
            duplicateCount: groupKey ? (occurrenceCounts.get(groupKey) ?? 1) : 1,
          }),
        }
      }),
    [accountConfigs, allRows, occurrenceCounts],
  )
  const scopedRows = useMemo(() => {
    if (scope === ALL_HISTORY_SCOPE) return enrichedRows
    return enrichedRows.filter(row => row.accountId === scope)
  }, [enrichedRows, scope])
  const aiInputItems = useMemo(() => buildHistoryAiInputItems(scopedRows), [scopedRows])
  const aiGroupingKey = useMemo(
    () => `${aiConfigSignature}:${buildHistoryAiGroupingKey(aiInputItems, scope)}`,
    [aiConfigSignature, aiInputItems, scope],
  )
  const aiGroups =
    aiGrouping.key === aiGroupingKey && aiGrouping.status === 'ready' ? aiGrouping.groups : []
  const currentAiGroupingStatus =
    aiGrouping.key === aiGroupingKey ? aiGrouping.status : ('idle' as const)
  const isAiGroupingLoading = currentAiGroupingStatus === 'loading'
  const hasCurrentAiGroups = aiGroups.length > 0
  const aiStatusLabel = !hasAiCredentials
    ? 'AI未配置'
    : isAiGroupingLoading
      ? 'AI整理中'
      : currentAiGroupingStatus === 'ready' && hasCurrentAiGroups
        ? 'AI已归类'
        : currentAiGroupingStatus === 'error'
          ? 'AI整理失败，已使用本地规则'
          : currentAiGroupingStatus === 'ready'
            ? 'AI无新增分组'
            : '本地规则'
  const aiActionLabel = isAiGroupingLoading
    ? '整理中'
    : currentAiGroupingStatus === 'ready' && hasCurrentAiGroups
      ? '重新整理'
      : 'AI整理'
  const fallbackCandidateRows = useMemo(() => buildCandidateHistoryRows(scopedRows), [scopedRows])
  const aiCandidateRows = useMemo(
    () => buildAiCandidateHistoryRows(scopedRows, aiInputItems, aiGroups),
    [aiGroups, aiInputItems, scopedRows],
  )
  const candidateRows = aiCandidateRows.length > 0 ? aiCandidateRows : fallbackCandidateRows
  const modeRows = mode === 'candidates' ? candidateRows : scopedRows
  const visibleRows = useMemo(() => filterHistoryRows(modeRows, query), [query, modeRows])
  const draftKeywords = draft ? splitKeywordDraft(draft.keywords) : []
  const draftContent = draft?.content.trim() ?? ''

  useEffect(() => {
    if (!open) return
    setScope(defaultScope)
    setMode('candidates')
    setQuery('')
    setDraft(null)
  }, [defaultScope, open])

  useEffect(() => {
    if (scope === ALL_HISTORY_SCOPE || accounts.some(account => account.accountId === scope)) {
      return
    }
    setScope(ALL_HISTORY_SCOPE)
  }, [accounts, scope])

  const startKeywordDraft = (row: EnrichedHistoryRow) => {
    setDraft(buildHistoryDraft(row, accountConfigs[row.accountId]))
  }

  const requestAiRegroup = () => {
    if (isAiGroupingLoading || !hasAiCredentials || aiInputItems.length === 0) {
      return
    }

    setDraft(null)
    setMode('candidates')
    const requestSeq = aiRequestSeqRef.current + 1
    aiRequestSeqRef.current = requestSeq
    setAiGrouping({ key: aiGroupingKey, status: 'loading', groups: [] })

    void requestHistoryAiGroups(aiInputItems)
      .then(groups => {
        if (aiRequestSeqRef.current !== requestSeq) return
        setAiGrouping({ key: aiGroupingKey, status: 'ready', groups })
      })
      .catch(error => {
        if (aiRequestSeqRef.current !== requestSeq) return
        console.warn('[AutoReplyHistory] AI grouping failed:', error)
        setAiGrouping({
          key: aiGroupingKey,
          status: 'error',
          groups: [],
          error: error instanceof Error ? error.message : 'AI 整理失败',
        })
      })
  }

  const saveKeywordDraft = (row: EnrichedHistoryRow) => {
    if (!onSaveKeywordRule || draft?.rowKey !== row.key || draftKeywords.length === 0) return
    if (!draftContent) return

    onSaveKeywordRule({
      accountId: row.accountId,
      commentId: row.comment.msg_id,
      commentText: getAutoReplyMessageDetail(row.comment),
      keywords: draftKeywords,
      contents: [draftContent],
    })
    setDraft(null)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="历史评论"
              className={triggerClassName}
              onClick={() => setOpen(true)}
            >
              <History className="h-3.5 w-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none group-hover:-rotate-12 group-hover:scale-110" />
              <span className="sr-only">历史评论</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">历史评论</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <SheetContent side="right" className="w-[min(86vw,760px)] sm:max-w-none">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>历史评论</SheetTitle>
          <SheetDescription>本地保存最近 7 天，下播后可从历史评论补充关键词回复。</SheetDescription>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex w-fit rounded-md border border-border/70 bg-background/35 p-0.5">
                <button
                  type="button"
                  aria-pressed={mode === 'candidates'}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60',
                    mode === 'candidates'
                      ? 'bg-primary/12 text-primary'
                      : 'text-muted-foreground hover:bg-primary/8 hover:text-foreground',
                  )}
                  onClick={() => {
                    setMode('candidates')
                    setDraft(null)
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  适合配置
                  <span className="tabular-nums text-current/75">{candidateRows.length}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'all'}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60',
                    mode === 'all'
                      ? 'bg-primary/12 text-primary'
                      : 'text-muted-foreground hover:bg-primary/8 hover:text-foreground',
                  )}
                  onClick={() => {
                    setMode('all')
                    setDraft(null)
                  }}
                >
                  全部评论
                  <span className="tabular-nums text-current/75">{scopedRows.length}</span>
                </button>
              </div>
              {mode === 'candidates' && aiInputItems.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 items-center gap-1 rounded text-[11px] text-muted-foreground">
                    <Sparkles
                      className={cn(
                        'h-3.5 w-3.5 text-primary',
                        isAiGroupingLoading && 'animate-pulse',
                      )}
                    />
                    {aiStatusLabel}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={isAiGroupingLoading || !hasAiCredentials}
                    onClick={requestAiRegroup}
                  >
                    <RefreshCw
                      className={cn('h-3.5 w-3.5', isAiGroupingLoading && 'animate-spin')}
                    />
                    {aiActionLabel}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,16rem)_1fr]">
            <Select
              value={scope}
              onValueChange={value => {
                setScope(value)
                setDraft(null)
              }}
            >
              <SelectTrigger size="sm" className="h-8 text-xs">
                <SelectValue placeholder="选择账号" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_HISTORY_SCOPE}>全部账号 · {allRows.length}</SelectItem>
                {accountOptions.map(option => (
                  <SelectItem key={option.accountId} value={option.accountId}>
                    {option.accountName} · {option.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索用户或评论"
                className="h-8 border-border/70 bg-background/45 pl-8 text-xs"
              />
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {visibleRows.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Clock3 className="h-5 w-5" />
              <span>
                {query.trim()
                  ? '没有匹配的历史评论'
                  : mode === 'candidates'
                    ? '暂无适合配置的历史评论'
                    : '暂无历史评论'}
              </span>
            </div>
          ) : (
            <div className="space-y-2 pt-3">
              {visibleRows.map(row => {
                const groupReply = getHistoryRowGroupReply(row)
                const replyBadge = getReplyBadge(groupReply)
                const isDrafting = draft?.rowKey === row.key
                const canSaveDraft = isDrafting && draftKeywords.length > 0 && Boolean(draftContent)
                const questionSamples = row.questionSamples ?? [
                  getAutoReplyMessageDetail(row.comment),
                ]
                const hideUserName = mode === 'candidates'
                const primaryQuestion = getAutoReplyMessageDetail(row.comment)
                const needsReplyContent =
                  !row.aiReplyDraft?.trim() && !groupReply?.replyContent.trim()
                const draftWarnings = isDrafting
                  ? getHistoryDraftKeywordWarnings(draftKeywords, accountConfigs[row.accountId])
                  : null
                return (
                  <div
                    key={row.key}
                    className={cn(
                      'rounded-md border px-3 py-2',
                      row.candidate.isCandidate
                        ? 'border-primary/25 bg-primary/8'
                        : 'border-border/70 bg-[var(--surface-muted)]/55',
                    )}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {hideUserName ? null : (
                            <span className="truncate text-[13px] font-semibold text-foreground">
                              {getAutoReplyMessageDisplayName(row.comment)}
                            </span>
                          )}
                          <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                            {row.accountName}
                          </span>
                          <span className="rounded border border-info/20 bg-info/10 px-1.5 py-0.5 text-[11px] text-info">
                            {row.platformLabel}
                          </span>
                          {row.timeLabel ? (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {row.timeLabel}
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            'mt-1 leading-5 text-foreground/90',
                            hideUserName ? 'text-sm font-medium' : 'text-[13px]',
                          )}
                        >
                          {primaryQuestion}
                        </p>
                        {questionSamples.length > 1 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-muted-foreground">
                              相似问法
                            </span>
                            {questionSamples.slice(0, 6).map(sample => (
                              <span
                                key={sample}
                                className="rounded border border-border/70 bg-background/35 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {sample}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {groupReply ? (
                          <p className="mt-1 line-clamp-2 rounded border border-border/60 bg-background/35 px-2 py-1 text-[12px] leading-5 text-muted-foreground">
                            可复用回复：{groupReply.replyContent}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {row.candidate.isConfigured ? (
                            <Badge variant="info" className="h-5 rounded px-1.5 text-[11px]">
                              已配置
                            </Badge>
                          ) : null}
                          {needsReplyContent && row.candidate.isCandidate ? (
                            <Badge variant="warning" className="h-5 rounded px-1.5 text-[11px]">
                              待补答案
                            </Badge>
                          ) : null}
                          {row.candidate.reasons.map(reason => (
                            <Badge
                              key={reason}
                              variant="neutral"
                              className="h-5 rounded px-1.5 text-[11px]"
                            >
                              {reason}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge
                          variant={replyBadge.variant}
                          className="h-5 rounded px-1.5 text-[11px]"
                        >
                          {replyBadge.label}
                        </Badge>
                        <span className="max-w-28 truncate text-[11px] text-muted-foreground">
                          {row.sessionLabel}
                        </span>
                        {row.candidate.isConfigured ? (
                          <div className="mt-1 inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-info">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            已入规则
                          </div>
                        ) : onSaveKeywordRule ? (
                          <Button
                            type="button"
                            variant={isDrafting ? 'subtle' : 'outline'}
                            size="sm"
                            className="mt-1 h-7 gap-1 px-2 text-xs"
                            onClick={() => startKeywordDraft(row)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            配置回复
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {isDrafting ? (
                      <div className="mt-3 rounded-md border border-primary/25 bg-background/45 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <KeyRound className="h-3.5 w-3.5 text-primary" />
                            这类问题的回复规则
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            保存前可删减问法，避免误触发
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-medium text-muted-foreground">
                            相似问法
                          </label>
                          <Input
                            value={draft.keywords}
                            onChange={event =>
                              setDraft(current =>
                                current?.rowKey === row.key
                                  ? { ...current, keywords: event.target.value.slice(0, 360) }
                                  : current,
                              )
                            }
                            placeholder="相似问法，可用顿号或换行分隔"
                            className="h-8 border-border/70 bg-background/55 text-xs"
                          />
                        </div>
                        <div className="mt-2 space-y-1.5">
                          <label className="block text-[11px] font-medium text-muted-foreground">
                            统一回复内容
                          </label>
                          <Textarea
                            value={draft.content}
                            onChange={event =>
                              setDraft(current =>
                                current?.rowKey === row.key
                                  ? { ...current, content: event.target.value.slice(0, 120) }
                                  : current,
                              )
                            }
                            placeholder="填写这类问题统一回复内容"
                            className="min-h-20 resize-none border-border/70 bg-background/55 text-sm"
                          />
                        </div>
                        {draftWarnings?.duplicates.length || draftWarnings?.broad.length ? (
                          <div className="mt-2 space-y-1 rounded-md border border-warning/25 bg-warning/8 px-2 py-1.5 text-[11px] leading-5 text-warning">
                            {draftWarnings.duplicates.length ? (
                              <div className="flex gap-1.5">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                  已有规则包含：
                                  {draftWarnings.duplicates.join('、')}，保存后会合并到现有规则。
                                </span>
                              </div>
                            ) : null}
                            {draftWarnings.broad.length ? (
                              <div className="flex gap-1.5">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                  问法较泛：
                                  {draftWarnings.broad.join('、')}，建议确认不会误触发。
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 text-[11px] text-muted-foreground">
                            保存后，这组问法会在 {row.accountName} 共用同一条回复。
                          </span>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setDraft(null)}
                            >
                              取消
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-3 text-xs"
                              disabled={!canSaveDraft}
                              onClick={() => saveKeywordDraft(row)}
                            >
                              确认保存
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
