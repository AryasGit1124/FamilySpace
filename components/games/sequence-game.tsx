'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { OnComplete, SequenceItem } from '@/lib/dynamic-game'
import { speakByContent } from '@/lib/game-speech'
import { stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

type Props = {
  data: SequenceItem[]
  onComplete: OnComplete
}

/** 排序题：上方空槽位，下方打乱卡片；按正确顺序点击填入，顺序全对即通关 */
export function SequenceGame({ data, onComplete }: Props) {
  const [index, setIndex] = useState(0)
  /** 已按顺序选中的 scrambled 下标 */
  const [built, setBuilt] = useState<number[]>([])
  const [attempted, setAttempted] = useState(false)
  const [wrongChip, setWrongChip] = useState<number | null>(null)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const firstTryRef = useRef(0)

  const item = data[index]
  const isLast = index === data.length - 1
  const solved = built.length === item.sequence.length

  useEffect(() => {
    speakByContent('请按正确顺序排列下面的内容')
    // 只在切题时播报
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  useEffect(() => () => stopSpeak(), [])

  const tapChip = (chipIndex: number) => {
    if (solved || built.includes(chipIndex)) return
    const expected = item.sequence[built.length]
    if (item.scrambled[chipIndex] === expected) {
      const nextBuilt = [...built, chipIndex]
      setBuilt(nextBuilt)
      if (nextBuilt.length === item.sequence.length) {
        if (!attempted) {
          firstTryRef.current += 1
          setFirstTryCorrect(firstTryRef.current)
        }
        speakByContent('排好了，真棒')
      }
    } else {
      setAttempted(true)
      setWrongChip(chipIndex)
      window.setTimeout(() => setWrongChip(null), 400)
    }
  }

  const next = () => {
    stopSpeak()
    if (isLast) {
      onComplete(data.length, firstTryRef.current)
      return
    }
    setBuilt([])
    setAttempted(false)
    setWrongChip(null)
    setIndex((v) => v + 1)
  }

  return (
    <>
      <div className="flex items-center justify-between text-sm">
        <span>
          第 {index + 1} / {data.length} 题
        </span>
        <span className="text-muted-foreground">已通关 {index} 题</span>
      </div>
      <Progress value={Math.round((index / data.length) * 100)} aria-label={`进度 ${index}/${data.length}`} />

      <p className="text-lg font-semibold">按正确顺序点击下面的卡片</p>

      {/* 上方序列槽位 */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-dashed bg-muted/30 p-3">
        {item.sequence.map((_, slotIndex) => {
          const chipIndex = built[slotIndex]
          const filled = chipIndex !== undefined
          return (
            <span
              key={`slot-${slotIndex}`}
              className={cn(
                'flex min-w-16 items-center justify-center rounded-xl border-2 px-3 py-3 text-lg font-semibold',
                filled
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-muted-foreground/30 bg-card text-muted-foreground',
              )}
            >
              {filled ? item.scrambled[chipIndex] : slotIndex + 1}
            </span>
          )
        })}
      </div>

      {/* 下方打乱卡片 */}
      <div className="flex flex-wrap gap-2">
        {item.scrambled.map((value, chipIndex) => {
          const used = built.includes(chipIndex)
          return (
            <button
              key={`chip-${chipIndex}`}
              type="button"
              onClick={() => tapChip(chipIndex)}
              disabled={used}
              className={cn(
                'rounded-xl border-2 px-4 py-3 text-lg font-semibold transition-colors',
                used && 'border-muted bg-muted text-muted-foreground opacity-40',
                wrongChip === chipIndex && 'math-shake border-destructive bg-destructive/10 text-destructive',
                !used && wrongChip !== chipIndex && 'border-border bg-card hover:bg-muted/60',
              )}
            >
              {value}
            </button>
          )
        })}
      </div>

      <div className="min-h-6">
        {solved ? (
          <p className="text-sm font-medium text-emerald-600">排对啦！</p>
        ) : wrongChip !== null ? (
          <p className="text-sm font-medium text-destructive">顺序不对，再想一想～</p>
        ) : null}
      </div>

      {solved && (
        <Button size="lg" className="w-full" onClick={next}>
          {isLast ? '完成游戏' : '下一题'}
        </Button>
      )}
    </>
  )
}
