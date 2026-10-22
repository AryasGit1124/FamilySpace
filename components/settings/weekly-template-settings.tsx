'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAppState } from '@/components/app-state-provider'
import { AddTemplateTaskDialog } from '@/components/settings/add-template-task-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { weekdays, type Weekday } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

export function WeeklyTemplateSettings() {
  const { weeklyTemplate, taskContents, subjects, removeTemplateTask } = useAppState()
  const [day, setDay] = useState<Weekday>(1)
  const [dialogOpen, setDialogOpen] = useState(false)

  const dayLabel = weekdays.find((w) => w.value === day)?.label
  const items = weeklyTemplate[day]
    .map((id) => taskContents.find((c) => c.id === id))
    .filter((c) => c !== undefined)

  return (
    <Card>
      <CardHeader>
        <CardTitle>每周任务模板</CardTitle>
        <CardDescription>为一周中的每一天设置固定打卡任务</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={day} onValueChange={(v) => setDay(v as Weekday)}>
          <TabsList className="h-9 w-full">
            {weekdays.map((w) => (
              <TabsTrigger key={w.value} value={w.value} className="px-0">
                <span className="sr-only">{w.label}</span>
                <span aria-hidden="true">{w.short}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
                const meta = getSubjectMeta(item.subjectId)
                const subjectName = subjects.find((s) => s.id === item.subjectId)?.name ?? '未知学科'
                return (
                  <li key={item.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <span className={cn('mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium', meta.tint)}>
                        {subjectName}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeTemplateTask(day, item.id)}
                      aria-label={`删除任务：${item.name}`}
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
      </CardContent>
      <AddTemplateTaskDialog weekday={day} open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
