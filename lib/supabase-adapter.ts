import type { CheckInTask, ScheduleEntry, Subject, SubjectId, TaskMode, TaskStatus, Weekday } from '@/lib/mock-data'
import { getTodayWeekday } from '@/lib/mock-data'

/**
 * Supabase 嵌套查询中 weekly_template 行的类型（只列出我们用到的字段）。
 * 实际运行时 Supabase 会返回更多字段，这里用来约束 adapter 的输入。
 */
export type WeeklyTemplateRow = {
  id: string
  day_of_week: number
  task_id: string | null
  /** 临时任务只在指定日期生效；普通周模板为 null */
  specific_date?: string | null
  /** 临时任务的奖励星星数（普通模板为空，按 1 颗处理） */
  stars?: number | null
  tasks: TaskRow | null
}

export type TaskRow = {
  id: string
  subject_id: SubjectId | null
  title: string
  /** DB 字段名：description（不是 detail） */
  description?: string | null
  /** DB 字段名：type（不是 mode），'online' | 'offline' */
  type?: TaskMode | null
  format?: 'teacher' | 'self' | null
  game_route?: string | null
  subjects: SubjectRow | null
}

export type SubjectRow = {
  id: SubjectId
  name: string
  /** DB 里没有 description 字段，替代是 color + sort_order */
  show_in_tab?: boolean | null
  color?: string | null
  sort_order?: number | null
}

/**
 * 把 DB 的 subjects.color 映射成 Tailwind tint（学科 tag 的底色+文字色）。
 * 未命中时给一个安全 fallback。
 */
const colorTintMap: Record<string, string> = {
  pink: 'bg-rose-100 text-rose-700',
  orange: 'bg-orange-100 text-orange-700',
  blue: 'bg-sky-100 text-sky-700',
  purple: 'bg-violet-100 text-violet-700',
  green: 'bg-emerald-100 text-emerald-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-slate-100 text-slate-700',
}
export function mapColorToTint(color?: string | null): string {
  return (color && colorTintMap[color]) ?? colorTintMap.pink
}

/** 学科柱形图用的实色背景 */
const colorSolidMap: Record<string, string> = {
  pink: 'bg-rose-400',
  orange: 'bg-orange-400',
  blue: 'bg-sky-400',
  purple: 'bg-violet-400',
  green: 'bg-emerald-400',
  cyan: 'bg-cyan-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
  gray: 'bg-slate-400',
}
export function mapColorToSolid(color?: string | null): string {
  return (color && colorSolidMap[color]) ?? colorSolidMap.pink
}

/**
 * 把 Supabase 嵌套返回的 weekly_templates 行 + checkinMap，
 * 适配成首页 TaskList 可直接消费的 CheckInTask 数组。
 */
export function adaptWeeklyTemplatesToTasks(
  rows: WeeklyTemplateRow[],
  checkinMap: Record<string, boolean> = {},
): CheckInTask[] {
  return rows
    .map((row) => {
      const task = row.tasks
      if (!task) return null

      const subjectId: SubjectId = task.subject_id ?? ''
      const status: TaskStatus = checkinMap[task.id] ? 'done' : 'todo'

      return {
        id: task.id,
        subjectId,
        title: task.title,
        // DB description → 前端 detail
        detail: task.description ?? '',
        // DB type → 前端 mode，默认 online
        mode: (task.type as TaskMode) ?? 'online',
        format: task.format ?? 'self',
        gameRoute: task.game_route ?? undefined,
        status,
        inWeeklyPlan: true,
        stars: row.stars ?? undefined,
      } satisfies CheckInTask
    })
    .filter((t): t is CheckInTask => t !== null)
}

/** 从 tasks 嵌套结果中抽取唯一的 subjects 列表，按 sort_order 排序、保留原有顺序兜底 */
export function adaptSubjectsFromTemplates(rows: WeeklyTemplateRow[]): Subject[] {
  const seen = new Set<SubjectId>()
  const collected: { s: SubjectRow; order: number }[] = []
  for (const row of rows) {
    const s = row.tasks?.subjects
    if (s && !seen.has(s.id)) {
      seen.add(s.id)
      collected.push({ s, order: s.sort_order ?? 0 })
    }
  }
  collected.sort((a, b) => a.order - b.order)
  return collected.map(({ s }) => ({
    id: s.id,
    name: s.name,
    // DB 里没 description 字段，留空串
    description: '',
    showInTab: s.show_in_tab ?? true,
    color: s.color ?? undefined,
    sortOrder: s.sort_order ?? undefined,
  }))
}

