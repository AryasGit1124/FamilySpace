'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import type { MatchingItem, OnComplete } from '@/lib/dynamic-game'
import { speakByContent } from '@/lib/game-speech'
import { stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

type Props = {
  data: MatchingItem[]
  onComplete: OnComplete
}

/** 稳定的字符串散列，用于确定性地打乱右列顺序（服务端/客户端结果一致，避免 hydration 不一致） */
function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 100000
  return hash
}

/** 连线题：左右两列，先点左边再点右边；配错抖动，全部配对完成后通关 */
export function MatchingGame({ data, onComplete }: Props) {
  const [matchedLeft, setMatchedLeft] = useState<number[]>([])
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null)
  const [attemptedLeft, setAttemptedLeft] = useState<number[]>([])
  const [wrongRight, setWrongRight] = useState<number | null>(null)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const firstTryRef = useRef(0)

  const rightOrder = useMemo(() => {
    const order = data.map((_, i) => i)
    order.sort((a, b) => hashString(`${data[a].right}${a}`) - hashString(`${data[b].right}${b}`))
    return order
  }, [data])

  useEffect(() => () => stopSpeak(), [])

  const pickLeft = (i: number) => {
    if (matchedLeft.includes(i)) return
    setSelectedLeft(i)
    speakByContent(data[i].left)
  }

  const pickRight = (orderIndex: number) => {
    if (selectedLeft === null) return
    const pairIndex = rightOrder[orderIndex]
    if (matchedLeft.includes(pairIndex)) return

    if (pairIndex === selectedLeft) {
      if (!attemptedLeft.includes(selectedLeft)) {
        firstTryRef.current += 1
        setFirstTryCorrect(firstTryRef.current)
      }
      const nextMatched = [...matchedLeft, selectedLeft]
      setMatchedLeft(nextMatched)
      speakByContent(data[selectedLeft].right)
      setSelectedLeft(null)
      if (nextMatched.length === data.length) {
        // 全部配对完成 → 交给父组件结算
        onComplete(data.length, firstTryRef.current)
      }
    } else {
      if (!attemptedLeft.includes(selectedLeft)) {
        setAttemptedLeft((prev) => [...prev, selectedLeft])
      }
      setWrongRight(orderIndex)
      window.setTimeout(() => setWrongRight(null), 400)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between text-sm">
        <span>
          已连对 {matchedLeft.length} / {data.length} 组
        </span>
        <span className="text-muted-foreground">先点左边，再点右边</span>
      </div>
      <Progress value={Math.round((matchedLeft.length / data.length) * 100)} aria-label="连线进度" />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          {data.map((pair, i) => {
            const matched = matchedLeft.includes(i)
            const selected = selectedLeft === i
            return (
              <button
                key={`left-${i}`}
                type="button"
                onClick={() => pickLeft(i)}
                disabled={matched}
                className={cn(
                  'rounded-2xl border-2 p-3 text-base font-medium transition-colors',
                  matched && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                  selected && !matched && 'border-primary bg-primary/10',
                  !matched && !selected && 'border-border bg-card hover:bg-muted/60',
                )}
              >
                {pair.left}
              </button>
            )
          })}
        </div>
        <div className="flex flex-col gap-2">
          {rightOrder.map((pairIndex, orderIndex) => {
            const matched = matchedLeft.includes(pairIndex)
            return (
              <button
                key={`right-${pairIndex}`}
                type="button"
                onClick={() => pickRight(orderIndex)}
                disabled={matched}
                className={cn(
                  'rounded-2xl border-2 p-3 text-base font-medium transition-colors',
                  matched && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                  wrongRight === orderIndex && 'math-shake border-destructive bg-destructive/10 text-destructive',
                  !matched && wrongRight !== orderIndex && 'border-border bg-card hover:bg-muted/60',
                )}
              >
                {data[pairIndex].right}
              </button>
            )
          })}
        </div>
      </div>

      <p className="min-h-6 text-sm text-muted-foreground">
        {wrongRight !== null ? '配对不正确，再试试～' : '点一个左边的词，再点它对应的右边'}
      </p>
    </>
  )
}
