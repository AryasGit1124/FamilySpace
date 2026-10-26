import { TodayView } from '@/components/today-view'
import { weekdays } from '@/lib/mock-data'
import { requireSupabase } from '@/lib/supabase'
import { resolveFamilyId } from '@/lib/family'
import { scoped } from '@/lib/supabase-queries'
import { isoDayOfWeek, shiftDate, todayStr } from '@/lib/dates'
import {
  adaptSchedules,
  adaptSubjectsFromTemplates,
  adaptWeeklyTemplatesToTasks,
} from '@/lib/supabase-adapter'
import type { ScheduleRow, WeeklyTemplateRow } from '@/lib/supabase-adapter'
import type { CheckInTask, ScheduleEntry, Subject, Weekday } from '@/lib/mock-data'

/**
 * 必须强制动态渲染：首页数据来自 Supabase，每次设置页 mutation 后
 * 要能通过 router.refresh() 触发重新查询。如果走静态预渲染（默认），
 * Supabase 查询只在 build 时跑一次，生产环境永远是同一份数据。
 */
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  // 以北京时间为准：服务器可能跑在 UTC，直接 new Date() 会在北京时间 0~8 点把「今天」算成昨天
  const today = todayStr()
  const todayWeekday = isoDayOfWeek(today) // 1=周一 … 7=周日，与数据库 day_of_week 一致
  const mondayStr = shiftDate(today, -(todayWeekday - 1))
  const weekDates = {} as Record<Weekday, string>
  for (let i = 0; i < 7; i += 1) {
    weekDates[(i + 1) as Weekday] = shiftDate(mondayStr, i)
  }

  // ----- 1~3. 并行查整周 templates / checkins / schedules（串行会 3 倍往返延迟） -----
  const [templateRows, checkinMapByDate, scheduleRows] = await Promise.all([
    fetchAllWeeklyTemplates().catch((err: unknown) => {
      console.error('[TodayPage] weekly_templates 查询失败:', err)
      return [] as WeeklyTemplateRow[]
    }),
    fetchWeekCheckins(weekDates[1], weekDates[7]).catch((err: unknown) => {
      console.error('[TodayPage] checkins 查询失败:', err)
      return {} as Record<string, Record<string, boolean>>
    }),
    fetchAllSchedules().catch((err: unknown) => {
      console.error('[TodayPage] schedules 查询失败:', err)
      return [] as ScheduleRow[]
    }),
  ])

  // ----- 4. 按 day_of_week 分组 -----
  const templatesByDay = groupByDay(templateRows)
  const schedulesByDay = groupByDay(scheduleRows)

  // ----- 5. 适配成前端类型（每天一组）-----
  const tasksByDay = {} as Record<Weekday, CheckInTask[]>
  const coursesByDay = {} as Record<Weekday, ScheduleEntry[]>

  for (const { value: day } of weekdays) {
    const dayTemplates = templatesByDay[day] ?? []
    const daySchedules = schedulesByDay[day] ?? []
    const dateKey = weekDates[day]
    const dayCheckinMap = checkinMapByDate[dateKey] ?? {}
    tasksByDay[day] = adaptWeeklyTemplatesToTasks(dayTemplates, dayCheckinMap)
    coursesByDay[day] = adaptSchedules(daySchedules)
  }

  // ----- 6. subjects = 整周模板 + 整周课表合并去重 -----
  const scheduleSubjectRows = scheduleRows
    .map((r) => r.tasks?.subjects)
    .filter(Boolean) as { id: string; name: string; color?: string | null; sort_order?: number | null }[]
  const scheduleSubjects: Subject[] = scheduleSubjectRows.map((s) => ({
    id: s.id,
    name: s.name,
    description: '',
    showInTab: true,
    color: s.color ?? undefined,
    sortOrder: s.sort_order ?? undefined,
  }))
  const templateSubjects = adaptSubjectsFromTemplates(templateRows)
  const merged: Subject[] = []
  const seenIds = new Set<string>()
  for (const s of templateSubjects) {
    merged.push(s)
    seenIds.add(s.id)
  }
  for (const s of scheduleSubjects) {
    if (!seenIds.has(s.id)) {
      merged.push(s)
      seenIds.add(s.id)
    }
  }

  return (
    <TodayView
      tasksByDay={tasksByDay}
      coursesByDay={coursesByDay}
      subjects={merged}
      todayWeekday={todayWeekday}
      weekDates={weekDates}
    />
  )
}

/** 查询整周 weekly_templates 并级联 tasks + subjects（不带 day_of_week 过滤） */
async function fetchAllWeeklyTemplates(): Promise<WeeklyTemplateRow[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('weekly_templates').select(
      `
        id,
        day_of_week,
        task_id,
        tasks (
          id,
          subject_id,
          title,
          description,
          type,
          format,
          game_route,
          subjects (
            id,
            name,
            show_in_tab,
            color,
            sort_order
          )
        )
      `.trim(),
    ),
    familyId,
  ).order('day_of_week')

  if (error) throw error
  return data ?? []
}

/** 查询本周 checkins，返回 { [dateKey]: { [task_id]: true } } */
async function fetchWeekCheckins(
  startDate: string,
  endDate: string,
): Promise<Record<string, Record<string, boolean>>> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('checkins').select('task_id, checkin_date'),
    familyId,
  )
    .gte('checkin_date', startDate)
    .lte('checkin_date', endDate)

  if (error) throw error
  const map: Record<string, Record<string, boolean>> = {}
  for (const row of data ?? []) {
    if (!row.task_id) continue
    const dateKey = String(row.checkin_date) // '2026-10-23'
    if (!map[dateKey]) map[dateKey] = {}
    map[dateKey][row.task_id] = true
  }
  return map
}

/** 查询整周 schedules 并级联 tasks + subjects（不带 day_of_week 过滤） */
async function fetchAllSchedules(): Promise<ScheduleRow[]> {
  const supabase = await requireSupabase()
  const familyId = await resolveFamilyId()
  const { data, error } = await scoped(
    supabase.from('schedules').select(
      `
        id,
        subject_id,
        task_id,
        day_of_week,
        start_time,
        duration_minutes,
        location,
        tasks (
          id,
          title,
          type,
          subjects (
            id,
            name,
            color,
            sort_order
          )
        )
      `.trim(),
    ),
    familyId,
  )
    .order('day_of_week')
    .order('start_time')

  if (error) throw error
  return data ?? []
}

/** 按 day_of_week 分组（1..7） */
function groupByDay<T extends { day_of_week: number }>(rows: T[]): Record<Weekday, T[]> {
  const result = {} as Record<Weekday, T[]>
  for (const row of rows) {
    const day = row.day_of_week as Weekday
    if (!result[day]) result[day] = []
    result[day].push(row)
  }
  return result
}
