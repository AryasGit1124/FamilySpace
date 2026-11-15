'use client'

import { useMemo, useState } from 'react'
import { describeBillError } from '@/lib/bills'
import { insertManualBill, type BillCategory } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

/** 北京时间「YYYY-MM-DDTHH:mm」，不依赖设备时区 */
function nowLocalInput(): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 16)
}

/** 快捷记账：底部抽屉表单（支出 / 收入、金额、分类、说明、时间） */
export function ManualBillSheet({
  categories,
  onClose,
  onSaved,
}: {
  categories: BillCategory[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [direction, setDirection] = useState<'expense' | 'income'>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [commodity, setCommodity] = useState('')
  const [tradeTime, setTradeTime] = useState(nowLocalInput)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** 多级分类优先展示最末级（叶子）分类，没有子分类的旧数据也能平铺 */
  const leafCategories = useMemo(() => {
    const leaves = categories.filter(
      (item) => !categories.some((child) => child.parent_id === item.id),
    )
    return leaves.length > 0 ? leaves : categories
  }, [categories])

  const save = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('请输入大于 0 的金额')
      return
    }
    const time = new Date(tradeTime)
    if (Number.isNaN(time.getTime())) {
      setError('请选择交易时间')
      return
    }

    setSaving(true)
    setError('')
    try {
      await insertManualBill({
        direction,
        amount: Math.round(value * 100) / 100,
        commodity: commodity.trim() || null,
        categoryId: categoryId || null,
        tradeTime: time.toISOString(),
      })
      alert('记账成功')
      await onSaved()
      onClose()
    } catch (err) {
      setError(`保存失败：${describeBillError(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl sm:rounded-2xl sm:pb-4"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-base font-bold">记一笔</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto rounded-full px-2 py-0.5 text-muted-foreground active:bg-muted"
          >
            ✕
          </button>
        </div>

        {/* 收 / 支 大号切换 */}
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
          {(
            [
              { value: 'expense', label: '支出', active: 'bg-white text-red-500 shadow-sm' },
              { value: 'income', label: '收入', active: 'bg-white text-emerald-600 shadow-sm' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setDirection(item.value)}
              className={cn(
                'rounded-xl py-3 text-base font-bold transition-colors',
                direction === item.value ? item.active : 'text-muted-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 大号金额 */}
        <label className="mt-4 flex items-end gap-1 border-b pb-2">
          <span className="text-2xl font-bold text-muted-foreground">¥</span>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:text-muted-foreground/40"
          />
        </label>

        {/* 分类胶囊 */}
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">分类</p>
          {leafCategories.length === 0 ? (
            <p className="rounded-xl bg-muted px-3 py-3 text-xs text-muted-foreground">
              还没有分类，先去「规则定义」里建一个吧（也可以不选分类直接保存）
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {leafCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryId((prev) => (prev === category.id ? '' : category.id))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    categoryId === category.id
                      ? 'border-primary bg-primary text-white'
                      : 'border-slate-200 bg-white text-slate-600',
                  )}
                >
                  {category.emoji} {category.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="mt-4 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          交易说明
          <input
            value={commodity}
            onChange={(event) => setCommodity(event.target.value)}
            placeholder="如：买菜、买衣服"
            className="w-full rounded-xl border bg-white px-3 py-2.5 text-base outline-none focus:border-primary"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          交易时间
          <input
            type="datetime-local"
            value={tradeTime}
            onChange={(event) => setTradeTime(event.target.value)}
            className="w-full rounded-xl border bg-white px-3 py-2.5 text-base outline-none focus:border-primary"
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="mt-4 w-full rounded-2xl bg-primary py-3.5 text-base font-bold text-white active:bg-primary/90 disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
