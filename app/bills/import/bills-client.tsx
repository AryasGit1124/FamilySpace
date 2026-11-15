'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, CreditCard, Wallet, Wand2, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { ManualBillSheet } from '@/app/bills/manual-bill-sheet'
import {
  billFallbackKey,
  bjDateTime,
  buildOdsRows,
  creatorTagClass,
  describeBillError,
  findRawHeaderRow,
  isMissingBillTable,
  newBatchId,
  pickBillCategory,
  readBillSheet,
  sourceTag,
  type BillSource,
} from '@/lib/bills'
import {
  deleteOdsBatch,
  fetchBillCategories,
  fetchBillRules,
  fetchBillsForRecategorize,
  fetchExistingBillKeys,
  fetchOdsBatches,
  fetchOdsBillsAll,
  insertOdsBills,
  updateBillsCategory,
  updateOdsBillCategory,
  type BillCategory,
  type OdsBatch,
  type OdsBillRow,
} from '@/lib/supabase-queries'

type Phase = 'idle' | 'parsing' | 'saving'

/** 单次渲染上限，超出时提示用筛选缩小范围 */
const RENDER_LIMIT = 300

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
type AmountFilterType = 'all' | 'nonzero' | 'gte100' | 'gte500' | 'custom'

const AMOUNT_OPTIONS: { value: AmountFilterType; label: string; hint?: string }[] = [
  { value: 'all', label: '全部金额' },
  { value: 'nonzero', label: '金额 ≠ 0', hint: '排除 0 元记录' },
  { value: 'gte100', label: '金额 ≥ 100', hint: '大额消费' },
  { value: 'gte500', label: '金额 ≥ 500', hint: '超大额消费' },
  { value: 'custom', label: '自定义范围', hint: '填写最小 / 最大金额' },
]

/** 金额胶囊文案 */
const amountLabel = (type: AmountFilterType, min: string, max: string) => {
  if (type === 'nonzero') return '金额 ≠ 0'
  if (type === 'gte100') return '金额 ≥ 100'
  if (type === 'gte500') return '金额 ≥ 500'
  if (type === 'custom') {
    const low = min.trim() === '' ? '0' : min.trim()
    const high = max.trim() === '' ? '不限' : max.trim()
    return `金额 ${low}-${high}`
  }
  return '金额'
}

/** 筛选胶囊：未选中灰边白底，选中浅橙底 */
function FilterPill({
  value,
  onChange,
  active,
  children,
}: {
  value: string
  onChange: (value: string) => void
  /** 是否高亮；默认按是否有值判断 */
  active?: boolean
  children: ReactNode
}) {
  const highlighted = active ?? Boolean(value)
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={[
        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors',
        highlighted
          ? 'border-orange-300 bg-orange-50 text-orange-600'
          : 'border-slate-200 bg-white text-slate-600',
      ].join(' ')}
    >
      {children}
    </select>
  )
}

