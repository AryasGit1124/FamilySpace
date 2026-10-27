'use client'

import { useCallback, useMemo, useState } from 'react'
import { mapColorToSolid } from '@/lib/supabase-adapter'
import { buildCurrentMonthCalendar, calcStreak, todayStr } from '@/lib/dates'
import { LEGACY_TASK_NAMES } from '@/lib/task-names'

type SubjectCount = { subjectId: string; name: string; color: string | null; count: number }
type TaskOption = { id: string; name: string }
type CheckinRecord = { date: string; taskId: string | null }
type TimelineItem = {
  taskId: string
  taskTitle: string | null
  checkinDate: string
  createdAt: string
  timeAgo: string
}
type StarLedgerRow = {
  id: string
  amount: number
  reason: string
  taskName: string | null
  createdAt: string
}

type Props = {
  checkinRecords: CheckinRecord[]
  tasks: TaskOption[]
  subjectCounts: SubjectCount[]
  timeline: TimelineItem[]
  starLedger: StarLedgerRow[]
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 「其他任务」筛选值：历史 task_id 匹配不到任何任务名 */
const OTHER_TASK = '__other__'

/** 顶部胶囊 Tab：样式保持截图原样 */
const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'calendar', label: '打卡日历' },
  { key: 'subjects', label: '学科分布' },
  { key: 'recent', label: '最近打卡' },
  { key: 'ledger', label: '星星流水' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** 星星流水筛选项 */
const LEDGER_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'earn', label: '仅获得' },
  { key: 'spend', label: '仅消耗' },
] as const

/** 概览时间范围 */
const TIME_RANGES = [
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
] as const
type TimeRange = (typeof TIME_RANGES)[number]['key']

/**
 * 学习统计页：胶囊 Tab 置顶（概览 / 打卡日历 / 学科分布 / 最近打卡 / 星星流水）。
 * 外层高度锁定、禁止页面滚动；各 Tab 内容在剩余空间内自适应铺满，列表内部滚动。
 * 注意：全局布局已有 pt-16（Header）+ pb-24（底部 TabBar），故可用高度为 100dvh - 10rem。
 */
