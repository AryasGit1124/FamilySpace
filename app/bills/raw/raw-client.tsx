'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { bjDateTime, describeBillError, isMissingBillTable } from '@/lib/bills'
import {
  fetchBillCategories,
  fetchOdsBatches,
  fetchOdsBills,
  updateOdsBillCategory,
  type BillCategory,
  type OdsBatch,
  type OdsBillRow,
} from '@/lib/supabase-queries'

/** 预览条数上限 */
const PAGE_LIMIT = 200

const sourceLabel = (source: string) =>
  source === 'wechat' ? '微信' : source === 'alipay' ? '支付宝' : source

/** 金额展示：收入绿色带 +，支出红色带 -，其他（不计收支）灰色 */
function AmountCell({ row }: { row: OdsBillRow }) {
  const direction = row.direction ?? ''
  const isIncome = direction.includes('收')
  const isExpense = direction.includes('支')
  const className = isIncome
    ? 'text-emerald-600'
    : isExpense
      ? 'text-red-500'
      : 'text-muted-foreground'
  const sign = isIncome ? '+' : isExpense ? '-' : ''

  return (
    <td className={`whitespace-nowrap px-2.5 py-1.5 text-right font-medium tabular-nums ${className}`}>
      {row.amount === null ? '—' : `${sign}¥${Number(row.amount).toFixed(2)}`}
    </td>
  )
}

/** 账单明细预览：直接读 bill_ods 的物理列 */
export function RawBillsClient({ batch }: { batch?: string }) {
  const [batches, setBatches] = useState<OdsBatch[]>([])
  const [rows, setRows] = useState<OdsBillRow[]>([])
  const [categories, setCategories] = useState<BillCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [batchList, billRows, categoryList] = await Promise.all([
        fetchOdsBatches(),
        fetchOdsBills({ batchId: batch, limit: PAGE_LIMIT }),
        fetchBillCategories(),
      ])
      setBatches(batchList)
      setRows(billRows)
      setCategories(categoryList)
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 读取账单失败:', detail, err)
      setError(
        isMissingBillTable(err)
          ? '账单表还没创建：请在 Supabase 执行 scripts/create-bill-ods.sql'
          : `读取账单失败：${detail}`,
      )
    } finally {
      setLoading(false)
    }
  }, [batch])

  useEffect(() => {
    void load()
  }, [load])

  const categoryById = useMemo(
    () => new Map(categories.map((item) => [item.id, item])),
    [categories],
  )

  /** 手动给单条账单补分类：先乐观更新，失败回滚 */
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
      <header className="shrink-0 border-b bg-card px-4 py-3 md:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2">
          <Link
            href="/bills/import"
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
          >
            ← 返回导入
          </Link>
          <h1 className="text-base font-bold md:text-lg">账单明细</h1>
          <span className="text-xs text-muted-foreground">
            {rows.length > 0 ? `最近 ${rows.length} 条` : ''}
          </span>
        </div>

        {batches.length > 0 && (
          <div className="mx-auto mt-2 flex w-full max-w-6xl gap-1.5 overflow-x-auto pb-0.5">
            <Link
              href="/bills/raw"
              className={[
                'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                !batch
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              全部批次
            </Link>
            {batches.map((item) => {
              const isActive = item.batchId === batch
              return (
                <Link
                  key={item.batchId}
                  href={`/bills/raw?batch=${encodeURIComponent(item.batchId)}`}
                  className={[
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span>{sourceLabel(item.source)}</span>
                  <span className="tabular-nums">{item.count}</span>
                  <span className="font-mono text-[10px] opacity-70">{item.batchId}</span>
                </Link>
              )
            })}
          </div>
        )}
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-3 md:px-6">
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

        {loading && (
          <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">正在读取账单…</p>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
            {batches.length === 0 ? '还没有导入记录，先回上一页导入账单吧' : '这个批次里没有数据'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[42rem] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="text-left text-muted-foreground">
                  <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">交易时间</th>
                  <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">交易对方</th>
                  <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">商品 / 说明</th>
                  <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">分类</th>
                  <th className="whitespace-nowrap border-b px-2.5 py-2 text-right font-semibold">
                    金额
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const category = row.category_id ? categoryById.get(row.category_id) : undefined
                  return (
                    <tr key={row.id} className="odd:bg-white even:bg-muted/30">
                      <td className="whitespace-nowrap border-b px-2.5 py-1.5 tabular-nums">
                        {row.trade_time ? bjDateTime(row.trade_time) : '—'}
                      </td>
                      <td
                        title={row.counterparty ?? ''}
                        className="max-w-[10rem] truncate border-b px-2.5 py-1.5"
                      >
                        {row.counterparty || '—'}
                      </td>
                      <td
                        title={row.commodity ?? ''}
                        className="max-w-[16rem] truncate border-b px-2.5 py-1.5"
                      >
                        {row.commodity || '—'}
                      </td>
                      <td className="whitespace-nowrap border-b px-2.5 py-1.5">
                        {category ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                            {category.emoji} {category.name}
                          </span>
                        ) : categories.length > 0 ? (
                          <select
                            value=""
                            onChange={(event) => void assignCategory(row.id, event.target.value)}
                            className="rounded-lg border bg-white px-1.5 py-1 text-[11px] text-muted-foreground"
                          >
                            <option value="">未分类</option>
                            {categories.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.emoji} {item.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">未分类</span>
                        )}
                      </td>
                      <AmountCell row={row} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">
            按交易时间倒序，最多展示 {PAGE_LIMIT} 条；完整字段已存入 bill_ods，原始行保存在 raw_data
          </p>
        )}
      </div>
    </div>
  )
}
