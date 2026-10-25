'use client'

import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { updateTaskGameConfig } from '@/lib/supabase-queries'
import { speakChinese, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { MathBackLink, RoundComplete, RoundProgress, MATH_ROUND_TOTAL } from '../game-ui'
import { useMathRound } from '../use-math-round'

/** 三档难度 */
const DIFFICULTIES = [5, 10, 20] as const

type Operator = '+' | '-'

type Question = {
  a: number
  b: number
  operator: Operator
  answer: number
  options: number[]
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 正确项 + 两个附近范围的干扰项（保持在 0~maxNumber 内） */
function buildOptions(answer: number, maxNumber: number): number[] {
  const values = new Set<number>([answer])
  const deltas = [1, -1, 2, -2, 3, -3]
  let guard = 0
  while (values.size < 3 && guard < 100) {
    guard += 1
    const candidate = answer + deltas[Math.floor(Math.random() * deltas.length)]
    if (candidate >= 0 && candidate <= maxNumber) values.add(candidate)
  }
  while (values.size < 3) {
    const candidate = Math.floor(Math.random() * (maxNumber + 1))
    if (!values.has(candidate)) values.add(candidate)
  }
  return shuffle(Array.from(values))
}

/**
 * 依据 maxNumber 随机出加法或减法：
 * 加法两个加数与和都不超过 maxNumber；减法被减数不超过且结果不为负。
 */
function makeQuestion(maxNumber: number): Question {
  if (Math.random() < 0.5) {
    const a = 1 + Math.floor(Math.random() * (maxNumber - 1))
    const b = 1 + Math.floor(Math.random() * (maxNumber - a))
    const answer = a + b
    return { a, b, operator: '+', answer, options: buildOptions(answer, maxNumber) }
  }

  const a = 2 + Math.floor(Math.random() * (maxNumber - 1))
  const b = 1 + Math.floor(Math.random() * a)
  const answer = a - b
  return { a, b, operator: '-', answer, options: buildOptions(answer, maxNumber) }
}

/** 语音文案：3 加 2 等于几？ */
function speechOf(question: Question): string {
  return `${question.a} ${question.operator === '+' ? '加' : '减'} ${question.b} 等于几？`
}

export function AddSubtractGame({
  taskId,
  initialMaxNumber,
}: {
  taskId: string | null
  initialMaxNumber: number
}) {
  const [maxNumber, setMaxNumber] = useState(initialMaxNumber)
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<number | null>(null)
  const [hasTried, setHasTried] = useState(false)
  const timerRef = useRef<number | null>(null)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useMathRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion(initialMaxNumber))
  }, [initialMaxNumber])

  /** 新题出现时自动播报；新题会打断上一题的"答对了"语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakChinese(speechOf(question))
    }
  }, [question])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      stopSpeak()
    },
    [],
  )

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const nextQuestion = () => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      setQuestion(makeQuestion(maxNumber))
      setLocked(false)
      setWrongOption(null)
      setHasTried(false)
      timerRef.current = null
    }, 800)
  }

  const choose = (value: number) => {
    if (!question || locked) return
    if (value === question.answer) {
      setLocked(true)
      speakChinese('答对了')
      addSolved(!hasTried)
      nextQuestion()
    } else {
      setWrongOption(value)
      setHasTried(true)
    }
  }

  /** 切换难度：重新开始进度并持久化到 tasks.game_config */
  const changeDifficulty = (next: number) => {
    if (next === maxNumber) return
    clearTimer()
    setMaxNumber(next)
    reset()
    setQuestion(makeQuestion(next))
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)

    if (taskId) {
      updateTaskGameConfig(taskId, { maxNumber: next }).catch((err: unknown) => {
        console.error('[MathAdd] 保存难度失败:', err)
      })
    }
  }

  const restart = () => {
    clearTimer()
    reset()
    setQuestion(makeQuestion(maxNumber))
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  return (
    <>
      <PageHeader title="加减法" subtitle="算一算，等于几" action={<MathBackLink />} />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {/* 难度切换 */}
        <div className="flex gap-2">
          {DIFFICULTIES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => changeDifficulty(value)}
              aria-pressed={maxNumber === value}
              className={cn(
                'h-10 flex-1 rounded-xl text-sm font-semibold transition-colors',
                maxNumber === value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              {value} 以内
            </button>
          ))}
        </div>

        <RoundProgress done={solved} />

        {finished ? (
          <RoundComplete
            total={MATH_ROUND_TOTAL}
            firstTryCorrect={firstTryCorrect}
            earnedStars={earnedStars}
            checked={checked}
            checkingIn={checkingIn}
            error={error}
            testMode={isParent}
            onRestart={restart}
          />
        ) : question ? (
          <>
            <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8">
              <p className="text-5xl font-bold tracking-wide" aria-label={speechOf(question)}>
                {question.a} {question.operator} {question.b} ={' '}
                <span className="text-primary">?</span>
              </p>
              <Button size="sm" variant="outline" onClick={() => speakChinese(speechOf(question))}>
                <Volume2 aria-hidden="true" />
                再听一遍
              </Button>
            </section>

            <div className="grid grid-cols-3 gap-3">
              {question.options.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => choose(value)}
                  onAnimationEnd={() =>
                    setWrongOption((cur) => (cur === value ? null : cur))
                  }
                  disabled={locked}
                  className={cn(
                    'flex h-20 items-center justify-center rounded-2xl border bg-background text-3xl font-bold transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongOption === value &&
                      'math-shake border-destructive bg-destructive/10 text-destructive',
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            <p className="text-center text-xs text-muted-foreground">答对 5 题即完成今日打卡</p>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">题目准备中…</p>
        )}
      </div>
    </>
  )
}
