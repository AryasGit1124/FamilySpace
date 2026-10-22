'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import { useAppState } from '@/components/app-state-provider'
import { PageHeader } from '@/components/page-header'
import { ScheduleCellDialog, type ScheduleCell } from '@/components/schedule-cell-dialog'
import { Button } from '@/components/ui/button'
import { getTodayWeekday, weekdays } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

export function WeekScheduleView() {
  const { subjects, scheduleGrid, courseOptions } = useAppState()
  const [cell, setCell] = useState<ScheduleCell | null>(null)
  const today = getTodayWeekday()

  return (
    <>
      <PageHeader
        title="周课表"
        subtitle="点击格子安排课程"
        action={
          <Button variant="outline" size="sm" render={<Link href="/settings" />} nativeButton={false}>
            <ChevronLeft aria-hidden="true" />
            返回设置
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-5">
        <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">配置后会展示在对应学科页</p>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-20 border-r border-b bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                >
                  学科
                </th>
                {weekdays.map((w) => (
                  <th
                    key={w.value}
                    scope="col"
                    className={cn(
                      'min-w-24 border-b px-2 py-2 text-center text-xs font-medium',
                      w.value === today ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {w.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => {
                const meta = getSubjectMeta(subject.id)
                return (
                  <tr key={subject.id}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-b bg-card px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      {subject.name}
                    </th>
                    {weekdays.map((w) => {
                      const courseId = scheduleGrid[subject.id]?.[w.value]
                      const course = courseOptions.find((c) => c.id === courseId)
                      return (
                        <td key={w.value} className="border-b p-1.5">
                          <button
                            type="button"
                            onClick={() => setCell({ subjectId: subject.id, weekday: w.value })}
                            aria-label={`${subject.name} ${w.label}：${course ? course.name : '未安排，点击添加'}`}
                            className={cn(
                              'flex h-14 w-full items-center justify-center rounded-lg px-1.5 text-xs leading-tight transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                              course
                                ? cn(meta.tint, 'font-medium hover:opacity-80')
                                : 'border border-dashed text-muted-foreground hover:border-primary hover:text-primary',
                            )}
                          >
                            {course ? course.name : <Plus className="size-4" aria-hidden="true" />}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <ScheduleCellDialog cell={cell} onClose={() => setCell(null)} />
    </>
  )
}
