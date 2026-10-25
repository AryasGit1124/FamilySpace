'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { fetchSubjects } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type SubjectRow = { id: string; name: string }

export type TaskEditData = {
  id: string
  subject_id: string
  title: string
  type: 'online' | 'offline'
  format: 'teacher' | 'self'
  description: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: {
    subject_id: string
    title: string
    type: 'online' | 'offline'
    format: 'teacher' | 'self'
    description: string | null
  }) => Promise<void> | void
  /** 编辑模式：传入后回填 + 标题变成"编辑任务" */
  editing?: TaskEditData | null
}

export function AddTaskDialog({ open, onOpenChange, onSubmit, editing }: Props) {
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectId, setSubjectId] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<'online' | 'offline'>('offline')
  const [format, setFormat] = useState<'teacher' | 'self'>('self')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isEditMode = !!editing

  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      try {
        const rows = await fetchSubjects()
        if (!alive) return
        setSubjects(rows.map((r) => ({ id: r.id, name: r.name })))
        if (editing) {
          setSubjectId(editing.subject_id)
          setTitle(editing.title)
          setType(editing.type)
          setFormat(editing.format)
          setDescription(editing.description ?? '')
        } else {
          setSubjectId(rows[0]?.id ?? '')
          setTitle('')
          setType('offline')
          setFormat('self')
          setDescription('')
        }
      } catch (err) {
        console.error('[AddTaskDialog] 加载失败:', err)
      }
    })()
    return () => { alive = false }
  }, [open, editing])

  const close = () => {
    if (!submitting) {
      setErrorMsg(null)
      onOpenChange(false)
    }
  }

  const valid = !!subjectId && title.trim().length > 0

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      await onSubmit?.({
        subject_id: subjectId,
        title: title.trim(),
        type,
        format,
        description: description.trim() || null,
      })
      close()
    } catch (err) {
      console.error('[AddTaskDialog] 提交失败:', err)
      setErrorMsg(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEditMode ? '编辑任务' : '新建任务'}</DialogTitle>
            <DialogDescription>任务会出现在"每周任务模板"的选择器里</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-subject">学科</Label>
            <select
              id="t-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {subjects.length === 0 && <option value="">—— 请先去学科设置里添加学科 ——</option>}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-title">任务名称</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：识字乐园"
              maxLength={30}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>线上/线下</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType('offline')}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    type === 'offline' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                  )}
                >线下</button>
                <button
                  type="button"
                  onClick={() => setType('online')}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    type === 'online' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                  )}
                >线上</button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>授课/自学</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormat('teacher')}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    format === 'teacher' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                  )}
                >老师授课</button>
                <button
                  type="button"
                  onClick={() => setFormat('self')}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    format === 'self' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                  )}
                >自学</button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-desc">备注（可选）</Label>
            <textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要说明这个任务要做什么、怎么做"
              rows={2}
              maxLength={200}
              className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none resize-none"
            />
          </div>

          {errorMsg && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</p>}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting ? '保存中…' : isEditMode ? '保存修改' : '确认添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
