'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Gamepad2, Sparkles, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { deleteTask } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type GameTask = {
  id: string
  title: string
  game_route: string | null
  created_at?: string | null
}

type Props = {
  subjectId: string
  subjectName: string
  games: GameTask[]
}

/** 学科页顶部「AI 生成新游戏」+ 该学科线上任务（含 AI 游戏）列表 */
export function AiGameSection({ subjectId, subjectName, games }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [age, setAge] = useState('4岁')
  const [difficulty, setDifficulty] = useState('初级')
  const [topic, setTopic] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 删除的两段式确认：先点垃圾桶进入确认态，再点「删除」执行 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (deletingId) return
    setDeletingId(id)
    setError('')
    try {
      await deleteTask(id)
      setConfirmingId(null)
      setNotice('已删除')
      router.refresh()
    } catch (err) {
      console.error('[AiGameSection] 删除任务失败:', err)
      setError(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeletingId(null)
    }
  }

  const trimmedTopic = topic.trim()

  const close = () => {
    if (!submitting) setOpen(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!trimmedTopic || submitting) return

    setSubmitting(true)
    setError('')
    setNotice('')

    try {
      const res = await fetch('/api/generate-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          subjectName,
          age: age.trim(),
          difficulty: difficulty.trim(),
          topic: trimmedTopic,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        title?: string
      }
      if (!res.ok) throw new Error(data.error ?? `生成失败（HTTP ${res.status}）`)

      setOpen(false)
      setTopic('')
      setNotice(`已生成「${data.title ?? '新游戏'}」，可在下方列表开始游戏`)
      // Server Component 重新查询 tasks 表，列表立即出现新游戏
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-labelledby="ai-game-title" className="flex flex-col gap-3">
      <div className="flex items-stretch gap-2">
        <Button className="flex-1" onClick={() => { setOpen(true); setError(''); setNotice('') }}>
          <Sparkles className="size-4" aria-hidden="true" />
          AI 生成新游戏
        </Button>
      </div>

      {notice && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      )}
      {error && !open && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="flex items-baseline justify-between px-1 pt-2">
        <h2 id="ai-game-title" className="text-lg font-bold">
          线上任务
        </h2>
        <span className="text-sm text-muted-foreground">{games.length} 个</span>
      </div>

      {games.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          还没有线上任务，点上面的按钮生成一个吧
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {games.map((game) => {
            // AI 生成游戏统一进万能渲染引擎 /games/dynamic/[id]（旧 /games/ai-play 内容也能解析）；子模块路由是整模块入口，直接跳
            const isPlayerRoute =
              game.game_route === '/games/ai-play' || game.game_route === '/games/dynamic'
            const href = game.game_route ? (isPlayerRoute ? `/games/dynamic/${game.id}` : game.game_route) : null
            const confirming = confirmingId === game.id
            return (
              <li
                key={game.id}
                className="flex items-center gap-3 rounded-xl border bg-card p-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Gamepad2 className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{game.title}</p>
                  {game.created_at && (
                    <p className="text-xs text-muted-foreground">{String(game.created_at).slice(0, 10)}</p>
                  )}
                </div>
                {confirming ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deletingId === game.id}
                      onClick={() => void handleDelete(game.id)}
                    >
                      {deletingId === game.id ? '删除中…' : '确认删除'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deletingId === game.id}
                      onClick={() => setConfirmingId(null)}
                    >
                      取消
                    </Button>
                  </span>
                ) : (
                  <>
                    {href ? (
                      <Link href={href} className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
                        开始
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">任务</span>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmingId(game.id)}
                      aria-label={`删除 ${game.title}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>AI 生成新游戏</DialogTitle>
              <DialogDescription>
                为「{subjectName}」生成 3-5 道题，题型由 AI 按学科自动选择
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-game-topic">知识点</Label>
              <Input
                id="ai-game-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例如：10以内加法"
                maxLength={40}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-game-age">孩子年龄</Label>
              <Input
                id="ai-game-age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="例如：4岁"
                maxLength={10}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-game-difficulty">难度</Label>
              <select
                id="ai-game-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <option value="初级">初级</option>
                <option value="中级">中级</option>
                <option value="高级">高级</option>
              </select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                取消
              </Button>
              <Button type="submit" disabled={!trimmedTopic || submitting}>
                {submitting ? '生成中…' : '生成'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
