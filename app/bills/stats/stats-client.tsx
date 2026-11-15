'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/page-header'
import {
  aggregateCategoryShare,
  aggregateTimeBuckets,
  billDirectionOf,
  bjDateTime,
  categorySubtreeIds,
  creatorTagClass,
  describeBillError,
  filterBillsByCategory,
  isMissingBillTable,
  type Granularity,
  type StatBill,
  type StatCategory,
} from '@/lib/bills'
import { fetchBillCategories, fetchBillsForStats } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

const PIE_COLORS = [
  '#f97316',
  '#0ea5e9',
  '#22c55e',
  '#a855f7',
  '#ef4444',
  '#eab308',
  '#14b8a6',
  '#6366f1',
  '#ec4899',
  '#84cc16',
]

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: '按日明细' },
  { value: 'month', label: '按月汇总' },
  { value: 'year', label: '按年汇总' },
]

/** 图表横轴标签：日 → 1/5，月 → 2026-01，年 → 2026 */
function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === 'day') {
    const [, month, day] = key.split('-')
    return `${Number(month)}/${Number(day)}`
  }
  return key
}

const money = (value: number) => `¥${value.toFixed(2)}`

export function StatsClient() {
  const [bills, setBills] = useState<StatBill[]>([])
  const [categories, setCategories] = useState<StatCategory[]>([])
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [categoryId, setCategoryId] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [billRows, categoryList] = await Promise.all([
        fetchBillsForStats(),
        fetchBillCategories(),
      ])
      setBills(billRows)
      setCategories(categoryList)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[BillsStats] 读取统计数据失败:', detail, err)
      setError(
        isMissingBillTable(err)
          ? '账单表还没创建：请先执行 scripts/create-bill-ods.sql'
          : `读取统计数据失败：${detail}`,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const categoryById = useMemo(
    () => new Map(categories.map((item) => [item.id, item])),
    [categories],
  )

  const topCategories = useMemo(
    () =>
      categories.filter(
        (item) => !item.parent_id || !categories.some((parent) => parent.id === item.parent_id),
      ),
    [categories],
  )

  /** 登记人筛选后（空 = 全部） */
  const creatorBills = useMemo(
    () =>
      creatorFilter ? bills.filter((bill) => (bill.creator_name ?? '') === creatorFilter) : bills,
    [bills, creatorFilter],
  )

  const creatorNames = useMemo(() => {
    const names = new Set<string>()
    for (const bill of bills) if (bill.creator_name) names.add(bill.creator_name)
    return [...names].sort()
  }, [bills])

  /** 分类筛选后（选一级分类含全部子分类）的账单 */
  const scopedBills = useMemo(
    () => filterBillsByCategory(creatorBills, categories, categoryId),
    [creatorBills, categories, categoryId],
  )

  /** 时间维度汇总：纵轴收入 / 支出 */
  const buckets = useMemo(
    () => aggregateTimeBuckets(scopedBills, granularity),
    [scopedBills, granularity],
  )

  /** 饼图：支出按二级分类占比；选二级分类时看同一父级下的兄弟分类 */
  const shares = useMemo(() => {
    const selected = categoryId ? categoryById.get(categoryId) : undefined
    if (!selected) return aggregateCategoryShare(scopedBills, categories)

    const scopeId = selected.parent_id ?? selected.id
    const scopeIds = categorySubtreeIds(categories, scopeId)
    const source = creatorBills.filter((bill) => !!bill.category_id && scopeIds.has(bill.category_id))
    return aggregateCategoryShare(source, categories, scopeId)
  }, [creatorBills, categories, categoryById, categoryId, scopedBills])

  const chartData = useMemo(
    () =>
      buckets.map((bucket) => ({
        ...bucket,
        label: bucketLabel(bucket.key, granularity),
      })),
    [buckets, granularity],
  )

  /** 饼图只保留 Top 5，其余合并为「其他」 */
  const pieData = useMemo(() => {
    const sorted = [...shares].sort((a, b) => b.value - a.value)
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5).reduce((sum, share) => sum + share.value, 0)
    const data = rest > 0 ? [...top, { name: '其他', emoji: '📦', value: Math.round(rest * 100) / 100 }] : top
    return data.map((share, index) => ({ ...share, fill: PIE_COLORS[index % PIE_COLORS.length] }))
  }, [shares])

  const totalExpense = useMemo(() => shares.reduce((sum, share) => sum + share.value, 0), [shares])

  const totals = useMemo(
    () =>
      buckets.reduce(
        (acc, bucket) => ({ income: acc.income + bucket.income, expense: acc.expense + bucket.expense }),
        { income: 0, expense: 0 },
      ),
    [buckets],
  )

  /** 按日明细：直接展示交易，按时间倒序 */
  const dayRows = useMemo(
    () =>
      [...scopedBills]
        .filter((bill) => billDirectionOf(bill.direction) !== null)
        .sort((a, b) => (b.trade_time ?? '').localeCompare(a.trade_time ?? ''))
        .slice(0, 300),
    [scopedBills],
  )

  const categoryLabel = useCallback(
    (id: string | null) => {
      const category = id ? categoryById.get(id) : undefined
      if (!category) return '未分类'
      const parent = category.parent_id ? categoryById.get(category.parent_id) : undefined
      return parent
        ? `${parent.emoji} ${parent.name} / ${category.emoji} ${category.name}`
        : `${category.emoji} ${category.name}`
    },
    [categoryById],
  )

  return (
    <div className="min-h-[100dvh] pb-24">
      <PageHeader
        title="数据统计"
        subtitle="按时间维度看收支，按分类看结构"
        backHref="/bills/import"
        backLabel="返回账单"
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
          >
            {loading ? '读取中…' : '刷新'}
          </button>
        }
      />

      <div className="mx-auto flex w-full max-w-full flex-col gap-3 overflow-x-hidden px-4 md:px-6">
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900"
            >
              重试
            </button>
          </div>
        )}

        {/* 筛选区：窄屏自动换行，胶囊不挤压 */}
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="flex shrink-0 rounded-full bg-muted p-0.5">
            {GRANULARITIES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setGranularity(item.value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm',
                  granularity === item.value
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-muted-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="min-w-[8rem] flex-1 rounded-full border bg-white px-3 py-2 text-sm font-medium outline-none focus:border-primary sm:flex-none"
          >
            <option value="">全部分类</option>
            {topCategories.map((parent) => (
              <optgroup key={parent.id} label={`${parent.emoji} ${parent.name}`}>
                <option value={parent.id}>全部 {parent.name}（含子分类）</option>
                {categories
                  .filter((child) => child.parent_id === parent.id)
                  .map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.emoji} {child.name}
                    </option>
                  ))}
              </optgroup>
            ))}
            {categories.length === 0 && <option disabled>还没建分类</option>}
          </select>

          <select
            value={creatorFilter}
            onChange={(event) => setCreatorFilter(event.target.value)}
            aria-label="按登记人筛选"
            className="min-w-[8rem] flex-1 rounded-full border bg-white px-3 py-2 text-sm font-medium outline-none focus:border-primary sm:flex-none"
          >
            <option value="">全部登记人</option>
            {creatorNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs sm:ml-auto sm:w-auto sm:bg-transparent sm:px-0 sm:py-0 sm:text-sm">
            <span className="text-muted-foreground">
              收入 <span className="font-bold text-emerald-600">{money(totals.income)}</span>
            </span>
            <span className="text-muted-foreground">
              支出 <span className="font-bold text-red-500">{money(totals.expense)}</span>
            </span>
            <span className="text-muted-foreground">
              结余{' '}
              <span
                className={cn(
                  'font-bold',
                  totals.income - totals.expense >= 0 ? 'text-emerald-600' : 'text-red-500',
                )}
              >
                {money(totals.income - totals.expense)}
              </span>
            </span>
          </div>
        </div>

        {/* 图表区：父级显式 w-full / min-w-0，ResponsiveContainer 才能测到真实宽度 */}
        <div className="grid w-full gap-3 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section className="w-full min-w-0 rounded-2xl border bg-card p-3 shadow-sm">
            <h2 className="mb-1 text-sm font-bold">收入 / 支出</h2>
            {loading ? (
              <p className="py-16 text-center text-sm text-muted-foreground">正在读取…</p>
            ) : chartData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">这个范围内没有数据</p>
            ) : (
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} width={56} />
                    <Tooltip
                      formatter={(value: number) => money(Number(value))}
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ fontSize: 12, borderRadius: 12 }}
                    />
                    <Bar dataKey="income" name="收入" stackId="sum" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="支出" stackId="sum" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <i className="size-2 rounded-sm bg-emerald-500" /> 收入
              </span>
              <span className="flex items-center gap-1">
                <i className="size-2 rounded-sm bg-red-500" /> 支出
              </span>
            </div>
          </section>

          <section className="w-full min-w-0 rounded-2xl border bg-card p-3 shadow-sm">
            <h2 className="mb-1 text-sm font-bold">支出分类占比</h2>
            {loading ? (
              <p className="py-16 text-center text-sm text-muted-foreground">正在读取…</p>
            ) : pieData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                还没有分类后的支出数据
              </p>
            ) : (
              <>
                <div className="h-56 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={42}
                        outerRadius={72}
                        paddingAngle={1}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          `${money(Number(value))}（${totalExpense > 0 ? Math.round((Number(value) / totalExpense) * 100) : 0}%）`,
                          name,
                        ]}
                        contentStyle={{ fontSize: 12, borderRadius: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-1 flex max-h-[72px] flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-[11px]">
                  {pieData.map((entry) => (
                    <li key={entry.name} className="flex items-center gap-1">
                      <i className="size-2 rounded-full" style={{ backgroundColor: entry.fill }} />
                      <span className="max-w-[9rem] truncate">{entry.name}</span>
                      <span className="font-semibold tabular-nums">
                        {totalExpense > 0 ? Math.round((entry.value / totalExpense) * 100) : 0}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* 明细 / 汇总卡片流 */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-base font-bold">
              {granularity === 'day' ? '交易明细' : granularity === 'month' ? '月度汇总' : '年度汇总'}
            </h2>
            <span className="text-xs text-muted-foreground">
              {granularity === 'day' ? `${dayRows.length} 条（最多 300）` : `${buckets.length} 期`}
            </span>
          </div>

          {granularity === 'day' ? (
            dayRows.length === 0 ? (
              <p className="w-full rounded-2xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                没有符合筛选条件的交易
              </p>
            ) : (
              <ul className="grid w-full gap-2 md:grid-cols-2">
                {dayRows.map((bill) => {
                  const direction = billDirectionOf(bill.direction)
                  return (
                    <li key={bill.id} className="w-full rounded-xl border bg-card p-3 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold leading-snug">
                            {bill.commodity || '—'}
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            {bill.trade_time ? bjDateTime(bill.trade_time) : '—'}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-base font-bold tabular-nums',
                            direction === 'income'
                              ? 'text-emerald-600'
                              : direction === 'expense'
                                ? 'text-red-500'
                                : 'text-muted-foreground',
                          )}
                        >
                          {direction === 'income' ? '+' : direction === 'expense' ? '-' : ''}
                          {money(Number(bill.amount ?? 0))}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {categoryLabel(bill.category_id)}
                        </span>
                        {bill.creator_name && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${creatorTagClass(bill.creator_name)}`}
                          >
                            {bill.creator_name}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )
          ) : buckets.length === 0 ? (
            <p className="w-full rounded-2xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              没有符合筛选条件的数据
            </p>
          ) : (
            <ul className="grid w-full gap-2 md:grid-cols-2">
              {[...buckets].reverse().map((bucket) => (
                <li key={bucket.key} className="w-full rounded-xl border bg-card p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold tabular-nums">{bucket.key}</span>
                    <span
                      className={cn(
                        'text-sm font-bold tabular-nums',
                        bucket.net >= 0 ? 'text-emerald-600' : 'text-red-500',
                      )}
                    >
                      结余 {money(bucket.net)}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs">
                    <span className="text-emerald-600">收入 {money(bucket.income)}</span>
                    <span className="text-red-500">支出 {money(bucket.expense)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