export function StatsView({ checkinRecords, tasks, subjectCounts, timeline, starLedger }: Props) {
  const [active, setActive] = useState<TabKey>('overview')
  /** 课程筛选：'all' / 课程展示名 / OTHER_TASK（匹配不到任务名的历史记录） */
  const [taskFilter, setTaskFilter] = useState<string>('all')
  /** 概览时间范围：本月 / 本年 */
  const [timeRange, setTimeRange] = useState<TimeRange>('month')
  /** 星星流水筛选：全部 / 仅获得 / 仅消耗 */
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'earn' | 'spend'>('all')

  /** task_id → 展示名：tasks 表优先，硬编码字典兜底，按 id 去重 */
  const idToName = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tasks) {
      const id = t.id?.trim()
      if (id && !map.has(id)) map.set(id, t.name || id)
    }
    for (const [id, name] of Object.entries(LEGACY_TASK_NAMES)) {
      if (!map.has(id)) map.set(id, name)
    }
    return map
  }, [tasks])

  /**
   * 课程筛选项：tasks 表里的课程 + 实际打卡记录中出现过的旧版 task_id。
   * 旧版硬编码 id（如 literacy_daily）若没有任何打卡数据，就不会出现在下拉里，
   * 避免出现「任务列表里根本没有」的课程。
   */
  const courseNames = useMemo(() => {
    const names: string[] = []
    const seen = new Set<string>()
    const push = (name: string) => {
      if (!name || seen.has(name)) return
      seen.add(name)
      names.push(name)
    }
    for (const t of tasks) push(t.name || t.id)
    for (const r of checkinRecords) {
      const id = r.taskId?.trim()
      if (!id) continue
      const name = idToName.get(id)
      if (name) push(name)
    }
    return names
  }, [tasks, checkinRecords, idToName])

  /** 打卡记录 → 课程展示名（匹配不到则归入「其他任务」） */
  const courseOf = useCallback(
    (taskId: string | null) => (taskId ? idToName.get(taskId) : undefined) ?? OTHER_TASK,
    [idToName],
  )

  /** 是否存在匹配不到课程名的历史打卡 */
  const hasOtherTask = useMemo(
    () => checkinRecords.some((r) => courseOf(r.taskId) === OTHER_TASK),
    [checkinRecords, courseOf],
  )

  /** 概览 + 打卡日历共用的课程筛选（前端过滤，切换即时响应） */
  const filteredDates = useMemo(
    () =>
      checkinRecords
        .filter((r) => taskFilter === 'all' || courseOf(r.taskId) === taskFilter)
        .map((r) => r.date)
        .filter(Boolean),
    [checkinRecords, taskFilter, courseOf],
  )

  /** 概览：时间范围前缀（本月 YYYY-MM / 本年 YYYY，北京时间） */
  const rangePrefix = useMemo(() => {
    const now = todayStr()
    return timeRange === 'month' ? now.slice(0, 7) : now.slice(0, 4)
  }, [timeRange])
  const rangeLabel = timeRange === 'month' ? '本月' : '本年'

  /** 概览：第一层按时间、第二层按课程过滤后的打卡日期 */
  const overviewDates = useMemo(
    () =>
      filteredDates.filter((d) => d.startsWith(rangePrefix)),
    [filteredDates, rangePrefix],
  )
  const overviewDays = useMemo(() => new Set(overviewDates).size, [overviewDates])
  const overviewStreak = useMemo(() => calcStreak(overviewDates), [overviewDates])

  /** 概览：星星流水同步做时间 + 课程两层过滤（流水表无 task_id，用 task_name 匹配） */
  const overviewEarnedStars = useMemo(
    () =>
      starLedger.reduce((sum, row) => {
        if (row.amount <= 0) return sum
        if (!bjDateKey(row.createdAt).startsWith(rangePrefix)) return sum
        if (taskFilter !== 'all') {
          if (taskFilter === OTHER_TASK) return sum
          if ((row.taskName ?? '') !== taskFilter) return sum
        }
        return sum + row.amount
      }, 0),
    [starLedger, rangePrefix, taskFilter],
  )

  const totalDays = overviewDays
  const streak = overviewStreak
  const calendar = useMemo(() => buildCurrentMonthCalendar(filteredDates), [filteredDates])

  const filterLabel =
    taskFilter === 'all' ? '全部课程' : taskFilter === OTHER_TASK ? '其他任务' : taskFilter

  const maxSubjectCount = Math.max(1, ...subjectCounts.map((s) => s.count))

  const filteredLedger = useMemo(
    () =>
      starLedger.filter((row) => {
        if (ledgerFilter === 'earn') return row.amount > 0
        if (ledgerFilter === 'spend') return row.amount < 0
        return true
      }),
    [starLedger, ledgerFilter],
  )

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col overflow-hidden px-4 pt-1 md:px-6">
      {/* 顶部胶囊 Tab 栏：页面最顶部元素；概览/日历 Tab 下右侧显示共用的课程筛选 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 pb-3">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={isActive}
              className={[
                'shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
        {active === 'calendar' && (
          <select
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
            aria-label="按课程筛选"
            className="ml-auto w-32 shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm outline-none focus:border-emerald-400 md:w-44"
          >
            <option value="all">全部课程</option>
            {courseNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {hasOtherTask && <option value={OTHER_TASK}>其他任务</option>}
          </select>
        )}
      </div>

      {/* 内容区：占满剩余高度，各 Tab 自适应铺满 */}
      <div className="min-h-0 flex-1">
        {/* 概览：双维度筛选 + 三张指标卡 */}
        {active === 'overview' && (
          <div className="flex h-full flex-col">
            {/* 紧凑筛选栏：左 本月/本年，右 课程下拉 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-3">
              <div className="flex gap-1 rounded-full bg-slate-100 p-0.5">
                {TIME_RANGES.map((opt) => {
                  const isActive = timeRange === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setTimeRange(opt.key)}
                      aria-pressed={isActive}
                      className={[
                        'rounded-full px-4 py-1.5 text-xs font-bold transition-colors',
                        isActive
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-700',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <select
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
                aria-label="按课程筛选"
                className="w-32 shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm outline-none focus:border-emerald-400 md:w-44"
              >
                <option value="all">全部课程</option>
                {courseNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {hasOtherTask && <option value={OTHER_TASK}>其他任务</option>}
              </select>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard icon="📅" value={totalDays} label={`${rangeLabel}打卡（天）`} valueClass="text-sky-600" bgClass="from-sky-100 to-blue-50" />
              <StatCard icon="🔥" value={streak} label={`${rangeLabel}连续（天）`} valueClass="text-orange-500" bgClass="from-orange-100 to-amber-50" />
              <StatCard icon="⭐" value={overviewEarnedStars} label={`${rangeLabel}获得（颗）`} valueClass="text-amber-500" bgClass="from-amber-100 to-yellow-50" />
            </div>
            <p className="shrink-0 pt-3 text-center text-xs text-slate-400">
              数据范围：{rangeLabel} · {filterLabel}
            </p>
          </div>
        )}

        {/* 打卡日历：顶部课程筛选 + 大尺寸月历铺满 */}
        {active === 'calendar' && (
          <section className="flex h-full flex-col rounded-3xl bg-white p-4 shadow-sm md:p-5">
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-800 md:text-lg">
                {calendar.year} 年 {calendar.month} 月打卡 · {filterLabel}
              </h2>
            </div>

            <div className="grid shrink-0 grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-400">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            <div className="mt-2 grid min-h-0 flex-1 grid-cols-7 gap-1.5 [grid-auto-rows:1fr]">
              {Array.from({ length: calendar.firstDayWeekday }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {calendar.cells.map((c) => {
                const isToday = c.dateKey === calendar.today
                const hasCheckin = c.count > 0
                return (
                  <div
                    key={c.dateKey}
                    className={[
                      'flex h-full min-h-9 flex-col items-center justify-center rounded-xl text-sm',
                      hasCheckin ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-400',
                      isToday ? 'ring-2 ring-emerald-400 ring-offset-1' : '',
                    ].join(' ')}
                  >
                    <span className="font-semibold">{c.day}</span>
                    {hasCheckin && (
                      <span className="mt-0.5 flex items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold leading-tight text-white">
                        {c.count}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-emerald-100" /> 已打卡
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-slate-100" /> 未打卡
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded ring-2 ring-emerald-400" /> 今天
              </span>
            </div>
          </section>
        )}

        {/* 学科分布柱状图 */}
        {active === 'subjects' && (
          <section className="flex h-full flex-col rounded-3xl bg-white p-4 shadow-sm md:p-5">
            <h2 className="mb-3 shrink-0 text-base font-bold text-slate-800 md:text-lg">
              学科打卡分布
            </h2>
            {subjectCounts.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
                暂无打卡数据
              </p>
            ) : (
              <div className="flex min-h-0 flex-1 items-end justify-around gap-2 px-2">
                {subjectCounts.map((s) => {
                  const heightPct = Math.max(4, Math.round((s.count / maxSubjectCount) * 100))
                  return (
                    <div
                      key={s.subjectId}
                      className="flex h-full max-w-24 flex-1 flex-col items-center gap-1"
                    >
                      <span className="shrink-0 text-xs font-bold text-slate-600">{s.count}</span>
                      <div className="flex min-h-0 w-full max-w-[48px] flex-1 items-end">
                        <div
                          className={`w-full rounded-t-xl ${mapColorToSolid(s.color)} transition-all`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span
                        className="w-full shrink-0 truncate text-center text-xs text-slate-500"
                        title={s.name}
                      >
                        {s.name}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* 最近打卡流水 */}
        {active === 'recent' && (
          <section className="flex h-full flex-col rounded-3xl bg-white p-4 shadow-sm md:p-5">
            <h2 className="mb-3 shrink-0 text-base font-bold text-slate-800 md:text-lg">
              最近打卡
            </h2>
            {timeline.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
                暂无打卡记录
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto pr-1">
                {timeline.map((item, idx) => (
                  <li
                    key={`${item.taskId}-${item.createdAt}-${idx}`}
                    className="flex items-center gap-3 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base">
                      ✅
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">
                        完成了 {item.taskTitle ?? item.taskId}
                      </p>
                      <p className="text-xs text-slate-400">{item.checkinDate}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{item.timeAgo}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* 星星流水明细 */}
        {active === 'ledger' && (
          <section className="flex h-full flex-col rounded-3xl bg-white p-4 shadow-sm md:p-5">
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-800 md:text-lg">⭐ 星星流水</h2>
              <div className="flex gap-1">
                {LEDGER_FILTERS.map((f) => {
                  const isActive = ledgerFilter === f.key
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setLedgerFilter(f.key)}
                      aria-pressed={isActive}
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
                        isActive
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                      ].join(' ')}
                    >
                      {f.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {filteredLedger.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-sm text-slate-400">
                还没有星星记录哦，快去打卡吧！
              </p>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto pr-1">
                {filteredLedger.map((row) => {
                  const isEarn = row.amount > 0
                  const label = row.taskName?.trim() || row.reason
                  return (
                    <li key={row.id} className="flex items-center gap-3 py-3">
                      <span
                        className={[
                          'w-16 shrink-0 text-sm font-bold tabular-nums',
                          isEarn ? 'text-green-600' : 'text-red-500',
                        ].join(' ')}
                      >
                        {isEarn ? `+${row.amount}` : row.amount} ⭐
                      </span>
                      <p
                        className="min-w-0 flex-1 truncate text-sm text-slate-700"
                        title={row.reason}
                      >
                        {label || '—'}
                      </p>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
                        {formatLedgerTime(row.createdAt)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

/** ISO 时间 -> 北京时间日期 key（YYYY-MM-DD） */
function bjDateKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** ISO 时间 -> MM-DD HH:mm（北京时间） */
function formatLedgerTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 概览指标卡（截图同款渐变卡片） */
function StatCard({
  icon,
  value,
  label,
  valueClass,
  bgClass,
}: {
  icon: string
  value: number
  label: string
  valueClass: string
  bgClass: string
}) {
  return (
    <div
      className={`flex h-full flex-col items-center justify-center rounded-3xl bg-gradient-to-br ${bgClass} px-6 py-7 text-center shadow-sm`}
    >
      <span className="text-4xl md:text-5xl" aria-hidden="true">
        {icon}
      </span>
      <p className={`mt-2 text-4xl font-black tabular-nums md:mt-3 md:text-5xl ${valueClass}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-600">{label}</p>
    </div>
  )
}
