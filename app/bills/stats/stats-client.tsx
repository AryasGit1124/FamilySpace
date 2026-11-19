'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { CalendarDays, ChevronDown, SlidersHorizontal } from 'lucide-react'
import {
  billDirectionOf,
  bjDateTime,
  creatorTagClass,
  describeBillError,
  isMissingBillTable,
  sourceTag,
  type StatBill,
} from '@/lib/bills'
import {
  amountFilterParams,
  buildBuckets,
  buildCategoryShares,
  buildPieData,
  bucketTotals,
  categoryFilterIds,
  percentOf,
  shareScopeIds,
  type AmountFilterType,
} from '@/lib/bill-stats'
import {
  categoryIcon,
  fetchBillCategories,
  fetchBillStatCreators,
  fetchBillStatYears,
  fetchCategorySummary,
  fetchMonthlySummary,
  fetchStatBillsPage,
  fetchStatBillsTotals,
  type BillCategory,
  type StatBucketRow,
  type StatCategoryRow,
} from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

/** 月份选项：全年 / 1-12 月 */
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

const money = (value: number) => `¥${value.toFixed(2)}`

/** 图表最多渲染的数据点（超出只展示最近的部分，汇总额仍为全量） */
const CHART_BUCKET_LIMIT = 180

/** 明细列表每页条数 */
const DETAIL_PAGE_SIZE = 50

const currentYear = () => String(new Date().getFullYear())

const AMOUNT_OPTIONS: { value: AmountFilterType; label: string; hint?: string }[] = [
  { value: 'all', label: '全部金额' },
  { value: 'gte100', label: '金额 ≥ 100', hint: '大额消费' },
  { value: 'gte500', label: '金额 ≥ 500', hint: '超大额消费' },
  { value: 'custom', label: '自定义范围', hint: '填写最小 / 最大金额' },
]

/** 底部筛选抽屉里的临时条件，点「确认筛选」才作用于图表与明细 */
type FilterDraft = {
  categoryId: string
  creator: string
  amountType: AmountFilterType
  minAmount: string
  maxAmount: string
}

const EMPTY_DRAFT: FilterDraft = {
  categoryId: '',
  creator: '',
  amountType: 'all',
  minAmount: '',
  maxAmount: '',
}

/** 筛选胶囊 */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-orange-300 bg-orange-50 text-orange-600'
          : 'border-slate-200 bg-white text-slate-600',
      )}
    >
      {children}
    </button>
  )
}

