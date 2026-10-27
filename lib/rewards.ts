import { requireSupabase } from '@/lib/supabase'
import { resolveFamilyId } from '@/lib/family'
import { familyPatch, scoped } from '@/lib/supabase-queries'

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
 * Teacher 课程打卡（待家长审核）。
 *
 * 流程：
 * 1. 幂等检查：今天该任务已打过卡则直接返回 0，避免重复提交。
 * 2. 插入 checkins 记录，status = 'pending'，待发放星星数写入 stars 字段。
 * 3. 连续 5 天判断：查过去 4 天该 taskId 的打卡（驳回的不算），
 *    若每天都有记录则本次待发 5 颗（基础 2 + 连续奖励 3），否则 2 颗。
 * 4. 孩子端不写 star_ledger，星星由家长在「打卡审核」里确认后才真正到账。
 * 5. 返回本次待发放星星总数（2 或 5）。
 */
export async function handleTeacherCheckin(
  taskId: string,
  _userId: string,
  dryRun = false,
): Promise<{ earned: number; isStreakBonus: boolean }> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const today = todayKey()

  // 1. 幂等：今天已提交过打卡则不再重复创建
  const { data: existing } = await scoped(
    supabase.from('checkins').select('task_id').eq('task_id', taskId).eq('checkin_date', today),
    familyId,
  ).limit(1)
  if (existing && existing.length > 0) {
    return { earned: 0, isStreakBonus: false }
  }

  // 2. 连续 5 天判断：过去 4 天是否每天都有该 taskId 的有效打卡
  const past4 = [offsetDayKey(-1), offsetDayKey(-2), offsetDayKey(-3), offsetDayKey(-4)]
  const { data: pastRows } = await scoped(
    supabase.from('checkins').select('checkin_date, status').eq('task_id', taskId).in('checkin_date', past4),
    familyId,
  )
  const pastSet = new Set(
    (pastRows ?? [])
      .filter((r) => String(r.status ?? 'approved') !== 'rejected')
      .map((r) => String(r.checkin_date)),
  )
  const isStreakBonus = past4.every((d) => pastSet.has(d))

  const earned = isStreakBonus ? 5 : 2

  // 3. 插入待审核打卡（家长端 dryRun 不写库，仅模拟结算）
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

  return { earned, isStreakBonus }
}

/**
 * 学科游戏打卡 + 首答正确率结算（待家长审核）。
 *
 * @param taskId           任务 ID
 * @param totalQuestions   总题数
 * @param firstTryCorrect  第一次就答对的题数
 * @param dryRun           家长端测试模式：不写 checkins，仅返回计算结果
 * @param starRule         可选自定义星星规则（按首答正确率返回星星数），
 *                         默认规则：全对 → 2 颗；≥90% → 1 颗；否则 0 颗
 * @returns 本次待家长确认后发放的星星数
 *
 * 幂等：今天已打过卡则不再重复创建，直接返回 0。
 * 孩子端不写 star_ledger，家长在「打卡审核」中确认后才真正到账。
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

  // 幂等：今天已打过卡则不再重复提交
  const { data: existing } = await scoped(
    supabase.from('checkins').select('task_id').eq('task_id', taskId).eq('checkin_date', today),
    familyId,
  ).limit(1)
  if (existing && existing.length > 0) {
    return 0
  }

  // 计算星星
  const accuracy = totalQuestions > 0 ? firstTryCorrect / totalQuestions : 0
  let stars = 0
  if (starRule) {
    stars = Math.max(0, Math.floor(starRule(accuracy)))
  } else {
    if (accuracy === 1) stars = 2
    else if (accuracy >= 0.9) stars = 1
  }

  // 插入待审核打卡记录（dryRun 不写库）
  if (!dryRun) {
    const { error: checkinErr } = await supabase.from('checkins').upsert({
      task_id: taskId,
      checkin_date: today,
      status: 'pending',
      stars,
      ...familyPatch(familyId),
    })
    if (checkinErr) throw checkinErr
  }

  return stars
}
