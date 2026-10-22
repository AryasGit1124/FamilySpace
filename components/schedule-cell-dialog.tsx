'use client'

import { Check } from 'lucide-react'
import { useAppState } from '@/components/app-state-provider'
import { Button } from '@/components/ui/button'
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

export type ScheduleCell = { subjectId: SubjectId; weekday: Weekday }

export function ScheduleCellDialog({ cell, onClose }: { cell: ScheduleCell | null; onClose: () => void }) {
  const { subjects, courseOptions, scheduleGrid, setScheduleCell } = useAppState()

  const subject = subjects.find((s) => s.id === cell?.subjectId)
  const dayLabel = weekdays.find((w) => w.value === cell?.weekday)?.label
  const currentId = cell ? scheduleGrid[cell.subjectId]?.[cell.weekday] : undefined
  const options = courseOptions.filter((c) => c.subjectId === cell?.subjectId)

  const pick = (courseId: string | null) => {
    if (cell) setScheduleCell(cell.subjectId, cell.weekday, courseId)
    onClose()
  }

  return (
    <Dialog open={cell !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {subject?.name} · {dayLabel}
          </DialogTitle>
          <DialogDescription>选择该学科当天的课程</DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            该学科下暂无可选课程
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.map((c) => {
              const active = c.id === currentId
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      active ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-secondary/60',
                    )}
                  >
                    {c.name}
                    {active && <Check className="size-4" aria-hidden="true" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <DialogFooter>
          {currentId && (
            <Button variant="destructive" onClick={() => pick(null)}>
              清除
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
