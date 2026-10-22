'use client'

import { useAppState } from '@/components/app-state-provider'
import { OfflineCourseCard } from '@/components/offline-course-card'
import { PageHeader } from '@/components/page-header'
import { TaskList } from '@/components/task-list'
import { getTodayWeekday } from '@/lib/mock-data'

export function TodayView() {
  const { schedule, tasks, subjects } = useAppState()
  const now = new Date()
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)
  const weekday = getTodayWeekday(now)
  const todayCourses = schedule
    .filter((c) => c.weekday === weekday)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  return (
    <>
      <PageHeader title="今日学习" subtitle={today} />
      <div className="flex flex-col gap-6 px-5">
        <OfflineCourseCard courses={todayCourses} subjects={subjects} />
        <TaskList tasks={tasks.filter((t) => t.inWeeklyPlan)} />
      </div>
    </>
  )
}
