import { PageHeader } from '@/components/page-header'
import {
  fetchCheckinDates,
  fetchRecentCheckins,
  fetchSubjectCheckinCounts,
  fetchTotalEarnedStars,
} from '@/lib/supabase-queries'
import { shiftDate, todayStr } from '@/lib/dates'
import { StatsView } from './stats-view'

/** 统计页每次进入重新拉取数据 */
export const dynamic = 'force-dynamic'

/** 今天的日期 key（YYYY-MM-DD，北京时间，与服务器运行时时区无关） */
function todayKey(): string {
  return todayStr()
}

/** 给定日期 key，返回前一天的 key */
function prevDayKey(key: string): string {
  return shiftDate(key, -1)
}

/**
 * 连续打卡天数：
 * 1. 去重后倒序排列的日期集合
 * 2. 起点：若今天有打卡则从今天起算，否则从昨天起算（今天还没过完，允许今天还没打卡）
 * 3. 逐天往前推，有记录则 +1，断了就停
 */
function calcStreak(dates: string[]): number {
  const set = new Set(dates)
  let streak = 0
  let cursor = todayKey()
  if (!set.has(cursor)) cursor = prevDayKey(cursor)
  while (set.has(cursor)) {
    streak += 1
    cursor = prevDayKey(cursor)
  }
  return streak
}

/** 把 created_at（ISO 字符串）转成相对时间描述：10分钟前 / 2小时前 / 3天前 */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  return iso.slice(0, 10)
}

/** 当前月份日历：返回 { day, dateKey, count }[]，count 为当天打卡次数 */
function buildCurrentMonthCalendar(checkinDates: string[]) {
  const nowKey = todayStr()
  const year = Number(nowKey.slice(0, 4))
  const month = Number(nowKey.slice(5, 7)) - 1 // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayWeekday = new Date(year, month, 1).getDay() // 0=周日

  // 统计每天打卡次数
  const countMap = new Map<string, number>()
  for (const d of checkinDates) countMap.set(d, (countMap.get(d) ?? 0) + 1)

  const cells: { day: number; dateKey: string; count: number }[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const dateKey = `${year}-${mm}-${dd}`
    cells.push({ day, dateKey, count: countMap.get(dateKey) ?? 0 })
  }
  return { year, month: month + 1, firstDayWeekday, cells, today: todayKey() }
}

export default async function StatsPage() {
  const [checkinDates, earnedStars, subjectCounts, recentCheckins] = await Promise.all([
    fetchCheckinDates(90).catch((err: unknown) => {
      console.error('[StatsPage] 读取打卡记录失败:', err)
      return [] as string[]
    }),
    fetchTotalEarnedStars().catch((err: unknown) => {
      console.error('[StatsPage] 读取星星记录失败:', err)
      return 0
    }),
    fetchSubjectCheckinCounts().catch((err: unknown) => {
      console.error('[StatsPage] 读取学科分布失败:', err)
      return []
    }),
    fetchRecentCheckins(10).catch((err: unknown) => {
      console.error('[StatsPage] 读取最近打卡失败:', err)
      return []
    }),
  ])

  const uniqueDays = new Set(checkinDates)
  const totalDays = uniqueDays.size
  const streak = calcStreak(checkinDates)
  const calendar = buildCurrentMonthCalendar(checkinDates)
  const maxSubjectCount = Math.max(1, ...subjectCounts.map((s) => s.count))
  const timeline = recentCheckins.map((r) => ({
    ...r,
    timeAgo: timeAgo(r.createdAt),
  }))

  return (
    <>
      <PageHeader title="学习统计" subtitle="孩子的成长足迹" backHref="/" backLabel="返回首页" />
      <StatsView
        totalDays={totalDays}
        streak={streak}
        earnedStars={earnedStars}
        calendar={calendar}
        subjectCounts={subjectCounts}
        maxSubjectCount={maxSubjectCount}
        timeline={timeline}
      />
    </>
  )
}
