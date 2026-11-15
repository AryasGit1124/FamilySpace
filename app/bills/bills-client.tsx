'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import {
  bjDateTime,
  buildOdsRows,
  describeBillError,
  findRawHeaderRow,
  isMissingBillTable,
  newBatchId,
  readBillSheet,
  type BillSource,
} from '@/lib/bills'
import { fetchOdsBatches, insertOdsBills, type OdsBatch } from '@/lib/supabase-queries'

type Phase = 'idle' | 'parsing' | 'saving'

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
 * 家庭账单：把微信 / 支付宝导出文件映射到 bill_ods 的物理列，原始行另存 raw_data。
 * 这里只做「解析 → 组装 JSON → 分批入库」，不做金额清洗与统计。
 * 批次列表在浏览器端读取：线上服务端访问 Supabase 偶发 ECONNRESET。
 */
export function BillsClient() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [batches, setBatches] = useState<OdsBatch[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingSource = useRef<BillSource>('wechat')

  const loadBatches = useCallback(async () => {
    setListLoading(true)
    setLoadError('')
    try {
      setBatches(await fetchOdsBatches())
    } catch (err) {
      const detail = describeBillError(err)
      console.error('[Bills] 读取导入批次失败:', detail, err)
      setLoadError(
        isMissingBillTable(err)
          ? '账单表还没创建：请在 Supabase 执行 scripts/create-bill-ods.sql，然后刷新本页'
          : `读取导入批次失败：${detail}`,
      )
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBatches()
  }, [loadBatches])

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
      const rows = buildOdsRows(sheet, headerIndex, source)
      if (rows.length === 0) throw new Error('表头之后没有数据行，请确认文件是否完整')

      const batchId = newBatchId()
      setPhase('saving')
      setPercent(0)
      setMessage(`已解析 ${rows.length} 条记录，正在保存…`)

      await insertOdsBills({
        source,
        batchId,
        rows,
        onProgress: (saved, total) => {
          savedSoFar = saved
          const ratio = Math.round((saved / total) * 100)
          setPercent(ratio)
          setMessage(`已解析 ${total} 条，已保存 ${saved} 条（${ratio}%）…`)
        },
      })

      setMessage('')
      setPercent(null)
      alert(`成功导入 ${rows.length} 条记录，批次号：${batchId}`)
      router.push(`/bills/raw?batch=${encodeURIComponent(batchId)}`)
    } catch (err) {
      const detail = describeBillError(err)
      // Supabase 的 PostgrestError 在浏览器控制台会显示成 {}，这里额外打印可读文本
      console.error('[Bills] 导入失败:', detail, err)
      setMessage('')
      setPercent(null)
      if (isMissingBillTable(err)) {
        setError('账单表还没创建：请在 Supabase 执行 scripts/create-bill-ods.sql，然后重试')
      } else {
        setError(`${savedSoFar > 0 ? `已保存 ${savedSoFar} 条，之后` : ''}导入失败：${detail}`)
      }
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden">
      <PageHeader
        title="家庭账单"
        subtitle="原始数据先入库，清洗与统计稍后再说"
        action={
          <Link
            href="/bills/raw"
            className="shrink-0 rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
          >
            原始数据
          </Link>
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 px-4 pb-4 md:px-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch lg:gap-5">
        {/* 左栏：导入入口 + 进度 */}
        <div className="flex shrink-0 flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {loadError && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
              <span className="flex-1">{loadError}</span>
              <button
                type="button"
                onClick={() => void loadBatches()}
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

          {busy && (
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
            整行原始数据同时存入 <span className="font-mono">raw_data</span>。
            每 100 条一批写入 <span className="font-mono">bill_ods</span>，并带批次号，方便整批撤回。
          </p>
        </div>

        {/* 右栏：最近导入批次 */}
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <h2 className="text-sm font-bold">导入批次</h2>
            <span className="text-xs text-muted-foreground">{batches.length} 个</span>
            <Link href="/bills/raw" className="ml-auto text-xs font-semibold text-primary">
              查看原始数据
            </Link>
          </header>

          {listLoading ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              正在读取导入批次…
            </p>
          ) : batches.length === 0 ? (
            <p className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
              还没有导入记录，点上面的按钮选择账单文件吧
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {batches.map((batch) => (
                <li key={batch.batchId}>
                  <Link
                    href={`/bills/raw?batch=${encodeURIComponent(batch.batchId)}`}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                        batch.source === 'wechat' ? 'bg-emerald-500' : 'bg-sky-500'
                      }`}
                    >
                      {SOURCE_META[batch.source as BillSource]?.short ?? batch.source}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{batch.count} 条记录</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {batch.batchId}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {batch.createdAt ? bjDateTime(batch.createdAt) : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
