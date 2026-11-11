'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Gift, ListChecks, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import {
  approveCheckin,
  approveExchangeRequest,
  fetchFamilyMembers,
  fetchPendingCheckins,
  fetchPendingExchangeRequests,
  rejectCheckin,
  rejectExchangeRequest,
  type ExchangeRequest,
  type PendingCheckinItem,
} from '@/lib/supabase-queries'

type TabKey = 'checkins' | 'exchanges'

/** 家长端审核中心：打卡审核 / 兑换审核 */
export default function ApprovalsPage() {
  const [tab, setTab] = useState<TabKey>('checkins')
  const [items, setItems] = useState<PendingCheckinItem[]>([])
  const [exchanges, setExchanges] = useState<ExchangeRequest[]>([])
  const [childName, setChildName] = useState('孩子')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pending, members, exchangeList] = await Promise.all([
        fetchPendingCheckins(),
        fetchFamilyMembers(),
        fetchPendingExchangeRequests(),
      ])
      setItems(pending)
      setExchanges(exchangeList)
      const child = members.find((m) => m.role === 'child')
      setChildName(child?.display_name?.trim() || '孩子')
    } catch (err) {
      console.error('[Approvals] 加载失败:', err)
      setFeedback({ type: 'error', text: '加载待审核数据失败，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 孩子新提交打卡 / 兑换申请时实时刷新列表
  useEffect(() => {
    const onChange = () => {
      void load()
    }
    window.addEventListener('checkins-changed', onChange)
    window.addEventListener('exchange-requests-changed', onChange)
    return () => {
      window.removeEventListener('checkins-changed', onChange)
      window.removeEventListener('exchange-requests-changed', onChange)
    }
  }, [load])

  const totalStars = useMemo(() => items.reduce((sum, item) => sum + item.stars, 0), [items])

  const handleApprove = async (item: PendingCheckinItem) => {
    if (busyId) return
    setBusyId(item.id)
    setFeedback(null)
    try {
      const granted = await approveCheckin(item.id, item.taskTitle)
      setItems((prev) => prev.filter((row) => row.id !== item.id))
      setFeedback({
        type: 'ok',
        text: `已通过「${item.taskTitle}」，${childName}获得 ${granted} 颗星星 ⭐`,
      })
    } catch (err) {
      console.error('[Approvals] 确认打卡失败:', err)
      setFeedback({ type: 'error', text: '确认失败，请重试' })
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (item: PendingCheckinItem) => {
    if (busyId) return
    setBusyId(item.id)
    setFeedback(null)
    try {
      await rejectCheckin(item.id)
      setItems((prev) => prev.filter((row) => row.id !== item.id))
      setFeedback({ type: 'ok', text: `已驳回「${item.taskTitle}」，本次不发放星星` })
    } catch (err) {
      console.error('[Approvals] 驳回打卡失败:', err)
      setFeedback({ type: 'error', text: '驳回失败，请重试' })
    } finally {
      setBusyId(null)
    }
  }

  const handleApproveExchange = async (request: ExchangeRequest) => {
    if (busyId) return
    setBusyId(request.id)
    setFeedback(null)
    try {
      await approveExchangeRequest(request)
      setExchanges((prev) => prev.filter((row) => row.id !== request.id))
      setFeedback({
        type: 'ok',
        text: `已同意兑换「${request.reward_title}」，并扣除 ${request.cost_stars} 颗星星。`,
      })
    } catch (err) {
      console.error('[Approvals] 同意兑换失败:', err)
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : '同意兑换失败，请重试',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleRejectExchange = async (request: ExchangeRequest) => {
    if (busyId) return
    setBusyId(request.id)
    setFeedback(null)
    try {
      await rejectExchangeRequest(request.id)
      setExchanges((prev) => prev.filter((row) => row.id !== request.id))
      setFeedback({ type: 'ok', text: `已拒绝兑换「${request.reward_title}」，星星和库存都没有变动` })
    } catch (err) {
      console.error('[Approvals] 拒绝兑换失败:', err)
      setFeedback({ type: 'error', text: '拒绝兑换失败，请重试' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader title="审核中心" subtitle="确认孩子的打卡与兑换申请" />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pb-6">
        <div className="flex gap-1 rounded-2xl bg-muted p-1">
          <TabButton
            active={tab === 'checkins'}
            onClick={() => setTab('checkins')}
            icon={<ListChecks className="size-4" aria-hidden="true" />}
            label="打卡审核"
            count={items.length}
          />
          <TabButton
            active={tab === 'exchanges'}
            onClick={() => setTab('exchanges')}
            icon={<Gift className="size-4" aria-hidden="true" />}
            label="兑换审核"
            count={exchanges.length}
            highlight
          />
        </div>

        {feedback && (
          <p
            className={`rounded-xl px-4 py-3 text-sm font-medium ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-600'
            }`}
          >
            {feedback.text}
          </p>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">正在加载…</p>
        ) : tab === 'checkins' ? (
          <CheckinList
            items={items}
            totalStars={totalStars}
            childName={childName}
            busyId={busyId}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ) : (
          <ExchangeList
            requests={exchanges}
            busyId={busyId}
            onApprove={handleApproveExchange}
            onReject={handleRejectExchange}
          />
        )}
      </div>
    </>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  highlight = false,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count: number
  /** 有待审核时显示红点数字 */
  highlight?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold transition-colors ${
        active ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
      {highlight && count > 0 && (
        <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

function CheckinList({
  items,
  totalStars,
  childName,
  busyId,
  onApprove,
  onReject,
}: {
  items: PendingCheckinItem[]
  totalStars: number
  childName: string
  busyId: string | null
  onApprove: (item: PendingCheckinItem) => Promise<void>
  onReject: (item: PendingCheckinItem) => Promise<void>
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card py-14">
        <span className="text-4xl" aria-hidden="true">
          🎉
        </span>
        <p className="text-base font-semibold">没有待审核的打卡</p>
        <p className="text-sm text-muted-foreground">孩子完成学习后会出现在这里</p>
      </div>
    )
  }

  return (
    <>
      <section className="flex items-center justify-between rounded-2xl bg-amber-50 px-5 py-4">
        <div>
          <p className="text-sm text-amber-700">待审核打卡</p>
          <p className="text-2xl font-bold text-amber-600">{items.length} 条</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-amber-700">确认后共发放</p>
          <p className="text-2xl font-bold text-amber-600">{totalStars} ⭐</p>
        </div>
      </section>

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700"
                aria-hidden="true"
              >
                {childName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{childName}</span>
                  {item.subjectName && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {item.subjectName}
                    </span>
                  )}
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-600">
                    预估 {item.stars} ⭐
                  </span>
                </div>
                <p className="mt-1 truncate text-base font-medium">{item.taskTitle}</p>
                <p className="mt-0.5 text-sm font-semibold text-amber-700">
                  {item.score === null ? `线下课程 · 固定 ${item.stars} 颗星` : `得分：${item.score} 分`}
                </p>
                {item.streak > 0 &&
                  (item.streak % 5 === 0 ? (
                    <p className="mt-1 rounded-md bg-orange-50 px-2 py-1 text-xs font-bold text-orange-600">
                      🔥 连续打卡第 {item.streak} 天，本次可获得额外 3 星奖励！
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      连续打卡第 {item.streak} 天，继续加油！
                    </p>
                  ))}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.checkinDate} · 提交于 {formatTime(item.createdAt)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void onReject(item)}
                disabled={busyId !== null}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <XCircle className="size-4" aria-hidden="true" />
                驳回
              </button>
              <button
                type="button"
                onClick={() => void onApprove(item)}
                disabled={busyId !== null}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                确认并发放星星
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function ExchangeList({
  requests,
  busyId,
  onApprove,
  onReject,
}: {
  requests: ExchangeRequest[]
  busyId: string | null
  onApprove: (request: ExchangeRequest) => Promise<void>
  onReject: (request: ExchangeRequest) => Promise<void>
}) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card py-14">
        <span className="text-4xl" aria-hidden="true">
          🎁
        </span>
        <p className="text-base font-semibold">没有待审核的兑换申请</p>
        <p className="text-sm text-muted-foreground">孩子在星星商城提交后会出现在这里</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {requests.map((request) => (
        <li key={request.id} className="rounded-2xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg"
              aria-hidden="true"
            >
              🎁
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{request.reward_title}</p>
              <p className="mt-1 flex items-center gap-1 text-lg font-extrabold text-amber-500">
                {request.cost_stars}
                <span className="text-base" aria-hidden="true">
                  ⭐
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                申请于 {formatTime(request.created_at)}
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void onReject(request)}
              disabled={busyId !== null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <XCircle className="size-4" aria-hidden="true" />
              拒绝
            </button>
            <button
              type="button"
              onClick={() => void onApprove(request)}
              disabled={busyId !== null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              同意兑换
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function formatTime(iso: string): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
