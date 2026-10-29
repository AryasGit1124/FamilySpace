'use client'

import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { isTimedPassed, pickLevelIndex } from '@/lib/knowledge-logic'
import { applyKnowledgeResult, type KnowledgeMasteryRow } from '@/lib/supabase-queries'
import { speakChinese, speakChineseAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { RoundComplete, RoundProgress, MathBackLink, MATH_ROUND_TOTAL } from '@/app/math/game-ui'
import { useMathRound } from '@/app/math/use-math-round'

/** 找规律的难度档位：知识点 = 游戏类型 + 难度（如 找规律_ABAB） */
type PatternLevel = {
  knowledge: string
  /** 规律标签（ABAB / AABB / ABCABC） */
  label: string
  /** 该难度下的图形规律（按周期循环） */
  patterns: string[][]
  /** 达标时限（秒）：超过时限本局视为不达标 */
  timeLimitSec: number
}

const PATTERN_LEVELS: PatternLevel[] = [
  {
    knowledge: '找规律_ABAB',
    label: 'ABAB',
    patterns: [
      ['🔴', '🔵'],
      ['⭐', '🌙'],
      ['🐱', '🐶'],
      ['🐰', '🐢'],
    ],
    timeLimitSec: 120,
  },
  {
    knowledge: '找规律_AABB',
    label: 'AABB',
    patterns: [
      ['🍎', '🍎', '🍌', '🍌'],
      ['🌸', '🌸', '🌼', '🌼'],
      ['🐷', '🐷', '🐔', '🐔'],
    ],
    timeLimitSec: 140,
  },
  {
    knowledge: '找规律_ABCABC',
    label: 'ABCABC',
    patterns: [
      ['🌸', '🌼', '🍀'],
      ['🍎', '🍌', '🍇'],
      ['🐱', '🐶', '🐭'],
    ],
    timeLimitSec: 160,
  },
]

/** 首答正确率达标线 */
const PASS_RATE = 0.8

/** 规律内可选图形不足时，用来凑干扰项 */
const POOL = ['🌞', '🐸', '🍇', '🚗', '🎈', '🍓']

type Question = {
  /** 展示的图形序列（不含问号） */
  sequence: string[]
  answer: string
  options: string[]
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function makeQuestion(patterns: string[][]): Question {
  const pattern = patterns[Math.floor(Math.random() * patterns.length)]
  /** 总共展示 4~5 个位置，最后一个用 ? 代替 */
  const total = 4 + Math.floor(Math.random() * 2)
  const visible = total - 1
  const sequence = Array.from({ length: visible }, (_, i) => pattern[i % pattern.length])
  const answer = pattern[visible % pattern.length]

  const distinct = Array.from(new Set(pattern)).filter((item) => item !== answer)
  const distractors = shuffle(distinct).slice(0, 2)
  while (distractors.length < 2) {
    const candidate = POOL[Math.floor(Math.random() * POOL.length)]
    if (candidate !== answer && !distractors.includes(candidate)) distractors.push(candidate)
  }

  return { sequence, answer, options: shuffle([answer, ...distractors]) }
}

export function PatternGame({
  taskId,
  knowledge = [],
}: {
  taskId: string | null
  /** knowledge_mastery 里 subject = '思维' 的记录（决定本局难度） */
  knowledge?: KnowledgeMasteryRow[]
}) {
  /** 本局难度：上一档熟练度满级后自动解锁下一档（ABAB → AABB → ABCABC） */
  const level = PATTERN_LEVELS[pickLevelIndex(PATTERN_LEVELS, knowledge)]
  const [question, setQuestion] = useState<Question | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<string | null>(null)
  const [hasTried, setHasTried] = useState(false)
  /** 本局开始时间（毫秒），结算时用于判断是否超时 */
  const startedAtRef = useRef(Date.now())

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useMathRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion(level.patterns))
  }, [level.patterns])

  /** 通关后按「正确率 + 用时」回写该难度的熟练度；熟练度满级后自动解锁下一难度 */
  useEffect(() => {
    if (!finished) return
    const elapsedSec = Math.round((Date.now() - startedAtRef.current) / 1000)
    const accuracy = firstTryCorrect / MATH_ROUND_TOTAL
    const passed = isTimedPassed(accuracy, elapsedSec, level.timeLimitSec, PASS_RATE)
    applyKnowledgeResult('思维', level.knowledge, passed).catch((err: unknown) => {
      console.warn('[Pattern] 写入知识点掌握度失败:', err)
    })
  }, [finished, firstTryCorrect, level.knowledge, level.timeLimitSec])

  /** 新题出现时自动播报；新题会打断上一题的"答对了"语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakChinese('下一个是什么？')
    }
  }, [question])

  useEffect(() => () => stopSpeak(), [])

  /** 答对：等「答对了，是 X」读完再出新题，期间按钮保持禁用 */
  const choose = async (option: string) => {
    if (!question || locked) return
    if (option === question.answer) {
      setLocked(true)
      addSolved(!hasTried)
      stopSpeak()
      await speakChineseAsync(`答对了，是 ${option}`)
      setQuestion(makeQuestion(level.patterns))
      setLocked(false)
      setWrongOption(null)
      setHasTried(false)
    } else {
      setWrongOption(option)
      setHasTried(true)
    }
  }

  const restart = () => {
    reset()
    startedAtRef.current = Date.now()
    setQuestion(makeQuestion(level.patterns))
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  return (
    <>
      <PageHeader
        title="找规律"
        subtitle={`看看图形怎么排，猜一猜下一个 · 难度 ${level.label}`}
        action={<MathBackLink href="/thinking" label="思维乐园" />}
      />
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
            <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-6">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {question.sequence.map((item, index) => (
                  <span
                    key={`${item}-${index}`}
                    className="flex size-14 items-center justify-center rounded-2xl border bg-background text-3xl leading-none select-none"
                    aria-hidden="true"
                  >
                    {item}
                  </span>
                ))}
                <span
                  className="flex size-14 items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 text-2xl font-bold text-primary"
                  aria-label="需要猜的图形"
                >
                  ?
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => speakChinese('下一个是什么？')}
              >
                <Volume2 aria-hidden="true" />
                下一个是什么？
              </Button>
            </section>

            <div className="grid grid-cols-3 gap-3">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => choose(option)}
                  onAnimationEnd={() =>
                    setWrongOption((cur) => (cur === option ? null : cur))
                  }
                  disabled={locked}
                  aria-label={`选择 ${option}`}
                  className={cn(
                    'flex h-20 items-center justify-center rounded-2xl border bg-background text-4xl transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongOption === option &&
                      'math-shake border-destructive bg-destructive/10',
                  )}
                >
                  <span aria-hidden="true">{option}</span>
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
