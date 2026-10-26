import { requireSupabase } from '@/lib/supabase'
import { resolveFamilyId, type UserRole } from '@/lib/family'
import { shiftDate, todayStr } from '@/lib/dates'
import type { Weekday } from '@/lib/mock-data'

/**
 * 给查询加上 family_id 过滤；还没有家庭（未登录 / 刚进登录页）时不加过滤。
 */
export function scoped<T>(query: T, familyId: string | null): T {
  if (!familyId) return query
  return (query as unknown as { eq: (column: string, value: string) => T }).eq('family_id', familyId)
}

/** 写入时带上 family_id；没有家庭时省略该字段 */
export function familyPatch(familyId: string | null) {
  return familyId ? { family_id: familyId } : {}
}

// ──────────────────────────────────────────────────────────────────────────────
// subjects
// ──────────────────────────────────────────────────────────────────────────────

export async function fetchSubjects() {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('subjects').select('id, name, show_in_tab, color, sort_order'),
    familyId,
  ).order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function insertSubject(name: string) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await supabase
    .from('subjects')
    .insert({ name, ...familyPatch(familyId) })
    .select('id, name, show_in_tab, color, sort_order')
    .single()
  if (error) throw error
  return data
}

export async function updateSubjectShowInTab(id: string, show: boolean) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('subjects').update({ show_in_tab: show }).eq('id', id)
  if (error) throw error
}

export async function updateSubject(id: string, name: string) {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('subjects')
    .update({ name })
    .eq('id', id)
    .select('id, name, show_in_tab, color, sort_order')
    .single()
  if (error) throw error
  return data
}

export async function deleteSubject(id: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('subjects').delete().eq('id', id)
  if (error) throw error
}

/** 统计某学科下的任务数 —— 删除学科前用于在确认弹窗里展示级联影响范围 */
export async function countTasksBySubject(subjectId: string) {
  const supabase = await requireSupabase()
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', subjectId)
  if (error) throw error
  return count ?? 0
}

// ──────────────────────────────────────────────────────────────────────────────
// tasks（带 subjects 级联 —— 用于模板选择器和课表选择器）
// ──────────────────────────────────────────────────────────────────────────────

export async function fetchTasksWithSubjects() {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('tasks').select(
      `
        id, subject_id, title, type, description, format,
        subjects ( id, name, color, sort_order )
      `.trim(),
    ),
    familyId,
  ).order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function insertTask(params: {
  subject_id: string
  title: string
  type: 'online' | 'offline'
  format?: 'teacher' | 'self'
  description?: string
}) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      subject_id: params.subject_id,
      title: params.title,
      type: params.type,
      format: params.format ?? 'self',
      description: params.description ?? null,
      ...familyPatch(familyId),
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function updateTask(
  id: string,
  params: {
    subject_id?: string
    title?: string
    type?: 'online' | 'offline'
    format?: 'teacher' | 'self'
    description?: string | null
  },
) {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('tasks')
    .update({
      subject_id: params.subject_id,
      title: params.title,
      type: params.type,
      format: params.format,
      description: params.description,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTask(id: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

/** 按学科名取学科 id（用于学科子模块返回学科主页） */
export async function fetchSubjectIdByName(name: string): Promise<string | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('subjects').select('id'), familyId)
    .eq('name', name)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.id as string | undefined) ?? null
}

/** 数学「加减法」任务：读取 id 与 game_config（难度配置） */
export async function fetchAddSubtractTask(): Promise<{
  id: string
  gameConfig: unknown
} | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('tasks').select('id, game_config'), familyId)
    .eq('title', '加减法')
    .eq('type', 'online')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { id: data.id as string, gameConfig: data.game_config }
}

/** 更新任务的 game_config（如加减法难度 { maxNumber: 10 }） */
export async function updateTaskGameConfig(taskId: string, gameConfig: Record<string, unknown>) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('tasks').update({ game_config: gameConfig }).eq('id', taskId)
  if (error) throw error
}

