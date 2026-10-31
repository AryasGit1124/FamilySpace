import { requireSupabase } from '@/lib/supabase'
import { resolveFamilyId } from '@/lib/family'
import { familyPatch, scoped } from '@/lib/supabase-queries'
import { accuracyToScore, estimateStarsFromScore, OFFLINE_CHECKIN_STARS, STREAK_BONUS_STARS } from '@/lib/star-rules'

/** 当前日期 key：YYYY-MM-DD（本地时区） */
function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 相对今天偏移 n 天的日期 key（n=-1 即昨天） */
function offsetDayKey(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 同一任务是否已连续打卡 5 天（今天 + 过去 4 天，驳回的不算）。
 * 满足则本次额外奖励 3 颗星。
 */
async function hasFiveDayStreak(
  supabase: Awaited<ReturnType<typeof requireSupabase>>,
  familyId: string | null,
  taskId: string,
): Promise<boolean> {
  const past4 = [offsetDayKey(-1), offsetDayKey(-2), offsetDayKey(-3), offsetDayKey(-4)]
  const { data } = await scoped(
    supabase.from('checkins').select('checkin_date, status').eq('task_id', taskId).in('checkin_date', past4),
    familyId,
  )
  const dates = new Set(
    (data ?? [])
      .filter((row) => String(row.status ?? 'approved') !== 'rejected')
      .map((row) => String(row.checkin_date)),
  )
  return past4.every((day) => dates.has(day))
}

/**
 * Teacher / 线下课程打卡（待家长审核）。
 *
 * - 预估固定 2 颗星；同一任务连续打卡 5 天时额外奖励 3 颗。
 * - 写入 checkins（status = 'pending'）。
 * - 孩子端不写 star_ledger，家长在「打卡审核」确认后才真正到账。
 * - 幂等：今天该任务已打过卡则返回 0，避免重复提交。
 */
export async function handleTeacherCheckin(
  taskId: string,
  _userId: string,
  dryRun = false,
): Promise<{ earned: number }> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const today = todayKey()

  const { data: existing } = await scoped(
    supabase.from('checkins').select('task_id').eq('task_id', taskId).eq('checkin_date', today),
    familyId,
  ).limit(1)
  if (existing && existing.length > 0) {
    return { earned: 0 }
  }

  const streakBonus = await hasFiveDayStreak(supabase, familyId, taskId)
  const earned = OFFLINE_CHECKIN_STARS + (streakBonus ? STREAK_BONUS_STARS : 0)

  // 家长端测试模式（dryRun）不写库，仅模拟结算
  if (!dryRun) {
    const { error: checkinErr } = await supabase.from('checkins').upsert({
      task_id: taskId,
      checkin_date: today,
      status: 'pending',
      stars: earned,
      ...familyPatch(familyId),
    })
    if (checkinErr) throw checkinErr
  }

  return { earned }
}

/**
 * 学科游戏打卡（待家长审核）。
 *
 * - 把首答正确率换算成百分制存入 checkins.score。
 * - 默认预估星星：100 分 3 颗；80 分及以上 2 颗；其他保底 1 颗。
 * - 支持各学科自定义规则（如故事固定 1 颗）。
 * - 同一任务连续打卡 5 天时额外奖励 3 颗。
 * - 孩子端不写 star_ledger，家长在「打卡审核」确认后才真正到账。
 * - 幂等：今天已打过卡则返回 0。家长端 dryRun 不写库。
 *
 * @param starRule 可选自定义规则：入参为首答正确率（0–1），返回星星数
 * @returns 本次预估（家长审核通过后发放）的星星数
 */
export async function handleGameCheckin(
  taskId: string,
  totalQuestions: number,
  firstTryCorrect: number,
  dryRun = false,
  starRule?: (accuracy: number) => number,
): Promise<number> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const today = todayKey()

  const { data: existing } = await scoped(
    supabase.from('checkins').select('task_id').eq('task_id', taskId).eq('checkin_date', today),
    familyId,
  ).limit(1)
  if (existing && existing.length > 0) {
    return 0
  }

  const accuracy = totalQuestions > 0 ? firstTryCorrect / totalQuestions : 0
  const score = accuracyToScore(firstTryCorrect, totalQuestions)
  const baseStars = starRule
    ? Math.max(0, Math.floor(starRule(accuracy)))
    : estimateStarsFromScore(score)
  const streakBonus = await hasFiveDayStreak(supabase, familyId, taskId)
  const stars = baseStars + (streakBonus ? STREAK_BONUS_STARS : 0)

  if (!dryRun) {
    const { error: checkinErr } = await supabase.from('checkins').upsert({
      task_id: taskId,
      checkin_date: today,
      status: 'pending',
      score,
      stars,
      ...familyPatch(familyId),
    })
    if (checkinErr) throw checkinErr
  }

  return stars
}
