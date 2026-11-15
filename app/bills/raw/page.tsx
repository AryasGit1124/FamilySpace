import Link from 'next/link'
import { bjDateTime, describeBillError, isMissingBillTable } from '@/lib/bills'
import { fetchRawBatches, fetchRawRows, type RawBatch, type RawBillRow } from '@/lib/supabase-queries'

/** 每次进入都重新读取 */
export const dynamic = 'force-dynamic'

/** 预览条数上限 */
const PAGE_LIMIT = 200

const sourceLabel = (source: string) =>
  source === 'wechat' ? '微信' : source === 'alipay' ? '支付宝' : source

/** 单张原始数据卡片：字段动态，键值对逐条展示 */
function RawCard({ row }: { row: RawBillRow }) {
  const entries = Object.entries(row.raw_json ?? {})
  return (
    <article className="rounded-2xl border bg-card p-3 shadow-sm">
      <header className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
            row.source === 'wechat' ? 'bg-emerald-500' : 'bg-sky-500'
          }`}
        >
          {sourceLabel(row.source)}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          批次 {row.batch_id ?? '—'}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          第 {row.row_index ?? '—'} 行
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {row.created_at ? bjDateTime(row.created_at) : ''}
        </span>
      </header>

      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex min-w-0 gap-1.5 text-xs leading-relaxed">
            <dt className="shrink-0 font-medium text-muted-foreground">【{key}】</dt>
            <dd className="min-w-0 break-all">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

/** 原始数据预览：导入多少条就展示多少条，字段原样保留 */
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
    rows = await fetchRawRows({ batchId: batch, limit: PAGE_LIMIT })
  } catch (err) {
    console.error('[RawBillsPage] 读取 bill_raw_data 失败:', describeBillError(err), err)
    loadError = isMissingBillTable(err)
      ? '原始账单表还没创建：请在 Supabase 执行 scripts/create-bill-raw-data.sql'
      : `读取原始数据失败：${describeBillError(err)}`
  }

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
          <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto pb-1 lg:grid-cols-2">
            {rows.map((row) => (
              <RawCard key={row.id} row={row} />
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <p className="mt-2 shrink-0 text-[11px] text-muted-foreground">
            按导入时间倒序，最多展示 {PAGE_LIMIT} 条；数据原样存储，未做任何清洗
          </p>
        )}
      </div>
    </div>
  )
}