/** 学科子模块任务幂等补建：已存在同名线上任务则直接返回，否则插入（带模块入口路由） */
export async function ensureModuleTask(params: { subject_id: string; title: string; game_route: string }) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  // 不 limit：并发访问学科页可能出现两条并发插入，这里查全量并顺手清理多余记录
  const { data: existing, error: findError } = await scoped(
    supabase.from('tasks').select('id, created_at'),
    familyId,
  )
    .eq('subject_id', params.subject_id)
    .eq('type', 'online')
    .eq('title', params.title)
    .order('created_at', { ascending: true })
  if (findError) throw findError
  if (existing && existing.length > 0) {
    // 保留最早一条，删掉并发产生的重复记录（自愈）
    for (const dup of existing.slice(1)) {
      await supabase.from('tasks').delete().eq('id', dup.id)
    }
    return existing[0]
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      subject_id: params.subject_id,
      title: params.title,
      type: 'online',
      format: 'self',
      game_route: params.game_route,
      ...familyPatch(familyId),
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** 按学科名 + 模块标题拿到模块任务 id（不存在时幂等补建），用于模块内小游戏打卡 */
export async function ensureModuleTaskIdBySubjectName(params: {
  subjectName: string
  title: string
  gameRoute: string
}): Promise<string | null> {
  const supabase = await requireSupabase()
  const { data: subject, error } = await supabase
    .from('subjects')
    .select('id')
    .eq('name', params.subjectName)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!subject?.id) return null

  const task = await ensureModuleTask({
    subject_id: subject.id as string,
    title: params.title,
    game_route: params.gameRoute,
  })
  return (task?.id as string | undefined) ?? null
}

/**
 * 插入一条 AI 生成的小游戏任务（type=online、format=self）
 * game_content 存整份游戏 JSON，前端在 /games/play 按 task_id 读取
 */
export async function insertGameTask(params: {
  subject_id: string
  title: string
  game_route: string
  game_content: unknown
}) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      subject_id: params.subject_id,
      title: params.title,
      type: 'online',
      format: 'self',
      game_route: params.game_route,
      game_content: params.game_content,
      ...familyPatch(familyId),
    })
    .select('id, title')
    .single()
  if (error) throw error
  return data
}

/** 按 id 查单个学科 —— 学科页头部展示用 */
export async function fetchSubjectById(id: string) {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, show_in_tab, color, sort_order')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** 学科页列表：该学科下所有线上任务（含 AI 生成的小游戏） */
export async function fetchOnlineTasksBySubject(subjectId: string) {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, game_route, created_at')
    .eq('subject_id', subjectId)
    .eq('type', 'online')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** 游戏播放页：按 id 读取任务及其 game_content */
export async function fetchGameTaskById(id: string) {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, subject_id, type, game_route, game_content')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** 星星总数：star_ledger 全表 amount 求和（表不存在时返回 0） */
export async function fetchStarTotal(): Promise<number> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('star_ledger').select('amount'), familyId)
  if (error) {
    console.warn('[Stars] 读取 star_ledger 失败:', error.message)
    return 0
  }
  return (data ?? []).reduce((sum, row) => sum + (typeof row.amount === 'number' ? row.amount : 0), 0)
}

/** 累计获得的星星总数：只统计 star_ledger 中正数金额（兑换扣减不计入） */
export async function fetchTotalEarnedStars(): Promise<number> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('star_ledger').select('amount'), familyId)
  if (error) {
    console.warn('[Stars] 读取 star_ledger 失败:', error.message)
    return 0
  }
  return (data ?? []).reduce(
    (sum, row) => sum + (typeof row.amount === 'number' && row.amount > 0 ? row.amount : 0),
    0,
  )
}

/** 写入一条星星奖励并广播 stars-changed 事件（StarBadge 实时刷新） */
export async function insertStar(amount: number, reason = '完成打卡') {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { error } = await supabase
    .from('star_ledger')
    .insert({ amount, reason, ...familyPatch(familyId) })
  if (error) {
    console.warn('[Stars] 写入 star_ledger 失败:', error.message)
    return
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('stars-changed'))
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// rewards_store（星星商城）
// ──────────────────────────────────────────────────────────────────────────────

export type RewardItem = {
  id: string
  icon: string | null
  title: string
  cost_stars: number
  stock: number
}

/** 商城奖励列表：只取还有库存的（stock > 0）；表未建时降级为空数组 */
export async function fetchRewards(): Promise<RewardItem[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('rewards_store').select('id, icon, title, cost_stars, stock'),
    familyId,
  )
    .gt('stock', 0)
    .order('created_at', { ascending: true })
  if (error) {
    console.warn('[Store] 读取 rewards_store 失败:', error.message)
    return []
  }
  return (data ?? []) as RewardItem[]
}

