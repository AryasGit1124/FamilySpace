'use client'

import { Monitor, School } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { useAppState } from '@/components/app-state-provider'
import type { CheckInTask } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

const modeLabel = { online: '线上', offline: '线下' } as const
const doneLabel = { online: '已打卡', offline: '已签到' } as const
const todoLabel = { online: '待打卡', offline: '待签到' } as const

export function TaskList({ tasks, showSubject = true }: { tasks: CheckInTask[]; showSubject?: boolean }) {
  const { subjects, toggleTask } = useAppState()
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const percent = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0

  return (
    <section aria-labelledby="task-list-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 id="task-list-title" className="text-lg font-bold">
          打卡任务
        </h2>
        <span className="text-sm text-muted-foreground">
          {doneCount}/{tasks.length} 已完成
        </span>
      </div>
      <Progress value={percent} aria-label={`完成进度 ${percent}%`} />

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">暂无打卡任务</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const done = task.status === 'done'
            const meta = getSubjectMeta(task.subjectId)
            const subjectName = subjects.find((s) => s.id === task.subjectId)?.name
            const ModeIcon = task.mode === 'online' ? Monitor : School
            const inputId = `task-${task.id}`
            return (
              <li key={task.id}>
                <label
                  htmlFor={inputId}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/60',
                    done && 'bg-muted/50',
                  )}
                >
                  <Checkbox id={inputId} checked={done} onCheckedChange={() => toggleTask(task.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {showSubject && (
                        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', meta.tint)}>
                          {subjectName}
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          task.mode === 'online'
                            ? 'border-sky-200 text-sky-700'
                            : 'border-amber-200 text-amber-700',
                        )}
                      >
                        <ModeIcon data-icon="inline-start" aria-hidden="true" />
                        {modeLabel[task.mode]}
                      </Badge>
                    </div>
                    <p className={cn('mt-1 font-medium', done && 'text-muted-foreground line-through')}>{task.title}</p>
                    <p className="text-xs text-muted-foreground">{task.detail}</p>
                  </div>
                  <Badge
                    variant={done ? 'secondary' : 'outline'}
                    className={cn(!done && 'text-muted-foreground')}
                  >
                    {done ? doneLabel[task.mode] : todoLabel[task.mode]}
                  </Badge>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
