'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { BillDetailTable } from '@/app/bills/bill-table'
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
    hint: '微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单（.xlsx / .csv）',
    className: 'bg-emerald-500 hover:bg-emerald-600',
    short: '微信',
  },
  alipay: {
    label: '导入支付宝账单',
    hint: '支付宝 → 我的 → 账单 → 右上角… → 开具交易流水证明（.csv / .xlsx）',
    className: 'bg-sky-500 hover:bg-sky-600',
    short: '支付宝',
  },
}

/**
 * 账单导入：文件 → bill_ods 物理列 + raw_data，下方直接展示明细，
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

  /** 切换批次筛选，只重新拉明细与批次 */
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

  /** 一级 / 二级分类层级：同优先级时让二级分类更具体，先命中 */
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
      // 同一分类的记录攒在一起，一次性回写
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

      // 分类变了，重新拉当前筛选下的明细
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

      // 导入后立刻展示这批数据
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
      // Supabase 的 PostgrestError 在浏览器控制台会显示成 {}，这里额外打印可读文本
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
    <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden">
      <PageHeader
        title="家庭账单"
        subtitle="导入微信 / 支付宝账单，一键套用分类规则"
        action={
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href="/bills/rules"
              className="rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              规则定义
            </Link>
            <Link
              href="/bills/stats"
              className="rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              数据统计
            </Link>
          </div>
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-4 pb-4 md:px-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch lg:gap-5">
        {/* 左栏：导入入口 + 一键分类 */}
        <div className="flex max-h-[48dvh] shrink-0 flex-col gap-3 overflow-y-auto pr-0.5 lg:max-h-none lg:min-h-0 lg:flex-1">
          {loadError && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
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

          <div className="grid grid-cols-2 gap-2">
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
                  className={`flex flex-col items-start gap-1 rounded-2xl px-4 py-3 text-left text-white transition-colors disabled:opacity-60 ${meta.className}`}
                >
                  <span className="text-sm font-bold md:text-base">{meta.label}</span>
                  <span className="hidden text-[11px] leading-snug opacity-90 sm:block">{meta.hint}</span>
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

          {/* 一键应用规则：页面主操作 */}
          <button
            type="button"
            disabled={busy || cleaning}
            onClick={() => void runRules()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-5 text-base font-bold text-white shadow-lg transition-all hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-60"
          >
            <span aria-hidden="true">🪄</span>
            {cleaning ? '正在应用规则…' : '一键应用规则自动分类'}
          </button>

          {(busy || cleaning) && (
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

          <p className="rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            导入按物理列映射：交易时间、交易类型、对方、商品、收/支、金额、支付方式、状态、单号、备注，
            整行原始数据同时存入 <span className="font-mono">raw_data</span>；每 100 条一批写入{' '}
            <span className="font-mono">bill_ods</span>。
          </p>
        </div>

        {/* 右栏：明细列表 */}
        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <header className="flex shrink-0 items-center gap-2">
            <h2 className="text-sm font-bold">账单明细</h2>
            <span className="text-xs text-muted-foreground">
              {selectedBatch ? '本批次' : '最近'} {rows.length} 条
            </span>
            <Link href="/bills/rules" className="ml-auto text-xs font-semibold text-primary">
              管理分类规则
            </Link>
          </header>

          {batches.length > 0 && (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => void changeBatch('')}
                className={[
                  'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  !selectedBatch
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
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
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    selectedBatch === batch.batchId
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span>{SOURCE_META[batch.source as BillSource]?.short ?? batch.source}</span>
                  <span className="tabular-nums">{batch.count}</span>
                  <span className="font-mono text-[10px] opacity-70">
                    {batch.createdAt ? bjDateTime(batch.createdAt) : batch.batchId}
                  </span>
                </button>
              ))}
            </div>
          )}

          {listLoading ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">正在读取账单…</p>
          ) : rows.length === 0 ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              {batches.length === 0
                ? '还没有导入记录，点上面的按钮选择账单文件吧'
                : '这个批次里没有数据'}
            </p>
          ) : (
            <BillDetailTable rows={rows} categories={categories} onAssign={(id, categoryId) => void assignCategory(id, categoryId)} />
          )}

          {rows.length > 0 && (
            <p className="shrink-0 text-[11px] text-muted-foreground">
              按交易时间倒序，最多展示 {PAGE_LIMIT} 条；未分类的可在「分类」列手动选择。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