/** 通用底部抽屉（移动端从底部弹出，桌面端居中） */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:rounded-2xl sm:pb-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
          <h3 className="truncate text-base font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full px-2 py-1 text-sm text-muted-foreground active:bg-muted"
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function StatsClient() {
  /** 两个 Tab：汇总视图 / 交易明细 */
  const [tab, setTab] = useState<'summary' | 'detail'>('summary')
  const [categories, setCategories] = useState<BillCategory[]>([])
  const [years, setYears] = useState<string[]>([])
  const [year, setYear] = useState<string>(currentYear)
  /** 'all' 表示全年 */
  const [month, setMonth] = useState('all')
  const [creatorNames, setCreatorNames] = useState<string[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  /** 金额筛选（独立于时间维度 / 分类 / 登记人，切换后仍保留） */
  const [amountType, setAmountType] = useState<AmountFilterType>('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  /** 底部抽屉：筛选 / 年月选择 */
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT)
  const [draftYear, setDraftYear] = useState(year)
  const [draftMonth, setDraftMonth] = useState(month)

  /** 数据库聚合结果（几十行，不再拉全量明细） */
  const [bucketRows, setBucketRows] = useState<StatBucketRow[]>([])
  const [categoryRows, setCategoryRows] = useState<StatCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /** 明细只要在「交易明细」Tab 才加载 */
  const [detailRows, setDetailRows] = useState<StatBill[]>([])
  const [detailHasMore, setDetailHasMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  /** 明细 Tab 的顶部合计：与列表同一套 where，由数据库聚合得出 */
  const [detailTotals, setDetailTotals] = useState<{ income: number; expense: number } | null>(null)

  const loadBase = useCallback(async () => {
    try {
      const [categoryList, yearList, creatorList] = await Promise.all([
        fetchBillCategories(),
        fetchBillStatYears(),
        fetchBillStatCreators(),
      ])
      setCategories(categoryList)
      setYears(yearList.length > 0 ? yearList : [currentYear()])
      // 数据里没有今年时自动落到最近一个有账单的年份，避免默认年份筛掉全部数据
      if (yearList.length > 0 && !yearList.includes(currentYear())) {
        setYear(yearList[0])
      }
      setCreatorNames(creatorList)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[BillsStats] 读取基础数据失败:', detail, err)
      setError(
        isMissingBillTable(err)
          ? '账单表还没创建：请先执行 scripts/create-bill-ods.sql'
          : `读取统计数据失败：${detail}`,
      )
    }
  }, [])

  useEffect(() => {
    void loadBase()
  }, [loadBase])

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

  /** 抽屉里当前选中的一级分类（选二级时回溯到父级） */
  const draftParentId = useMemo(() => {
    const selected = draft.categoryId ? categoryById.get(draft.categoryId) : undefined
    return selected ? (selected.parent_id ?? selected.id) : ''
  }, [draft.categoryId, categoryById])

  const draftChildren = useMemo(
    () => categories.filter((item) => item.parent_id === draftParentId),
    [categories, draftParentId],
  )

  /** 分类筛选范围：选一级 = 整棵子树；选二级 = 仅该分类 */
  const filterCategoryIds = useMemo(
    () => categoryFilterIds(categories, categoryId),
    [categoryId, categories],
  )

  /** 饼图范围：选二级时看同一父级下的兄弟分类 */
  const shareCategoryIds = useMemo(
    () => shareScopeIds(categories, categoryId),
    [categoryId, categories],
  )

  /** 金额筛选 → RPC 参数 */
  const amountParams = useMemo(
    () => amountFilterParams(amountType, minAmount, maxAmount),
    [amountType, minAmount, maxAmount],
  )

  /** 年份 / 月份 / 分类 / 登记人 / 金额 → RPC 与明细共用 */
  const filterParams = useMemo(
    () => ({
      year: year || null,
      month,
      categoryIds: filterCategoryIds,
      creator: creatorFilter,
      ...amountParams,
    }),
    [year, month, filterCategoryIds, creatorFilter, amountParams],
  )

  /** 聚合数据：时间桶（按月）+ 分类占比，均由数据库计算 */
  const loadAggregates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [bucketData, categoryData] = await Promise.all([
        fetchMonthlySummary({ ...filterParams, granularity: 'month' }),
        fetchCategorySummary({ ...filterParams, categoryIds: shareCategoryIds }),
      ])
      setBucketRows(bucketData)
      setCategoryRows(categoryData)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[BillsStats] 读取统计数据失败:', detail, err)
      setError(`读取统计数据失败：${detail}`)
    } finally {
      setLoading(false)
    }
  }, [filterParams, shareCategoryIds])

  useEffect(() => {
    void loadAggregates()
  }, [loadAggregates])

  /** 明细查询参数：额外带上下钻选中的分类 id（一级分类由查询层展开二级） */
  const detailParams = useMemo(
    () => ({ ...filterParams, categoryId: categoryId || null }),
    [filterParams, categoryId],
  )

  /** 明细分页：服务端每次 50 条 */
  const loadDetailPage = useCallback(
    async (offset: number) => {
      setDetailLoading(true)
      try {
        // 首页数据与顶部合计并行请求，保证「列表有数据、汇总不为 0」
        const [rows, total] = await Promise.all([
          fetchStatBillsPage({
            ...detailParams,
            offset,
            limit: DETAIL_PAGE_SIZE,
          }),
          offset === 0
            ? fetchStatBillsTotals(detailParams).catch((err) => {
                console.warn('[BillsStats] 明细合计读取失败，回退到统计数据:', err)
                return null
              })
            : Promise.resolve(null),
        ])
        setDetailRows((prev) => (offset === 0 ? rows : [...prev, ...rows]))
        if (offset === 0) setDetailTotals(total)
        setDetailHasMore(rows.length === DETAIL_PAGE_SIZE)
      } catch (err) {
        const detail = describeBillError(err)
        console.error('[BillsStats] 读取明细失败:', detail, err)
        setError(`读取明细失败：${detail}`)
      } finally {
        setDetailLoading(false)
      }
    },
    [detailParams],
  )

  /** 切到明细 Tab 或任一筛选条件变化时，重新从第 0 页拉取 */
  useEffect(() => {
    if (tab !== 'detail') return
    // 下钻排查用：确认状态更新后带上了正确的分类与子分类集合
    console.log(
      '[BillsStats] 当前查询的分类条件:',
      categoryId || '全部分类',
      '对应的子分类IDs:',
      filterCategoryIds ?? [],
    )
    setDetailRows([])
    setDetailHasMore(false)
    setDetailTotals(null)
    void loadDetailPage(0)
  }, [tab, loadDetailPage])

  const refresh = useCallback(async () => {
    await loadBase()
    await loadAggregates()
    if (tab === 'detail') await loadDetailPage(0)
  }, [loadBase, loadAggregates, loadDetailPage, tab])

  /** 时间桶：RPC 已按 key 升序返回 */
  const buckets = useMemo(() => buildBuckets(bucketRows), [bucketRows])

  /** 饼图：数据库按分类聚合，这里只做分类名 / Emoji 映射 */
  const shares = useMemo(
    () => buildCategoryShares(categoryRows, categories, categoryId),
    [categoryRows, categories, categoryId],
  )

  /** 图表最多展示的点数 */
  const chartData = useMemo(
    () => (buckets.length > CHART_BUCKET_LIMIT ? buckets.slice(-CHART_BUCKET_LIMIT) : buckets),
    [buckets],
  )

  const chartTruncated = buckets.length > CHART_BUCKET_LIMIT

  /** 饼图只保留 Top 5，其余合并为「其他」 */
  const pieData = useMemo(() => buildPieData(shares), [shares])

  const totalExpense = useMemo(() => shares.reduce((sum, share) => sum + share.value, 0), [shares])

  /** 下钻：选中分类并跳到交易明细 Tab */
  const drillDown = useCallback((id: string | null) => {
    if (!id) return
    setCategoryId(id)
    setTab('detail')
  }, [])

  const totals = useMemo(() => bucketTotals(buckets), [buckets])

  /** 明细 Tab 展示与列表同条件的合计；聚合查询失败时回退到统计 RPC */
  const displayedTotals = tab === 'detail' && detailTotals ? detailTotals : totals

  /** 已生效的筛选条件数量（分类 / 登记人 / 金额） */
  const activeFilterCount =
    (categoryId ? 1 : 0) + (creatorFilter ? 1 : 0) + (amountType !== 'all' ? 1 : 0)

  /** 打开抽屉时把当前条件复制为草稿，直接关闭不影响已生效条件 */
  const openFilters = () => {
    setDraft({ categoryId, creator: creatorFilter, amountType, minAmount, maxAmount })
    setFilterOpen(true)
  }

  const applyFilters = () => {
    setCategoryId(draft.categoryId)
    setCreatorFilter(draft.creator)
    setAmountType(draft.amountType)
    setMinAmount(draft.minAmount)
    setMaxAmount(draft.maxAmount)
    setFilterOpen(false)
  }

  const openDatePicker = () => {
    setDraftYear(year)
    setDraftMonth(month)
    setDateOpen(true)
  }

  const applyDate = () => {
    setYear(draftYear)
    setMonth(draftMonth)
    setDateOpen(false)
  }

  /** 顶部展示的年月文案：2026年11月 / 2026年全年 */
  const dateLabel = `${year}年${month === 'all' ? '全年' : `${Number(month)}月`}`

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden pb-24">
      <PageHeader
        title="数据统计"
        subtitle="按时间维度看收支，按分类看结构"
        backHref="/bills/import"
        backLabel="返回账单"
        action={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="shrink-0 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
          >
            {loading ? '读取中…' : '刷新'}
          </button>
        }
      />

      <div className="mx-auto flex w-full max-w-full flex-col gap-3 overflow-x-hidden px-4 md:px-6">
        {/* 两个 Tab：汇总视图 / 交易明细 */}
        <div className="mt-2 flex w-full rounded-full bg-muted p-0.5">
          {(
            [
              { value: 'summary', label: '📈 汇总视图' },
              { value: 'detail', label: '📝 交易明细' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={cn(
                'flex-1 rounded-full py-2 text-sm font-semibold transition-colors',
                tab === item.value ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900"
            >
              重试
            </button>
          </div>
        )}

        {/* 顶部只保留年月 + 筛选入口，详细条件收进底部抽屉，彻底去掉横向滑动 */}
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={openDatePicker}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-white px-3 py-2 text-sm font-semibold text-slate-700 active:bg-muted/60"
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{dateLabel}</span>
            <ChevronDown
              className="ml-auto size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={openFilters}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors',
              activeFilterCount > 0
                ? 'border-orange-300 bg-orange-50 text-orange-600'
                : 'bg-white text-slate-600',
            )}
          >
            <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
            <span>{activeFilterCount > 0 ? `筛选 (${activeFilterCount})` : '筛选'}</span>
            {activeFilterCount > 0 && (
              <span className="size-1.5 rounded-full bg-orange-500" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* 汇总条：始终显示当前筛选下的合计 */}
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/60 px-3 py-2 text-xs sm:text-sm">
          <span className="text-muted-foreground">
            收入{' '}
            <span className="font-bold text-emerald-600">{money(displayedTotals.income)}</span>
          </span>
          <span className="text-muted-foreground">
            支出 <span className="font-bold text-red-500">{money(displayedTotals.expense)}</span>
          </span>
          <span className="text-muted-foreground">
            结余{' '}
            <span
              className={cn(
                'font-bold',
                displayedTotals.income - displayedTotals.expense >= 0
                  ? 'text-emerald-600'
                  : 'text-red-500',
              )}
            >
              {money(displayedTotals.income - displayedTotals.expense)}
            </span>
          </span>
        </div>

        {tab === 'summary' ? (
          <>
            {/* 图表区：父级显式 w-full / min-w-0，ResponsiveContainer 才能测到真实宽度 */}
            <div className="grid w-full gap-3 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <section className="w-full min-w-0 rounded-2xl border bg-card p-3 shadow-sm">
                <h2 className="mb-1 text-sm font-bold">收入 / 支出</h2>
                {chartTruncated && (
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    数据点较多，图表仅展示最近 {CHART_BUCKET_LIMIT} 期；汇总与明细仍包含全部数据。
                  </p>
                )}
                {loading ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">正在读取…</p>
                ) : chartData.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">这个范围内没有数据</p>
                ) : (
                  <div className="relative h-64 w-full overflow-hidden">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 11 }} width={56} />
                        <Tooltip
                          formatter={(value) => money(Number(value ?? 0))}
                          labelStyle={{ fontSize: 12 }}
                          contentStyle={{ fontSize: 12, borderRadius: 12 }}
                        />
                        <Bar
                          dataKey="income"
                          name="收入"
                          stackId="sum"
                          fill="#22c55e"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="expense"
                          name="支出"
                          stackId="sum"
                          fill="#ef4444"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                        />
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
                  <div className="relative h-64 w-full overflow-hidden">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={42}
                          outerRadius={72}
                          paddingAngle={1}
                          isAnimationActive={false}
                          onClick={(_, index) => drillDown(pieData[index]?.id ?? null)}
                          className="cursor-pointer"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`${entry.id ?? 'other'}-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [
                            `${money(Number(value ?? 0))}（${Math.round(percentOf(Number(value ?? 0), totalExpense))}%）`,
                            String(name ?? ''),
                          ]}
                          contentStyle={{ fontSize: 12, borderRadius: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <p className="mt-1 text-center text-[11px] text-muted-foreground">
                  点击扇区可下钻到该分类的交易明细
                </p>
              </section>
            </div>

            {/* 分类列表：点击任意一行下钻到交易明细 */}
            <section className="w-full rounded-2xl border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-2 px-3 pt-3">
                <h2 className="text-sm font-bold">分类支出明细</h2>
                <span className="text-[11px] text-muted-foreground">
                  {loading ? '读取中…' : `${shares.length} 个分类`}
                </span>
              </div>
              {loading ? (
                <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
              ) : shares.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  还没有分类后的支出数据
                </p>
              ) : (
                <ul className="mt-1 divide-y divide-gray-100">
                  {shares.map((share) => {
                    const percent = percentOf(share.value, totalExpense)
                    return (
                      <li key={share.id ?? share.name}>
                        <button
                          type="button"
                          onClick={() => drillDown(share.id)}
                          className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left active:bg-muted/60"
                        >
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-base"
                            aria-hidden="true"
                          >
                            {share.emoji}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900">
                              {share.name}
                            </span>
                            <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                              <span
                                className="block h-full rounded-full bg-orange-400"
                                style={{ width: `${Math.min(percent, 100)}%` }}
                              />
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-semibold tabular-nums text-gray-900">
                              {money(share.value)}
                            </span>
                            <span className="block text-[11px] tabular-nums text-muted-foreground">
                              {percent.toFixed(1)}%
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>
        ) : (
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">交易明细</h2>
              <span className="text-xs text-muted-foreground">已加载 {detailRows.length} 条</span>
            </div>

            {detailRows.length === 0 ? (
              <p className="w-full rounded-2xl border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                {detailLoading ? '正在加载…' : '没有符合筛选条件的交易'}
              </p>
            ) : (
              <>
                <ul className="w-full divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white">
                  {detailRows.map((bill) => {
                    const direction = bill.transaction_nature ?? billDirectionOf(bill.direction)
                    const categoryIdOfBill = bill.subcategory_id ?? bill.category_id
                    const category = categoryIdOfBill ? categoryById.get(categoryIdOfBill) : undefined
                    const categoryParent =
                      category?.parent_id ? categoryById.get(category.parent_id) : undefined
                    const source = sourceTag(bill.source)
                    return (
                      <li key={bill.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                        <span
                          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg"
                          aria-hidden="true"
                        >
                          {category ? categoryIcon(category) : '💰'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base leading-snug text-gray-900">
                            {bill.commodity || '—'}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                            {source && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${source.className}`}
                              >
                                {source.label}
                              </span>
                            )}
                            {bill.creator_name && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${creatorTagClass(bill.creator_name)}`}
                              >
                                {bill.creator_name}
                              </span>
                            )}
                            <span className="tabular-nums">
                              {bill.trade_time ? bjDateTime(bill.trade_time) : '—'}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {categoryParent && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                {categoryIcon(categoryParent)} {categoryParent.name}
                              </span>
                            )}
                            {category ? (
                              <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-600">
                                {categoryIcon(category)} {category.name}
                              </span>
                            ) : (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                未分类
                              </span>
                            )}
                          </div>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-lg font-medium tabular-nums',
                            direction === 'income'
                              ? 'text-amber-600'
                              : direction === 'expense'
                                ? 'text-gray-900'
                                : 'text-gray-400',
                          )}
                        >
                          {direction === 'income' ? '+' : direction === 'expense' ? '-' : ''}
                          {money(Number(bill.net_amount ?? 0))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-3 text-center">
                  {detailHasMore ? (
                    <button
                      type="button"
                      onClick={() => void loadDetailPage(detailRows.length)}
                      disabled={detailLoading}
                      className="h-10 w-full max-w-xs rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-600 active:bg-gray-50 disabled:opacity-60"
                    >
                      {detailLoading ? '加载中…' : `加载更多（每次 ${DETAIL_PAGE_SIZE} 条）`}
                    </button>
                  ) : (
                    <p className="py-2 text-xs text-muted-foreground">没有更多了</p>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {dateOpen && (
        <Sheet title="选择年月" onClose={() => setDateOpen(false)}>
          <div className="space-y-4">
            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">年份</p>
              <div className="flex flex-wrap gap-2">
                {years.map((item) => (
                  <Chip key={item} active={draftYear === item} onClick={() => setDraftYear(item)}>
                    {item}年
                  </Chip>
                ))}
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">月份</p>
              <div className="grid grid-cols-4 gap-2">
                <Chip active={draftMonth === 'all'} onClick={() => setDraftMonth('all')}>
                  全年
                </Chip>
                {MONTH_OPTIONS.map((item) => (
                  <Chip
                    key={item}
                    active={draftMonth === item}
                    onClick={() => setDraftMonth(item)}
                  >
                    {Number(item)}月
                  </Chip>
                ))}
              </div>
            </section>

            <button
              type="button"
              onClick={applyDate}
              className="h-11 w-full rounded-xl bg-primary text-sm font-semibold text-white active:opacity-90"
            >
              确定
            </button>
          </div>
        </Sheet>
      )}

      {filterOpen && (
        <Sheet title="筛选" onClose={() => setFilterOpen(false)}>
          <div className="space-y-5">
            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">一级分类</p>
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={!draft.categoryId}
                  onClick={() => setDraft((prev) => ({ ...prev, categoryId: '' }))}
                >
                  全部分类
                </Chip>
                {topCategories.map((parent) => (
                  <Chip
                    key={parent.id}
                    active={draftParentId === parent.id}
                    onClick={() => setDraft((prev) => ({ ...prev, categoryId: parent.id }))}
                  >
                    {categoryIcon(parent)} {parent.name}
                  </Chip>
                ))}
              </div>
              {topCategories.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">还没建分类</p>
              )}
            </section>

            {draftParentId && draftChildren.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">二级分类</p>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={draft.categoryId === draftParentId}
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, categoryId: draftParentId }))
                    }
                  >
                    全部
                  </Chip>
                  {draftChildren.map((child) => (
                    <Chip
                      key={child.id}
                      active={draft.categoryId === child.id}
                      onClick={() => setDraft((prev) => ({ ...prev, categoryId: child.id }))}
                    >
                      {categoryIcon(child)} {child.name}
                    </Chip>
                  ))}
                </div>
              </section>
            )}

            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">金额区间</p>
              <div className="flex flex-wrap gap-2">
                {AMOUNT_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    active={draft.amountType === option.value}
                    onClick={() => setDraft((prev) => ({ ...prev, amountType: option.value }))}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
              {draft.amountType === 'custom' && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={draft.minAmount}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, minAmount: event.target.value }))
                    }
                    placeholder="最小金额"
                    aria-label="最小金额"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-orange-300"
                  />
                  <span className="shrink-0 text-sm text-gray-400">—</span>
                  <input
                    inputMode="decimal"
                    value={draft.maxAmount}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, maxAmount: event.target.value }))
                    }
                    placeholder="最大金额"
                    aria-label="最大金额"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-orange-300"
                  />
                </div>
              )}
            </section>

            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">登记人</p>
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={!draft.creator}
                  onClick={() => setDraft((prev) => ({ ...prev, creator: '' }))}
                >
                  全部
                </Chip>
                {creatorNames.map((name) => (
                  <Chip
                    key={name}
                    active={draft.creator === name}
                    onClick={() => setDraft((prev) => ({ ...prev, creator: name }))}
                  >
                    {name}
                  </Chip>
                ))}
              </div>
              {creatorNames.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">暂无登记人</p>
              )}
            </section>

            <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-white px-4 pb-[env(safe-area-inset-bottom)] pt-3">
              <button
                type="button"
                onClick={() => setDraft(EMPTY_DRAFT)}
                className="h-11 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 active:bg-gray-50"
              >
                重置
              </button>
              <button
                type="button"
                onClick={applyFilters}
                className="h-11 flex-[2] rounded-xl bg-orange-500 text-sm font-semibold text-white active:bg-orange-600"
              >
                确认筛选
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}
