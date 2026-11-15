'use client'

import { bjDateTime } from '@/lib/bills'
import type { BillCategory, OdsBillRow } from '@/lib/supabase-queries'

/** 金额：收入绿色带 +，支出红色带 -，其他（不计收支）灰色 */
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

/** 账单明细表：时间 / 交易对方 / 商品说明 / 分类 / 金额；表头吸顶，表格内部滚动 */
export function BillDetailTable({
  rows,
  categories,
  onAssign,
}: {
  rows: OdsBillRow[]
  categories: BillCategory[]
  /** 未分类记录手动选分类 */
  onAssign?: (id: string, categoryId: string) => void
}) {
  const categoryById = new Map(categories.map((item) => [item.id, item]))

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[42rem] border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr className="text-left text-muted-foreground">
            <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">交易时间</th>
            <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">交易对方</th>
            <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">商品说明</th>
            <th className="whitespace-nowrap border-b px-2.5 py-2 font-semibold">分类</th>
            <th className="whitespace-nowrap border-b px-2.5 py-2 text-right font-semibold">金额</th>
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
                  ) : onAssign && categories.length > 0 ? (
                    <select
                      value=""
                      onChange={(event) => onAssign(row.id, event.target.value)}
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
  )
}
