'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** 每个英语小游戏通关需要答对的题数 */
export const ENGLISH_ROUND_TOTAL = 5

/** 顶部进度圆点 */
export function RoundProgress({ done }: { done: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">进度</span>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: ENGLISH_ROUND_TOTAL }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-2.5 rounded-full transition-colors',
              i < done ? 'bg-emerald-500' : 'bg-muted',
            )}
          />
        ))}
      </div>
      <span className="ml-auto text-xs text-muted-foreground">
        {Math.min(done, ENGLISH_ROUND_TOTAL)} / {ENGLISH_ROUND_TOTAL}
      </span>
    </div>
  )
}

/** 通关卡片：显示首答正确率 + 获得星星 */
export function RoundComplete({
  total,
  firstTryCorrect,
  earnedStars,
  checked,
  checkingIn,
  error,
  testMode = false,
  onRestart,
}: {
  total: number
  firstTryCorrect: number
  earnedStars: number
  checked: boolean
  checkingIn: boolean
  error: string
  /** 家长端测试模式：星星仅展示未真正发放 */
  testMode?: boolean
  onRestart: () => void
}) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
      <span className="text-5xl" aria-hidden="true">
        🎉
      </span>
      <h2 className="text-xl font-bold">通关啦！</h2>
      <p className="text-sm text-muted-foreground">
        本次答对 {total} 题（首答正确 {firstTryCorrect} 题）
      </p>
      {checked && (
        <p className="text-base font-bold text-amber-500">
          获得 {earnedStars} 颗星星{'⭐'.repeat(Math.min(earnedStars, 5))}
        </p>
      )}
      {checkingIn && <p className="text-sm text-muted-foreground">正在结算…</p>}
      {checked && (
        <p className={cn('text-sm font-medium', testMode ? 'text-orange-500' : 'text-emerald-600')}>
          {testMode ? '测试模式：星星未真正发放' : '今日打卡完成 ✅'}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="mt-2" onClick={onRestart}>
        再玩一次
      </Button>
    </section>
  )
}

/** 小游戏顶部返回字母乐园 */
export function AlphabetBackLink() {
  return (
    <Link
      href="/english/alphabet"
      className="flex items-center gap-1 rounded-lg border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      字母乐园
    </Link>
  )
}
