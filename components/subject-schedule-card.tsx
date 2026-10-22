'use client'

import Link from 'next/link'
import { useAppState } from '@/components/app-state-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getTodayWeekday, weekdays, type SubjectId } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

export function SubjectScheduleCard({ subjectId }: { subjectId: SubjectId }) {
  const { scheduleGrid, courseOptions } = useAppState()
  const today = getTodayWeekday()
  const meta = getSubjectMeta(subjectId)
  const row = scheduleGrid[subjectId] ?? {}
  const entries = weekdays
    .map((w) => ({ ...w, course: courseOptions.find((c) => c.id === row[w.value]) }))
    .filter((e) => e.course !== undefined)

  return (
    <Card>
      <CardHeader>
        <CardTitle>本周课表</CardTitle>
        <CardDescription>{entries.length > 0 ? `每周 ${entries.length} 节课` : '暂未安排课程'}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <Link
            href="/schedule"
            className="block rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground hover:border-primary hover:text-primary"
          >
            去周课表中安排课程
          </Link>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li
                key={e.value}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3',
                  e.value === today && 'border-primary bg-primary/5',
                )}
              >
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold', meta.tint)}>
                  {e.short}
                </span>
                <p className="flex-1 text-sm font-medium">{e.course?.name}</p>
                {e.value === today && <span className="text-xs font-medium text-primary">今天</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