/** 家长端：全部奖励（含已售罄库存 0 的） */
export async function fetchAllRewards(): Promise<RewardItem[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('rewards_store').select('id, icon, title, cost_stars, stock'),
    familyId,
  ).order('created_at', { ascending: true })
  if (error) {
    console.warn('[StoreConfig] 读取 rewards_store 失败:', error.message)
    return []
  }
  return (data ?? []) as RewardItem[]
}

/** 新增一条商城奖励 */
export async function insertReward(params: {
  icon: string
  title: string
  cost_stars: number
  stock: number
}) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await supabase
    .from('rewards_store')
    .insert({ ...params, ...familyPatch(familyId) })
    .select('id')
    .single()
  if (error) throw error
  return data
}

/** 删除一条商城奖励 */
export async function deleteReward(id: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('rewards_store').delete().eq('id', id)
  if (error) throw error
}

/** 修改一条商城奖励（名称、图标、星星数、库存） */
export async function updateReward(
  id: string,
  params: { icon: string; title: string; cost_stars: number; stock: number },
) {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('rewards_store')
    .update(params)
    .eq('id', id)
    .select('id')
    .single()
  if (error) throw error
  return data
}

export type StarLedgerEntry = {
  id: string
  amount: number
  reason: string
  created_at: string
}

/** 家长端：最近的星星消耗记录（amount < 0 即兑换记录），按时间倒序 */
export async function fetchRedemptionRecords(limit = 20): Promise<StarLedgerEntry[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('star_ledger').select('id, amount, reason, created_at'),
    familyId,
  )
    .lt('amount', 0)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('[StoreConfig] 读取兑换记录失败:', error.message)
    return []
  }
  return (data ?? []) as StarLedgerEntry[]
}

/**
 * 兑换奖励：库存减 1 + 写入一条负数星星记录。
 * 先扣库存再记账，记账失败时把库存补回去，避免孩子白扣星星。
 */
export async function redeemReward(reward: RewardItem) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()

  const { data: updated, error: stockError } = await supabase
    .from('rewards_store')
    .update({ stock: reward.stock - 1 })
    .eq('id', reward.id)
    .eq('stock', reward.stock)
    .select('id')
  if (stockError) throw stockError
  if (!updated || updated.length === 0) throw new Error('库存已变化，请刷新后再试')

  const { error: ledgerError } = await supabase
    .from('star_ledger')
    .insert({ amount: -reward.cost_stars, reason: `兑换: ${reward.title}`, ...familyPatch(familyId) })
  if (ledgerError) {
    // 回滚库存，避免记账失败后库存被白白扣掉
    await supabase.from('rewards_store').update({ stock: reward.stock }).eq('id', reward.id)
    throw ledgerError
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('stars-changed'))
  }
}

/**
 * 游戏通关后打卡：写入 checkins（task_id + 当天日期），成功后发星星（默认 1 颗）。
 * 所有游戏的打卡统一走这里，Boss 关等场景可通过 stars 传 3。
 */
export async function insertCheckin(taskId: string, checkinDate: string, stars = 1) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { error } = await supabase
    .from('checkins')
    .upsert({ task_id: taskId, checkin_date: checkinDate, ...familyPatch(familyId) })
  if (error) throw error
  await insertStar(stars)
}

/** 今天是否已给该任务打过卡（媒体详情页「线下课打卡」状态用） */
export async function fetchTodayCheckin(taskId: string): Promise<boolean> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('checkins').select('task_id').eq('task_id', taskId).eq('checkin_date', todayStr()),
    familyId,
  ).limit(1)
  if (error) {
    console.warn('[Checkin] 查询今日打卡状态失败:', error.message)
    return false
  }
  return (data ?? []).length > 0
}

/** 拉取最近 N 天的打卡日期，用于统计累计/连续打卡天数 */
export async function fetchCheckinDates(days = 90): Promise<string[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  if (!familyId) return []

  // 以北京时间为准：UTC 直接偏移会卡在时区边界
  const sinceStr = shiftDate(todayStr(), -days)

  const { data, error } = await scoped(
    supabase.from('checkins').select('checkin_date'),
    familyId,
  ).gte('checkin_date', sinceStr)

  if (error) {
    console.warn('[Stats] 读取 checkins 失败:', error.message)
    return []
  }
  return (data ?? []).map((r) => String(r.checkin_date)).filter(Boolean)
}

