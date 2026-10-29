/**
 * 各学科知识点掌握度的纯逻辑（不依赖 React / Supabase，便于单元测试）。
 *
 * 包含：掌握度升降与复习节奏、英语到期知识点挑选、数学每日闯关主题与难度、
 * 思维游戏难度解锁与用时判定。
 */

/** 掌握度等级上限（满级后解锁下一难度） */
export const MAX_MASTERY_LEVEL = 6

/** 复习间隔（天），下标 = 掌握度等级 - 1，等级越高间隔越长 */
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 15, 30, 60] as const

/** 环节首答正确率默认达标线 */
export const PASS_RATE = 0.75

/** 业务层用到的最小掌握度记录结构（KnowledgeMasteryRow 可直接传入） */
export type MasteryRow = {
  knowledge: string
  mastery_level: number
  next_review_date: string
}

/** 等级对应的下次复习间隔（天）；越界时按 1 天处理 */
export function reviewIntervalDays(level: number): number {
  return REVIEW_INTERVAL_DAYS[level - 1] ?? 1
}

export type MasteryState = {
  masteryLevel: number
  correctStreak: number
  intervalDays: number
}

/**
 * 一局结束后的掌握度变化：
 * 首答达标 → 连击 +1，连对 >= 2 次升一级（上限 6）；
 * 未达标 → 连击归零、等级重置为 1，明天必须再练。
 */
export function nextMasteryState(
  currentLevel: number,
  currentStreak: number,
  firstTryCorrect: boolean,
): MasteryState {
  let masteryLevel = 1
  let correctStreak = 0
  if (firstTryCorrect) {
    correctStreak = currentStreak + 1
    masteryLevel = Math.max(currentLevel, 1)
    if (correctStreak >= 2) masteryLevel = Math.min(masteryLevel + 1, MAX_MASTERY_LEVEL)
  }
  return { masteryLevel, correctStreak, intervalDays: reviewIntervalDays(masteryLevel) }
}

/** 首答正确率是否达标；总题数为 0 时视为未达标 */
export function isPassed(correct: number, total: number, passRate: number = PASS_RATE): boolean {
  if (total <= 0) return false
  return correct / total >= passRate
}

/** 是否到了复习期（今天及以前到期）；0 级表示还没练过，不算到期 */
export function isDue(
  row: Pick<MasteryRow, 'mastery_level' | 'next_review_date'>,
  today: string,
): boolean {
  return row.mastery_level > 0 && row.next_review_date <= today
}

// ──────────────────────────────────────────────────────────────────────────────
// 英语：知识点命名 + 到期复习挑选
// ──────────────────────────────────────────────────────────────────────────────

/** 英语知识点命名：字母A 表示具体字母，单词Apple 表示具体单词 */
export const LETTER_KNOWLEDGE_PREFIX = '字母'
export const WORD_KNOWLEDGE_PREFIX = '单词'

export function letterKnowledge(upper: string): string {
  return `${LETTER_KNOWLEDGE_PREFIX}${upper.toUpperCase()}`
}

export function wordKnowledge(en: string): string {
  return `${WORD_KNOWLEDGE_PREFIX}${en}`
}

export function letterFromKnowledge(knowledge: string | null): string | null {
  if (!knowledge || !knowledge.startsWith(LETTER_KNOWLEDGE_PREFIX)) return null
  return knowledge.slice(LETTER_KNOWLEDGE_PREFIX.length) || null
}

export function wordFromKnowledge(knowledge: string | null): string | null {
  if (!knowledge || !knowledge.startsWith(WORD_KNOWLEDGE_PREFIX)) return null
  return knowledge.slice(WORD_KNOWLEDGE_PREFIX.length) || null
}

export type ReviewTargetKind = 'letter' | 'word'

