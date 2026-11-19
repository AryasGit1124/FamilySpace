'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, CreditCard, Search, SlidersHorizontal, Wallet, Wand2, X, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ManualBillSheet } from '@/app/bills/manual-bill-sheet'
import {
  bjDateTime,
  buildOdsRows,
  creatorTagClass,
  describeBillError,
  findRawHeaderRow,
  isMissingBillTable,
  newBatchId,
  readBillSheet,
  billDirectionOf,
  sourceTag,
  type BillSource,
} from '@/lib/bills'
import {
  applyCategoryRules,
  categoryIcon,
  deleteOdsBatch,
  fetchBillCategories,
  fetchBillStatCreators,
  fetchDwdBillsPage,
  fetchDwdYears,
  fetchOdsBatches,
  insertOdsBills,
  processBillBatch,
  updateDwdBillCategory,
  type BillCategory,
  type OdsBatch,
} from '@/lib/supabase-queries'
import type { BillDWD } from '@/types/bill'

type Phase = 'idle' | 'parsing' | 'saving'

/** 明细每页条数（服务端分页） */
const PAGE_SIZE = 50

const SOURCE_META: Record<
  BillSource,
  { label: string; hint: string; icon: LucideIcon; iconClass: string; short: string }
> = {
  wechat: {
    label: '导入微信账单',
    hint: '钱包 → 账单 → 常见问题 → 下载账单',
    icon: Wallet,
    iconClass: 'text-emerald-500',
    short: '微信',
  },
  alipay: {
    label: '导入支付宝账单',
    hint: '我的 → 账单 → … → 开具交易流水证明',
    icon: CreditCard,
    iconClass: 'text-sky-500',
    short: '支付宝',
  },
}

/** 批次 chips 里的来源简称，兼容手动记账（source=manual） */
const SOURCE_LABELS: Record<string, string> = {
  wechat: '微信',
  alipay: '支付宝',
  manual: '手动',
}

/** 导入历史的主标题：老数据没有文件名时的兜底 */
const batchFileName = (batch: { fileName?: string }) =>
  batch.fileName?.trim() || '未命名账单文件'

/** 明细筛选条件：一级分类 / 二级分类（年月由顶部切换器控制） */
type BillFilters = {
  parentId: string
  childId: string
}

const EMPTY_FILTERS: BillFilters = { parentId: '', childId: '' }

/** 当前年份（默认展示今年） */
const currentYear = () => String(new Date().getFullYear())

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

/** 时间条件文案：全年 / 11月 */
const timeLabel = (year: string, month: string) =>
  `${year}年${month === 'all' ? '全年' : `${Number(month)}月`}`

/** 金额筛选类型 */
type AmountFilterType = 'all' | 'gte100' | 'gte500' | 'custom'

const AMOUNT_OPTIONS: { value: AmountFilterType; label: string; hint?: string }[] = [
  { value: 'all', label: '全部金额' },
  { value: 'gte100', label: '金额 ≥ 100', hint: '大额消费' },
  { value: 'gte500', label: '金额 ≥ 500', hint: '超大额消费' },
  { value: 'custom', label: '自定义范围', hint: '填写最小 / 最大金额' },
]

/** 底部筛选抽屉的临时条件，点「确认筛选」才生效 */
type FilterDraft = {
  batchId: string
  categoryId: string
  creator: string
  amountType: AmountFilterType
  minAmount: string
  maxAmount: string
}