/** 学科打卡分布：返回每个学科的打卡次数（含学科名与颜色） */
export async function fetchSubjectCheckinCounts(): Promise<
  { subjectId: string; name: string; color: string | null; count: number }[]
> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  if (!familyId) return []

  const { data, error } = await scoped(
    supabase.from('checkins').select(
      `task_id,
       tasks ( subject_id, subjects ( id, name, color ) )`,
    ),
    familyId,
  )

  if (error) {
    console.warn('[Stats] 读取学科打卡分布失败:', error.message)
    return []
  }

  const map = new Map<string, { name: string; color: string | null; count: number }>()
  for (const row of data ?? []) {
    const tasks = Array.isArray(row?.tasks) ? row.tasks[0] : row?.tasks
    const subjects = Array.isArray(tasks?.subjects) ? tasks?.subjects[0] : tasks?.subjects
    if (!subjects?.id) continue
    const cur = map.get(subjects.id)
    if (cur) cur.count += 1
    else map.set(subjects.id, { name: subjects.name ?? '未知', color: subjects.color ?? null, count: 1 })
  }
  return Array.from(map, ([subjectId, v]) => ({ subjectId, ...v })).sort((a, b) => b.count - a.count)
}

/** 最近打卡流水：按 created_at 倒序，关联任务标题 */
export async function fetchRecentCheckins(limit = 10): Promise<
  { taskId: string; taskTitle: string | null; checkinDate: string; createdAt: string }[]
> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  if (!familyId) return []

  const { data, error } = await scoped(
    supabase.from('checkins').select(
      `task_id, checkin_date, created_at,
       tasks ( title )`,
    ),
    familyId,
  )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[Stats] 读取最近打卡失败:', error.message)
    return []
  }

  return (data ?? []).map((r) => {
    const tasks = Array.isArray(r?.tasks) ? r.tasks[0] : r?.tasks
    return {
      taskId: String(r.task_id),
      taskTitle: tasks?.title ?? null,
      checkinDate: String(r.checkin_date ?? ''),
      createdAt: String(r.created_at ?? ''),
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────────
// 识字模块：literacy_chars / child_mastery
// ──────────────────────────────────────────────────────────────────────────────

export type LiteracyChar = {
  id: string
  level: number
  char: string
  pinyin: string | null
  lesson: number | null
  /** AI 生成的字卡数据，未填充时为 null（前端降级） */
  emoji?: string | null
  word?: string | null
  sentence?: string | null
}

export type MasteryStatus = 'mastered' | 'review'

const LITERACY_CHAR_COLUMNS = 'id, level, char, pinyin, lesson, emoji, word, sentence'

/** 某级别的全部汉字，按课次排序 */
export async function fetchLiteracyCharsByLevel(level: number): Promise<LiteracyChar[]> {
  const supabase = await requireSupabase()
  const query = (columns: string) =>
    supabase
      .from('literacy_chars')
      .select(columns)
      .eq('level', level)
      .order('lesson', { ascending: true })
      .order('created_at', { ascending: true })

  const primary = await query(LITERACY_CHAR_COLUMNS)
  if (!primary.error) return (primary.data ?? []) as LiteracyChar[]

  // 数据库还没加 emoji/word/sentence 字段时回退基础字段，避免识字页直接崩
  console.warn('[Literacy] 读取 AI 字卡字段失败，回退基础字段:', primary.error.message)
  const fallback = await query('id, level, char, pinyin, lesson')
  if (fallback.error) throw fallback.error
  return (fallback.data ?? []) as LiteracyChar[]
}

/** char_id → status 的映射，用于字卡/测试页回显掌握状态 */
export async function fetchMasteryMap(): Promise<Record<string, MasteryStatus>> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('child_mastery').select('char_id, status'),
    familyId,
  )
  if (error) throw error
  const map: Record<string, MasteryStatus> = {}
  for (const row of data ?? []) {
    if (row.char_id) map[row.char_id] = row.status as MasteryStatus
  }
  return map
}

/** 已认识字总数（跨级别） */
export async function countMasteredChars(): Promise<number> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { count, error } = await scoped(
    supabase.from('child_mastery').select('id', { count: 'exact', head: true }),
    familyId,
  ).eq('status', 'mastered')
  if (error) throw error
  return count ?? 0
}

