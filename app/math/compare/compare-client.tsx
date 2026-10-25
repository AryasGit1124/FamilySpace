'use client'

import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { speakChinese, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { RoundComplete, RoundProgress, MathBackLink, MATH_ROUND_TOTAL } from '../game-ui'
import { useMathRound } from '../use-math-round'

type Symbol = '<' | '>' | '='
const SYMBOLS: Symbol[] = ['<', '>', '=']

type Question = {
  a: number
  b: number
}

function makeQuestion(): Question {
  let a = 1 + Math.floor(Math.random() * 20)
  let b = 1 + Math.floor(Math.random() * 20)
  // 确保两数不相邻（差值至少为 2）
  while (Math.abs(a - b) < 2) {
    b = 1 + Math.floor(Math.random() * 20)
  }
  // 随机交换位置，避免总把大数放右边
  return Math.random() < 0.5 ? { a, b } : { a: b, b: a }
}

export function CompareGame({ taskId }: { taskId: string | null }) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongSymbol, setWrongSymbol] = useState<Symbol | null>(null)
  const [hasTried, setHasTried] = useState(false)
  const timerRef = useRef<number | null>(null)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useMathRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion())
  }, [])

  /** 题目出现时自动播报；新题会打断上一题的"答对了"语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakChinese(`${question.a} 和 ${question.b}，哪个大？`)
    }
  }, [question])

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      stopSpeak()
    },
    [],
  )

  const nextQuestion = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setQuestion(makeQuestion())
      setLocked(false)
      setWrongSymbol(null)
      setHasTried(false)
    }, 800)
  }

  const choose = (symbol: Symbol) => {
    if (!question || locked) return
    const answer: Symbol = question.a > question.b ? '>' : '<'
    if (symbol === answer) {
      setLocked(true)
      speakChinese('答对了')
      addSolved(!hasTried)
      nextQuestion()
    } else {
      setWrongSymbol(symbol)
      setHasTried(true)
    }
  }

  const restart = () => {
    reset()
    setQuestion(makeQuestion())
    setLocked(false)
    setWrongSymbol(null)
    setHasTried(false)
  }

  return (
    <>
      <PageHeader title="比大小" subtitle="看一看，两个数谁更大" action={<MathBackLink />} />
      <div className="flex flex-col gap-5 px-5 pb-6">
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
              <div className="flex items-center justify-center gap-6">
                <span className="text-6xl font-bold">{question.a}</span>
                <span className="text-4xl text-muted-foreground">?</span>
                <span className="text-6xl font-bold">{question.b}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => speakChinese(`${question.a} 和 ${question.b}，哪个大？`)}
              >
                <Volume2 aria-hidden="true" />
                {question.a} 和 {question.b}，哪个大？
              </Button>
            </section>

            <div className="grid grid-cols-3 gap-3">
              {SYMBOLS.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => choose(symbol)}
                  onAnimationEnd={() =>
                    setWrongSymbol((cur) => (cur === symbol ? null : cur))
                  }
                  disabled={locked}
                  aria-label={`选择 ${symbol}`}
                  className={cn(
                    'flex h-20 items-center justify-center rounded-2xl border bg-background text-4xl font-bold transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongSymbol === symbol &&
                      'math-shake border-destructive bg-destructive/10 text-destructive',
                  )}
                >
                  {symbol}
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
