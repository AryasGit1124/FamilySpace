'use client'

import Link from 'next/link'
import { useAppState } from '@/components/app-state-provider'
import { PageHeader } from '@/components/page-header'
import { SubjectScheduleCard } from '@/components/subject-schedule-card'
import { TaskList } from '@/components/task-list'
import type { SubjectId } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

export function SubjectView({ subjectId }: { subjectId: SubjectId }) {
  const { subjects, tasks } = useAppState()
  const subject = subjects.find((s) => s.id === subjectId)

  if (!subject) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-20 text-center">
        <p className="font-medium">找不到这个学科</p>
        <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
          返回今日
        </Link>
      </div>
    )
  }

  const meta = getSubjectMeta(subjectId)
  const Icon = meta.icon

  return (
    <>
      <PageHeader
        title={subject.name}
        subtitle={subject.description}
        action={
          <span className={cn('flex size-12 items-center justify-center rounded-2xl', meta.tint)}>
            <Icon className="size-6" aria-hidden="true" />
          </span>
        }
      />
      <div className="flex flex-col gap-6 px-5">
        <SubjectScheduleCard subjectId={subjectId} />
        <TaskList tasks={tasks.filter((t) => t.subjectId === subjectId)} showSubject={false} />
      </div>
    </>
  )
}
