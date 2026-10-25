'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AddTemplateTaskDialog } from '@/components/settings/add-template-task-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { mapColorToTint } from '@/lib/supabase-adapter'
import { deleteWeeklyTemplate, fetchTasksWithSubjects, fetchWeeklyTemplatesWithTasks, insertWeeklyTemplate } from '@/lib/supabase-queries'
import { weekdays, type Weekday } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type TaskPick = {
  id: string
  title: string
  type: 'online' | 'offline' | null
  subject: { id: string; name: string; color: string | null } | null
}

type TemplateRow = {
  id: string
  day_of_week: Weekday
  task_id: string
  task: TaskPick | null
}

export function WeeklyTemplateSettings() {
  const router = useRouter()
  const [day, setDay] = useState<Weekday>(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [allTasks, setAllTasks] = useState<TaskPick[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [templates, tasks] = await Promise.all([
        fetchWeeklyTemplatesWithTasks(),
        fetchTasksWithSubjects(),
      ])

      setRows(
        templates.map((r) => ({
          id: r.id,
          day_of_week: r.day_of_week as Weekday,
          task_id: r.task_id,
          task: r.tasks
            ? {
                id: r.tasks.id,
                title: r.tasks.title,
                type: r.tasks.type,
                subject: r.tasks.subjects
                  ? { id: r.tasks.subjects.id, name: r.tasks.subjects.name, color: r.tasks.subjects.color ?? null }
                  : null,
              }
            : null,
        })),
      )

      setAllTasks(
        tasks.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          subject: t.subjects
            ? { id: t.subjects.id, name: t.subjects.name, color: t.subjects.color ?? null }
            : null,
        })),
      )
    } catch (err) {
      console.error('[WeeklyTemplateSettings] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const dayLabel = weekdays.find((w) => w.value === day)?.label
  const items = rows.filter((r) => r.day_of_week === day && r.task)

  const handleAdd = async (taskIds: string[]) => {
    try {
      await Promise.all(taskIds.map((id) => insertWeeklyTemplate(id, day)))
      await load()
      router.refresh()
    } catch (err) {
      console.error('[WeeklyTemplateSettings] 添加失败:', err)
    }
  }

  const handleRemove = async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      await deleteWeeklyTemplate(id)
      router.refresh()
    } catch (err) {
      console.error('[WeeklyTemplateSettings] 删除失败:', err)
      await load()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>每周任务模板</CardTitle>
        <CardDescription>为一周中的每一天设置固定打卡任务</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={String(day)} onValueChange={(v) => setDay(Number(v) as Weekday)}>
          <TabsList className="h-9 w-full">
            {weekdays.map((w) => (
              <TabsTrigger key={w.value} value={String(w.value)} className="px-0">
                <span className="sr-only">{w.label}</span>
                <span aria-hidden="true">{w.short}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {loading ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            <section aria-label={`${dayLabel}打卡任务`} className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {dayLabel} · 共 {items.length} 项任务
              </p>
              {items.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {dayLabel}还没有任务，点击下方添加
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((item) => {
                    const subject = item.task!.subject
                    const tint = subject?.color ? mapColorToTint(subject.color) : 'bg-slate-100 text-slate-700'
                    return (
                      <li key={item.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.task!.title}</p>
                          {subject && (
                            <span className={cn('mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium', tint)}>
                              {subject.name}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemove(item.id)}
                          aria-label={`删除任务：${item.task!.title}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <Button variant="outline" className="w-full" onClick={() => setDialogOpen(true)}>
              <Plus aria-hidden="true" />
              添加任务
            </Button>
          </>
        )}
      </CardContent>
      <AddTemplateTaskDialog
        weekday={day}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleAdd}
        existingTaskIds={rows.filter((r) => r.day_of_week === day).map((r) => r.task_id)}
        allTasks={allTasks}
      />
    </Card>
  )
}
