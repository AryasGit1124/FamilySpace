'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { AddTempTaskDialog } from '@/components/add-temp-task-dialog'
import { useAuth } from '@/components/auth-provider'
import type { CheckInTask } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { familyPatch } from '@/lib/supabase-queries'
import { resolveFamilyId } from '@/lib/family'
import { todayDateKey } from '@/lib/supabase-adapter'
import { handleTeacherCheckin } from '@/lib/rewards'

const DONE_LABEL = '已打卡'
const TODO_LABEL = '未打卡'

/** 任务标题 → 对应模块入口；用于孩子端点任务直达打卡 */
const TITLE_ROUTE_RULES: { pattern: RegExp; href: string }[] = [
  { pattern: /识字|认字/, href: '/chinese/literacy' },
  { pattern: /拼音/, href: '/chinese/pinyin' },
  { pattern: /古诗|背诵/, href: '/chinese/poem' },
  { pattern: /口算|加减|比大小|点数|找规律|数学/, href: '/math' },
  { pattern: /字母/, href: '/english/alphabet' },
  { pattern: /单词|词汇|绘本/, href: '/english/vocab' },
  { pattern: /拼读/, href: '/english/phonics' },
  { pattern: /思维|数独|记忆|翻牌/, href: '/thinking' },
  { pattern: /冒险/, href: '/adventure' },
]

/** 解析孩子端任务点击后要去的位置：teacher → 资料库；self → 对应模块 */
function resolveTaskHref(task: CheckInTask): string | null {
  // 老师资料类任务：跳到该课程最新日期的资料库页
  if (task.format === 'teacher') {
    return `/library?course=${encodeURIComponent(task.title)}&latest=1`
  }
  // 自学类任务：优先任务自带的模块路由，其次按标题关键词匹配，最后回退学科页
  if (task.gameRoute) return task.gameRoute
  const rule = TITLE_ROUTE_RULES.find((r) => r.pattern.test(task.title))
  if (rule) return rule.href
  return task.subjectId ? `/subject/${task.subjectId}` : null
}

