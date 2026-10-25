'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { OfflineCourseCard } from '@/components/offline-course-card'
import { PageHeader } from '@/components/page-header'
import { TaskList } from '@/components/task-list'
import { weekdays, type CheckInTask, type ScheduleEntry, type Subject, type Weekday } from '@/lib/mock-data'
import { fetchStarTotal } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type Props = {
  tasksByDay: Record<Weekday, CheckInTask[]>
  coursesByDay: Record<Weekday, ScheduleEntry[]>
  subjects: Subject[]
  todayWeekday: Weekday
  /** 本周每天的 YYYY-MM-DD，如 { 2: '2026-10-21' } */
  weekDates: Record<Weekday, string>
}

export function TodayView({ tasksByDay, coursesByDay, subjects, todayWeekday, weekDates }: Props) {
  const [selectedDay, setSelectedDay] = useState<Weekday>(todayWeekday)
  const { role } = useAuth()
  const isChild = role === 'child'
  const [starTotal, setStarTotal] = useState<number | null>(null)

  useEffect(() => {
    if (!isChild) return

    let active = true
    const load = () => {
      fetchStarTotal()
        .then((total) => {
          if (active) setStarTotal(total)
        })
        .catch(() => {
          if (active) setStarTotal(0)
        })
    }

    void load()
    window.addEventListener('stars-changed', load)
    return () => {
      active = false
      window.removeEventListener('stars-changed', load)
    }
  }, [isChild])

  const tasks = Array.isArray(tasksByDay?.[selectedDay]) ? tasksByDay[selectedDay] : []
  const courses = Array.isArray(coursesByDay?.[selectedDay]) ? coursesByDay[selectedDay] : []
  // 用 slice() 而非 [...courses] —— 避免某些边缘情况下的 "not iterable" 报错
  const sortedCourses = courses.slice().sort((a, b) => a.startTime.localeCompare(b.startTime))
  const dateKey = weekDates?.[selectedDay] ?? ''

  // 把 YYYY-MM-DD 格式化成 "周二 · 10月21日"
  const selectedWeekday = weekdays.find((w) => w.value === selectedDay)
  const [, mm, dd] = dateKey.split('-')
  const dateLabel = dateKey
    ? `${selectedWeekday?.label ?? ''} · ${Number(mm)}月${Number(dd)}日`
    : selectedWeekday?.label ?? ''

  return (
    <>
      <PageHeader
        title="今日学习"
        subtitle={dateLabel}
      />
      <div className="flex flex-col gap-4 px-5">
        {/* 孩子端：大号星星总数 + 去兑换入口 */}
        {isChild && (
          <section className="rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 px-5 py-5 text-white shadow-lg shadow-amber-200/70">
            <p className="text-center text-lg font-bold drop-shadow-sm">
              ⭐ 我的星星：{starTotal ?? '—'} 颗
            </p>
            <Link
              href="/store"
              className="mt-3 flex h-14 items-center justify-center gap-2 rounded-2xl bg-white text-lg font-black text-orange-500 shadow-md transition-transform active:scale-[0.98]"
            >
              <span aria-hidden="true">🎁</span>
              去兑换
            </Link>
          </section>
        )}
        {/* 顶部周几 Tab —— 本地切换，不刷新页面 */}
        <nav aria-label="选择周几" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {weekdays.map((w) => {
            const active = selectedDay === w.value
            const isToday = w.value === todayWeekday
            const dayNum = Number(weekDates?.[w.value]?.split('-')[2] ?? 0)
            return (
              <button
                key={w.value}
                type="button"
                onClick={() => setSelectedDay(w.value)}
                aria-current={active ? 'date' : undefined}
                className={cn(
                  'flex min-w-[3.2rem] flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                )}
              >
                <span className="text-[11px] opacity-70">{isToday ? '今天' : dayNum}</span>
                <span className="font-semibold">{w.short}</span>
              </button>
            )
          })}
        </nav>

        <OfflineCourseCard
          courses={sortedCourses}
          subjects={subjects}
          dateKey={dateKey}
          isToday={selectedDay === todayWeekday}
        />
        <TaskList tasks={tasks} dateKey={dateKey} />
      </div>
    </>
  )
}
