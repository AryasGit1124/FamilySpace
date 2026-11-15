import Link from 'next/link'
import { bjDateTime, describeBillError, isMissingBillTable } from '@/lib/bills'
import {
  fetchRawBatches,
  fetchRawRows,
  type RawBatch,
  type RawBillRow,
} from '@/lib/supabase-queries'

/** 每次进入都重新读取 */
export const dynamic = 'force-dynamic'

const PAGE_LIMIT = 200

/** 各行的字段并集，按首次出现顺序作为表头 */
function collectColumns(rows: RawBillRow[]): string[] {
  const seen = new Set<string>()
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row.raw_json ?? {})) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  return columns
}

/** 原始数据预览：某个批次导入了什么，就原样展示什么 */
export default async function RawBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const { batch } = await searchParams

  let batches: RawBatch[] = []
  let rows: RawBillRow[] = []
  let loadError: string | null = null

  try {
    batches = await fetchRawBatches()
    const activeBatch = batch ?? batches[0]?.batchId
    if (activeBatch) rows = await fetchRawRows(activeBatch, PAGE_LIMIT)
  } catch (err) {
    console.error('[RawBillsPage] 读取 bill_raw_data 失败:', describeBillError(err), err)
    loadError = isMissingBillTable(err)
      ? '原始账单表还没创建：请在 Supabase 执行 scripts/create-bill-raw-data.sql'
      : `读取原始数据失败：${describeBillError(err)}`
  }

  const activeBatch = batch ?? batches[0]?.batchId ?? ''
  const columns = collectColumns(rows)
  const sourceLabel = (source: string) => (source === 'wechat' ? '微信' : source === 'alipay' ? '支付宝' : source)

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-card px-4 py-3 md:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2">
          <Link
            href="/bills"
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
          >
            ← 返回导入
          </Link>
          <h1 className="text-base font-bold md:text-lg">原始数据预览</h1>
          <span className="text-xs text-muted-foreground">
            {rows.length > 0 ? `${rows.length} 条${rows.length >= PAGE_LIMIT ? '（仅前 200 条）' : ''}` : ''}
          </span>
        </div>

        {batches.length > 0 && (
          <div className="mx-auto mt-2 flex w-full max-w-6xl gap-1.5 overflow-x-auto pb-0.5">
            {batches.map((item) => {
              const isActive = item.batchId === activeBatch
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
        {loadError && (
          <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
            {loadError}
          </p>
        )}

        {!loadError && rows.length === 0 && (
          <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
            {batches.length === 0 ? '还没有导入记录，先回上一页导入账单吧' : '这个批次里没有数据'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl border bg-card">
            <table className="min-w-max border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="whitespace-nowrap border-b px-2.5 py-2 text-left font-semibold text-muted-foreground">
                    行号
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column}
                      className="whitespace-nowrap border-b px-2.5 py-2 text-left font-semibold text-muted-foreground"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="odd:bg-white even:bg-muted/30">
                    <td className="whitespace-nowrap border-b px-2.5 py-1.5 tabular-nums text-muted-foreground">
                      {row.row_index ?? '—'}
                    </td>
                    {columns.map((column) => {
                      const value = row.raw_json?.[column] ?? ''
                      return (
                        <td
                          key={column}
                          title={value}
                          className="max-w-[14rem] truncate border-b px-2.5 py-1.5"
                        >
                          {value || '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">
            导入时间：{rows[0]?.created_at ? bjDateTime(rows[0].created_at) : '—'} · 批次号：
            <span className="font-mono">{activeBatch}</span> · 数据原样存储，未做任何清洗
          </p>
        )}
      </div>
    </div>
  )
}
