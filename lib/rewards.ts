import { requireSupabase } from '@/lib/supabase'
import { resolveFamilyId } from '@/lib/family'
import { computeStreakForTask, familyPatch, scoped } from '@/lib/supabase-queries'
import { accuracyToScore, baseStarsForCheckin, estimateStarsFromScore, STREAK_BONUS_STARS } from '@/lib/star-rules'

/** 当前日期 key：YYYY-MM-DD（本地时区） */
function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 同一任务从 anchorDate（含）往前的连续打卡天数是否恰好是 5 的倍数。
 * 仅第 5 / 10 / 15 … 天触发 +3 星奖励，其余天数（如第 6、7 天）不奖励，
 * 修复旧逻辑「满 5 天后每天都多发」的 Bug。
 * 驳回的打卡不计入连续天数。
 */
async function isStreakMilestone(
  supabase: Awaited<ReturnType<typeof requireSupabase>>,
  familyId: string | null,
  taskId: string,
  anchorDate: string,
): Promise<boolean> {
  const streak = await computeStreakForTask(supabase, familyId, taskId, anchorDate)
  return streak > 0 && streak % 5 === 0
}

/**
 * 老师授课（format = 'teacher'）/ 线下课程打卡（待家长审核）。
 *
 * - 基础星星按 tasks.format 判断：teacher 固定 2 颗（与提交视频/文字等形式无关）；
 *   同一任务连续打卡第 5/10/15… 天时额外奖励 3 颗。
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

  // 判断授课形式必须读 tasks.format（不能用 type 的 online / offline）
  const { data: taskRow } = await scoped(
    supabase.from('tasks').select('format').eq('id', taskId),
    familyId,
  ).maybeSingle()
  const format = (taskRow?.format as string | null | undefined) ?? null
  console.log('[TeacherCheckin] task format =', format)

  const streakBonus = await isStreakMilestone(supabase, familyId, taskId, today)
  const baseStars = baseStarsForCheckin(format, null)
  const earned = baseStars + (streakBonus ? STREAK_BONUS_STARS : 0)

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
  const streakBonus = await isStreakMilestone(supabase, familyId, taskId, today)
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
