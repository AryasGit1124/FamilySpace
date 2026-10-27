'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import {
  approveCheckin,
  fetchFamilyMembers,
  fetchPendingCheckins,
  rejectCheckin,
  type PendingCheckinItem,
} from '@/lib/supabase-queries'

/** 家长端打卡审核：待审核列表 + 确认发星 / 驳回 */
export default function ApprovalsPage() {
  const [items, setItems] = useState<PendingCheckinItem[]>([])
  const [childName, setChildName] = useState('孩子')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pending, members] = await Promise.all([fetchPendingCheckins(), fetchFamilyMembers()])
      setItems(pending)
      const child = members.find((m) => m.role === 'child')
      setChildName(child?.display_name?.trim() || '孩子')
    } catch (err) {
      console.error('[Approvals] 加载失败:', err)
      setFeedback({ type: 'error', text: '加载待审核打卡失败，请稍后重试' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 孩子新提交打卡时实时刷新列表
  useEffect(() => {
    const onChange = () => {
      void load()
    }
    window.addEventListener('checkins-changed', onChange)
    return () => window.removeEventListener('checkins-changed', onChange)
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

  return (
    <>
      <PageHeader title="打卡审核" subtitle="确认孩子的打卡后才发放星星" />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pb-6">
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
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card py-14">
            <span className="text-4xl" aria-hidden="true">
              🎉
            </span>
            <p className="text-base font-semibold">没有待审核的打卡</p>
            <p className="text-sm text-muted-foreground">孩子完成学习后会出现在这里</p>
          </div>
        ) : (
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
                        待发 {item.stars} ⭐
                      </span>
                    </div>
                    <p className="mt-1 truncate text-base font-medium">{item.taskTitle}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.checkinDate} · 提交于 {formatTime(item.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReject(item)}
                    disabled={busyId !== null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    驳回
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApprove(item)}
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
        )}
      </div>
    </>
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
