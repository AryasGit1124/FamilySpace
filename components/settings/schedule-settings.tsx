'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AddScheduleDialog, type ScheduleEditData } from '@/components/settings/add-schedule-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { mapColorToTint } from '@/lib/supabase-adapter'
import { deleteSchedule, fetchSchedulesWithTasks } from '@/lib/supabase-queries'
import { weekdays, type Weekday } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type SchedulePick = {
  id: string
  day_of_week: number
  start_time: string // "HH:MM:SS"
  duration_minutes: number
  location: string | null
  task: {
    id: string
    title: string
    type: string | null
    subject: { id: string; name: string; color: string | null } | null
  } | null
}

function timeOnly(hhmmss: string) {
  const [h, m] = hhmmss.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  const eh = Math.floor(total / 60) % 24
  const em = total % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

export function ScheduleSettings() {
  const router = useRouter()
  const [rows, setRows] = useState<SchedulePick[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduleEditData | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchSchedulesWithTasks()
      setRows(
        data.map((r) => ({
          id: r.id,
          day_of_week: r.day_of_week,
          start_time: r.start_time,
          duration_minutes: r.duration_minutes,
          location: r.location,
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
    } catch (err) {
      console.error('[ScheduleSettings] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSaved = async () => {
    setEditing(null)
    await load()
    router.refresh()
  }

  const handleAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const handleEdit = (row: SchedulePick) => {
    const task = row.task
    if (!task) return
    const start = timeOnly(row.start_time)
    setEditing({
      scheduleId: row.id,
      taskId: task.id,
      initialWeekdays: [row.day_of_week as Weekday],
      startTime: start,
      durationMinutes: row.duration_minutes,
      location: row.location,
      subjectId: task.subject?.id,
      taskTitle: task.title, // 编辑回填：课程名称、线上线下、学科、周几、时间、地点均可修改
      taskType: task.type === 'online' ? 'online' : 'offline',
    })
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      await deleteSchedule(id)
      router.refresh()
    } catch (err) {
      console.error('[ScheduleSettings] 删除失败:', err)
      await load()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>课表设置</CardTitle>
        <CardDescription>新增课程支持多选周几；课程名称、学科、线上线下、时间、地点、周几均可编辑</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有排课程，点击下方新增
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const task = row.task
              if (!task) return null
              const subject = task.subject
              const tint = subject?.color ? mapColorToTint(subject.color) : 'bg-slate-100 text-slate-700'
              const weekdayLabel = weekdays.find((w) => w.value === row.day_of_week)?.label
              const start = timeOnly(row.start_time)
              const end = addMinutes(start, row.duration_minutes)
              return (
                <li key={row.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold', tint)}>
                    {weekdayLabel?.slice(1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {subject?.name ?? '未关联学科'} · {start} - {end} · {row.location ?? '无地点'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => handleEdit(row)}
                      aria-label={`编辑课程：${task.title}`}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(row.id)}
                      aria-label={`删除课程：${task.title}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <Button variant="outline" className="w-full" onClick={handleAdd} disabled={loading}>
          <Plus aria-hidden="true" />
          新增课程
        </Button>
      </CardContent>
      <AddScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAddedOrEdited={handleSaved}
        editing={editing}
      />
    </Card>
  )
}