/** 到期复习知识点：等级低、到期早的排在前面；只保留指定类型（字母 / 单词） */
export function pickDueTargets(
  rows: MasteryRow[],
  kind: ReviewTargetKind,
  today: string,
): string[] {
  const prefix = kind === 'letter' ? LETTER_KNOWLEDGE_PREFIX : WORD_KNOWLEDGE_PREFIX
  return rows
    .filter((row) => isDue(row, today))
    .filter((row) => row.knowledge.startsWith(prefix) && row.knowledge.length > prefix.length)
    .sort(
      (a, b) =>
        a.mastery_level - b.mastery_level || a.next_review_date.localeCompare(b.next_review_date),
    )
    .map((row) => row.knowledge)
}

/** 第 index 题（0 起）应插入的复习知识点；超出预留题数或没有到期知识点时返回 null */
export function reviewTargetForIndex(
  pool: string[],
  index: number,
  reviewQuestions: number,
): string | null {
  if (pool.length === 0 || index < 0 || index >= reviewQuestions) return null
  return pool[index % pool.length]
}

// ──────────────────────────────────────────────────────────────────────────────
// 数学：难度范围 + 今日重点环节
// ──────────────────────────────────────────────────────────────────────────────

/** 复习等级 → 出题数字范围：低等级 5 以内，中等级 10 以内，高等级 20 以内 */
export function maxNumberForLevel(level: number): number {
  if (level <= 1) return 5
  if (level <= 3) return 10
  return 20
}

export type Focus = { index: number; level: number }

/**
 * 今日主题：优先到期待复习的知识点（等级最低、到期最早的），
 * 其次完全没练过的知识点（作为新学），最后兜底取等级最低的一个。
 */
export function pickFocusIndex(
  rows: MasteryRow[],
  knowledgeNames: readonly string[],
  today: string,
): Focus {
  const byName = new Map(rows.map((row) => [row.knowledge, row]))
  const record = (index: number) => byName.get(knowledgeNames[index])
  const indexes = knowledgeNames.map((_, index) => index)

  const sortWeakestFirst = (a: number, b: number) => {
    const ra = record(a)
    const rb = record(b)
    return (
      (ra?.mastery_level ?? 0) - (rb?.mastery_level ?? 0) ||
      (ra?.next_review_date ?? '').localeCompare(rb?.next_review_date ?? '')
    )
  }

  const due = indexes
    .filter((index) => {
      const row = record(index)
      return Boolean(row) && isDue(row!, today)
    })
    .sort(sortWeakestFirst)
  if (due.length > 0) {
    return { index: due[0], level: record(due[0])?.mastery_level ?? 0 }
  }

  const fresh = indexes.find((index) => !record(index))
  if (fresh !== undefined) return { index: fresh, level: 0 }

  const weakest = indexes.slice().sort(sortWeakestFirst)[0]
  return { index: weakest, level: record(weakest)?.mastery_level ?? 0 }
}

// ──────────────────────────────────────────────────────────────────────────────
// 思维：难度解锁 + 用时判定
// ──────────────────────────────────────────────────────────────────────────────

export type LevelLike = { knowledge: string }

/** 按「上一档是否满级」逐级决定本局难度索引（0 为最简单） */
export function pickLevelIndex(
  levels: readonly LevelLike[],
  rows: readonly Pick<MasteryRow, 'knowledge' | 'mastery_level'>[],
  unlockLevel: number = MAX_MASTERY_LEVEL,
): number {
  let index = 0
  while (index + 1 < levels.length) {
    const row = rows.find((item) => item.knowledge === levels[index].knowledge)
    if (!row || row.mastery_level < unlockLevel) break
    index += 1
  }
  return index
}

/** 思维游戏结算判定：首答正确率达标且没有超时（用时为 0 视为异常，不达标） */
export function isTimedPassed(
  accuracy: number,
  elapsedSec: number,
  timeLimitSec: number,
  minRate: number,
): boolean {
  return accuracy >= minRate && elapsedSec > 0 && elapsedSec <= timeLimitSec
}
