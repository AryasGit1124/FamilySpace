'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import {
  bjDateTime,
  bjDayKey,
  categoryOf,
  describeBillError,
  expenseByCategory,
  isMissingBillTable,
  parseBillFile,
  sumBills,
  type BillSource,
} from '@/lib/bills'
import { todayStr } from '@/lib/dates'
import { insertBills, type BillRow } from '@/lib/supabase-queries'

type Phase = 'idle' | 'parsing' | 'saving'
type Period = 'month' | 'year'

/** 下拉筛选的「全部」哨兵值 */
const ALL = '__all__'

const SOURCE_META: Record<BillSource, { label: string; hint: string; className: string }> = {
  wechat: {
    label: '导入微信账单',
    hint: '微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单（.xls / .csv）',
    className: 'bg-emerald-500 hover:bg-emerald-600',
  },
  alipay: {
    label: '导入支付宝账单',
    hint: '支付宝 → 我的 → 账单 → 右上角… → 开具交易流水证明（.csv / .xlsx）',
    className: 'bg-sky-500 hover:bg-sky-600',
  },
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
]

function yuan(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 「2026-01-05T12:30:45+08:00」→「2026-01-05 12:30」 */
function dayLabel(occurredAt: string): string {
  return bjDateTime(occurredAt)
}

/**
 * 家庭账单：导入微信 / 支付宝 CSV，按月 / 年看收支概况、支出分类 Top 5 与明细。
 * 手机端单列，左栏（导入 + 看板 + 分类）自带内部滚动；iPad/桌面左右分栏，明细列表内部独立滚动。
 */
export function BillsClient({
  bills,
  loadError,
}: {
  bills: BillRow[]
  loadError?: string | null
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState('')
  /** 统计区间：本月 / 本年 */
  const [period, setPeriod] = useState<Period>('month')
  const [sourceFilter, setSourceFilter] = useState<string>(ALL)
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL)
  const inputRefs = useRef<Record<BillSource, HTMLInputElement | null>>({
    wechat: null,
    alipay: null,
  })

  const busy = phase !== 'idle'

  /** 区间前缀：本月 YYYY-MM / 本年 YYYY（按北京时间） */
  const prefix = useMemo(
    () => (period === 'month' ? todayStr().slice(0, 7) : todayStr().slice(0, 4)),
    [period],
  )

  const periodBills = useMemo(
    () => bills.filter((row) => bjDayKey(row.occurred_at).startsWith(prefix)),
    [bills, prefix],
  )

  const { income, expense } = useMemo(() => sumBills(periodBills, prefix), [periodBills, prefix])

  /** 支出按 category 聚合，占比基数是区间内总支出 */
  const categoryStats = useMemo(() => expenseByCategory(periodBills, prefix), [periodBills, prefix])

  const topCategories = categoryStats.slice(0, 5)

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of bills) set.add(categoryOf(row))
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [bills])

  const detailRows = useMemo(
    () =>
      periodBills.filter((row) => {
        if (sourceFilter !== ALL && row.source !== sourceFilter) return false
        if (categoryFilter !== ALL && categoryOf(row) !== categoryFilter) return false
        return true
      }),
    [periodBills, sourceFilter, categoryFilter],
  )

  const handleFile = async (source: BillSource, file: File) => {
    if (busy) return
    setError('')
    setPhase('parsing')
    setPercent(null)
    setMessage('正在解析文件…')
    let savedSoFar = 0
    try {
      const result = await parseBillFile(file, source)
      if (result.rows.length === 0) {
        setPhase('idle')
        setMessage('')
        setError(
          result.total === 0
            ? '这个文件里没读到账单数据，请确认是微信 / 支付宝官方导出的 .csv / .xls / .xlsx 文件'
            : `共 ${result.total} 条记录，但没有可统计的收/支记录（转账、还款会被过滤）`,
        )
        return
      }

      setPhase('saving')
      setPercent(0)
      setMessage(`已解析 ${result.rows.length} 条，正在保存…`)
      let saved = 0
      await insertBills(result.rows, (done) => {
        saved = done
        savedSoFar = done
        const ratio = Math.round((done / result.rows.length) * 100)
        setPercent(ratio)
        setMessage(`已解析 ${result.rows.length} 条，已保存 ${saved} 条（${ratio}%）…`)
      })
      setMessage('')
      setError('')
      setPhase('idle')
      setPercent(null)
      alert(
        `导入成功：${result.rows.length} 条记录已保存${
          result.skipped > 0 ? `（另有 ${result.skipped} 条不计收支已过滤）` : ''
        }`,
      )
      router.refresh()
    } catch (err) {
      const detail = describeBillError(err)
      // Supabase 的 PostgrestError 在浏览器控制台会显示成 {}，这里额外打印可读文本
      console.error('[Bills] 导入失败:', detail, err)
      setMessage('')
      if (isMissingBillTable(err)) {
        setError('账单数据表还没创建：请在 Supabase 执行 scripts/create-family-bills.sql，然后重试')
      } else {
        setError(
          `${savedSoFar > 0 ? `已保存 ${savedSoFar} 条，之后` : ''}导入失败：${detail}`,
        )
      }
    } finally {
      setPhase('idle')
    }
  }

  const balance = income - expense
  const periodLabel = period === 'month' ? '本月' : '本年'

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden">
      <PageHeader
        title="家庭账单"
        subtitle="微信 / 支付宝流水，一眼看清去向"
        action={
          <div className="flex shrink-0 rounded-full bg-slate-100 p-0.5">
            {PERIODS.map((item) => {
              const isActive = period === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setPeriod(item.key)}
                  aria-pressed={isActive}
                  className={[
                    'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
                    isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-4 pb-4 md:px-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch lg:gap-5">
        {/* 左栏：导入 + 数据看板 + 分类统计（手机端自带内部滚动，桌面端占据左半屏） */}
        <div className="flex max-h-[52dvh] shrink-0 flex-col gap-3 overflow-y-auto pb-0.5 lg:max-h-none lg:min-h-0 lg:flex-1">
          {loadError && (
            <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
              {loadError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(SOURCE_META) as BillSource[]).map((source) => {
              const meta = SOURCE_META[source]
              return (
                <button
                  key={source}
                  type="button"
                  disabled={busy}
                  onClick={() => inputRefs.current[source]?.click()}
                  className={`flex flex-col items-start gap-1 rounded-2xl px-4 py-3 text-left text-white transition-colors disabled:opacity-60 ${meta.className}`}
                >
                  <span className="text-sm font-bold md:text-base">{meta.label}</span>
                  <span className="hidden text-[11px] leading-snug opacity-90 sm:block">{meta.hint}</span>
                </button>
              )
            })}
            {(Object.keys(SOURCE_META) as BillSource[]).map((source) => (
              <input
                key={source}
                ref={(el) => {
                  inputRefs.current[source] = el
                }}
                type="file"
                accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void handleFile(source, file)
                }}
              />
            ))}
          </div>

          {busy && (
            <div className="rounded-2xl border bg-card px-4 py-3">
              <p className="text-sm font-medium">{message || '正在处理…'}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                {percent === null ? (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                ) : (
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.max(percent, 4)}%` }}
                  />
                )}
              </div>
            </div>
          )}

          {error && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

          {/* 数据看板：总收入 / 总支出 / 结余 */}
          <section className="grid grid-cols-3 gap-2">
            <StatCard label="总收入" value={`+¥${yuan(income)}`} tone="text-emerald-600" />
            <StatCard label="总支出" value={`-¥${yuan(expense)}`} tone="text-rose-600" />
            <StatCard
              label="结余"
              value={`${balance < 0 ? '-' : ''}¥${yuan(Math.abs(balance))}`}
              tone={balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}
            />
          </section>

          {/* 支出分类 Top 5：纯 CSS 横向进度条 */}
          <section className="rounded-2xl border bg-card px-4 py-3">
            <header className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold">支出分类 Top 5</h2>
              <span className="text-xs text-muted-foreground">
                {periodLabel} {categoryStats.length} 类
              </span>
            </header>
            {topCategories.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {periodLabel}还没有支出记录
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2.5">
                {topCategories.map((item) => (
                  <li key={item.name}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        ¥{yuan(item.amount)} · {item.percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-rose-400"
                        style={{ width: `${Math.max(item.percent, 2)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 右栏：明细列表（内部独立滚动） */}
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
            <h2 className="text-sm font-bold">账单明细</h2>
            <span className="text-xs text-muted-foreground">{detailRows.length} 条</span>
            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label="按分类筛选"
                className="max-w-[7.5rem] rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400"
              >
                <option value={ALL}>全部分类</option>
                {categoryOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                aria-label="按来源筛选"
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400"
              >
                <option value={ALL}>全部来源</option>
                <option value="wechat">微信</option>
                <option value="alipay">支付宝</option>
              </select>
            </div>
          </header>

          {detailRows.length === 0 ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              {bills.length === 0
                ? '还没有账单，点上面的按钮导入 CSV 吧'
                : `${periodLabel}没有符合条件的记录`}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {detailRows.map((row) => {
                const isIncome = row.direction === 'income'
                return (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.description || row.category || '—'}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="tabular-nums">{dayLabel(row.occurred_at)}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none">
                          {categoryOf(row)}
                        </span>
                        <span>{row.source === 'wechat' ? '微信' : '支付宝'}</span>
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-bold tabular-nums ${
                        isIncome ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {isIncome ? '+' : '-'}¥{yuan(Number(row.amount) || 0)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-bold tabular-nums md:text-base ${tone}`}>{value}</p>
    </div>
  )
}
