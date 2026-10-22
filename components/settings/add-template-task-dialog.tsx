'use client'

import { useState } from 'react'
import { useAppState } from '@/components/app-state-provider'
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
import { weekdays, type SubjectId, type Weekday } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Props = { weekday: Weekday; open: boolean; onOpenChange: (open: boolean) => void }

export function AddTemplateTaskDialog({ weekday, open, onOpenChange }: Props) {
  const { subjects, taskContents, weeklyTemplate, addTemplateTasks } = useAppState()
  const [subjectId, setSubjectId] = useState<SubjectId>(subjects[0]?.id ?? '')
  const [selected, setSelected] = useState<string[]>([])

  const existing = weeklyTemplate[weekday]
  const contents = taskContents.filter((c) => c.subjectId === subjectId)
  const dayLabel = weekdays.find((w) => w.value === weekday)?.label

  const close = () => {
    setSelected([])
    onOpenChange(false)
  }

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))

  const confirm = () => {
    addTemplateTasks(weekday, selected)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>添加任务到{dayLabel}</DialogTitle>
          <DialogDescription>先选择学科，再勾选要加入的任务（可多选）</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="选择学科" className="flex flex-wrap gap-2">
          {subjects.map((s) => {
            const active = s.id === subjectId
            const count = selected.filter((id) => taskContents.find((c) => c.id === id)?.subjectId === s.id).length
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSubjectId(s.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
                )}
              >
                {s.name}
                {count > 0 && <span className="ml-1 text-xs opacity-80">({count})</span>}
              </button>
            )
          })}
        </div>

        <div className="max-h-64 overflow-y-auto">
          {contents.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              该学科下暂无可选内容
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {contents.map((c) => {
                const added = existing.includes(c.id)
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
                      <span className="flex-1">{c.name}</span>
                      {added && <span className="text-xs text-muted-foreground">已添加</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          <Button onClick={confirm} disabled={selected.length === 0}>
            确认添加{selected.length > 0 ? ` (${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
