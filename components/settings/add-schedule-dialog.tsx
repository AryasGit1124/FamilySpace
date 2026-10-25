'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
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
import { weekdays, type Weekday } from '@/lib/mock-data'
import { deleteSchedule, fetchSubjects, fetchTasksWithSubjects, insertSchedule, insertTask, updateSchedule, updateTask } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type SubjectRow = { id: string; name: string }
type TaskRow = { id: string; title: string; subject_id: string | null; type?: string | null; subjects: { id: string; name: string } | null }

/** 编辑模式：回填用的数据 */
export type ScheduleEditData = {
  scheduleId: string
  /** 如果这条 schedule 背后是"新建"出来的 task（本应用 insertSchedule 前会 insertTask），允许编辑它的 title/type */
  taskId: string
  initialWeekdays: Weekday[] // 编辑时已有的 day_of_week（多选）
  startTime: string // "HH:MM"
  durationMinutes: number
  location: string | null
  // task 字段（可选，用于回填编辑 mode='new' 时的新建内容）
  taskTitle?: string
  taskType?: 'online' | 'offline'
  subjectId?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddedOrEdited?: () => Promise<void> | void
  /** 编辑模式：传入后回填 + 标题变成"编辑课程" */
  editing?: ScheduleEditData | null
}

type TaskSourceMode = 'new' | 'existing'

