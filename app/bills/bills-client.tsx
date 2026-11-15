'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { parseBillCsv, type BillSource } from '@/lib/bills'
import { insertBills, type BillStats } from '@/lib/supabase-queries'

type Phase = 'idle' | 'parsing' | 'saving'

const SOURCE_META: Record<BillSource, { label: string; hint: string; className: string }> = {
  wechat: {
    label: '导入微信账单',
    hint: '微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单',
    className: 'bg-emerald-500 hover:bg-emerald-600',
  },
  alipay: {
    label: '导入支付宝账单',
    hint: '支付宝 → 我的 → 账单 → 右上角… → 开具交易流水证明',
    className: 'bg-sky-500 hover:bg-sky-600',
  },
}

function yuan(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 家庭账单：导入微信 / 支付宝 CSV，展示本月收支概况 */
export function BillsClient({ initialStats }: { initialStats: BillStats }) {
  const router = useRouter()
  const [stats] = useState(initialStats)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inputRefs = useRef<Record<BillSource, HTMLInputElement | null>>({
    wechat: null,
    alipay: null,
  })

  const busy = phase !== 'idle'

  const handleFile = async (source: BillSource, file: File) => {
    if (busy) return
    setError('')
    setPhase('parsing')
    setMessage('正在解析文件…')
    try {
      const buffer = await file.arrayBuffer()
      // 微信/支付宝导出有时是 GBK，用 UTF-8 解出替换符时再按 GBK 解一次
      let text = new TextDecoder('utf-8').decode(buffer)
      if (text.includes('\uFFFD')) {
        try {
          text = new TextDecoder('gbk').decode(buffer)
        } catch {
          // 浏览器不支持 gbk 时保留 UTF-8 结果
        }
      }

      const result = parseBillCsv(text, source)
      if (result.rows.length === 0) {
        setPhase('idle')
        setMessage('')
        setError(
          result.total === 0
            ? '这个文件里没读到账单数据，请确认是官方导出的 CSV'
            : `共 ${result.total} 条记录，但没有可统计的收/支记录（转账、还款会被过滤）`,
        )
        return
      }

      setPhase('saving')
      setMessage(`已解析 ${result.rows.length} 条，正在保存…`)
      let saved = 0
      await insertBills(result.rows, (done) => {
        saved = done
        setMessage(`已解析 ${result.rows.length} 条，已保存 ${saved} 条…`)
      })
      setMessage('')
      setError('')
      alert(
        `导入成功：${result.rows.length} 条记录已保存${
          result.skipped > 0 ? `（另有 ${result.skipped} 条不计收支已过滤）` : ''
        }`,
      )
      router.refresh()
    } catch (err) {
      console.error('[Bills] 导入失败:', err)
      setError(`导入失败：${err instanceof Error ? err.message : String(err)}`)
      setMessage('')
    } finally {
      setPhase('idle')
    }
  }

  const balance = stats.monthIncome - stats.monthExpense

  return (
    <>
      <PageHeader title="家庭账单" subtitle="导入微信 / 支付宝流水，看看这个月的钱都花在哪" />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SOURCE_META) as BillSource[]).map((source) => {
            const meta = SOURCE_META[source]
            return (
              <button
                key={source}
                type="button"
                disabled={busy}
                onClick={() => inputRefs.current[source]?.click()}
                className={`flex flex-col items-start gap-1 rounded-2xl px-5 py-4 text-left text-white transition-colors disabled:opacity-60 ${meta.className}`}
              >
                <span className="text-lg font-bold">{meta.label}</span>
                <span className="text-xs leading-relaxed opacity-90">{meta.hint}</span>
              </button>
            )
          })}
          {(Object.keys(SOURCE_META) as BillSource[]).map((source) => (
            <input
              key={source}
              ref={(el) => {
                inputRefs.current[source] = el
              }}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleFile(source, file)
              }}
            />
          ))}
        </div>

        {busy && (
          <div className="rounded-2xl border bg-card px-4 py-3">
            <p className="text-sm font-medium">{message || '正在处理…'}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        <section className="grid grid-cols-3 gap-3">
          <StatCard label="本月支出" value={`¥${yuan(stats.monthExpense)}`} tone="text-rose-600" />
          <StatCard label="本月收入" value={`¥${yuan(stats.monthIncome)}`} tone="text-emerald-600" />
          <StatCard
            label="本月结余"
            value={`${balance >= 0 ? '' : '-'}¥${yuan(Math.abs(balance))}`}
            tone={balance >= 0 ? 'text-foreground' : 'text-rose-600'}
          />
        </section>

        <section className="rounded-2xl border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-bold">最近记录</h2>
            <span className="text-xs text-muted-foreground">共 {stats.totalCount} 条</span>
          </header>
          {stats.recent.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              还没有账单，点上面的按钮导入 CSV 吧
            </p>
          ) : (
            <ul className="divide-y">
              {stats.recent.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.description || row.category || '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.occurred_at.slice(0, 16).replace('T', ' ')} ·{' '}
                      {row.source === 'wechat' ? '微信' : '支付宝'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-bold tabular-nums ${
                      row.direction === 'income' ? 'text-emerald-600' : 'text-foreground'
                    }`}
                  >
                    {row.direction === 'income' ? '+' : '-'}¥{yuan(Number(row.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-base font-bold tabular-nums md:text-lg ${tone}`}>{value}</p>
    </div>
  )
}
