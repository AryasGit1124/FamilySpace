'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import {
  bjDateTime,
  buildOdsRows,
  describeBillError,
  findRawHeaderRow,
  isMissingBillTable,
  newBatchId,
  pickBillCategory,
  readBillSheet,
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

const SOURCE_META: Record<BillSource, { label: string; hint: string; className: string; short: string }> = {
  wechat: {
    label: '导入微信账单',
    hint: '钱包 → 账单 → 常见问题 → 下载账单',
    className: 'bg-emerald-500 active:bg-emerald-600',
    short: '微信',
  },
  alipay: {
    label: '导入支付宝账单',
    hint: '我的 → 账单 → … → 开具交易流水证明',
    className: 'bg-sky-500 active:bg-sky-600',
    short: '支付宝',
  },
}

const money = (value: number | null) =>
  value === null ? '—' : `¥${Number(value).toFixed(2)}`

/** 账单卡片：手机端优先，商品说明大字 + 对方/时间小字 + 金额 + 分类标签 */
function BillCard({
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

  return (
    <li className="rounded-2xl border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-snug">
            {row.commodity || row.trade_type || '（无商品说明）'}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.counterparty || '—'}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {row.trade_time ? bjDateTime(row.trade_time) : '—'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={
              isIncome
                ? 'text-base font-bold tabular-nums text-emerald-600'
                : isExpense
                  ? 'text-base font-bold tabular-nums text-red-500'
                  : 'text-base font-bold tabular-nums text-muted-foreground'
            }
          >
            {isIncome ? '+' : isExpense ? '-' : ''}
            {money(row.amount)}
          </span>
          {category ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {category.emoji} {category.name}
            </span>
          ) : categories.length > 0 ? (
            <select
              value=""
              onChange={(event) => onAssign(row.id, event.target.value)}
              className="rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
            >
              <option value="">待分类</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.emoji} {item.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">待分类</span>
          )}
        </div>
      </div>
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

      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        {loadError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
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

        {/* 上传区：全宽大按钮 */}
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(SOURCE_META) as BillSource[]).map((source) => {
            const meta = SOURCE_META[source]
            return (
              <button
                key={source}
                type="button"
                disabled={busy}
                onClick={() => {
                  pendingSource.current = source
                  inputRef.current?.click()
                }}
                className={`flex w-full flex-col items-start gap-1 rounded-2xl px-5 py-5 text-left text-white transition-colors disabled:opacity-60 ${meta.className}`}
              >
                <span className="text-base font-bold">{meta.label}</span>
                <span className="text-xs leading-snug opacity-90">{meta.hint}</span>
              </button>
            )
          })}
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

        <button
          type="button"
          disabled={busy || cleaning}
          onClick={() => void runRules()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-5 text-base font-bold text-white shadow-lg active:from-violet-600 active:to-fuchsia-600 disabled:opacity-60"
        >
          <span aria-hidden="true">🪄</span>
          {cleaning ? '正在应用规则…' : '一键应用规则自动分类'}
        </button>

        {(busy || cleaning) && (
          <div className="mt-3 rounded-2xl border bg-card px-4 py-3">
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

        {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

        {/* 明细卡片流 */}
        <section className="mt-6">
          <header className="mb-2 flex items-center gap-2">
            <h2 className="text-base font-bold">账单明细</h2>
            <span className="text-xs text-muted-foreground">
              {selectedBatch ? '本批次' : '最近'} {rows.length} 条
            </span>
            <Link href="/bills/stats" className="ml-auto text-xs font-semibold text-primary">
              看统计
            </Link>
          </header>

          {batches.length > 0 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2">
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
                  <span>{SOURCE_META[batch.source as BillSource]?.short ?? batch.source}</span>
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
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {rows.map((row) => (
                <BillCard
                  key={row.id}
                  row={row}
                  categories={categories}
                  onAssign={(id, categoryId) => void assignCategory(id, categoryId)}
                />
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              按交易时间倒序，最多展示 {PAGE_LIMIT} 条；「待分类」下拉可手动指定分类。
            </p>
          )}
        </section>

        <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          导入按物理列映射：交易时间、交易类型、对方、商品、收/支、金额、支付方式、状态、单号、备注，
          整行原始数据同时存入 raw_data；每 100 条一批写入 bill_ods。
        </p>
      </div>
    </div>
  )
}