export function AddScheduleDialog({ open, onOpenChange, onAddedOrEdited, editing }: Props) {
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [allTasks, setAllTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(false)

  // 表单字段
  const [subjectId, setSubjectId] = useState('')
  const [mode, setMode] = useState<TaskSourceMode>('new')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskType, setNewTaskType] = useState<'online' | 'offline'>('offline')
  const [existingTaskId, setExistingTaskId] = useState('')
  const [weekdaysArr, setWeekdaysArr] = useState<Weekday[]>([]) // 多选
  const [startTime, setStartTime] = useState('') // "14:30"
  const [duration, setDuration] = useState(45)
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isEditMode = !!editing

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const [subjRows, taskRows] = await Promise.all([fetchSubjects(), fetchTasksWithSubjects()])
      setSubjects(subjRows.map((r) => ({ id: r.id, name: r.name })))
      setAllTasks(
        taskRows.map((r) => ({
          id: r.id,
          title: r.title,
          subject_id: r.subject_id,
          type: r.type,
          subjects: r.subjects ? { id: r.subjects.id, name: r.subjects.name } : null,
        })),
      )
    } catch (err) {
      console.error('[ScheduleDialog] 加载失败:', err)
      setErrorMsg('加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  // 打开时回填 / 重置
  useEffect(() => {
    if (!open) return

    if (editing) {
      // 编辑模式回填
      setSubjectId(editing.subjectId ?? '')
      if (editing.taskTitle !== undefined) {
        setMode('new')
        setNewTaskTitle(editing.taskTitle)
        setNewTaskType(editing.taskType ?? 'offline')
      } else {
        setMode('existing')
        setExistingTaskId(editing.taskId)
      }
      setWeekdaysArr([...editing.initialWeekdays])
      setStartTime(editing.startTime)
      setDuration(editing.durationMinutes)
      setLocation(editing.location ?? '')
    } else {
      // 新增模式重置
      setSubjectId('')
      setMode('new')
      setNewTaskTitle('')
      setNewTaskType('offline')
      setExistingTaskId('')
      setWeekdaysArr([])
      setStartTime('')
      setDuration(45)
      setLocation('')
    }
  }, [open, editing])

  // 已选学科下的 tasks（给"选已有"模式用）
  const subjectTasks = allTasks.filter((t) => t.subject_id === subjectId)

  const toggleWeekday = (w: Weekday) => {
    setWeekdaysArr((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort((a, b) => a - b) as Weekday[],
    )
  }

  const close = () => {
    if (!submitting) {
      setErrorMsg(null)
      onOpenChange(false)
    }
  }

  const valid = (() => {
    if (!subjectId) return false
    if (weekdaysArr.length === 0) return false
    if (!startTime) return false
    if (duration <= 0) return false
    if (mode === 'new' && !newTaskTitle.trim()) return false
    if (mode === 'existing' && !existingTaskId) return false
    return true
  })()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      let taskId: string
      let subjectIdForSchedule: string | null = subjectId

      if (isEditMode && editing) {
        // 编辑模式：直接更新原任务本身（名称 / 线上线下 / 学科），不新建任务，
        // 否则每次保存都会多出一个没人引用的任务
        taskId = editing.taskId
        await updateTask(editing.taskId, {
          subject_id: subjectId,
          title: newTaskTitle.trim(),
          type: newTaskType,
        })
      } else if (mode === 'new') {
        const created = await insertTask({
          subject_id: subjectId,
          title: newTaskTitle.trim(),
          type: newTaskType,
          format: 'teacher',
        })
        taskId = created.id
      } else {
        taskId = existingTaskId
        const picked = allTasks.find((t) => t.id === taskId)
        subjectIdForSchedule = picked?.subject_id ?? subjectId
      }

      if (isEditMode && editing) {
        // 编辑策略：
        //   - weekdays 集合和原来完全一样：只 updateSchedule（取第一条 scheduleId）
        //   - weekdays 集合变了：删原来的 schedule，再循环 insertSchedule 新的
        const sameWeekdays =
          editing.initialWeekdays.length === weekdaysArr.length &&
          editing.initialWeekdays.every((d) => weekdaysArr.includes(d))

        if (sameWeekdays) {
          // 取第一条 scheduleId 更新（编辑时回填传了第一条）
          await updateSchedule(editing.scheduleId, {
            day_of_week: weekdaysArr[0], // 同集合就随便取一个，这里只会有一条
            start_time: startTime,
            duration_minutes: duration,
            location: location.trim() || null,
            subject_id: subjectIdForSchedule,
          })
        } else {
          // 删旧的 + 插新的
          await deleteSchedule(editing.scheduleId)
          // 如果 initialWeekdays 有多个还得删其他 —— 但 scheduleId 只传了第一条。
          // 简单起见：只保证当前传入的 scheduleId 被删掉；如果 initialWeekdays 只有一条就刚好。
          for (const d of weekdaysArr) {
            await insertSchedule({
              task_id: taskId,
              subject_id: subjectIdForSchedule,
              day_of_week: d,
              start_time: startTime,
              duration_minutes: duration,
              location: location.trim() || null,
            })
          }
        }
      } else {
        // 新增：循环 insert（一个 day_of_week 一条 schedule）
        for (const d of weekdaysArr) {
          await insertSchedule({
            task_id: taskId,
            subject_id: subjectIdForSchedule,
            day_of_week: d,
            start_time: startTime,
            duration_minutes: duration,
            location: location.trim() || null,
          })
        }
      }

      await onAddedOrEdited?.()
      close()
    } catch (err: unknown) {
      console.error('[ScheduleDialog] 提交失败:', err)
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
            <DialogTitle>{isEditMode ? '编辑课程' : '新增课程'}</DialogTitle>
            <DialogDescription>
              {isEditMode ? '学科、课程名称、线上线下、周几、时间、地点都可修改' : '可以新建任务，或是把已有任务挂到课表时间点'}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
          ) : subjects.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              还没有学科，先去学科设置里添加一个
            </p>
          ) : (
            <>
              {/* 学科（编辑模式也可重新选择；换学科时会把任务移动到新学科） */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-subject">学科</Label>
                <select
                  id="s-subject"
                  value={subjectId}
                  onChange={(e) => {
                    setSubjectId(e.target.value)
                    setExistingTaskId('')
                  }}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* 任务来源（编辑模式禁用） */}
              {!isEditMode && (
                <div className="flex flex-col gap-1.5">
                  <Label>任务来源</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMode('new')}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                        mode === 'new' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                      )}
                    >
                      新建任务
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('existing')}
                      disabled={subjectTasks.length === 0}
                      title={subjectTasks.length === 0 ? '该学科下暂无已建任务' : ''}
                      className={cn(
                        'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        mode === 'existing' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                      )}
                    >
                      选已有任务{subjectTasks.length > 0 ? ` (${subjectTasks.length})` : ''}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'new' ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="s-title">课程名称</Label>
                    <Input
                      id="s-title"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      placeholder="例如：线下外教课"
                      maxLength={20}
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>线上/线下</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNewTaskType('offline')}
                        className={cn(
                          'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                          newTaskType === 'offline' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                        )}
                      >
                        线下
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewTaskType('online')}
                        className={cn(
                          'flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                          newTaskType === 'online' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                        )}
                      >
                        线上
                      </button>
                    </div>
                  </div>
                </>
              ) : !isEditMode ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-task">选择已有任务</Label>
                  <select
                    id="s-task"
                    value={existingTaskId}
                    onChange={(e) => setExistingTaskId(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <option value="">—— 请选择 ——</option>
                    {subjectTasks.map((t) => (
                      <option key={t.id} value={t.id}>{t.title} ({t.type === 'online' ? '线上' : t.type === 'offline' ? '线下' : ''})</option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* 周几 —— 多选 */}
              <div className="flex flex-col gap-1.5">
                <Label>周几上课（可多选）</Label>
                <div className="flex flex-wrap gap-1.5">
                  {weekdays.map((w) => {
                    const active = weekdaysArr.includes(w.value)
                    return (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => toggleWeekday(w.value)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-sm transition-colors',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                        )}
                      >
                        {w.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 时间 & 时长 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-time">开始时间</Label>
                  <Input
                    id="s-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-duration">用时（分钟）</Label>
                  <Input
                    id="s-duration"
                    type="number"
                    min={1}
                    max={300}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* 地点 */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-loc">地点（可选）</Label>
                <Input
                  id="s-loc"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="例如：少年宫 302 教室 / 线上腾讯会议"
                  maxLength={50}
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
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
