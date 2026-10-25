'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'
import { ChevronLeft, ChevronRight, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { fetchReviewChars, type LiteracyChar } from '@/lib/supabase-queries'
import { speakChar } from '@/lib/tts'
import { cn } from '@/lib/utils'

export default function LiteracyCardPage() {
  const [chars, setChars] = useState<LiteracyChar[]>([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const touchStartX = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const rows = await fetchReviewChars()
      setChars(rows)
      setIndex(0)
      setFlipped(false)
    } catch (err) {
      console.error('[LiteracyCard] 加载失败:', err)
      setError(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = chars[index]

  const go = (delta: number) => {
    if (chars.length === 0) return
    setFlipped(false)
    setIndex((i) => (i + delta + chars.length) % chars.length)
  }

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }

  const handleTouchEnd = (e: TouchEvent) => {
    const startX = touchStartX.current
    touchStartX.current = null
    if (startX === null) return
    const delta = (e.changedTouches[0]?.clientX ?? startX) - startX
    if (Math.abs(delta) < 50) return
    // 左滑看下一张，右滑看上一张
    go(delta < 0 ? 1 : -1)
  }

  return (
    <>
      <PageHeader title="字卡练习" subtitle="点卡片翻面看拼音，左右滑动切换" />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            正在加载字卡…
          </p>
        ) : !current ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">还没有「不认识」的字卡</p>
            <Link
              href="/games/literacy-test"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              先去识字测试标记不认识的字 →
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>
                {index + 1} / {chars.length}
              </span>
              <span className="text-muted-foreground">第 {current.level} 级</span>
            </div>

            {/* 可翻转卡片；左右滑动切换 */}
            <div
              className="[perspective:1000px]"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className="relative block h-64 w-full text-center"
                aria-label={`字卡 ${current.char}，点击翻面`}
              >
                <span
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-3xl border-2 bg-card transition-transform duration-500 [backface-visibility:hidden] [transform-style:preserve-3d]',
                    flipped && '[transform:rotateY(180deg)]',
                  )}
                >
                  <span className="text-8xl font-bold leading-none">{current.char}</span>
                </span>
                <span
                  className={cn(
                    'absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-primary/30 bg-primary/5 transition-transform duration-500 [backface-visibility:hidden] [transform-style:preserve-3d] [transform:rotateY(180deg)]',
                    flipped && '[transform:rotateY(0deg)]',
                  )}
                >
                  <span className="text-xs text-muted-foreground">拼音</span>
                  <span className="text-4xl font-semibold text-primary">{current.pinyin ?? '—'}</span>
                </span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="icon" onClick={() => go(-1)} aria-label="上一张">
                <ChevronLeft className="size-5" aria-hidden="true" />
              </Button>
              <Button className="flex-1" onClick={() => speakChar(current.char, current.pinyin)}>
                <Volume2 className="size-4" aria-hidden="true" />
                朗读
              </Button>
              <Button variant="outline" size="icon" onClick={() => go(1)} aria-label="下一张">
                <ChevronRight className="size-5" aria-hidden="true" />
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              左滑 / 右滑可切换字卡，点卡片翻面
            </p>
          </>
        )}
      </div>
    </>
  )
}
