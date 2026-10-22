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
}: {
  courses: ScheduleEntry[]
  subjects: Subject[]
  title?: string
  description?: string
  showWeekday?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description ?? (courses.length > 0 ? `今天有 ${courses.length} 节课` : '今天没有线下课程')}
        </CardDescription>
      </CardHeader>
      {courses.length > 0 && (
        <CardContent>
          <ul className="flex flex-col gap-3">
            {courses.map((course) => {
              const meta = getSubjectMeta(course.subjectId)
              const subjectName = subjects.find((s) => s.id === course.subjectId)?.name
              const Icon = meta.icon
              return (
                <li key={course.id} className="flex gap-3 rounded-xl bg-muted p-3">
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
                </li>
              )
            })}
          </ul>
        </CardContent>
      )}
    </Card>
  )
}
