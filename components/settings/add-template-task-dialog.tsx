'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { mapColorToTint } from '@/lib/supabase-adapter'
import { weekdays, type Weekday } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type TaskPick = {
  id: string
  title: string
  type: 'online' | 'offline' | null
  subject: { id: string; name: string; color: string | null } | null
}

type Props = {
  weekday: Weekday
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 确认回调：把选中的 task_id 列表传出去 */
  onConfirm: (taskIds: string[]) => Promise<void> | void
  /** 这一天已经挂在模板上的 task_id —— 禁用这些 */
  existingTaskIds: string[]
  /** 真实 tasks 列表（带 subjects 级联） */
  allTasks: TaskPick[]
}

export function AddTemplateTaskDialog({ weekday, open, onOpenChange, onConfirm, existingTaskIds, allTasks }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const dayLabel = weekdays.find((w) => w.value === weekday)?.label

  // 按学科分组 —— 让用户在扁平列表里一眼看出"这条属于哪个学科"
  // 但不再强制"选学科→看该学科任务"的两步，而是一次性展示所有
  const grouped = useMemo(() => {
    const groups: { subjectName: string; tint: string; items: TaskPick[] }[] = []
    const bySubject = new Map<string, TaskPick[]>()
    for (const t of allTasks) {
      const key = t.subject?.id ?? '__none__'
      if (!bySubject.has(key)) bySubject.set(key, [])
      bySubject.get(key)!.push(t)
    }
    for (const [, items] of bySubject) {
      const first = items[0]
      const subjectName = first.subject?.name ?? '无学科'
      const tint = first.subject?.color ? mapColorToTint(first.subject.color) : 'bg-slate-100 text-slate-700'
      groups.push({ subjectName, tint, items })
    }
    return groups
  }, [allTasks])

  const close = () => {
    if (!submitting) {
      setSelected([])
      onOpenChange(false)
    }
  }

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))

  const confirm = async () => {
    if (selected.length === 0) return
    setSubmitting(true)
    try {
      await onConfirm(selected)
      close()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>添加任务到{dayLabel}</DialogTitle>
          <DialogDescription>勾选要加入的任务（可多选，已添加的会被禁用）</DialogDescription>
        </DialogHeader>

        {allTasks.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有任何任务，请先去"任务列表"里新建
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto flex flex-col gap-3">
            {grouped.map((g) => (
              <div key={g.subjectName} className="flex flex-col gap-2">
                <span className={cn('inline-block self-start rounded px-2 py-0.5 text-xs font-medium', g.tint)}>
                  {g.subjectName}
                </span>
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((c) => {
                    const added = existingTaskIds.includes(c.id)
                    const checkboxId = `content-${c.id}`
                    return (
                      <li key={c.id}>
                        <label
                          htmlFor={checkboxId}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border p-3 text-sm',
                            added ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-secondary/60',
                          )}
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={added || selected.includes(c.id)}
                            disabled={added}
                            onCheckedChange={(checked) => toggle(c.id, checked === true)}
                          />
                          <span className="flex-1">
                            {c.title}
                            {c.type && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                （{c.type === 'online' ? '线上' : '线下'}）
                              </span>
                            )}
                          </span>
                          {added && <span className="text-xs text-muted-foreground">已添加</span>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>
            取消
          </Button>
          <Button onClick={confirm} disabled={selected.length === 0 || submitting}>
            {submitting ? '提交中…' : `确认添加${selected.length > 0 ? ` (${selected.length})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
