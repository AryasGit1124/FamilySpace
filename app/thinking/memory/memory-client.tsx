'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth-provider'
import { MEMORY_EMOJIS } from '@/lib/memory-emojis'
import { handleGameCheckin } from '@/lib/rewards'
import { speakChinese } from '@/lib/tts'
import { cn } from '@/lib/utils'

/** 每局 8 对，共 16 张牌（4x4） */
const PAIR_COUNT = 8
/** 两张不一样时，1 秒后自动盖回去 */
const FLIP_BACK_DELAY = 1000

type Card = {
  /** 每张牌唯一（同图案两张牌 key 不同） */
  key: number
  emoji: string
  name: string
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 随机抽 8 个图案，复制一份后洗牌，组成 16 张牌 */
function buildDeck(): Card[] {
  const picked = shuffle(MEMORY_EMOJIS).slice(0, PAIR_COUNT)
  const pairs = picked.flatMap((item, index) => [
    { key: index * 2, emoji: item.emoji, name: item.name },
    { key: index * 2 + 1, emoji: item.emoji, name: item.name },
  ])
  return shuffle(pairs)
}

export function MemoryGame({ taskId }: { taskId: string | null }) {
  const { role } = useAuth()
  const isParent = role === 'parent'
  // 牌面在客户端生成（useEffect），避免随机内容导致 hydration 不匹配
  const [deck, setDeck] = useState<Card[]>([])
  /** 当前翻开的牌下标（最多 2 张） */
  const [flipped, setFlipped] = useState<number[]>([])
  /** 已配对成功的牌下标 */
  const [matched, setMatched] = useState<Set<number>>(new Set())
  /** 曾经在失败配对中翻开过的牌 key（用于判断「首答配对」） */
  const [exposed, setExposed] = useState<Set<number>>(new Set())
  /** 首次配对成功的对数（两张牌都没见过就配对上） */
  const [firstTryMatches, setFirstTryMatches] = useState(0)
  /** 两张不匹配等待盖回时锁定点击 */
  const [locked, setLocked] = useState(false)
  const [finished, setFinished] = useState(false)
  const [earnedStars, setEarnedStars] = useState(0)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checked, setChecked] = useState(false)
  const [checkinError, setCheckinError] = useState('')
  const flipBackTimer = useRef<number | null>(null)

  const newGame = () => {
    if (flipBackTimer.current !== null) {
      window.clearTimeout(flipBackTimer.current)
      flipBackTimer.current = null
    }
    setDeck(buildDeck())
    setFlipped([])
    setMatched(new Set())
    setExposed(new Set())
    setFirstTryMatches(0)
    setLocked(false)
    setFinished(false)
    setChecked(false)
    setEarnedStars(0)
    setCheckinError('')
  }

  useEffect(() => {
    newGame()
    return () => {
      if (flipBackTimer.current !== null) window.clearTimeout(flipBackTimer.current)
    }
  }, [])

  const flipCard = (index: number) => {
    if (locked || finished) return
    if (flipped.includes(index) || matched.has(index)) return

    const next = [...flipped, index]
    setFlipped(next)
    if (next.length < 2) return

    const [a, b] = next
    if (deck[a].name === deck[b].name) {
      // 配对成功：保持翻开，播报图案名称
      // 两张牌都没在失败配对中出现过 → 首答配对
      const wasFirstTry = !exposed.has(deck[a].key) && !exposed.has(deck[b].key)
      if (wasFirstTry) setFirstTryMatches((c) => c + 1)
      const newMatched = new Set(matched)
      newMatched.add(a)
      newMatched.add(b)
      setMatched(newMatched)
      setFlipped([])
      speakChinese(`答对啦，${deck[a].name}`)
      if (newMatched.size === deck.length) {
        setFinished(true)
        speakChinese('太棒了，全部找到啦！')
      }
    } else {
      // 不一样：标记为已暴露，锁定点击，1 秒后盖回去
      setExposed((prev) => {
        const s = new Set(prev)
        s.add(deck[a].key)
        s.add(deck[b].key)
        return s
      })
      setLocked(true)
      flipBackTimer.current = window.setTimeout(() => {
        flipBackTimer.current = null
        setFlipped([])
        setLocked(false)
      }, FLIP_BACK_DELAY)
    }
  }

  const doCheckin = () => {
    if (!taskId) {
      setCheckinError('没找到打卡任务，本次进度未写入')
      return
    }
    setCheckingIn(true)
    handleGameCheckin(taskId, PAIR_COUNT, firstTryMatches, isParent)
      .then((stars) => {
        setEarnedStars(stars)
        setChecked(true)
      })
      .catch((err: unknown) => {
        console.error('[Memory] 打卡失败:', err)
        setCheckinError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setCheckingIn(false))
  }

  const matchedPairs = matched.size / 2

  return (
    <>
      <PageHeader
        title="记忆翻牌"
        subtitle={`已配对 ${matchedPairs} / ${PAIR_COUNT} 对`}
        backHref="/thinking"
        backLabel="返回思维乐园"
      />
      <div className="flex flex-col gap-4 px-5 pb-6">
        {finished ? (
          <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
            <span className="text-5xl" aria-hidden="true">
              🎉
            </span>
            <h2 className="text-xl font-bold">太棒了，全部找到啦！</h2>
            <p className="text-sm text-muted-foreground">
              本次配对 {PAIR_COUNT} 对（首答配对 {firstTryMatches} 对）
            </p>
            {checked && (
              <p className="text-base font-semibold text-amber-600">
                等待家长确认后可获得 {earnedStars} 颗星星 ⭐
              </p>
            )}
            {checked ? (
              <p className="text-sm font-medium text-emerald-600">打卡成功，等待家长确认 ⏳</p>
            ) : (
              <Button className="mt-1" disabled={checkingIn} onClick={doCheckin}>
                {checkingIn ? '正在打卡…' : '完成打卡'}
              </Button>
            )}
            {checkinError && <p className="text-sm text-destructive">{checkinError}</p>}
            <Button variant="outline" onClick={newGame}>
              <RotateCcw className="size-4" aria-hidden="true" />
              再玩一局
            </Button>
          </section>
        ) : (
          <>
            {deck.length === 0 ? (
              // 牌面生成前的占位，避免布局跳动
              <div className="grid grid-cols-4 gap-2" aria-hidden="true">
                {Array.from({ length: 16 }, (_, i) => (
                  <div key={i} className="aspect-square rounded-2xl bg-muted/60" />
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-4 gap-2" role="list" aria-label="记忆翻牌棋盘">
                {deck.map((card, index) => {
                  const isUp = flipped.includes(index) || matched.has(index)
                  const isMatched = matched.has(index)
                  return (
                    <li key={card.key} className="aspect-square perspective-normal">
                      <button
                        type="button"
                        onClick={() => flipCard(index)}
                        aria-label={isUp ? card.name : `第 ${index + 1} 张卡片，未翻开`}
                        className={cn(
                          'relative h-full w-full transition-transform duration-500 transform-3d',
                          isUp && 'rotate-y-180',
                        )}
                      >
                        {/* 背面（默认朝上） */}
                        <span
                          className="absolute inset-0 flex items-center justify-center rounded-2xl border bg-gradient-to-br from-purple-400 to-indigo-500 text-2xl text-white shadow-sm backface-hidden"
                          aria-hidden="true"
                        >
                          ❓
                        </span>
                        {/* 正面（翻过来后朝上） */}
                        <span
                          className={cn(
                            'absolute inset-0 flex items-center justify-center rounded-2xl border bg-card text-3xl shadow-sm backface-hidden rotate-y-180',
                            isMatched && 'ring-2 ring-emerald-400',
                          )}
                          aria-hidden="true"
                        >
                          {card.emoji}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <Button variant="outline" className="self-center" onClick={newGame}>
              <RotateCcw className="size-4" aria-hidden="true" />
              重新洗牌
            </Button>
          </>
        )}
      </div>
    </>
  )
}