/** 写入掌握状态：按 char_id 唯一约束 upsert，有记录则更新，没有则插入 */
export async function upsertMastery(charId: string, status: MasteryStatus) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  // char_id 上有全局唯一约束，必须用 onConflict upsert：
  // 「先查再插」在旧记录 family_id 为空/属其他家庭时会查不到而误走 insert，撞唯一约束
  const { error } = await supabase.from('child_mastery').upsert(
    {
      char_id: charId,
      status,
      updated_at: new Date().toISOString(),
      ...familyPatch(familyId),
    },
    { onConflict: 'char_id' },
  )
  if (error) throw error
}

/** 所有 status='mastered' 的汉字（去重、按级别课次排序）—— 用于 AI 故事 */
export async function fetchMasteredChars(): Promise<string[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data: rows, error } = await scoped(
    supabase.from('child_mastery').select('char_id'),
    familyId,
  ).eq('status', 'mastered')
  if (error) throw error

  const ids = (rows ?? []).map((r) => r.char_id).filter(Boolean)
  if (ids.length === 0) return []

  const { data: chars, error: charError } = await supabase
    .from('literacy_chars')
    .select('char, level, lesson')
    .in('id', ids)
    .order('level', { ascending: true })
    .order('lesson', { ascending: true })
  if (charError) throw charError

  const seen = new Set<string>()
  const result: string[] = []
  for (const row of chars ?? []) {
    if (row.char && !seen.has(row.char)) {
      seen.add(row.char)
      result.push(row.char)
    }
  }
  return result
}

/** 已掌握汉字（带拼音，按字去重）—— 冒险岛语文题优先从中抽取 */
export async function fetchMasteredCharsWithPinyin(): Promise<{ char: string; pinyin: string | null }[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data: rows, error } = await scoped(
    supabase.from('child_mastery').select('char_id'),
    familyId,
  ).eq('status', 'mastered')
  if (error) throw error

  const ids = (rows ?? []).map((r) => r.char_id).filter(Boolean)
  if (ids.length === 0) return []

  const { data: chars, error: charError } = await supabase
    .from('literacy_chars')
    .select('char, pinyin')
    .in('id', ids)
  if (charError) throw charError

  const seen = new Set<string>()
  const result: { char: string; pinyin: string | null }[] = []
  for (const row of chars ?? []) {
    if (row.char && !seen.has(row.char)) {
      seen.add(row.char)
      result.push({ char: row.char, pinyin: (row.pinyin as string | null) ?? null })
    }
  }
  return result
}

/** 冒险岛已通关的关卡号列表 —— 地图页/关卡页同步进度用（表不存在时返回空数组） */
export async function fetchAdventurePassedLevels(): Promise<number[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('adventure_progress').select('level_id'),
    familyId,
  )
  if (error) {
    // 表未建（42P01）等场景降级为本地进度
    console.warn('[Adventure] 读取 adventure_progress 失败，降级为仅本地进度:', error.message)
    return []
  }
  const levels = (data ?? [])
    .map((row) => row.level_id)
    .filter((item): item is number => typeof item === 'number')
  return Array.from(new Set(levels))
}

/** 写入一条通关记录（表不存在时静默跳过，不影响本地解锁） */
export async function insertAdventureProgress(level: number) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { error } = await supabase
    .from('adventure_progress')
    .insert({ level_id: level, ...familyPatch(familyId) })
  if (error) {
    console.warn('[Adventure] 写入 adventure_progress 失败（已保留本地进度）:', error.message)
  }
}

export type AdventureLevel = {
  level_number: number
  is_boss: boolean
  difficulty_max: number
}

/** adventure_levels 表未建时的默认 20 关：每 5 关一个 Boss，难度按关卡公式递增 */
export function buildDefaultAdventureLevels(): AdventureLevel[] {
  return Array.from({ length: 20 }, (_, i) => {
    const n = i + 1
    return {
      level_number: n,
      is_boss: n % 5 === 0,
      difficulty_max: Math.min(5 + Math.floor((n - 1) / 3) * 5, 20),
    }
  })
}

