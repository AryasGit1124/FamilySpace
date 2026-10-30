'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mapColorToTint } from '@/lib/supabase-adapter'
import {
  addTempTasksToDay,
  createTempTaskForDay,
  fetchSubjects,
  fetchTasksWithSubjects,
} from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type TaskPick = {
  id: string
  title: string
  type: 'online' | 'offline' | null
  subject: { id: string; name: string; color: string | null } | null
}

type SubjectPick = { id: string; name: string }

type AddMode = 'library' | 'custom'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 加到哪一天（YYYY-MM-DD） */
  dateKey: string
  /** 这一天已存在的任务 id —— 任务库里的这些条目禁用 */
  existingTaskIds: string[]
  /** 添加成功后通知父组件刷新今日任务列表 */
  onAdded: () => void
}

/** 首页「添加临时任务」弹窗：从任务库多选，或自定义输入新建 */
export function AddTempTaskDialog({ open, onOpenChange, dateKey, existingTaskIds, onAdded }: Props) {
  const [mode, setMode] = useState<AddMode>('library')
  const [subjects, setSubjects] = useState<SubjectPick[]>([])
  const [allTasks, setAllTasks] = useState<TaskPick[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  // 自定义输入表单
  const [title, setTitle] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [stars, setStars] = useState(1)

  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [, mm, dd] = dateKey.split('-')
  const dateLabel = dateKey ? `${Number(mm)}月${Number(dd)}日` : '今天'

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const [subjectRows, taskRows] = await Promise.all([fetchSubjects(), fetchTasksWithSubjects()])
      setSubjects(subjectRows.map((r) => ({ id: r.id, name: r.name })))
      setAllTasks(
        taskRows.map((r) => ({
          id: r.id,
          title: r.title,
          type: (r.type as 'online' | 'offline' | null) ?? null,
          subject: r.subjects
            ? { id: r.subjects.id, name: r.subjects.name, color: r.subjects.color ?? null }
            : null,
        })),
      )
    } catch (err) {
      console.error('[AddTempTaskDialog] 加载失败:', err)
      setErrorMsg('加载任务库失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    setMode('library')
    setSelected([])
    setTitle('')
    setSubjectId('')
    setStars(1)
    setErrorMsg(null)
  }, [open, load])

  // 学科默认选中第一个，避免用户忘了选
  useEffect(() => {
    if (!open || subjectId) return
    if (subjects.length > 0) setSubjectId(subjects[0].id)
  }, [open, subjects, subjectId])

  const grouped = useMemo(() => {
    const groups: { name: string; tint: string; items: TaskPick[] }[] = []
    const bySubject = new Map<string, TaskPick[]>()
    for (const t of allTasks) {
      const key = t.subject?.id ?? '__none__'
      if (!bySubject.has(key)) bySubject.set(key, [])
      bySubject.get(key)!.push(t)
    }
    for (const [, items] of bySubject) {
      const first = items[0]
      groups.push({
        name: first.subject?.name ?? '无学科',
        tint: first.subject?.color ? mapColorToTint(first.subject.color) : 'bg-slate-100 text-slate-700',
        items,
      })
    }
    return groups
  }, [allTasks])

  const close = () => {
    if (!submitting) onOpenChange(false)
  }

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))

  const canSubmit =
    mode === 'library' ? selected.length > 0 : Boolean(title.trim() && subjectId)

  const confirm = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (mode === 'library') {
        await addTempTasksToDay(selected, dateKey)
      } else {
        await createTempTaskForDay({
          subject_id: subjectId,
          title: title.trim(),
          type: 'offline',
          stars,
          task_date: dateKey,
        })
      }
      onAdded()
      close()
    } catch (err: unknown) {
      console.error('[AddTempTaskDialog] 添加失败:', err)
      setErrorMsg(err instanceof Error ? err.message : '添加失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加临时任务</DialogTitle>
          <DialogDescription>只加入 {dateLabel} 这一天，不影响每周计划</DialogDescription>
        </DialogHeader>

        {/* 顶部两个 Tab */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { key: 'library', label: '从任务库选择' },
              { key: 'custom', label: '自定义输入' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                'flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                mode === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'library' ? (
          loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
          ) : allTasks.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              还没有任何任务，可以切到「自定义输入」新建一条
            </p>
          ) : (
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
              {grouped.map((g) => (
                <div key={g.name} className="flex flex-col gap-2">
                  <span className={cn('inline-block self-start rounded px-2 py-0.5 text-xs font-medium', g.tint)}>
                    {g.name}
                  </span>
                  <ul className="flex flex-col gap-1.5">
                    {g.items.map((t) => {
                      const added = existingTaskIds.includes(t.id)
                      const checkboxId = `temp-task-${t.id}`
                      return (
                        <li key={t.id}>
                          <label
                            htmlFor={checkboxId}
                            className={cn(
                              'flex items-center gap-3 rounded-xl border p-3 text-sm',
                              added
                                ? 'cursor-not-allowed opacity-60'
                                : 'cursor-pointer hover:bg-secondary/60',
                            )}
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={added || selected.includes(t.id)}
                              disabled={added}
                              onCheckedChange={(checked) => toggle(t.id, checked === true)}
                            />
                            <span className="flex-1">
                              {t.title}
                              {t.type && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  （{t.type === 'online' ? '线上' : '线下'}）
                                </span>
                              )}
                            </span>
                            {added && <span className="text-xs text-muted-foreground">已在今日</span>}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="temp-title">任务名称</Label>
              <Input
                id="temp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：跳绳 100 下"
                maxLength={30}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="temp-subject">所属学科</Label>
              <select
                id="temp-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="temp-stars">奖励星星数</Label>
              <Input
                id="temp-stars"
                type="number"
                min={0}
                max={10}
                value={stars}
                onChange={(e) => setStars(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>
            取消
          </Button>
          <Button onClick={confirm} disabled={!canSubmit || submitting}>
            {submitting ? '添加中…' : mode === 'library' && selected.length > 0 ? `确认添加 (${selected.length})` : '确认添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
