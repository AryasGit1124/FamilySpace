'use client'

import Link from 'next/link'
import { CalendarRange, ChevronRight } from 'lucide-react'
import { useAppState } from '@/components/app-state-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ScheduleSettings() {
  const { scheduleGrid } = useAppState()
  const filled = Object.values(scheduleGrid).reduce((sum, row) => sum + Object.keys(row).length, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>课表设置</CardTitle>
        <CardDescription>按学科和星期安排每周课程，配置后会展示在对应学科页</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/schedule"
          className="flex items-center gap-3 rounded-xl border bg-secondary/40 p-4 transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarRange className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">查看周课表</p>
            <p className="text-xs text-muted-foreground">
              {filled > 0 ? `本周已安排 ${filled} 节课` : '还没有安排课程，点击开始配置'}
            </p>
          </div>
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  )
}
