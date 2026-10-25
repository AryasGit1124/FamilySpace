'use client'

import { useState } from 'react'
import { mapColorToSolid } from '@/lib/supabase-adapter'

type SubjectCount = { subjectId: string; name: string; color: string | null; count: number }
type CalendarData = {
  year: number
  month: number
  firstDayWeekday: number
  cells: { day: number; dateKey: string; count: number }[]
  today: string
}
type TimelineItem = {
  taskId: string
  taskTitle: string | null
  checkinDate: string
  createdAt: string
  timeAgo: string
}

type Props = {
  totalDays: number
  streak: number
  earnedStars: number
  calendar: CalendarData
  subjectCounts: SubjectCount[]
  maxSubjectCount: number
  timeline: TimelineItem[]
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'calendar', label: '打卡日历' },
  { key: 'subjects', label: '学科分布' },
  { key: 'recent', label: '最近打卡' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** 顶部 Tab 切换：概览 / 打卡日历 / 学科分布 / 最近打卡 */
export function StatsView({
  totalDays,
  streak,
  earnedStars,
  calendar,
  subjectCounts,
  maxSubjectCount,
  timeline,
}: Props) {
  const [active, setActive] = useState<TabKey>('overview')

  return (
    <div className="flex flex-col gap-5 px-5 pb-10">
      {/* 顶部 Tab 栏 */}
      <div className="sticky top-0 z-10 -mx-5 flex gap-1 overflow-x-auto bg-background/90 px-5 py-2 backdrop-blur">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
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
      </div>

      {/* 概览：三张指标卡 */}
      {active === 'overview' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon="📅" value={totalDays} label="累计打卡（天）" valueClass="text-sky-600" bgClass="from-sky-100 to-blue-50" />
          <StatCard icon="🔥" value={streak} label="连续打卡（天）" valueClass="text-orange-500" bgClass="from-orange-100 to-amber-50" />
          <StatCard icon="⭐" value={earnedStars} label="累计获得（颗）" valueClass="text-amber-500" bgClass="from-amber-100 to-yellow-50" />
        </div>
      )}

      {/* 打卡日历 */}
      {active === 'calendar' && (
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-slate-800">
            {calendar.year} 年 {calendar.month} 月打卡
          </h2>
          <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-400">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
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
                    'relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm',
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
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
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
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-slate-800">学科打卡分布</h2>
          {subjectCounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">暂无打卡数据</p>
          ) : (
            <div className="flex h-56 items-end justify-around gap-2 px-2">
              {subjectCounts.map((s) => {
                const heightPct = Math.max(4, Math.round((s.count / maxSubjectCount) * 100))
                return (
                  <div key={s.subjectId} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-bold text-slate-600">{s.count}</span>
                    <div className="flex h-44 w-full max-w-[48px] items-end">
                      <div
                        className={`w-full rounded-t-xl ${mapColorToSolid(s.color)} transition-all`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="truncate text-center text-xs text-slate-500" title={s.name}>
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
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-slate-800">最近打卡</h2>
          {timeline.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">暂无打卡记录</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {timeline.map((item, idx) => (
                <li key={`${item.taskId}-${item.createdAt}-${idx}`} className="flex items-center gap-3 py-3">
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

      {active === 'overview' && (
        <p className="text-center text-xs text-muted-foreground">数据范围：最近 90 天的打卡记录</p>
      )}
    </div>
  )
}

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
      className={`flex flex-col items-center rounded-3xl bg-gradient-to-br ${bgClass} px-6 py-7 text-center shadow-sm`}
    >
      <span className="text-5xl" aria-hidden="true">
        {icon}
      </span>
      <p className={`mt-3 text-5xl font-black tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-1 text-sm font-semibold" style={{ color: 'inherit' }}>
        {label}
      </p>
    </div>
  )
}