/** 账单行：微信账单式极简列表项 —— 左 Emoji / 中信息 / 右金额，无卡片背景与阴影 */
function BillRow({
  row,
  categories,
  onAssign,
}: {
  row: OdsBillRow
  categories: BillCategory[]
  onAssign: (id: string, categoryId: string) => void
}) {
  const direction = row.direction ?? ''
  const isIncome = direction.includes('收')
  const isExpense = direction.includes('支')
  const category = row.category_id ? categories.find((item) => item.id === row.category_id) : undefined
  const emoji =
    category?.emoji ??
    (row.source === 'wechat' ? '💬' : row.source === 'alipay' ? '💙' : '✏️')
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

        {/* 第三行：分类或极小的待分类下拉 */}
        {(category || categories.length > 0) && (
          <div className="mt-1">
            {category ? (
              <span className="text-[11px] text-gray-400">
                {category.emoji} {category.name}
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
                    {item.emoji} {item.name}
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
        {row.amount === null
          ? '—'
          : `${isIncome ? '+' : isExpense ? '-' : ''}${Number(row.amount).toFixed(2)}`}
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
  const [rows, setRows] = useState<OdsBillRow[]>([])
  const [categories, setCategories] = useState<BillCategory[]>([])
  const [selectedBatch, setSelectedBatch] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cleaning, setCleaning] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 正在撤销的批次 id，撤销中禁用该行按钮 */
  const [undoingBatch, setUndoingBatch] = useState('')
  /** 明细组合筛选（全部在前端完成，不触发请求） */
  const [filters, setFilters] = useState<BillFilters>(EMPTY_FILTERS)
  /** 顶部时间筛选：年份默认今年，月份默认全年 */
  const [filterYear, setFilterYear] = useState<string>(currentYear)
  const [filterMonth, setFilterMonth] = useState<string>('all')
  /** 金额筛选：类型 + 自定义上下限（字符串便于输入） */
  const [amountType, setAmountType] = useState<AmountFilterType>('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [amountOpen, setAmountOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingSource = useRef<BillSource>('wechat')

  const loadInitial = useCallback(async () => {
    setListLoading(true)
    setLoadError('')
    try {
      const [batchList, categoryList, billRows] = await Promise.all([
        fetchOdsBatches(),
        fetchBillCategories(),
        fetchOdsBillsAll(),
      ])
      setBatches(batchList)
      setCategories(categoryList)
      setRows(billRows)
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
  }, [])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  /** 切换批次筛选，只重新拉明细 */
  const changeBatch = async (batchId: string) => {
    setSelectedBatch(batchId)
    setListLoading(true)
    try {
      setRows(await fetchOdsBillsAll({ batchId: batchId || undefined }))
    } catch (err) {
      setLoadError(`读取账单失败：${describeBillError(err)}`)
    } finally {
      setListLoading(false)
    }
  }

  /** 一级 / 二级分类层级：同优先级时让二级分类先命中 */
  const buildDepthOf = (list: BillCategory[]) => {
    const byId = new Map(list.map((item) => [item.id, item]))
    return (categoryId: string) => {
      let depth = 0
      let current = byId.get(categoryId)
      while (current?.parent_id && depth < 5) {
        depth += 1
        current = byId.get(current.parent_id)
      }
      return depth
    }
  }

  /** 一键应用规则：按最新规则全量重新分类（会覆盖手动分类） */
  const runRules = async () => {
    if (
      !confirm(
        '此操作将根据最新规则，重新分类所有账单（包括您手动修改过的分类）。确定要继续吗？',
      )
    ) {
      return
    }
    setCleaning(true)
    setError('')
    try {
      const [ruleList, allBills, categoryList] = await Promise.all([
        fetchBillRules(),
        fetchBillsForRecategorize(),
        fetchBillCategories(),
      ])
      if (ruleList.length === 0) {
        alert('还没有任何归类规则，先去「规则定义」里给分类添加关键词吧')
        return
      }
      if (allBills.length === 0) {
        alert('账单里还没有数据')
        return
      }

      const depthOf = buildDepthOf(categoryList)
      // key 为分类 id；空字符串代表「未分类（null）」
      const groups = new Map<string, string[]>()
      let changed = 0
      let unmatched = 0
      for (const bill of allBills) {
        const next = pickBillCategory(bill, ruleList, depthOf)
        if (!next) unmatched += 1
        if ((bill.category_id ?? null) === (next ?? null)) continue
        changed += 1
        const key = next ?? ''
        const ids = groups.get(key) ?? []
        ids.push(bill.id)
        groups.set(key, ids)
      }

      setPhase('saving')
      setPercent(null)
      setMessage(`正在重新分类…（共 ${allBills.length} 条）`)

      let updated = 0
      for (const [key, ids] of groups) {
        for (let start = 0; start < ids.length; start += 50) {
          updated += await updateBillsCategory(ids.slice(start, start + 50), key || null)
          setMessage(`正在重新分类…（已更新 ${updated}/${changed} 条）`)
        }
      }

      const [batchList, billRows] = await Promise.all([
        fetchOdsBatches(),
        fetchOdsBillsAll({ batchId: selectedBatch || undefined }),
      ])
      setBatches(batchList)
      setRows(billRows)
      setCategories(categoryList)
      alert(
        `已重新分类全部数据！共更新 ${updated} 条；规则命中 ${allBills.length - unmatched} 条，未分类 ${unmatched} 条。`,
      )
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 规则分类失败:', detail, err)
      setError(
        isMissingBillTable(err)
          ? '账单表还缺 category_id 列：请重新执行 scripts/create-bill-ods.sql'
          : `规则分类失败：${detail}`,
      )
    } finally {
      setPhase('idle')
      setMessage('')
      setPercent(null)
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
      const [batchList, billRows] = await Promise.all([
        fetchOdsBatches(),
        fetchOdsBillsAll({ batchId: nextSelected || undefined }),
      ])
      setBatches(batchList)
      setRows(billRows)
      setHistoryOpen(false)
      alert(`已撤销该批次 ${deleted} 条记录`)
    } catch (err) {
      setError(`撤销失败：${describeBillError(err)}`)
    } finally {
      setUndoingBatch('')
    }
  }

  const busy = phase !== 'idle'
  /** 最近 10 次导入（手工记账没有批次号，不参与撤销） */
  const importBatches = batches.filter((batch) => batch.batchId !== '(无批次号)').slice(0, 10)

  /** 一级分类选项（parent_id 为空） */
  const parentCategories = useMemo(
    () => categories.filter((category) => !category.parent_id),
    [categories],
  )

  /** 二级分类选项：选了一级就只列它的子分类，否则列出所有子分类 */
  const childCategories = useMemo(() => {
    const children = categories.filter((category) => category.parent_id)
    return filters.parentId
      ? children.filter((category) => category.parent_id === filters.parentId)
      : children
  }, [categories, filters.parentId])

  const hasFilters = Boolean(
    filters.parentId || filters.childId || amountType !== 'all' || filterMonth !== 'all',
  )

  /** 年份选项：数据中出现的年份 + 今年，倒序 */
  const yearOptions = useMemo(() => {
    const years = new Set<string>([currentYear()])
    for (const row of rows) {
      if (row.trade_time) years.add(bjDateTime(row.trade_time).slice(0, 4))
    }
    return [...years].sort((a, b) => b.localeCompare(a))
  }, [rows])

  /** 第一层：按年份过滤（默认全年） */
  const yearRows = useMemo(
    () =>
      rows.filter((row) =>
        row.trade_time ? bjDateTime(row.trade_time).slice(0, 4) === filterYear : false,
      ),
    [rows, filterYear],
  )

  /** 第二层：月份过滤（all = 全年） */
  const monthRows = useMemo(() => {
    if (filterMonth === 'all') return yearRows
    return yearRows.filter((row) =>
      row.trade_time ? bjDateTime(row.trade_time).slice(5, 7) === filterMonth.padStart(2, '0') : false,
    )
  }, [yearRows, filterMonth])

  /** 第二层：分类过滤（一级含其全部二级）+ 金额过滤 */
  const filteredRows = useMemo(() => {
    let allowedCategoryIds: Set<string> | null = null
    if (filters.childId) {
      allowedCategoryIds = new Set([filters.childId])
    } else if (filters.parentId) {
      allowedCategoryIds = new Set([filters.parentId])
      for (const category of categories) {
        if (category.parent_id === filters.parentId) allowedCategoryIds.add(category.id)
      }
    }

    const min = minAmount.trim() === '' ? null : Number(minAmount)
    const max = maxAmount.trim() === '' ? null : Number(maxAmount)

    return monthRows.filter((row) => {
      if (allowedCategoryIds && (!row.category_id || !allowedCategoryIds.has(row.category_id))) {
        return false
      }
      const value = Number(row.amount ?? 0)
      if (amountType === 'nonzero' && value === 0) return false
      if (amountType === 'gte100' && value < 100) return false
      if (amountType === 'gte500' && value < 500) return false
      if (amountType === 'custom') {
        if (min !== null && !Number.isNaN(min) && value < min) return false
        if (max !== null && !Number.isNaN(max) && value > max) return false
      }
      return true
    })
  }, [monthRows, categories, filters, amountType, minAmount, maxAmount])

  /** 按交易月份分组（YYYY-MM 倒序），每组带收支小计 */
  const groupedMonths = useMemo(() => {
    const map = new Map<string, { expense: number; income: number; bills: OdsBillRow[] }>()
    for (const row of filteredRows) {
      const stamp = row.trade_time ? bjDateTime(row.trade_time) : ''
      const key = stamp ? stamp.slice(0, 7) : '未知时间'
      let group = map.get(key)
      if (!group) {
        group = { expense: 0, income: 0, bills: [] }
        map.set(key, group)
      }
      group.bills.push(row)
      const direction = row.direction ?? ''
      if (direction.includes('收')) group.income += Number(row.amount ?? 0)
      else if (direction.includes('支')) group.expense += Number(row.amount ?? 0)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, group]) => ({ key, ...group }))
  }, [filteredRows])

  /** 渲染上限：按分组顺序取前 RENDER_LIMIT 条 */
  const visibleGroups = useMemo(() => {
    let remaining = RENDER_LIMIT
    const result: typeof groupedMonths = []
    for (const group of groupedMonths) {
      if (remaining <= 0) break
      const bills = group.bills.slice(0, remaining)
      result.push({ ...group, bills })
      remaining -= bills.length
    }
    return result
  }, [groupedMonths])

  const handleFile = async (source: BillSource, file: File) => {
    if (busy) return
    setError('')
    setPhase('parsing')
    setPercent(null)
    setMessage(`正在解析 ${file.name}…`)
    let savedSoFar = 0

    try {
      // 解析前先取最新规则与分类层级，导入时直接完成自动分类
      let ruleList: Awaited<ReturnType<typeof fetchBillRules>> = []
      let categoryList = categories
      try {
        ;[ruleList, categoryList] = await Promise.all([fetchBillRules(), fetchBillCategories()])
        setCategories(categoryList)
      } catch (ruleErr) {
        console.warn('[Bills] 读取自动分类规则失败，本次导入不做自动分类:', ruleErr)
      }

      const sheet = await readBillSheet(file, source)
      const headerIndex = findRawHeaderRow(sheet)
      const parsedRows = buildOdsRows(sheet, headerIndex, source)
      if (parsedRows.length === 0) throw new Error('表头之后没有数据行，请确认文件是否完整')

      // 去重：交易单号优先；没有单号的用「分钟级时间_金额_商品说明」兜底键
      const tradeNoOf = (row: (typeof parsedRows)[number]) => (row.tradeNo ?? '').trim()
      const tradeNos = [...new Set(parsedRows.map(tradeNoOf).filter((value) => value.length > 0))]
      const fallbackKeys = [
        ...new Set(
          parsedRows
            .filter((row) => !tradeNoOf(row))
            .map((row) => billFallbackKey(row.tradeTime, row.amount, row.commodity)),
        ),
      ]
      const existingKeys = await fetchExistingBillKeys({ tradeNos, fallbackKeys })
      const seenKeys = new Set<string>()
      let duplicateCount = 0
      const freshRows = parsedRows.filter((row) => {
        const key = tradeNoOf(row) || billFallbackKey(row.tradeTime, row.amount, row.commodity)
        if (seenKeys.has(key) || existingKeys.has(key)) {
          duplicateCount += 1
          return false
        }
        seenKeys.add(key)
        return true
      })
      if (freshRows.length === 0) {
        alert(`本次文件中的 ${parsedRows.length} 条记录全部是重复账单，未导入。`)
        return
      }

      const depthOf = buildDepthOf(categoryList)
      let autoClassified = 0
      const rowsToSave = freshRows.map((row) => {
        const categoryId = ruleList.length
          ? pickBillCategory(
              {
                counterparty: row.counterparty,
                commodity: row.commodity,
                trade_type: row.tradeType,
              },
              ruleList,
              depthOf,
            )
          : null
        if (!categoryId) return row
        autoClassified += 1
        return { ...row, categoryId }
      })

      const batchId = newBatchId()
      setPhase('saving')
      setPercent(0)
      setMessage(`已解析 ${rowsToSave.length} 条记录，正在保存…`)

      await insertOdsBills({
        source,
        batchId,
        rows: rowsToSave,
        onProgress: (saved, total) => {
          savedSoFar = saved
          const ratio = Math.round((saved / total) * 100)
          setPercent(ratio)
          setMessage(`已解析 ${total} 条，已保存 ${saved} 条（${ratio}%）…`)
        },
      })

      setSelectedBatch(batchId)
      const [batchList, billRows] = await Promise.all([
        fetchOdsBatches(),
        fetchOdsBillsAll({ batchId }),
      ])
      setBatches(batchList)
      setRows(billRows)
      alert(
        `成功导入 ${rowsToSave.length} 条记录（已自动过滤 ${duplicateCount} 条重复账单${
          autoClassified > 0 ? `，自动分类 ${autoClassified} 条` : ''
        }）。\n批次号：${batchId}`,
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

  /** 手动补分类：先乐观更新，失败回滚 */
  const assignCategory = async (id: string, categoryId: string) => {
    if (!categoryId) return
    const previous = rows.find((row) => row.id === id)?.category_id ?? null
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, category_id: categoryId } : row)))
    try {
      await updateOdsBillCategory(id, categoryId)
    } catch (err) {
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, category_id: previous } : row)),
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
              onClick={() => void loadInitial()}
              className="shrink-0 rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900"
            >
              重试
            </button>
          </div>
        )}

        {/* 工具栏：两个导入按钮并排，规则按钮通栏 */}
        <div className="w-full pb-2 pt-1">
          <div className="grid w-full grid-cols-2 gap-3">
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
                  className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 transition-colors active:bg-gray-50 disabled:opacity-60"
                >
                  <Icon className={`size-4 shrink-0 ${meta.iconClass}`} aria-hidden="true" />
                  <span className="truncate">{meta.label}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex w-full items-center gap-2">
            <button
              type="button"
              disabled={busy || cleaning}
              onClick={() => void runRules()}
              className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 text-xs font-semibold text-orange-600 transition-colors active:bg-orange-50 disabled:opacity-60"
            >
              <Wand2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{cleaning ? '正在重新分类…' : '一键应用规则'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setHistoryOpen(true)}
              className="flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors active:bg-gray-50 disabled:opacity-60"
            >
              <span aria-hidden="true">🗂️</span>
              导入历史
            </button>
          </div>
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
            <span className="text-xs text-muted-foreground">{filteredRows.length} 条</span>
            <Link href="/bills/stats" className="ml-auto text-xs font-semibold text-primary">
              看统计
            </Link>
          </header>

          {/* 分类筛选：横向滑动，避免手机端撑破页面 */}
          <div className="mb-1 flex w-full max-w-full items-center gap-2 overflow-x-auto whitespace-nowrap px-1 pb-2">
            <FilterPill
              value={filters.parentId}
              onChange={(value) =>
                setFilters((prev) => ({ ...prev, parentId: value, childId: '' }))
              }
            >
              <option value="">一级分类</option>
              {parentCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji} {category.name}
                </option>
              ))}
            </FilterPill>

            <FilterPill
              value={filters.childId}
              onChange={(value) => setFilters((prev) => ({ ...prev, childId: value }))}
            >
              <option value="">二级分类</option>
              {childCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji} {category.name}
                </option>
              ))}
            </FilterPill>

            <FilterPill
              value={filterYear}
              onChange={setFilterYear}
              active={filterYear !== currentYear()}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </FilterPill>

            <FilterPill
              value={filterMonth}
              onChange={setFilterMonth}
              active={filterMonth !== 'all'}
            >
              <option value="all">全年</option>
              {MONTH_OPTIONS.map((month) => (
                <option key={month} value={month}>
                  {month}月
                </option>
              ))}
            </FilterPill>

            <button
              type="button"
              onClick={() => setAmountOpen(true)}
              className={[
                'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                amountType !== 'all'
                  ? 'border-orange-300 bg-orange-50 text-orange-600'
                  : 'border-slate-200 bg-white text-slate-600',
              ].join(' ')}
            >
              <span>{amountLabel(amountType, minAmount, maxAmount)}</span>
              <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
            </button>

            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS)
                  setAmountType('all')
                  setMinAmount('')
                  setMaxAmount('')
                  setFilterMonth('all')
                }}
                className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors active:bg-gray-50"
              >
                重置筛选
              </button>
            )}
          </div>

          {batches.length > 0 && (
            <div className="flex w-full max-w-full gap-1.5 overflow-x-auto pb-2">
              <button
                type="button"
                onClick={() => void changeBatch('')}
                className={[
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  !selectedBatch
                    ? 'border-primary bg-orange-50 text-primary'
                    : 'border-slate-200 bg-white text-slate-600',
                ].join(' ')}
              >
                全部批次
              </button>
              {batches.map((batch) => (
                <button
                  key={batch.batchId}
                  type="button"
                  onClick={() => void changeBatch(batch.batchId)}
                  className={[
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    selectedBatch === batch.batchId
                      ? 'border-primary bg-orange-50 text-primary'
                      : 'border-slate-200 bg-white text-slate-600',
                  ].join(' ')}
                >
                  <span>{SOURCE_LABELS[batch.source] ?? batch.source}</span>
                  <span className="tabular-nums">{batch.count}</span>
                </button>
              ))}
            </div>
          )}

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
          ) : (
            <div className="w-full max-w-full">
              {visibleGroups.map((group) => (
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

          {filteredRows.length > RENDER_LIMIT && (
            <p className="whitespace-normal break-words py-2 text-center text-xs text-muted-foreground">
              仅显示最近 {RENDER_LIMIT} 条，请用上方筛选缩小范围（共 {filteredRows.length} 条）
            </p>
          )}

          {filteredRows.length > 0 && filteredRows.length <= RENDER_LIMIT && (
            <p className="py-2 text-xs text-muted-foreground">
              按交易时间倒序、按月分组；筛选基于已加载的全部账单。「待分类」可手动指定分类。
            </p>
          )}
        </section>

        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          导入按物理列映射：交易时间、交易类型、对方、商品、收/支、金额、支付方式、状态、单号、备注，
          整行原始数据同时存入 raw_data；每 100 条一批写入 bill_ods。
        </p>
      </div>

      {/* 手机端悬浮「记一笔」 */}
      <button
        type="button"
        onClick={() => setManualOpen(true)}
        aria-label="记一笔"
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-2xl font-light text-white shadow-lg active:bg-blue-700 md:bottom-8 md:right-8"
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
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {SOURCE_LABELS[batch.source] ?? batch.source} · 共 {batch.count} 条
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {bjDateTime(batch.createdAt)}
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

      {amountOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setAmountOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="amount-filter-title"
            className="w-full max-w-md rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:rounded-2xl sm:pb-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <h3 id="amount-filter-title" className="truncate text-base font-bold">
                金额筛选
              </h3>
              <button
                type="button"
                onClick={() => setAmountOpen(false)}
                className="shrink-0 rounded-full px-2 py-1 text-sm text-muted-foreground active:bg-muted"
              >
                关闭
              </button>
            </div>

            <ul className="divide-y divide-gray-100">
              {AMOUNT_OPTIONS.map((option) => {
                const active = amountType === option.value
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      onClick={() => {
                        setAmountType(option.value)
                        if (option.value !== 'custom') setAmountOpen(false)
                      }}
                      className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
                    >
                      <span className="min-w-0">
                        <span
                          className={[
                            'block text-sm',
                            active ? 'font-semibold text-orange-600' : 'text-gray-800',
                          ].join(' ')}
                        >
                          {option.label}
                        </span>
                        {option.hint && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {option.hint}
                          </span>
                        )}
                      </span>
                      {active && <span className="shrink-0 text-orange-600">✓</span>}
                    </button>
                  </li>
                )
              })}
            </ul>

            {amountType === 'custom' && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={minAmount}
                  onChange={(event) => setMinAmount(event.target.value)}
                  placeholder="最小金额"
                  aria-label="最小金额"
                  className="h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-orange-300"
                />
                <span className="shrink-0 text-sm text-gray-400">—</span>
                <input
                  inputMode="decimal"
                  value={maxAmount}
                  onChange={(event) => setMaxAmount(event.target.value)}
                  placeholder="最大金额"
                  aria-label="最大金额"
                  className="h-11 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-orange-300"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => setAmountOpen(false)}
              className="mt-3 h-11 w-full rounded-xl bg-orange-50 text-sm font-semibold text-orange-600 active:bg-orange-100"
            >
              完成
            </button>
          </div>
        </div>
      )}

      {manualOpen && (
        <ManualBillSheet
          categories={categories}
          onClose={() => setManualOpen(false)}
          onSaved={async () => {
            // 手动记账没有批次号，清掉批次筛选让新记录出现在最上方
            setSelectedBatch('')
            await loadInitial()
          }}
        />
      )}
    </div>
  )
}