/** 返回今天的日期字符串（本地 YYYY-MM-DD），用于 checkins 查询 */
export function todayDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 计算本周（周一为起点）每一天的 YYYY-MM-DD 日期字符串，
 * 用于首页顶部周几 Tab 切换时，按对应日期查/写 checkins。
 * 返回 { 1: '2026-10-20', 2: '2026-10-21', ... 7: '2026-10-26' }
 */
export function getWeekDates(baseDate = new Date()): Record<Weekday, string> {
  const today = getTodayWeekday(baseDate) // 1=Mon ... 7=Sun
  const monday = new Date(baseDate)
  monday.setDate(baseDate.getDate() - (today - 1))
  monday.setHours(0, 0, 0, 0)

  const result = {} as Record<Weekday, string>
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    result[(i + 1) as Weekday] = todayDateKey(d)
  }
  return result
}

// ──────────────────────────────────────────────────────────────────────────────
// schedules 表适配
// ──────────────────────────────────────────────────────────────────────────────

export type ScheduleRow = {
  id: string
  subject_id: SubjectId | null
  task_id: string | null
  day_of_week: Weekday
  start_time: string // "14:30:00"
  duration_minutes: number
  location: string | null
  tasks: ScheduleTaskRow | null
}

export type ScheduleTaskRow = {
  id: string
  title: string
  type?: TaskMode | null
  subjects: { id: SubjectId } | null
}

/** 把 "14:30:00" 截成 "14:30" */
export function timeOnly(hhmmss: string | null | undefined): string {
  if (!hhmmss) return ''
  const [h, m] = hhmmss.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/** 给定 "HH:MM" + durationMinutes 算出结束时间 "HH:MM" */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  const eh = Math.floor(total / 60) % 24
  const em = total % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

/** 把 Supabase schedules 嵌套行适配成前端 ScheduleEntry */
export function adaptSchedules(rows: ScheduleRow[]): ScheduleEntry[] {
  return rows
    .map((row) => {
      const task = row.tasks
      if (!task) return null
      const subjectId: SubjectId = task.subjects?.id ?? row.subject_id ?? ''
      const start = timeOnly(row.start_time)
      const end = addMinutes(start, row.duration_minutes)
      return {
        id: row.id,
        subjectId,
        taskId: task.id,
        title: task.title,
        location: row.location ?? '',
        weekday: row.day_of_week,
        startTime: start,
        endTime: end,
      } satisfies ScheduleEntry
    })
    .filter((r): r is ScheduleEntry => r !== null)
}

// ──────────────────────────────────────────────────────────────────────────────
// tasks 表用于选择器（学科设置页 / 课表新建弹窗）
// ──────────────────────────────────────────────────────────────────────────────

export type TaskPickerRow = {
  id: string
  subject_id: SubjectId | null
  title: string
  type?: TaskMode | null
  description?: string | null
  subjects: { id: SubjectId; name: string; color?: string | null } | null
}

/** 从 tasks 嵌套结果中抽取 subjects 集合（用于选择器显示名称） */
export function adaptSubjectsFromTasks(rows: TaskPickerRow[]): Subject[] {
  const seen = new Set<SubjectId>()
  const collected: { s: { id: SubjectId; name: string; color?: string | null }; order: number }[] = []
  for (const row of rows) {
    const s = row.subjects
    if (s && !seen.has(s.id)) {
      seen.add(s.id)
      collected.push({ s, order: 0 }) // task picker 不知道 sort_order，先按出现顺序
    }
  }
  return collected.map(({ s }) => ({
    id: s.id,
    name: s.name,
    description: '',
    showInTab: true,
    color: s.color ?? undefined,
  }))
}
