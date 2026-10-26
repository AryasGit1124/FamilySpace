'use client'

import { useEffect, useRef, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import { isCorrectOption, type FillItem, type OnComplete } from '@/lib/dynamic-game'
import { speakByContent, speakByContentAsync } from '@/lib/game-speech'
import { stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

type Props = {
  data: FillItem[]
  onComplete: OnComplete
}

/** 把题目文本按 __ 占位切成多段，中间渲染填空槽 */
function splitBlank(text: string): { before: string; after: string } {
  const match = /_{2,}/.exec(text)
  if (!match) return { before: text, after: '' }
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + match[0].length),
  }
}

/** 填空题：点击选项填入空格，答对自动继续下一题 */
export function FillGame({ data, onComplete }: Props) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const firstTryRef = useRef(0)

  const item = data[index]
  const isLast = index === data.length - 1
  const solved = picked !== null && isCorrectOption(item.options[picked], picked, item.answer)
  const { before, after } = splitBlank(item.text)

  useEffect(() => {
    speakByContent(item.text.replace(/_{2,}/g, ' 空 '))
    // 只在切题时播报
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // 卸载时停止语音
  useEffect(() => () => stopSpeak(), [])

  const pick = async (i: number) => {
    if (solved) return
    const correct = isCorrectOption(item.options[i], i, item.answer)
    if (correct) {
      if (!attempted) {
        firstTryRef.current += 1
        setFirstTryCorrect(firstTryRef.current)
      }
      setPicked(i)
      // 语音播完再自动进入下一题，播报期间选项保持禁用
      await speakByContentAsync('答对啦')
      stopSpeak()
      if (isLast) {
        onComplete(data.length, firstTryRef.current)
      } else {
        setPicked(null)
        setAttempted(false)
        setIndex((v) => v + 1)
      }
    } else {
      setAttempted(true)
      setPicked(i)
    }
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

      <p className="flex flex-wrap items-center gap-1 text-2xl font-semibold leading-relaxed">
        <span>{before}</span>
        <span
          className={cn(
            'inline-flex min-w-16 items-center justify-center rounded-lg border-b-4 px-2',
            solved
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-muted-foreground/50 bg-muted/40 text-muted-foreground',
          )}
        >
          {solved ? item.options[picked as number] : '?'}
        </span>
        <span>{after}</span>
      </p>

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
              disabled={solved}
              className={cn(
                'w-full rounded-2xl border-2 p-4 text-center text-xl font-semibold transition-colors',
                showCorrect && 'border-emerald-500 bg-emerald-50 text-emerald-800',
                showWrong && 'math-shake border-destructive bg-destructive/10 text-destructive',
                !showCorrect && !showWrong && 'border-border bg-card hover:bg-muted/60',
              )}
            >
              {option}
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
    </>
  )
}
