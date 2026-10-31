/** 打卡星星规则：孩子端只做预估，家长审核通过后按同一规则真正发放 */

/** 线下课程（Teacher / Offline）固定 2 颗星 */
export const OFFLINE_CHECKIN_STARS = 2

/** 同一任务连续打卡 5 天的额外奖励 */
export const STREAK_BONUS_STARS = 3

/** 首答正确率换算成百分制得分（0–100 整数） */
export function accuracyToScore(firstTryCorrect: number, totalQuestions: number): number {
  if (totalQuestions <= 0) return 0
  return Math.round((firstTryCorrect / totalQuestions) * 100)
}

/**
 * 按分数预估星星：
 * - score 为 null（线下课程，无正确率）→ 2 颗
 * - 线上全对（100 分）→ 3 颗
 * - 80 分及以上 → 2 颗
 * - 其他 → 保底 1 颗
 */
export function estimateStarsFromScore(score: number | null | undefined): number {
  if (score === null || score === undefined) return OFFLINE_CHECKIN_STARS
  if (score >= 100) return 3
  if (score >= 80) return 2
  return 1
}