const EMPTY_DRAFT: FilterDraft = {
  batchId: '',
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
      className={[
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-orange-300 bg-orange-50 text-orange-600'
          : 'border-slate-200 bg-white text-slate-600',
      ].join(' ')}
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

/** 账单行：微信账单式极简列表项 —— 左图标 / 中信息 / 右金额，无卡片背景与阴影 */
function BillRow({
  row,
  categories,
  onAssign,
}: {
  row: BillDWD
  categories: BillCategory[]
  onAssign: (id: string, categoryId: string) => void
}) {
  const kind = row.transaction_nature ?? billDirectionOf(row.direction)
  const isIncome = kind === 'income'
  const isExpense = kind === 'expense'
  /** 二级分类优先，其次一级分类 */
  const category = categories.find(
    (item) => item.id === (row.subcategory_id ?? row.category_id),
  )
  const parentCategory =
    category?.parent_id != null
      ? categories.find((item) => item.id === category.parent_id)
      : undefined
  const emoji = category
    ? categoryIcon(category)
    : row.source === 'wechat'
      ? '💬'
      : row.source === 'alipay'
        ? '💙'
        : '✏️'
  const source = sourceTag(row.source)
  const stamp = row.trade_time ? bjDateTime(row.trade_time) : ''
  const shortTime = stamp ? `${Number(stamp.slice(5, 7))}月${Number(stamp.slice(8, 10))}日 ${stamp.slice(11)}` : '—'

  return (
    <li className="flex w-full min-w-0 items-center gap-3 border-b border-gray-100 bg-white py-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg"
        aria-hidden="true"
      >
        {emoji}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-base leading-snug text-gray-900">
          {row.commodity || row.counterparty || row.trade_type || '（无商品说明）'}
        </p>

        {/* 第二行：来源 / 登记人 / 时间 */}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          {source && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${source.className}`}
            >
              {source.label}
            </span>
          )}
          {row.creator_name && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${creatorTagClass(row.creator_name)}`}
            >
              {row.creator_name}
            </span>
          )}
          <span className="tabular-nums">{shortTime}</span>
        </div>

        {/* 第三行：待确认标记 + 分类或极小的待分类下拉 */}
        {(row.needs_review || category || categories.length > 0) && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {row.needs_review && (
              <span className="shrink-0 text-[10px] font-medium text-red-500">待确认</span>
            )}
            {category ? (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {parentCategory && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {categoryIcon(parentCategory)} {parentCategory.name}
                  </span>
                )}
                <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-600">
                  {categoryIcon(category)} {category.name}
                </span>
              </span>
            ) : (
              <select
                value=""
                onChange={(event) => onAssign(row.id, event.target.value)}
                aria-label="选择分类"
                className="max-w-full appearance-none rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 outline-none"
              >
                <option value="">待分类</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.parent_id ? '　↳ ' : ''}
                    {categoryIcon(item)} {item.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <span
        className={
          isIncome
            ? 'shrink-0 text-lg font-medium tabular-nums text-orange-500'
            : isExpense
              ? 'shrink-0 text-lg font-medium tabular-nums text-gray-900'
              : 'shrink-0 text-lg font-medium tabular-nums text-gray-400'
        }
      >
        {row.net_amount === null
          ? '—'
          : `${isIncome ? '+' : isExpense ? '-' : ''}${Number(row.net_amount).toFixed(2)}`}
      </span>
    </li>
  )
}

/**
 * 账单导入：文件 → bill_ods 物理列 + raw_data，下方卡片流展示明细，
 * 并提供「一键应用规则自动分类」。数据全部在浏览器端读写（线上服务端偶发 ECONNRESET）。
 */
export function BillsClient() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState('')

  const [batches, setBatches] = useState<OdsBatch[]>([])
  const [rows, setRows] = useState<BillDWD[]>([])
  const [categories, setCategories] = useState<BillCategory[]>([])
  const [selectedBatch, setSelectedBatch] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [cleaning, setCleaning] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 刚复制过文件名的批次 id，用于短暂提示 */
  const [copiedFileBatch, setCopiedFileBatch] = useState('')
  /** 正在撤销的批次 id，撤销中禁用该行按钮 */
  const [undoingBatch, setUndoingBatch] = useState('')
  /** 明细组合筛选（全部下推到 bill_dwd 查询） */
  const [filters, setFilters] = useState<BillFilters>(EMPTY_FILTERS)
  /** 顶部时间筛选：年份默认今年，月份默认全年 */
  const [filterYear, setFilterYear] = useState<string>(currentYear)
  const [filterMonth, setFilterMonth] = useState<string>('all')
  /** 年份下拉选项（来自 bill_dwd 的实际数据范围） */
  const [yearOptions, setYearOptions] = useState<string[]>([currentYear()])
  /** 金额筛选：类型 + 自定义上下限（字符串便于输入） */
  const [amountType, setAmountType] = useState<AmountFilterType>('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  /** 登记人筛选（来自 get_bill_creators RPC） */
  const [creatorFilter, setCreatorFilter] = useState('')
  const [creatorOptions, setCreatorOptions] = useState<string[]>([])
  /** 万能搜索：输入值 + 500ms 防抖后的查询值 */
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  /** 底部抽屉：筛选 / 年月选择 */
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT)
  const [draftYear, setDraftYear] = useState(filterYear)
  const [draftMonth, setDraftMonth] = useState(filterMonth)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingSource = useRef<BillSource>('wechat')

  /** 分类筛选换算成 id 集合（一级分类含其全部二级） */
  const categoryIds = useMemo(() => {
    if (filters.childId) return [filters.childId]
    if (!filters.parentId) return null
    const ids = [filters.parentId]
    for (const category of categories) {
      if (category.parent_id === filters.parentId) ids.push(category.id)
    }
    return ids
  }, [filters.parentId, filters.childId, categories])

  /** 金额筛选换算成查询边界 */
  const amountBounds = useMemo(() => {
    const min = minAmount.trim() === '' ? null : Number(minAmount)
    const max = maxAmount.trim() === '' ? null : Number(maxAmount)
    const validMin = min !== null && Number.isFinite(min) ? min : null
    const validMax = max !== null && Number.isFinite(max) ? max : null
    if (amountType === 'gte100') return { min: 100, max: null, excludeZero: false }
    if (amountType === 'gte500') return { min: 500, max: null, excludeZero: false }
    if (amountType === 'custom') return { min: validMin, max: validMax, excludeZero: false }
    return { min: null, max: null, excludeZero: false }
  }, [amountType, minAmount, maxAmount])

  /** 当前筛选条件 → bill_dwd 查询参数 */
  const queryParams = useMemo(
    () => ({
      batchId: selectedBatch || undefined,
      year: filterYear,
      month: filterMonth,
      // 下钻分类交给数据层实时展开（一级分类会带出全部二级分类）
      categoryId: filters.childId || filters.parentId || undefined,
      categoryIds,
      creator: creatorFilter || undefined,
      keyword: keyword || undefined,
      minAmount: amountBounds.min,
      maxAmount: amountBounds.max,
      excludeZero: amountBounds.excludeZero,
    }),
    [selectedBatch, filterYear, filterMonth, filters.childId, filters.parentId, categoryIds, creatorFilter, keyword, amountBounds],
  )

  /** 元数据：批次、分类、年份选项 */
  const loadMeta = useCallback(async () => {
    try {
      const [batchList, categoryList, years, creatorList] = await Promise.all([
        fetchOdsBatches(),
        fetchBillCategories(),
        fetchDwdYears(),
        fetchBillStatCreators(),
      ])
      setBatches(batchList)
      setCategories(categoryList)
      setYearOptions(years)
      setCreatorOptions(creatorList)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 读取基础数据失败:', detail, err)
      setLoadError(
        isMissingBillTable(err)
          ? '账单表还没创建：请在 Supabase 执行 scripts/create-bill-ods.sql，然后刷新本页'
          : `读取账单失败：${detail}`,
      )
    }
  }, [])

  /** 第一页明细（筛选条件变化时重新拉取） */
  const loadRows = useCallback(async () => {
    setListLoading(true)
    setLoadError('')
    try {
      const page = await fetchDwdBillsPage({ ...queryParams, offset: 0, limit: PAGE_SIZE })
      setRows(page.rows)
      setHasMore(page.hasMore)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 读取账单失败:', detail, err)
      setLoadError(
        isMissingBillTable(err)
          ? '账单表还没创建：请在 Supabase 执行 scripts/create-bill-ods.sql，然后刷新本页'
          : `读取账单失败：${detail}`,
      )
    } finally {
      setListLoading(false)
    }
  }, [queryParams])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  /** 搜索输入防抖 500ms，停止输入后再查询 */
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(searchInput.trim()), 500)
    return () => clearTimeout(timer)
  }, [searchInput])

  /** 加载下一页（每次 50 条，追加到列表） */
  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await fetchDwdBillsPage({
        ...queryParams,
        offset: rows.length,
        limit: PAGE_SIZE,
      })
      setRows((prev) => [...prev, ...page.rows])
      setHasMore(page.hasMore)
    } catch (err) {
      console.error('[Bills] 加载下一页失败:', describeBillError(err), err)
      setLoadError(`读取账单失败：${describeBillError(err)}`)
    } finally {
      setLoadingMore(false)
    }
  }

  /** 一键应用规则：交给数据库 RPC 全量重新分类（手动分类会保留） */
  const runRules = async () => {
    if (
      !confirm('将按最新规则重新分类所有账单，手动修改过的分类会保留。确定要继续吗？')
    ) {
      return
    }
    setCleaning(true)
    setError('')
    setMessage('正在重新分类…')
    try {
      const updated = await applyCategoryRules()
      await Promise.all([loadMeta(), loadRows()])
      alert(`成功为 ${updated} 条账单更新了分类！`)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 规则分类失败:', detail, err)
      setError(`规则分类失败：${detail}（请确认已执行 scripts/create-bill-apply-rules-rpc.sql）`)
    } finally {
      setMessage('')
      setCleaning(false)
    }
  }

  /** 撤销一次导入：按批次删除全部记录，不可恢复 */
  const undoBatch = async (batch: OdsBatch) => {
    if (!confirm('确定要撤销本次导入的所有记录吗？该操作不可逆！')) return
    setUndoingBatch(batch.batchId)
    try {
      const deleted = await deleteOdsBatch(batch.batchId)
      const nextSelected = selectedBatch === batch.batchId ? '' : selectedBatch
      setSelectedBatch(nextSelected)
      await Promise.all([loadMeta(), loadRows()])
      setHistoryOpen(false)
      alert(`已撤销该批次 ${deleted} 条记录`)
    } catch (err) {
      setError(`撤销失败：${describeBillError(err)}`)
    } finally {
      setUndoingBatch('')
    }
  }

  const busy = phase !== 'idle'
  /** 点击文件名复制（非 HTTPS 等场景失败时静默，仍可长按选择文本） */
  const copyFileName = async (batchId: string, name: string) => {
    try {
      await navigator.clipboard.writeText(name)
      setCopiedFileBatch(batchId)
      window.setTimeout(() => {
        setCopiedFileBatch((prev) => (prev === batchId ? '' : prev))
      }, 1500)
    } catch {
      // 忽略：不影响其它操作
    }
  }
  /** 最近 10 次导入（手工记账没有批次号，不参与撤销） */
  const importBatches = batches.filter((batch) => batch.batchId !== '(无批次号)').slice(0, 10)

  /** 一级分类选项（parent_id 为空） */
  const parentCategories = useMemo(
    () => categories.filter((category) => !category.parent_id),
    [categories],
  )

  /** 抽屉里当前选中的一级分类（选二级时回溯到父级） */
  const draftParentId = useMemo(() => {
    const selected = draft.categoryId ? categories.find((item) => item.id === draft.categoryId) : undefined
    return selected ? (selected.parent_id ?? selected.id) : ''
  }, [draft.categoryId, categories])

  const draftChildren = useMemo(
    () => categories.filter((item) => item.parent_id === draftParentId),
    [categories, draftParentId],
  )

  const hasFilters = Boolean(
    filters.parentId ||
      filters.childId ||
      creatorFilter ||
      keyword ||
      selectedBatch ||
      amountType !== 'all' ||
      filterMonth !== 'all',
  )

  /** 已生效的筛选条件数量（批次 / 分类 / 登记人 / 金额） */
  const activeFilterCount =
    (selectedBatch ? 1 : 0) +
    (filters.parentId || filters.childId ? 1 : 0) +
    (creatorFilter ? 1 : 0) +
    (amountType !== 'all' ? 1 : 0)

  /** 打开抽屉时把当前条件复制为草稿，直接关闭不影响已生效条件 */
  const openFilters = () => {
    setDraft({
      batchId: selectedBatch,
      categoryId: filters.childId || filters.parentId,
      creator: creatorFilter,
      amountType,
      minAmount,
      maxAmount,
    })
    setFilterOpen(true)
  }

  const applyFilters = () => {
    const selected = draft.categoryId
      ? categories.find((item) => item.id === draft.categoryId)
      : undefined
    setFilters({
      parentId: selected ? (selected.parent_id ?? selected.id) : '',
      childId: selected?.parent_id ? selected.id : '',
    })
    setSelectedBatch(draft.batchId)
    setCreatorFilter(draft.creator)
    setAmountType(draft.amountType)
    setMinAmount(draft.minAmount)
    setMaxAmount(draft.maxAmount)
    setFilterOpen(false)
  }

  const openDatePicker = () => {
    setDraftYear(filterYear)
    setDraftMonth(filterMonth)
    setDateOpen(true)
  }

  const applyDate = () => {
    setFilterYear(draftYear)
    setFilterMonth(draftMonth)
    setDateOpen(false)
  }

  /** 已加载的明细（筛选已在 bill_dwd 查询端完成） */
  const filteredRows = rows

  /** 按交易月份分组（YYYY-MM 倒序），每组带已加载数据的小计 */
  const groupedMonths = useMemo(() => {
    const map = new Map<string, { expense: number; income: number; bills: BillDWD[] }>()
    for (const row of filteredRows) {
      const stamp = row.trade_time ? bjDateTime(row.trade_time) : ''
      const key = stamp ? stamp.slice(0, 7) : '未知时间'
      let group = map.get(key)
      if (!group) {
        group = { expense: 0, income: 0, bills: [] }
        map.set(key, group)
      }
      group.bills.push(row)
      const kind = row.transaction_nature ?? billDirectionOf(row.direction)
      if (kind === 'income') group.income += Number(row.net_amount ?? 0)
      else if (kind === 'expense') group.expense += Number(row.net_amount ?? 0)
    }
    const list = [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, group]) => ({ key, ...group }))
    // 时间倒序分页时，最后一个月可能只加载了一部分，标记出来避免小计被误读为整月合计
    return list.map((group, index) => ({
      ...group,
      partial: hasMore && index === list.length - 1,
    }))
  }, [filteredRows, hasMore])

  const handleFile = async (source: BillSource, file: File) => {
    if (busy) return
    setError('')
    setPhase('parsing')
    setPercent(null)
    setMessage(`正在解析 ${file.name}…`)
    let savedSoFar = 0

    try {
      const sheet = await readBillSheet(file, source)
      const headerIndex = findRawHeaderRow(sheet)
      const parsedRows = buildOdsRows(sheet, headerIndex, source)
      if (parsedRows.length === 0) throw new Error('表头之后没有数据行，请确认文件是否完整')

      const batchId = newBatchId()
      setPhase('saving')
      setPercent(0)
      setMessage(`已解析 ${parsedRows.length} 条记录，正在保存…`)

      setMessage(`已解析 ${parsedRows.length} 条记录，正在写入原始层…`)

      await insertOdsBills({
        source,
        batchId,
        fileName: file.name,
        rows: parsedRows,
        onProgress: (saved, total) => {
          savedSoFar = saved
          const ratio = Math.round((saved / total) * 100)
          setPercent(ratio)
          setMessage(`已解析 ${total} 条，已保存 ${saved} 条（${ratio}%）…`)
        },
      })

      // 写入原始层后，触发后台清洗（ODS → DWD）
      setMessage('正在后台清洗数据…')
      let cleanFailed = false
      try {
        await processBillBatch(batchId)
      } catch (err) {
        cleanFailed = true
        console.error('[Bills] 清洗任务触发失败:', describeBillError(err), err)
      }

      await Promise.all([loadMeta(), loadRows()])
      alert(
        cleanFailed
          ? '账单已保存，但触发清洗失败。请确认数据库存在 process_bill_batch 函数后重试。'
          : '账单已导入并完成清洗。',
      )
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 导入失败:', detail, err)
      if (isMissingBillTable(err)) {
        setError('账单表还没创建：请在 Supabase 执行 scripts/create-bill-ods.sql，然后重试')
      } else {
        setError(`${savedSoFar > 0 ? `已保存 ${savedSoFar} 条，之后` : ''}导入失败：${detail}`)
      }
    } finally {
      setPhase('idle')
      setMessage('')
      setPercent(null)
    }
  }

  /** 手动补分类：直接更新 bill_dwd，先乐观更新，失败回滚 */
  const assignCategory = async (id: string, categoryId: string) => {
    if (!categoryId) return
    const previous = rows.find((row) => row.id === id)
    const category = categories.find((item) => item.id === categoryId)
    const parentId = category?.parent_id ?? null
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              category_id: parentId ?? categoryId,
              subcategory_id: parentId ? categoryId : null,
            }
          : row,
      ),
    )
    try {
      await updateDwdBillCategory(id, categoryId)
    } catch (err) {
      setRows((prev) =>
        prev.map((row) =>
          row.id === id
            ? {
                ...row,
                category_id: previous?.category_id ?? null,
                subcategory_id: previous?.subcategory_id ?? null,
              }
            : row,
        ),
      )
      setError(`设置分类失败：${describeBillError(err)}`)
    }
  }

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden pb-24">
      <PageHeader
        title="家庭账单"
        subtitle="导入微信 / 支付宝账单，一键套用规则"
        action={
          <Link
            href="/bills/rules"
            className="shrink-0 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 active:bg-slate-200"
          >
            规则定义
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-full overflow-x-hidden px-4">
        {loadError && (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
            <span className="flex-1">{loadError}</span>
            <button
              type="button"
              onClick={() => {
                void loadMeta()
                void loadRows()
              }}
              className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900"
            >
              重试
            </button>
          </div>
        )}

        {/* 极简工具栏：左侧导入，右侧一键应用规则 */}
        <div className="flex w-full min-w-0 items-center gap-1.5 pb-2 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {(Object.keys(SOURCE_META) as BillSource[]).map((source) => {
              const meta = SOURCE_META[source]
              const Icon = meta.icon
              return (
                <button
                  key={source}
                  type="button"
                  disabled={busy}
                  title={meta.hint}
                  onClick={() => {
                    pendingSource.current = source
                    inputRef.current?.click()
                  }}
                  className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 transition-colors active:bg-gray-50 disabled:opacity-60"
                >
                  <Icon className={`size-3.5 shrink-0 ${meta.iconClass}`} aria-hidden="true" />
                  <span className="truncate">{meta.short}账单</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            disabled={busy || cleaning}
            onClick={() => void runRules()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-orange-200 bg-white px-2.5 text-xs font-semibold text-orange-600 transition-colors active:bg-orange-50 disabled:opacity-60"
          >
            <Wand2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">
              {cleaning ? '重新分类中…' : '一键应用规则'}
            </span>
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label="导入历史"
            title="导入历史"
            onClick={() => setHistoryOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm transition-colors active:bg-gray-50 disabled:opacity-60"
          >
            🗂️
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleFile(pendingSource.current, file)
          }}
        />

        {(busy || cleaning) && (
          <div className="mb-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
            <p className="text-xs font-medium">{message || '正在处理…'}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
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

        {error && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* 明细：微信账单式极简列表（按月份分组，每组自带小计） */}
        <section className="mt-1">
          <header className="flex flex-wrap items-center gap-2 pb-2">
            <h2 className="text-base font-bold">账单明细</h2>
            <span className="text-xs text-muted-foreground">
              已加载 {filteredRows.length} 条
            </span>
            <Link href="/bills/stats" className="ml-auto text-xs font-semibold text-primary">
              看统计
            </Link>
          </header>

          {/* 万能搜索：商品 / 交易对方 / 备注 / 整行原始 JSON */}
          <div className="relative mb-2 w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索商品、对方或原始备注..."
              aria-label="搜索账单"
              className="h-10 w-full rounded-full border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none focus:border-orange-300"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="清空搜索"
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* 顶部只保留年月与筛选入口，条件全部收进底部抽屉 */}
          <div className="mb-2 flex w-full max-w-full items-center gap-2">
            <button
              type="button"
              onClick={openDatePicker}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border bg-white px-3 py-2 text-sm font-semibold text-slate-700 active:bg-muted/60"
            >
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{timeLabel(filterYear, filterMonth)}</span>
              <ChevronDown
                className="ml-auto size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={openFilters}
              className={[
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors',
                activeFilterCount > 0
                  ? 'border-orange-300 bg-orange-50 text-orange-600'
                  : 'border-slate-200 bg-white text-slate-600',
              ].join(' ')}
            >
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
              <span>{activeFilterCount > 0 ? `筛选 (${activeFilterCount})` : '筛选'}</span>
              {activeFilterCount > 0 && (
                <span className="size-1.5 rounded-full bg-orange-500" aria-hidden="true" />
              )}
            </button>
          </div>

          {listLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">正在读取账单…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {batches.length === 0
                ? '还没有导入记录，点上面的按钮选择账单文件吧'
                : '这个批次里没有数据'}
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="whitespace-normal break-words py-10 text-center text-sm text-muted-foreground">
              {timeLabel(filterYear, filterMonth)}
              {hasFilters ? '没有符合筛选条件的账单' : '没有账单'}
            </p>
          ) : filterMonth !== 'all' ? (
            /* 已筛选具体月份：不再重复月份头，直接平铺 */
            <ul className="w-full max-w-full bg-white">
              {filteredRows.map((row) => (
                <BillRow
                  key={row.id}
                  row={row}
                  categories={categories}
                  onAssign={(id, categoryId) => void assignCategory(id, categoryId)}
                />
              ))}
            </ul>
          ) : (
            <div className="w-full max-w-full">
              {groupedMonths.map((group) => (
                <section key={group.key} className="w-full max-w-full">
                  {/* 月份头部：浅灰吸顶条 + 该月收支小计 */}
                  <div className="sticky top-16 z-10 flex w-full max-w-full items-center justify-between gap-2 bg-gray-50 px-3 py-2">
                    <span className="shrink-0 text-sm font-bold text-gray-900">
                      {group.key === '未知时间'
                        ? '未知时间'
                        : `${group.key.slice(0, 4)}年${Number(group.key.slice(5, 7))}月`}
                    </span>
                    <span className="min-w-0 truncate text-[11px] tabular-nums text-gray-400">
                      支出 <span className="font-medium text-gray-600">¥{group.expense.toFixed(2)}</span>
                      <span className="mx-1 text-gray-300">·</span>
                      收入 <span className="font-medium text-gray-600">¥{group.income.toFixed(2)}</span>
                      {group.partial && <span className="ml-1 text-gray-300">（本月未加载完）</span>}
                    </span>
                  </div>

                  <ul className="w-full max-w-full bg-white">
                    {group.bills.map((row) => (
                      <BillRow
                        key={row.id}
                        row={row}
                        categories={categories}
                        onAssign={(id, categoryId) => void assignCategory(id, categoryId)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {hasMore && !listLoading && (
            <div className="py-3 text-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="h-10 w-full max-w-xs rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-600 active:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore ? '正在加载…' : `加载更多（每次 ${PAGE_SIZE} 条）`}
              </button>
            </div>
          )}

          {!hasMore && filteredRows.length > 0 && (
            <p className="py-2 text-xs text-muted-foreground">
              已全部加载。列表来自清洗后的数据，按交易时间倒序、按月分组；「待分类」可手动指定分类。
            </p>
          )}
        </section>

        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          导入时只写入原始层 bill_ods（整行原始数据存 raw_data）；随后调用 process_bill_batch
          清洗进 bill_dwd，本页展示的是清洗后的结果，手工记账则直接写入 bill_dwd。
        </p>
      </div>

      {/* 手机端悬浮「记一笔」 */}
      <button
        type="button"
        onClick={() => setManualOpen(true)}
        aria-label="手工记账"
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white text-2xl font-light text-gray-700 shadow-md active:bg-gray-50 md:bottom-8 md:right-8"
      >
        <span aria-hidden="true">＋</span>
      </button>

      {historyOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-history-title"
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:rounded-2xl sm:pb-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
              <h3 id="import-history-title" className="truncate text-base font-bold">
                导入历史
              </h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="shrink-0 rounded-full px-2 py-1 text-sm text-muted-foreground active:bg-muted"
              >
                关闭
              </button>
            </div>

            {importBatches.length === 0 ? (
              <p className="whitespace-normal break-words py-8 text-center text-sm text-muted-foreground">
                还没有导入记录
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {importBatches.map((batch) => (
                  <li key={batch.batchId} className="flex min-w-0 items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => void copyFileName(batch.batchId, batchFileName(batch))}
                        className="block w-full select-text truncate text-left text-sm font-semibold text-gray-900 active:opacity-60"
                        title="点击复制文件名"
                      >
                        {batchFileName(batch)}
                      </button>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {copiedFileBatch === batch.batchId
                          ? '已复制文件名'
                          : `${SOURCE_LABELS[batch.source] ?? batch.source} · ${bjDateTime(batch.createdAt)} · ${batch.count} 条`}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={undoingBatch === batch.batchId}
                      onClick={() => void undoBatch(batch)}
                      className="shrink-0 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 active:bg-red-100 disabled:opacity-60"
                    >
                      {undoingBatch === batch.batchId ? '撤销中…' : '撤销导入'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              仅展示最近 10 次导入；撤销会删除该批次全部记录，且不可恢复。
            </p>
          </div>
        </div>
      )}

      {dateOpen && (
        <Sheet title="选择年月" onClose={() => setDateOpen(false)}>
          <div className="space-y-4">
            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">年份</p>
              <div className="flex flex-wrap gap-2">
                {yearOptions.map((item) => (
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
                    {item}月
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
            {batches.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">导入批次</p>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={!draft.batchId}
                    onClick={() => setDraft((prev) => ({ ...prev, batchId: '' }))}
                  >
                    全部批次
                  </Chip>
                  {batches.map((batch) => {
                    const stamp = bjDateTime(batch.createdAt).slice(5, 10).replace('-', '/')
                    return (
                      <Chip
                        key={batch.batchId}
                        active={draft.batchId === batch.batchId}
                        onClick={() => setDraft((prev) => ({ ...prev, batchId: batch.batchId }))}
                      >
                        {SOURCE_LABELS[batch.source] ?? batch.source} {stamp} · {batch.count}
                      </Chip>
                    )
                  })}
                </div>
              </section>
            )}

            <section>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">一级分类</p>
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={!draft.categoryId}
                  onClick={() => setDraft((prev) => ({ ...prev, categoryId: '' }))}
                >
                  全部分类
                </Chip>
                {parentCategories.map((parent) => (
                  <Chip
                    key={parent.id}
                    active={draftParentId === parent.id}
                    onClick={() => setDraft((prev) => ({ ...prev, categoryId: parent.id }))}
                  >
                    {categoryIcon(parent)} {parent.name}
                  </Chip>
                ))}
              </div>
              {parentCategories.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">还没建分类</p>
              )}
            </section>

            {draftParentId && draftChildren.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">二级分类</p>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    active={draft.categoryId === draftParentId}
                    onClick={() => setDraft((prev) => ({ ...prev, categoryId: draftParentId }))}
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
                {creatorOptions.map((name) => (
                  <Chip
                    key={name}
                    active={draft.creator === name}
                    onClick={() => setDraft((prev) => ({ ...prev, creator: name }))}
                  >
                    {name}
                  </Chip>
                ))}
              </div>
              {creatorOptions.length === 0 && (
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

      {manualOpen && (
        <ManualBillSheet
          categories={categories}
          onClose={() => setManualOpen(false)}
          onSaved={async () => {
            // 手动记账没有批次号，清掉批次筛选让新记录出现在最上方
            setSelectedBatch('')
            await Promise.all([loadMeta(), loadRows()])
          }}
        />
      )}
    </div>
  )
}
