const PLATFORM_NICKNAME_PREFIX_LABELS = [
  '潜在新客',
  '优质用户',
  '已购买',
  '近期购买',
  '待支付',
  '主播',
] as const
const HOST_NICKNAME_PREFIX_LABELS = new Set<string>(['主播'])
const SELF_NICKNAME = '我'

export type AutoReplyNicknameIdentity = {
  rawName: string
  displayName: string
  normalizedName: string
  labels: string[]
  isHost: boolean
}

function compactNickname(value?: string | null) {
  return (value || '匿名用户').trim().replace(/\s+/g, '')
}

function stripPlatformPrefixLabels(value: string) {
  let displayName = value
  const labels: string[] = []

  for (let index = 0; index < PLATFORM_NICKNAME_PREFIX_LABELS.length; index += 1) {
    const label = PLATFORM_NICKNAME_PREFIX_LABELS.find(
      candidate => displayName.startsWith(candidate) && displayName.length > candidate.length,
    )
    if (!label) break

    labels.push(label)
    displayName = displayName.slice(label.length).trim()
  }

  return {
    labels,
    displayName: displayName || value,
  }
}

export function normalizeAutoReplyNickname(value?: string | null) {
  return compactNickname(getAutoReplyDisplayName(value)).toLowerCase()
}

export function getAutoReplyDisplayName(value?: string | null) {
  const rawName = compactNickname(value)
  return stripPlatformPrefixLabels(rawName).displayName
}

export function parseAutoReplyNickname(value?: string | null): AutoReplyNicknameIdentity {
  const rawName = compactNickname(value)
  const { labels, displayName } = stripPlatformPrefixLabels(rawName)
  const normalizedName = compactNickname(displayName).toLowerCase()

  return {
    rawName,
    displayName,
    normalizedName,
    labels,
    isHost:
      labels.some(label => HOST_NICKNAME_PREFIX_LABELS.has(label)) ||
      normalizedName === SELF_NICKNAME,
  }
}

export function areSameAutoReplyViewerName(left?: string | null, right?: string | null) {
  return normalizeAutoReplyNickname(left) === normalizeAutoReplyNickname(right)
}

function toAutoReplyOperatorNames(operatorName?: string | string[] | null) {
  const names = Array.isArray(operatorName) ? operatorName : [operatorName]
  return names.filter((name): name is string => Boolean(name?.trim()))
}

export function isAutoReplyHostNickname(
  nickname?: string | null,
  operatorName?: string | string[] | null,
) {
  const identity = parseAutoReplyNickname(nickname)
  if (identity.isHost) return true

  return toAutoReplyOperatorNames(operatorName).some(
    name => identity.normalizedName === normalizeAutoReplyNickname(name),
  )
}
