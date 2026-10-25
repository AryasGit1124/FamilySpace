/** AI 生成游戏的通用协议：{ title, type, difficulty, data } —— 供接口校验与播放器共用 */

export type DynamicGameType = 'choice' | 'matching' | 'sequence' | 'fill' | 'story'

export type ChoiceItem = { question: string; options: string[]; answer: string }
export type MatchingItem = { left: string; right: string }
export type SequenceItem = { sequence: string[]; scrambled: string[] }
export type FillItem = { text: string; answer: string; options: string[] }
export type StoryItem = { content: string }

export type DynamicGame =
  | { title: string; type: 'choice'; difficulty?: string; data: ChoiceItem[] }
  | { title: string; type: 'matching'; difficulty?: string; data: MatchingItem[] }
  | { title: string; type: 'sequence'; difficulty?: string; data: SequenceItem[] }
  | { title: string; type: 'fill'; difficulty?: string; data: FillItem[] }
  | { title: string; type: 'story'; difficulty?: string; data: StoryItem[] }

export const GAME_TYPES: DynamicGameType[] = ['choice', 'matching', 'sequence', 'fill', 'story']

/** 所有题型统一的完成回调参数 */
export type OnComplete = (totalQuestions: number, firstTryCorrectCount: number) => void

/** answer 兼容三种写法：选项原文、"A/B/C" 字母、0/1/2 下标 */
export function isCorrectOption(option: string, index: number, answer: string) {
  const expected = answer.trim()
  if (!expected) return false
  if (option.trim() === expected) return true
  if (/^[A-Za-z]$/.test(expected)) return index === expected.toUpperCase().charCodeAt(0) - 65
  if (/^\d+$/.test(expected)) return index === Number(expected)
  return false
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
}

function isValidItem(type: DynamicGameType, raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const item = raw as Record<string, unknown>

  if (type === 'choice') {
    return (
      isNonEmptyString(item.question) &&
      isStringArray(item.options) &&
      item.options.length >= 2 &&
      isNonEmptyString(item.answer)
    )
  }
  if (type === 'matching') {
    return isNonEmptyString(item.left) && isNonEmptyString(item.right)
  }
  if (type === 'sequence') {
    return (
      isStringArray(item.sequence) &&
      item.sequence.length >= 2 &&
      isStringArray(item.scrambled) &&
      item.scrambled.length === item.sequence.length
    )
  }
  if (type === 'story') {
    return isNonEmptyString(item.content)
  }
  return (
    isNonEmptyString(item.text) &&
    isNonEmptyString(item.answer) &&
    isStringArray(item.options) &&
    item.options.length >= 2
  )
}

function inferType(items: unknown[]): DynamicGameType | null {
  const first = items.find((item) => item && typeof item === 'object') as
    | Record<string, unknown>
    | undefined
  if (!first) return null
  if ('left' in first && 'right' in first) return 'matching'
  if ('sequence' in first && 'scrambled' in first) return 'sequence'
  if ('content' in first) return 'story'
  if ('text' in first && 'answer' in first) return 'fill'
  if ('question' in first && 'options' in first) return 'choice'
  return null
}

/**
 * 解析 tasks.game_content（可能是 jsonb 对象，也可能是字符串）为可播放的游戏。
 * 题型以声明的 type 为准；声明缺失或不合法时按数据结构推断。
 */
export function parseDynamicGame(raw: unknown, fallbackTitle: string): DynamicGame | null {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null

  const content = value as Record<string, unknown>
  let items = Array.isArray(content.data) ? content.data.filter(Boolean) : []

  // 兼容旧版 AI 游戏内容 { questions: [{ text, options, answer }] }
  if (items.length === 0 && Array.isArray(content.questions)) {
    items = (content.questions as unknown[]).map((raw) => {
      const q = (raw ?? {}) as Record<string, unknown>
      return { question: q.text, options: q.options, answer: q.answer }
    })
  }

  if (items.length === 0) return null

  const declared =
    typeof content.type === 'string' && GAME_TYPES.includes(content.type as DynamicGameType)
      ? (content.type as DynamicGameType)
      : null

  const type =
    declared && items.every((item) => isValidItem(declared, item)) ? declared : inferType(items)
  if (!type) return null

  const data = items.filter((item) => isValidItem(type, item))
  if (data.length === 0) return null

  const title = isNonEmptyString(content.title) ? content.title.trim() : fallbackTitle
  const difficulty = isNonEmptyString(content.difficulty) ? content.difficulty.trim() : undefined

  return { title, type, difficulty, data } as DynamicGame
}
