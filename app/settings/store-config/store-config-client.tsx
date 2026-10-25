'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { History, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  deleteReward,
  insertReward,
  updateReward,
  type RewardItem,
  type StarLedgerEntry,
} from '@/lib/supabase-queries'

type Props = {
  rewards: RewardItem[]
  records: StarLedgerEntry[]
}

const DEFAULT_STOCK = '10'
const DEFAULT_ICON = '🎁'

/** 下拉可选的奖励图标 */
const ICON_OPTIONS = [
  { emoji: '🍦', label: '冰淇淋' },
  { emoji: '🧸', label: '玩具' },
  { emoji: '🍭', label: '糖果' },
  { emoji: '🍫', label: '巧克力' },
  { emoji: '🍕', label: '好吃的' },
  { emoji: '🎮', label: '游戏时间' },
  { emoji: '📺', label: '动画片' },
  { emoji: '🎨', label: '画画' },
  { emoji: '🎡', label: '游乐园' },
  { emoji: '🚲', label: '骑车' },
  { emoji: '🏞️', label: '出去玩' },
  { emoji: '🎁', label: '其他礼物' },
] as const

/** 固定按北京时间格式化，避免服务端/客户端时区不同导致 hydration 不一致 */
function formatTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** 家长端商城配置：奖励列表增删改 + 最近的兑换记录 */
export function StoreConfigClient({ rewards, records }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  /** 非空表示当前在编辑某条奖励，空表示新增 */
  const [editing, setEditing] = useState<RewardItem | null>(null)
  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [costStars, setCostStars] = useState('')
  const [stock, setStock] = useState(DEFAULT_STOCK)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const cost = Number(costStars)
  const stockCount = Number(stock)
  const valid =
    title.trim().length > 0 &&
    costStars.trim() !== '' &&
    Number.isInteger(cost) &&
    cost > 0 &&
    stock.trim() !== '' &&
    Number.isInteger(stockCount) &&
    stockCount >= 0

  // 编辑的奖励如果用了列表外的图标，把它补进下拉选项，避免下拉框显示空白
  const iconOptions = ICON_OPTIONS.some((option) => option.emoji === icon)
    ? ICON_OPTIONS
    : [{ emoji: icon, label: '当前图标' }, ...ICON_OPTIONS]

  const resetForm = () => {
    setTitle('')
    setIcon(DEFAULT_ICON)
    setCostStars('')
    setStock(DEFAULT_STOCK)
    setError('')
  }

  const close = () => {
    if (!submitting) {
      resetForm()
      setEditing(null)
      setOpen(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    resetForm()
    setNotice('')
    setOpen(true)
  }

  const openEdit = (reward: RewardItem) => {
    setEditing(reward)
    setTitle(reward.title)
    setIcon(reward.icon || DEFAULT_ICON)
    setCostStars(String(reward.cost_stars))
    setStock(String(reward.stock))
    setError('')
    setNotice('')
    setOpen(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || submitting) return

    setSubmitting(true)
    setError('')
    setNotice('')
    const payload = {
      icon: icon.trim() || DEFAULT_ICON,
      title: title.trim(),
      cost_stars: cost,
      stock: stockCount,
    }

    try {
      if (editing) {
        await updateReward(editing.id, payload)
        setNotice(`已更新「${payload.title}」`)
      } else {
        await insertReward(payload)
        setNotice(`已添加「${payload.title}」`)
      }
      resetForm()
      setEditing(null)
      setOpen(false)
      router.refresh()
    } catch (err) {
      console.error('[StoreConfig] 保存奖励失败:', err)
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (reward: RewardItem) => {
    if (deletingId) return
    if (!window.confirm(`确定删除奖励「${reward.title}」吗？删除后孩子将看不到它。`)) return

    setDeletingId(reward.id)
    setError('')
    setNotice('')
    try {
      await deleteReward(reward.id)
      setNotice(`已删除「${reward.title}」`)
      router.refresh()
    } catch (err) {
      console.error('[StoreConfig] 删除奖励失败:', err)
      setError(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-5 pb-3">
        <h2 className="text-lg font-bold">奖励列表</h2>
        <Button onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          新增奖励
        </Button>
      </div>

      {notice && (
        <p className="mx-5 mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      )}
      {error && (
        <p className="mx-5 mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {rewards.length === 0 ? (
        <p className="mx-5 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          还没有奖励，点右上角「新增奖励」添加一个吧
        </p>
      ) : (
        <ul className="flex flex-col gap-2 px-5">
          {rewards.map((reward) => (
            <li key={reward.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-2xl"
                aria-hidden="true"
              >
                {reward.icon || '🎁'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{reward.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ⭐ {reward.cost_stars} · 剩余库存 {reward.stock}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-primary"
                  disabled={deletingId === reward.id}
                  onClick={() => openEdit(reward)}
                  aria-label={`修改 ${reward.title}`}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={deletingId === reward.id}
                  onClick={() => void handleDelete(reward)}
                  aria-label={`删除 ${reward.title}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="redemption-title" className="px-5 pt-8 pb-6">
        <div className="flex items-center gap-2">
          <History className="size-5 text-primary" aria-hidden="true" />
          <h2 id="redemption-title" className="text-lg font-bold">
            兑换记录
          </h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">最近 20 条消耗星星的记录</p>

        {records.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有兑换记录
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {records.map((record) => (
              <li key={record.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-lg" aria-hidden="true">
                  🧾
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {record.reason.replace(/^兑换:\s*/, '')}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatTime(record.created_at)}</p>
                </div>
                <span className="shrink-0 text-sm font-bold text-amber-600">
                  {Math.abs(record.amount)} ⭐
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{editing ? '编辑奖励' : '新增奖励'}</DialogTitle>
              <DialogDescription>
                {editing ? '修改后星星商城会立即更新' : '添加后孩子就能在星星商城看到它'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reward-title">奖励名称</Label>
              <Input
                id="reward-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：吃一个冰淇淋"
                maxLength={40}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reward-icon">Emoji 图标</Label>
              <Select value={icon} onValueChange={(value) => setIcon(value ?? DEFAULT_ICON)}>
                <SelectTrigger id="reward-icon" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {iconOptions.map((option) => (
                    <SelectItem key={option.emoji} value={option.emoji}>
                      <span className="text-lg leading-none">{option.emoji}</span>
                      <span>{option.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="reward-cost">需要星星数</Label>
                <Input
                  id="reward-cost"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={costStars}
                  onChange={(e) => setCostStars(e.target.value)}
                  placeholder="5"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reward-stock">库存数量</Label>
                <Input
                  id="reward-stock"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                取消
              </Button>
              <Button type="submit" disabled={!valid || submitting}>
                {submitting ? '保存中…' : editing ? '保存修改' : '确认添加'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