/** 冒险岛关卡配置：按 level_number 升序（表不存在时返回空数组，调用方用默认配置兜底） */
export async function fetchAdventureLevels(): Promise<AdventureLevel[]> {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('adventure_levels')
    .select('level_number, is_boss, difficulty_max')
    .order('level_number', { ascending: true })
  if (error) {
    console.warn('[Adventure] 读取 adventure_levels 失败，使用默认关卡配置:', error.message)
    return []
  }
  return (data ?? []) as AdventureLevel[]
}

/** status='review' 的汉字 —— 字卡练习的默认牌堆 */
export async function fetchReviewChars(): Promise<LiteracyChar[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data: rows, error } = await scoped(
    supabase.from('child_mastery').select('char_id'),
    familyId,
  ).eq('status', 'review')
  if (error) throw error

  const ids = (rows ?? []).map((r) => r.char_id).filter(Boolean)
  if (ids.length === 0) return []

  const { data: chars, error: charError } = await supabase
    .from('literacy_chars')
    .select(LITERACY_CHAR_COLUMNS)
    .in('id', ids)
    .order('level', { ascending: true })
    .order('lesson', { ascending: true })
  if (charError) throw charError
  return (chars ?? []) as LiteracyChar[]
}

/** 找到「识字」这个线上任务 —— 故事页打卡用它的 task_id */
export async function fetchLiteracyTaskId(): Promise<string | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('tasks').select('id'), familyId)
    .eq('type', 'online')
    .eq('title', '识字')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

/** 随机抽 count 个汉字（字库不大，全量拉取后本地洗牌） */
export async function fetchRandomLiteracyChars(count: number): Promise<LiteracyChar[]> {
  const supabase = await requireSupabase()
  const { data, error } = await supabase.from('literacy_chars').select(LITERACY_CHAR_COLUMNS)
  if (error) throw error
  const all = (data ?? []) as LiteracyChar[]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all.slice(0, count)
}

// ──────────────────────────────────────────────────────────────────────────────
// 古诗诵读：poems
// ──────────────────────────────────────────────────────────────────────────────

export type Poem = {
  id: string
  title: string
  author: string | null
  /** 每句一个元素（含标点） */
  content: string[]
  category: string | null
  level: number | null
}

/** 全部古诗，按级别排序 */
export async function fetchPoems(): Promise<Poem[]> {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('poems')
    .select('id, title, author, content, category, level')
    .order('level', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    author: row.author ?? null,
    content: Array.isArray(row.content) ? (row.content as string[]) : [],
    category: row.category ?? null,
    level: row.level ?? null,
  }))
}

// ──────────────────────────────────────────────────────────────────────────────
// weekly_templates
// ──────────────────────────────────────────────────────────────────────────────

export async function fetchWeeklyTemplatesWithTasks() {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('weekly_templates').select(
      `
        id, day_of_week, task_id,
        tasks ( id, title, type, description, format, subject_id,
          subjects ( id, name, color )
        )
      `.trim(),
    ),
    familyId,
  ).order('day_of_week', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function insertWeeklyTemplate(task_id: string, day_of_week: Weekday) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await supabase
    .from('weekly_templates')
    .insert({ task_id, day_of_week, ...familyPatch(familyId) })
    .select('id, day_of_week, task_id')
    .single()
  if (error) throw error
  return data
}

export async function deleteWeeklyTemplate(id: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('weekly_templates').delete().eq('id', id)
  if (error) throw error
}

// ──────────────────────────────────────────────────────────────────────────────
// schedules
// ──────────────────────────────────────────────────────────────────────────────

