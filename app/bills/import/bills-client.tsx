'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CreditCard, Wallet, Wand2, type LucideIcon } from 'lucide-react'
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
  pickBillCategory,
  readBillSheet,
  sourceTag,
  type BillSource,
} from '@/lib/bills'
import {
  fetchBillCategories,
  fetchBillRules,
  fetchOdsBatches,
  fetchOdsBills,
  fetchUnclassifiedBills,
  insertOdsBills,
  updateBillsCategory,
  updateOdsBillCategory,
  type BillCategory,
  type OdsBatch,
  type OdsBillRow,
} from '@/lib/supabase-queries'

type Phase = 'idle' | 'parsing' | 'saving'

/** 明细一次展示条数 */
const PAGE_LIMIT = 200

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

const money = (value: number | null) =>
  value === null ? '—' : `¥${Number(value).toFixed(2)}`

/** 批次 chips 里的来源简称，兼容手动记账（source=manual） */
const SOURCE_LABELS: Record<string, string> = {
  wechat: '微信',
  alipay: '支付宝',
  manual: '手动',
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
    <li className="flex items-center gap-3 bg-white px-4 py-3">
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
                className="appearance-none rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 outline-none"
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
            ? 'shrink-0 text-lg font-medium tabular-nums text-amber-600'
            : isExpense
              ? 'shrink-0 text-lg font-medium tabular-nums text-gray-900'
              : 'shrink-0 text-lg font-medium tabular-nums text-gray-400'
        }
      >
        {isIncome ? '+' : isExpense ? '-' : ''}
        {money(row.amount)}
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

  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingSource = useRef<BillSource>('wechat')

  const loadInitial = useCallback(async () => {
    setListLoading(true)
    setLoadError('')
    try {
      const [batchList, categoryList, billRows] = await Promise.all([
        fetchOdsBatches(),
        fetchBillCategories(),
        fetchOdsBills({ limit: PAGE_LIMIT }),
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
      setRows(await fetchOdsBills({ batchId: batchId || undefined, limit: PAGE_LIMIT }))
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

  /** 一键应用规则：只处理 category_id 为空的记录 */
  const runRules = async () => {
    setCleaning(true)
    setError('')
    try {
      const [ruleList, pending, categoryList] = await Promise.all([
        fetchBillRules(),
        fetchUnclassifiedBills(),
        fetchBillCategories(),
      ])
      if (ruleList.length === 0) {
        alert('还没有任何归类规则，先去「规则定义」里给分类添加关键词吧')
        return
      }
      if (pending.length === 0) {
        alert('没有待分类的账单')
        return
      }

      const depthOf = buildDepthOf(categoryList)
      const groups = new Map<string, string[]>()
      for (const bill of pending) {
        const categoryId = pickBillCategory(bill, ruleList, depthOf)
        if (!categoryId) continue
        const list = groups.get(categoryId) ?? []
        list.push(bill.id)
        groups.set(categoryId, list)
      }

      setPhase('saving')
      setPercent(null)
      setMessage(`正在按规则分类…（待处理 ${pending.length} 条）`)

      let updated = 0
      for (const [categoryId, ids] of groups) {
        updated += await updateBillsCategory(ids, categoryId)
        setMessage(`已自动分类 ${updated} 条…`)
      }

      const [batchList, billRows] = await Promise.all([
        fetchOdsBatches(),
        fetchOdsBills({ batchId: selectedBatch || undefined, limit: PAGE_LIMIT }),
      ])
      setBatches(batchList)
      setRows(billRows)
      setCategories(categoryList)
      alert(`成功自动分类了 ${updated} 条记录！`)
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

  const busy = phase !== 'idle'

  /** 列表顶部概览：当前列表的月份 + 收支合计 */
  const summary = useMemo(() => {
    let income = 0
    let expense = 0
    let latest = ''
    for (const row of rows) {
      const direction = row.direction ?? ''
      if (direction.includes('收')) income += Number(row.amount ?? 0)
      else if (direction.includes('支')) expense += Number(row.amount ?? 0)
      if (row.trade_time && row.trade_time > latest) latest = row.trade_time
    }
    const stamp = latest ? bjDateTime(latest) : ''
    const month = stamp ? `${stamp.slice(0, 4)}年${Number(stamp.slice(5, 7))}月` : '全部账单'
    return { income, expense, month }
  }, [rows])

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
      const rowsToSave = buildOdsRows(sheet, headerIndex, source)
      if (rowsToSave.length === 0) throw new Error('表头之后没有数据行，请确认文件是否完整')

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
        fetchOdsBills({ batchId, limit: PAGE_LIMIT }),
      ])
      setBatches(batchList)
      setRows(billRows)
      alert(`成功导入 ${rowsToSave.length} 条记录，批次号：${batchId}`)
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
    <div className="min-h-[100dvh] pb-24">
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

      <div className="mx-auto w-full max-w-full overflow-x-hidden">
        {loadError && (
          <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
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

        {/* 工具栏：导入 + 规则，普通小按钮，不再占据首屏 */}
        <div className="flex w-full flex-wrap items-center gap-2 px-4 pb-2 pt-1">
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
                className="flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors active:bg-gray-50 disabled:opacity-60"
              >
                <Icon className={`size-4 shrink-0 ${meta.iconClass}`} aria-hidden="true" />
                {meta.label}
              </button>
            )
          })}
          <button
            type="button"
            disabled={busy || cleaning}
            onClick={() => void runRules()}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-md bg-sky-50 px-3 text-xs font-semibold text-sky-700 transition-colors active:bg-sky-100 disabled:opacity-60"
          >
            <Wand2 className="size-3.5 shrink-0" aria-hidden="true" />
            {cleaning ? '正在应用规则…' : '一键应用规则'}
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
          <div className="mx-4 mb-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
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
          <p className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* 明细：微信账单式极简列表 */}
        <section className="mt-1">
          <header className="flex items-center gap-2 px-4 pb-2">
            <h2 className="text-base font-bold">账单明细</h2>
            <span className="text-xs text-muted-foreground">
              {selectedBatch ? '本批次' : '最近'} {rows.length} 条
            </span>
            <Link href="/bills/stats" className="ml-auto text-xs font-semibold text-primary">
              看统计
            </Link>
          </header>

          {batches.length > 0 && (
            <div className="flex w-full gap-1.5 overflow-x-auto px-4 pb-2">
              <button
                type="button"
                onClick={() => void changeBatch('')}
                className={[
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  !selectedBatch
                    ? 'border-primary bg-primary/10 text-primary'
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
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-200 bg-white text-slate-600',
                  ].join(' ')}
                >
                  <span>{SOURCE_LABELS[batch.source] ?? batch.source}</span>
                  <span className="tabular-nums">{batch.count}</span>
                </button>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="sticky top-16 z-20 flex items-center justify-between border-b border-gray-100 bg-gray-50/95 px-4 py-2 text-xs backdrop-blur">
              <span className="font-semibold text-gray-700">{summary.month}</span>
              <span className="tabular-nums text-gray-500">
                支出 <span className="font-semibold text-gray-900">{money(summary.expense)}</span>
                <span className="mx-1.5 text-gray-300">|</span>
                收入 <span className="font-semibold text-amber-600">{money(summary.income)}</span>
              </span>
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
          ) : (
            <ul className="divide-y divide-gray-100 border-y border-gray-100 bg-white">
              {rows.map((row) => (
                <BillRow
                  key={row.id}
                  row={row}
                  categories={categories}
                  onAssign={(id, categoryId) => void assignCategory(id, categoryId)}
                />
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              按交易时间倒序，最多展示 {PAGE_LIMIT} 条；「待分类」可手动指定分类。
            </p>
          )}
        </section>

        <p className="mx-4 mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          导入按物理列映射：交易时间、交易类型、对方、商品、收/支、金额、支付方式、状态、单号、备注，
          整行原始数据同时存入 raw_data；每 100 条一批写入 bill_ods。
        </p>
      </div>

      {/* 手机端悬浮「记一笔」 */}
      <button
        type="button"
        onClick={() => setManualOpen(true)}
        aria-label="记一笔"
        className="fixed bottom-20 right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-3xl font-light text-white shadow-lg active:bg-blue-700"
      >
        <span aria-hidden="true">＋</span>
      </button>

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
