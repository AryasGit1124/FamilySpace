'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CheckCircle2, PartyPopper, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAuth } from '@/components/auth-provider'
import { handleGameCheckin } from '@/lib/rewards'
import { cn } from '@/lib/utils'

export type AiGameQuestion = {
  id: number | string
  text: string
  options: string[]
  answer: string
}

const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F']

/** answer 兼容三种写法：选项原文、"A/B/C" 字母、0/1/2 下标 */
function isCorrectOption(option: string, index: number, answer: string) {
  const expected = answer.trim()
  if (!expected) return false
  if (option.trim() === expected) return true
  if (/^[A-Za-z]$/.test(expected)) return index === expected.toUpperCase().charCodeAt(0) - 65
  if (/^\d+$/.test(expected)) return index === Number(expected)
  return false
}

type Props = {
  taskId: string
  subjectId?: string | null
  title: string
  questions: AiGameQuestion[]
}

export function AiGamePlayer({ taskId, subjectId, title, questions }: Props) {
  const { role } = useAuth()
  const isParent = role === 'parent'
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checked, setChecked] = useState(false)
  const [earnedStars, setEarnedStars] = useState(0)
  const [error, setError] = useState('')
  /** 首答正确数：当前题第一次点击就选对的累计 */
  const [firstTryCorrectCount, setFirstTryCorrectCount] = useState(0)
  /** 当前题是否已经点错过 */
  const [hasTriedCurrentQuestion, setHasTriedCurrentQuestion] = useState(false)

  const question = questions[index]
  const isLast = index === questions.length - 1
  const solved = picked !== null && isCorrectOption(question.options[picked], picked, question.answer)
  const percent = finished ? 100 : Math.round((index / questions.length) * 100)
  const totalQuestions = questions.length

  const next = () => {
    setPicked(null)
    setError('')
    setHasTriedCurrentQuestion(false)
    if (isLast) setFinished(true)
    else setIndex((i) => i + 1)
  }

  const restart = () => {
    setIndex(0)
    setPicked(null)
    setFinished(false)
    setChecked(false)
    setEarnedStars(0)
    setError('')
    setFirstTryCorrectCount(0)
    setHasTriedCurrentQuestion(false)
  }

  /** 全部答对后打卡：按首答正确率发放星星 */
  const handleCheckin = async () => {
    if (saving || checked) return
    setSaving(true)
    setError('')
    try {
      const stars = await handleGameCheckin(taskId, totalQuestions, firstTryCorrectCount, isParent)
      setEarnedStars(stars)
      setChecked(true)
    } catch (err) {
      console.error('[AiGamePlayer] 打卡失败:', err)
      setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  if (finished) {
    return (
      <div className="flex flex-col gap-5 px-5 pt-8 pb-6">
        <header className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">AI 互动小游戏</p>
          <h1 className="text-2xl font-bold">{title}</h1>
        </header>

        <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center">
          <PartyPopper className="size-10 text-primary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-xl font-bold">全部答对，太棒了！</p>
            <p className="text-sm text-muted-foreground">
              本次答对 {totalQuestions} 题（首答正确 {firstTryCorrectCount} 题）
            </p>
            {checked && (
              <p className="text-base font-semibold text-amber-600">
                家长审核通过后可获得 {earnedStars} 颗星星 ⭐
              </p>
            )}
          </div>

          {checked ? (
            <>
              <Badge variant="secondary" className="text-emerald-700">
                打卡成功，等待家长审核
              </Badge>
              {subjectId && (
                <Link
                  href={`/subject/${subjectId}`}
                  className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
                >
                  返回学科
                </Link>
              )}
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={handleCheckin} disabled={saving}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {saving ? '打卡中…' : '完成打卡'}
            </Button>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button variant="ghost" onClick={restart}>
            <RotateCcw className="size-4" aria-hidden="true" />
            再玩一次
          </Button>
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-5 pt-8 pb-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">AI 互动小游戏</p>
        <h1 className="text-2xl font-bold">{title}</h1>
      </header>

      <div className="flex items-center justify-between text-sm">
        <span>
          第 {index + 1} / {questions.length} 题
        </span>
        <span className="text-muted-foreground">已答对 {index} 题</span>
      </div>
      <Progress value={percent} aria-label={`进度 ${percent}%`} />

      <p className="text-xl font-semibold leading-relaxed text-balance">{question.text}</p>

      <div className="flex flex-col gap-3">
        {question.options.map((option, i) => {
          const correct = isCorrectOption(option, i, question.answer)
          const showCorrect = solved && correct
          const showWrong = picked === i && !correct
          return (
            <button
              key={`${question.id}-${i}`}
              type="button"
              onClick={() => {
                if (solved) return
                const correct = isCorrectOption(option, i, question.answer)
                if (correct) {
                  if (!hasTriedCurrentQuestion) {
                    setFirstTryCorrectCount((c) => c + 1)
                  }
                } else {
                  setHasTriedCurrentQuestion(true)
                }
                setPicked(i)
              }}
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
    </div>
  )
}
