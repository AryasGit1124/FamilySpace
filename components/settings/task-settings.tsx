'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AddTaskDialog, type TaskEditData } from '@/components/settings/add-task-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { mapColorToTint } from '@/lib/supabase-adapter'
import { deleteTask, fetchSubjects, fetchTasksWithSubjects, insertTask, updateTask } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type SubjectRow = { id: string; name: string; color: string | null }
type TaskRow = {
  id: string
  title: string
  type: 'online' | 'offline' | null
  format: 'teacher' | 'self' | null
  description: string | null
  subject: { id: string; name: string; color: string | null } | null
}

export function TaskSettings() {
  const router = useRouter()
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [subjectFilter, setSubjectFilter] = useState<string>('') // '' = 全部
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TaskEditData | null>(null)
  const [confirmDel, setConfirmDel] = useState<TaskRow | null>(null)

  const load = useCallback(async () => {
    try {
      const [subjRows, taskRows] = await Promise.all([fetchSubjects(), fetchTasksWithSubjects()])
      setSubjects(
        subjRows.map((r) => ({ id: r.id, name: r.name, color: r.color ?? null })),
      )
      setTasks(
        taskRows.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type === 'online' || r.type === 'offline' ? r.type : null,
          format: r.format === 'teacher' || r.format === 'self' ? r.format : null,
          description: r.description,
          subject: r.subjects
            ? { id: r.subjects.id, name: r.subjects.name, color: r.subjects.color ?? null }
            : null,
        })),
      )
    } catch (err) {
      console.error('[TaskSettings] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = subjectFilter
    ? tasks.filter((t) => t.subject?.id === subjectFilter)
    : tasks

  const handleSaved = async (data: {
    subject_id: string
    title: string
    type: 'online' | 'offline'
    format: 'teacher' | 'self'
    description: string | null
  }) => {
    if (editing) {
      await updateTask(editing.id, data)
    } else {
      await insertTask(data)
    }
    setEditing(null)
    await load()
    router.refresh()
  }

  const handleDelete = async (task: TaskRow) => {
    const id = task.id
    // 乐观更新
    setTasks((prev) => prev.filter((t) => t.id !== id))
    try {
      await deleteTask(id)
      await load()
      router.refresh()
    } catch (err) {
      console.error('[TaskSettings] 删除失败:', err)
      await load()
    } finally {
      setConfirmDel(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>任务列表</CardTitle>
        <CardDescription>
          配置学科里的任务内容；"每周任务模板"和"课表设置"都会用到这里的任务
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 学科筛选 */}
        {subjects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSubjectFilter('')}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                subjectFilter === ''
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-secondary',
              )}
            >全部学科（{tasks.length}）</button>
            {subjects.map((s) => {
              const count = tasks.filter((t) => t.subject?.id === s.id).length
              const active = subjectFilter === s.id
              const tint = s.color ? mapColorToTint(s.color) : 'bg-slate-100 text-slate-700'
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSubjectFilter(s.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    active ? 'border-primary bg-primary text-primary-foreground' : cn(tint, 'hover:opacity-80'),
                  )}
                >
                  {s.name}{count > 0 ? `（${count}）` : ''}
                </button>
              )
            })}
          </div>
        )}

        {loading ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有任何任务，点击下方新增
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            该学科下暂无任务
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((t) => {
              return (
                <li key={t.id} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    {/* 选中具体学科 tab 时只显示任务名称；"全部学科"视图才展示学科/类型/描述 */}
                    {!subjectFilter && (
                      <>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {t.subject && (
                            <span
                              className={cn(
                                'rounded px-2 py-0.5 text-[11px] font-medium',
                                t.subject.color
                                  ? mapColorToTint(t.subject.color)
                                  : 'bg-slate-100 text-slate-700',
                              )}
                            >
                              {t.subject.name}
                            </span>
                          )}
                          {t.type && (
                            <Badge variant="outline" className={cn(
                              t.type === 'online'
                                ? 'border-sky-200 text-sky-700'
                                : 'border-amber-200 text-amber-700',
                            )}>
                              {t.type === 'online' ? '线上' : '线下'}
                            </Badge>
                          )}
                          {t.format && (
                            <Badge variant="outline">
                              {t.format === 'teacher' ? '老师授课' : '自学'}
                            </Badge>
                          )}
                        </div>
                        {t.description && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => {
                        setEditing({
                          id: t.id,
                          subject_id: t.subject?.id ?? '',
                          title: t.title,
                          type: t.type ?? 'offline',
                          format: t.format ?? 'self',
                          description: t.description,
                        })
                        setDialogOpen(true)
                      }}
                      aria-label={`编辑任务：${t.title}`}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmDel(t)}
                      aria-label={`删除任务：${t.title}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => { setEditing(null); setDialogOpen(true) }}
          disabled={loading}
        >
          <Plus aria-hidden="true" />
          新增任务
        </Button>
      </CardContent>

      <AddTaskDialog
        open={dialogOpen}
        onOpenChange={(next) => { if (!next) setEditing(null); setDialogOpen(next) }}
        onSubmit={handleSaved}
        editing={editing}
      />

      {/* 删除确认：因为 ON DELETE CASCADE 会把 schedules / weekly_templates / checkins / media 一起删 */}
      {confirmDel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="删除确认"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmDel(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              <p className="font-semibold">确定删除这个任务吗？</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              任务「{confirmDel.title}」的所有课表排期、每周模板配置、打卡记录和上传资料会一起被删除，且无法恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDel(null)}>取消</Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(confirmDel)}
              >确认删除</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