export function TaskList({
  tasks,
  dateKey,
}: {
  tasks: CheckInTask[]
  /** 可选。打卡写入哪一天（YYYY-MM-DD）。不传则用今天。首页切换周几 Tab 时传入。 */
  dateKey?: string
}) {
  // 本地乐观状态：从 props 初始化 + 当 props 变更（Server Component 刷新）时同步
  const [localTasks, setLocalTasks] = useState<CheckInTask[]>(() => tasks)
  const { user, role } = useAuth()
  /** 家长端为测试模式：结算流程照常运行，但不写 checkins / star_ledger */
  const isParent = role === 'parent'
  const [tempDialogOpen, setTempDialogOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setLocalTasks(tasks)
  }, [tasks])

  const doneCount = localTasks.filter((t) => t.status === 'done').length
  const percent = localTasks.length ? Math.round((doneCount / localTasks.length) * 100) : 0

  /** 打卡/取消打卡：乐观更新 + Supabase checkins insert/delete */
  const handleToggle = async (taskId: string) => {
    const task = localTasks.find((t) => t.id === taskId)
    if (!task) return

    const willDo = task.status !== 'done'
    // 乐观更新
    setLocalTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: willDo ? 'done' : 'todo' } : t)))

    try {
      const key = dateKey ?? todayDateKey()
      const testPrefix = isParent ? '【测试模式】' : ''

      // Teacher 课程打卡：提交待审核记录（家长确认后才发星）
      if (willDo && task.format === 'teacher') {
        const { earned } = await handleTeacherCheckin(taskId, user?.id ?? '', isParent)
        if (earned > 0) {
          window.alert(
            `${testPrefix}打卡成功！等待家长确认后，就能获得 ${earned} 颗星星啦 ⭐`,
          )
          window.dispatchEvent(new Event('checkins-changed'))
        }
        return
      }

      // 家长端测试模式：自学类任务不写库，仅本地 UI 模拟
      if (isParent) {
        return
      }

      if (!supabase) {
        console.warn('[TaskList] Supabase 未初始化，只做了本地 UI 更新')
        return
      }

      if (willDo) {
        // 自学类打卡：插入待审核记录，家长确认后才发星
        const familyId = await resolveFamilyId()
        const { error } = await supabase.from('checkins').upsert({
          task_id: taskId,
          checkin_date: key,
          status: 'pending',
          stars: task.stars ?? 1,
          ...familyPatch(familyId),
        })
        if (error) throw error
        window.dispatchEvent(new Event('checkins-changed'))
      } else {
        // 取消打卡：删除
        const { error } = await supabase
          .from('checkins')
          .delete()
          .eq('task_id', taskId)
          .eq('checkin_date', key)
        if (error) throw error
        window.dispatchEvent(new Event('checkins-changed'))
      }
    } catch (err) {
      console.error('[TaskList] checkins 写入失败，回滚 UI:', err)
      setLocalTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: willDo ? 'todo' : 'done' } : t)),
      )
    }
  }

  const todoTasks = localTasks.filter((t) => t.status !== 'done')
  const doneTasks = localTasks.filter((t) => t.status === 'done')

  /** 渲染一条任务。teacher → 资料库；self → 对应模块做游戏 */
  const renderTask = (task: CheckInTask) => {
    const done = task.status === 'done'
    const isTeacher = task.format === 'teacher'
    // 家长和孩子端统一：teacher → 资料库；self → 对应模块做游戏
    const href = resolveTaskHref(task)
    const titleClass = cn(
      'min-w-0 flex-1 truncate font-medium',
      done && 'text-muted-foreground line-through',
    )
    const badge = (
      <Badge variant={done ? 'secondary' : 'outline'} className={cn(!done && 'text-muted-foreground')}>
        {done ? DONE_LABEL : TODO_LABEL}
      </Badge>
    )
    return (
      <li key={task.id}>
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/60',
            done && 'bg-muted/50',
          )}
        >
          <Checkbox
            id={`task-${task.id}`}
            checked={done}
            onCheckedChange={() => handleToggle(task.id)}
            aria-label={`${task.title} ${done ? '取消打卡' : '打卡'}`}
          />
          {href ? (
            <Link
              href={href}
              aria-label={`去完成 ${task.title}`}
              className="flex min-w-0 flex-1 items-center gap-2 transition-opacity active:opacity-70"
            >
              <span className={titleClass}>{task.title}</span>
              {badge}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ) : (
            <>
              {isTeacher ? (
                <Link
                  href={`/library?course=${encodeURIComponent(task.title)}&latest=1`}
                  className={cn(
                    titleClass,
                    'underline decoration-muted-foreground/40 underline-offset-4',
                  )}
                >
                  {task.title}
                </Link>
              ) : (
                <label htmlFor={`task-${task.id}`} className={cn(titleClass, 'cursor-pointer')}>
                  {task.title}
                </label>
              )}
              {badge}
            </>
          )}
        </div>
      </li>
    )
  }

  return (
    <section aria-labelledby="task-list-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="task-list-title" className="text-lg font-bold">
          打卡任务
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {doneTasks.length}/{localTasks.length} 已完成
          </span>
          {/* 家长和孩子端都可以临时给某一天加任务 */}
          <Button size="sm" variant="outline" onClick={() => setTempDialogOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            添加临时任务
          </Button>
        </div>
      </div>
      <Progress value={percent} aria-label={`完成进度 ${percent}%`} />

      {localTasks.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          这一天没有排打卡任务 🎉
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="px-1 text-sm font-semibold text-muted-foreground">
              未打卡（{todoTasks.length}）
            </h3>
            {todoTasks.length > 0 ? (
              <ul className="flex flex-col gap-2">{todoTasks.map(renderTask)}</ul>
            ) : (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                全部完成 🎉
              </p>
            )}
          </div>
          {doneTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="px-1 text-sm font-semibold text-muted-foreground">
                已打卡（{doneTasks.length}）
              </h3>
              <ul className="flex flex-col gap-2">{doneTasks.map(renderTask)}</ul>
            </div>
          )}
        </div>
      )}

      <AddTempTaskDialog
        open={tempDialogOpen}
        onOpenChange={setTempDialogOpen}
        dateKey={dateKey ?? todayDateKey()}
        existingTaskIds={localTasks.map((t) => t.id)}
        onAdded={() => router.refresh()}
      />
    </section>
  )
}