export async function fetchSchedulesWithTasks() {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('schedules').select(
      `
        id, subject_id, task_id, day_of_week, start_time, duration_minutes, location,
        tasks ( id, title, type,
          subjects ( id, name, color )
        )
      `.trim(),
    ),
    familyId,
  )
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function insertSchedule(params: {
  task_id: string
  subject_id: string | null
  day_of_week: Weekday
  start_time: string // "HH:MM"
  duration_minutes: number
  location: string | null
}) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const startFull = params.start_time.includes(':') && params.start_time.split(':').length === 2
    ? `${params.start_time}:00`
    : params.start_time
  const { data, error } = await supabase
    .from('schedules')
    .insert({
      task_id: params.task_id,
      subject_id: params.subject_id ?? null,
      day_of_week: params.day_of_week,
      start_time: startFull,
      duration_minutes: params.duration_minutes,
      location: params.location ?? null,
      ...familyPatch(familyId),
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function deleteSchedule(id: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('schedules').delete().eq('id', id)
  if (error) throw error
}

export async function updateSchedule(
  id: string,
  params: {
    day_of_week?: Weekday
    start_time?: string // "HH:MM"
    duration_minutes?: number
    location?: string | null
    subject_id?: string | null
  },
) {
  const supabase = await requireSupabase()
  const startFull = params.start_time
    ? params.start_time.includes(':') && params.start_time.split(':').length === 2
      ? `${params.start_time}:00`
      : params.start_time
    : undefined
  const { data, error } = await supabase
    .from('schedules')
    .update({
      day_of_week: params.day_of_week,
      start_time: startFull,
      duration_minutes: params.duration_minutes,
      location: params.location,
      subject_id: params.subject_id,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ──────────────────────────────────────────────────────────────────────────────
// media（上传的课程视频 / 图片）
// ──────────────────────────────────────────────────────────────────────────────

export const MEDIA_BUCKET = 'course-media'

export type MediaRow = {
  id: string
  course_id: string | null
  course_name: string | null
  media_date: string
  file_url: string
  file_type: string | null
  note: string | null
  offline_class: string | null
  uploader_name: string | null
  created_at: string
  /** 协同标记：learned=已带学 / need_review=需重看 / null=未标记 */
  teaching_status: 'learned' | 'need_review' | null
  /** 家长陪伴备注，多端共享 */
  parent_note: string | null
  /** 视频封面图（上传时浏览器端抽帧生成），图片资料为 null */
  thumb_url: string | null
}

const MEDIA_SELECT =
  'id, course_id, course_name, media_date, file_url, file_type, note, offline_class, uploader_name, created_at, teaching_status, parent_note, thumb_url'

/** 全部资料，按关联日期倒序（同一天按上传时间倒序） */
export async function fetchMediaList(): Promise<MediaRow[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('media').select(MEDIA_SELECT), familyId)
    .order('media_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** 按 id 读取单条资料（视频详情页用），不存在返回 null */
export async function fetchMediaById(id: string): Promise<MediaRow | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(supabase.from('media').select(MEDIA_SELECT), familyId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** 更新协同标记 / 陪伴备注（媒体详情页家长端用），仅更新传入的字段 */
export async function updateMediaTeaching(
  id: string,
  patch: { teaching_status?: 'learned' | 'need_review' | null; parent_note?: string | null },
) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { error } = await scoped(supabase.from('media').update(patch), familyId).eq('id', id)
  if (error) throw error
}

export async function insertMedia(row: {
  course_id: string | null
  course_name: string | null
  child_name?: string | null
  offline_class: string | null
  media_date: string
  file_url: string
  file_type: string
  note: string | null
  uploader_name: string
  thumb_url?: string | null
}) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await supabase
    .from('media')
    .insert({ ...row, ...familyPatch(familyId) })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function deleteMedia(id: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('media').delete().eq('id', id)
  if (error) throw error
}

/** 从 publicUrl 解析出 Storage 内的路径，并删除该文件 */
export async function deleteMediaFileByUrl(fileUrl: string) {
  const supabase = await requireSupabase()
  const marker = `/object/public/${MEDIA_BUCKET}/`
  const idx = fileUrl.indexOf(marker)
  if (idx < 0) return
  const path = decodeURIComponent(fileUrl.slice(idx + marker.length).split('?')[0])
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path])
  if (error) throw error
}

// ──────────────────────────────────────────────────────────────────────────────
// 登录 / 家庭：families + profiles
// ──────────────────────────────────────────────────────────────────────────────

export type { UserRole }

export type ProfileRow = {
  id: string
  family_id: string | null
  role: UserRole
  display_name: string | null
}

/** 当前用户的资料（role / family_id / display_name）；表未建或查询失败时返回 null */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, family_id, role, display_name')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.warn('[Auth] 读取 profiles 失败:', error.message)
    return null
  }
  return (data as ProfileRow | null) ?? null
}

/** 新增/更新当前用户的资料，绑定家庭、角色与家庭角色昵称 */
export async function upsertProfile(params: {
  id: string
  family_id: string | null
  role: UserRole
  display_name?: string | null
}): Promise<ProfileRow> {
  const supabase = await requireSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .upsert(params, { onConflict: 'id' })
    .select('id, family_id, role, display_name')
    .maybeSingle()

  // 写入成功但回读被 RLS 拦掉（0 行）时不能用 .single()，否则会误判为失败并中断登录流程
  const noRow = (error as { code?: string } | null)?.code === 'PGRST116'
  if (error && !noRow) throw error
  if (!data) {
    return {
      id: params.id,
      family_id: params.family_id,
      role: params.role,
      display_name: params.display_name ?? null,
    } as ProfileRow
  }
  return data as ProfileRow
}

/** 移除某个家庭成员（删除其 profiles 记录，对应 auth 用户仍存在但无法再访问该家庭） */
export async function deleteProfile(profileId: string): Promise<void> {
  const supabase = await requireSupabase()
  const { error } = await supabase.from('profiles').delete().eq('id', profileId)
  if (error) throw error
}

export type FamilyInfo = {
  id: string
  name: string
  invite_code: string
}

/** 当前家庭信息（家庭码分享用） */
export async function fetchCurrentFamily(): Promise<FamilyInfo | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  if (!familyId) return null
  const { data, error } = await supabase
    .from('families')
    .select('id, name, invite_code')
    .eq('id', familyId)
    .maybeSingle()
  if (error) throw error
  return (data as FamilyInfo | null) ?? null
}

export type FamilyMember = {
  id: string
  role: UserRole
  display_name: string | null
  created_at: string
}

/** 当前家庭的全部成员 */
export async function fetchFamilyMembers(): Promise<FamilyMember[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  if (!familyId) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, display_name, created_at')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FamilyMember[]
}

/** 新家庭默认带上的学科，避免新建后底部 Tab 空白 */
export const DEFAULT_SUBJECTS = [
  { name: '语文', color: 'pink', sort_order: 1 },
  { name: '数学', color: 'orange', sort_order: 2 },
  { name: '英语', color: 'blue', sort_order: 3 },
  { name: '思维', color: 'purple', sort_order: 4 },
  { name: '冒险岛', color: 'cyan', sort_order: 6 },
]

export async function seedDefaultSubjects(familyId: string) {
  const supabase = await requireSupabase()
  const { error } = await supabase
    .from('subjects')
    .insert(DEFAULT_SUBJECTS.map((s) => ({ ...s, family_id: familyId, show_in_tab: true })))
  if (error) throw error
}

/** 用邀请码查家庭；不存在时返回 null */
export async function fetchFamilyByInviteCode(code: string): Promise<{ id: string; name: string } | null> {
  const supabase = await requireSupabase()
  // 走 SECURITY DEFINER 的 RPC：families 表本身只允许读自己家庭，
  // 否则等于把全站邀请码对外开放
  const { data, error } = await supabase.rpc('find_family_by_invite_code', { code })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? { id: row.id, name: row.name } : null
}

/** 生成 uuid：非 https 环境（如局域网 http://192.168.x.x:3000）下 crypto.randomUUID 不可用 */
function safeUuid(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 新建家庭，返回 family_id */
export async function insertFamily(params: { name: string; invite_code: string }): Promise<{ id: string }> {
  const supabase = await requireSupabase()
  // id 由客户端生成：插入后再 .select() 取 id 会走 families 的读策略，
  // 而建家庭的那一刻用户还没有 profile，读不到刚插入的行会被 RLS 拦截
  const id = safeUuid()
  const { error } = await supabase.from('families').insert({ id, ...params })
  if (error) throw error
  return { id }
}

// ──────────────────────────────────────────────────────────────────────────────
// AI 生成内容缓存：daily_contents
// ──────────────────────────────────────────────────────────────────────────────

/** 读取某天某类型的 AI 内容缓存（如 type='literacy_story'），无缓存返回 null */
export async function fetchDailyContent(type: string, date: string): Promise<string | null> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('daily_contents').select('content'),
    familyId,
  )
    .eq('type', type)
    .eq('date', date)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.content as string | undefined) ?? null
}

/** 写入 AI 内容缓存（同一天同类型可多条，读取时取最新） */
export async function saveDailyContent(type: string, date: string, content: string) {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { error } = await supabase
    .from('daily_contents')
    .insert({ type, date, content, ...familyPatch(familyId) })
  if (error) throw error
}
