import Link from 'next/link'
import { CalendarDays, Clock, MapPin } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { weekdays, type ScheduleEntry, type Subject } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

export function OfflineCourseCard({
  courses,
  subjects,
  title = '线下课程',
  description,
  showWeekday = false,
  dateKey,
  isToday = false,
}: {
  courses: ScheduleEntry[]
  subjects: Subject[]
  title?: string
  description?: string
  showWeekday?: boolean
  /** 课程对应的日期（YYYY-MM-DD），传入后每节课可点击跳转 */
  dateKey?: string
  /** 是否为当天：当天课程点击跳上传页，其他天跳资料库页 */
  isToday?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description ??
            (courses.length > 0
              ? `今天有 ${courses.length} 节课${dateKey ? (isToday ? '，点击课程上传资料' : '，点击课程查看资料') : ''}`
              : '今天没有线下课程')}
        </CardDescription>
      </CardHeader>
      {courses.length > 0 && (
        <CardContent>
          <ul className="flex flex-col gap-3">
            {courses.map((course) => {
              const meta = getSubjectMeta(course.subjectId)
              const subjectName = subjects.find((s) => s.id === course.subjectId)?.name
              const Icon = meta.icon
              const body = (
                <>
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', meta.tint)}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {course.title}
                      <span className="sr-only">（{subjectName}）</span>
                    </p>
                    <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {showWeekday ? (
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Clock className="size-3.5" aria-hidden="true" />
                        )}
                        {showWeekday && `${weekdays[course.weekday - 1].label} · `}
                        {course.startTime} - {course.endTime}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5" aria-hidden="true" />
                        <span className="truncate">{course.location}</span>
                      </span>
                    </div>
                  </div>
                </>
              )
              // 当天课程 → 上传页（预选该课程 + 当天日期）；其他天 → 该课程资料库页
              let href: string | null = null
              if (dateKey) {
                if (isToday) {
                  const params = new URLSearchParams()
                  if (course.taskId) params.set('courseId', course.taskId)
                  params.set('date', dateKey)
                  href = `/upload?${params.toString()}`
                } else {
                  href = `/library?course=${encodeURIComponent(course.title)}&latest=1`
                }
              }
              return (
                <li key={course.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex gap-3 rounded-xl bg-muted p-3 transition-colors hover:bg-muted/70"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3 rounded-xl bg-muted p-3">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  )
}
