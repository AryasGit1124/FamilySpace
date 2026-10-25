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
 * Teacher 课程打卡 + 连续 5 天额外奖励。
 *
 * 流程：
 * 1. 幂等检查：今天该任务已打过卡则直接返回 0，避免重复发星。
 * 2. 插入 checkins 记录。
 * 3. 基础奖励：star_ledger +2（reason: Teacher课程打卡）。
 * 4. 连续 5 天判断：查过去 4 天（不含今天）该 taskId 的打卡，若每天都有记录，
 *    说明今天是连续第 5 天，额外 +3（reason: 连续5天打卡额外奖励）。
 * 5. 返回本次获得星星总数（2 或 5）。
 */
export async function handleTeacherCheckin(
  taskId: string,
  _userId: string,
  dryRun = false,
): Promise<{ earned: number; isStreakBonus: boolean }> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const today = todayKey()

  // 1. 幂等：今天已打过卡则不再发奖
  const { data: existing } = await scoped(
    supabase.from('checkins').select('task_id').eq('task_id', taskId).eq('checkin_date', today),
    familyId,
  ).limit(1)
  if (existing && existing.length > 0) {
    return { earned: 0, isStreakBonus: false }
  }

  // 2. 插入打卡记录（家长端 dryRun 不写库，仅模拟结算）
  if (!dryRun) {
    const { error: checkinErr } = await supabase
      .from('checkins')
      .upsert({ task_id: taskId, checkin_date: today, ...familyPatch(familyId) })
    if (checkinErr) throw checkinErr
  }

  // 3. 基础奖励 +2（dryRun 不写 star_ledger）
  if (!dryRun) {
    await insertStarInternal(2, 'Teacher课程打卡', familyId)
  }

  // 4. 连续 5 天判断：过去 4 天是否每天都有该 taskId 的打卡
  const past4 = [offsetDayKey(-1), offsetDayKey(-2), offsetDayKey(-3), offsetDayKey(-4)]
  const { data: pastRows } = await scoped(
    supabase.from('checkins').select('checkin_date').eq('task_id', taskId).in('checkin_date', past4),
    familyId,
  )
  const pastSet = new Set((pastRows ?? []).map((r) => String(r.checkin_date)))
  const isStreakBonus = past4.every((d) => pastSet.has(d))

  let earned = 2
  if (isStreakBonus) {
    if (!dryRun) {
      await insertStarInternal(3, '连续5天打卡额外奖励', familyId)
    }
    earned = 5
  }

  // 通知前端刷新星星显示（dryRun 不触发，避免假数据）
  if (!dryRun && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('stars-changed'))
  }

  return { earned, isStreakBonus }
}

/** 内部写 star_ledger（与 supabase-queries.insertStar 一致，但允许传 familyId 避免重复解析） */
async function insertStarInternal(amount: number, reason: string, familyId: string | null) {
  const supabase = await requireSupabase()
  const { error } = await supabase
    .from('star_ledger')
    .insert({ amount, reason, ...familyPatch(familyId) })
  if (error) {
    console.warn('[Stars] 写入 star_ledger 失败:', error.message)
  }
}

/**
 * 学科游戏打卡 + 首答正确率结算。
 *
 * @param taskId           任务 ID
 * @param totalQuestions   总题数
 * @param firstTryCorrect  第一次就答对的题数
 * @param dryRun           家长端测试模式：不写 checkins / star_ledger，仅返回计算结果
 * @param starRule         可选自定义星星规则（按首答正确率返回星星数），
 *                         默认规则：全对 → 2 颗；≥90% → 1 颗；否则 0 颗
 * @returns 获得的星星数
 *
 * 幂等：今天已打过卡则不再重复发星，直接返回 0。
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

  // 幂等：今天已打过卡则不再发奖
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

  // 插入打卡记录（dryRun 不写库）
  if (!dryRun) {
    const { error: checkinErr } = await supabase
      .from('checkins')
      .upsert({ task_id: taskId, checkin_date: today, ...familyPatch(familyId) })
    if (checkinErr) throw checkinErr
  }

  // 发星（dryRun 不写 star_ledger）
  if (stars > 0 && !dryRun) {
    await insertStarInternal(stars, `游戏打卡（首答正确率 ${Math.round(accuracy * 100)}%）`, familyId)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('stars-changed'))
    }
  }

  return stars
}
