'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { isCorrectOption, type ChoiceItem, type OnComplete } from '@/lib/dynamic-game'
import { speakByContent } from '@/lib/game-speech'
import { stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F']

type Props = {
  data: ChoiceItem[]
  onComplete: OnComplete
}

/** 选择题：一次一题，答错抖动不切题，答对后进入下一题 */
export function ChoiceGame({ data, onComplete }: Props) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  /** 用 ref 保存实时值，避免最后一题结算时读到旧 state */
  const firstTryRef = useRef(0)

  const item = data[index]
  const isLast = index === data.length - 1
  const solved = picked !== null && isCorrectOption(item.options[picked], picked, item.answer)

  useEffect(() => {
    speakByContent(item.question)
    // 只在切题时播报
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  useEffect(() => () => stopSpeak(), [])

  const pick = (i: number) => {
    if (solved) return
    const correct = isCorrectOption(item.options[i], i, item.answer)
    if (correct) {
      if (!attempted) {
        firstTryRef.current += 1
        setFirstTryCorrect(firstTryRef.current)
      }
      speakByContent('答对啦')
    } else {
      setAttempted(true)
    }
    setPicked(i)
  }

  const next = () => {
    stopSpeak()
    if (isLast) {
      onComplete(data.length, firstTryRef.current)
      return
    }
    setPicked(null)
    setAttempted(false)
    setIndex((v) => v + 1)
  }

  return (
    <>
      <div className="flex items-center justify-between text-sm">
        <span>
          第 {index + 1} / {data.length} 题
        </span>
        <span className="text-muted-foreground">已答对 {index} 题</span>
      </div>
      <Progress value={Math.round((index / data.length) * 100)} aria-label={`进度 ${index}/${data.length}`} />

      <p className="text-xl font-semibold leading-relaxed text-balance">{item.question}</p>

      <div className="flex flex-col gap-3">
        {item.options.map((option, i) => {
          const correct = isCorrectOption(option, i, item.answer)
          const showCorrect = solved && correct
          const showWrong = picked === i && !correct
          return (
            <button
              key={`option-${i}`}
              type="button"
              onClick={() => pick(i)}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left text-lg font-medium transition-colors',
                showCorrect && 'border-emerald-500 bg-emerald-50 text-emerald-800',
                showWrong && 'math-shake border-destructive bg-destructive/10 text-destructive',
                !showCorrect && !showWrong && 'border-border bg-card hover:bg-muted/60',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {optionLetters[i] ?? i + 1}
              </span>
              <span className="flex-1">{option}</span>
            </button>
          )
        })}
      </div>

      <div className="min-h-6">
        {solved ? (
          <p className="text-sm font-medium text-emerald-600">答对啦！</p>
        ) : picked !== null ? (
          <p className="text-sm font-medium text-destructive">再想一想～</p>
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
