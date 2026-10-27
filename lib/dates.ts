/**
 * 统一的日期工具。
 * 本应用面向国内家庭，所有「今天 / 星期几」一律以北京时间（Asia/Shanghai）为准，
 * 与服务器的运行时时区无关（服务器可能跑在 UTC，直接用 new Date() 会在北京时间 0 点 ~ 8 点之间
 * 把「今天」算成昨天）。
 *
 * 禁止使用 new Date().toISOString().slice(0, 10) 获取今天 —— 那是 UTC 日期。
 */

import type { Weekday } from '@/lib/supabase-adapter'

const BJ_TZ = 'Asia/Shanghai'

/** 北京时间今天，格式 YYYY-MM-DD（如 2026-10-26） */
export function todayStr(): string {
  return new Date()
    .toLocaleDateString('zh-CN', {
      timeZone: BJ_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-')
}

/** YYYY-MM-DD -> 1..7（周一=1 … 周日=7，与数据库 day_of_week 约定一致） */
export function isoDayOfWeek(dateStr: string): Weekday {
  // 取正午解析，避免任何时区边界把日期推回前一天
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay() // 0=周日 … 6=周六
  return (day === 0 ? 7 : day) as Weekday
}

/** YYYY-MM-DD -> 中文星期标签（如「周一」） */
export function weekdayLabelOf(dateStr: string): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[new Date(`${dateStr}T12:00:00`).getDay()]
}

/** YYYY-MM-DD 前后偏移 n 天，返回新的 YYYY-MM-DD */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 连续打卡天数：
 * 1. 去重后倒序排列的日期集合
 * 2. 起点：若今天有打卡则从今天起算，否则从昨天起算（今天还没过完，允许今天还没打卡）
 * 3. 逐天往前推，有记录则 +1，断了就停
 */
export function calcStreak(dates: string[]): number {
  const set = new Set(dates)
  let streak = 0
  let cursor = todayStr()
  if (!set.has(cursor)) cursor = shiftDate(cursor, -1)
  while (set.has(cursor)) {
    streak += 1
    cursor = shiftDate(cursor, -1)
  }
  return streak
}

/** 当前月份日历：返回 { day, dateKey, count }[]，count 为当天打卡次数 */
export function buildCurrentMonthCalendar(checkinDates: string[]) {
  const nowKey = todayStr()
  const year = Number(nowKey.slice(0, 4))
  const month = Number(nowKey.slice(5, 7)) - 1 // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayWeekday = new Date(year, month, 1).getDay() // 0=周日

  const countMap = new Map<string, number>()
  for (const d of checkinDates) countMap.set(d, (countMap.get(d) ?? 0) + 1)

  const cells: { day: number; dateKey: string; count: number }[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const dateKey = `${year}-${mm}-${dd}`
    cells.push({ day, dateKey, count: countMap.get(dateKey) ?? 0 })
  }
  return { year, month: month + 1, firstDayWeekday, cells, today: todayStr() }
}
