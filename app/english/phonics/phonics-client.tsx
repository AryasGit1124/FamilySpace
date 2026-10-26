'use client'

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { ALPHABET, VOCAB, type VocabWord } from '@/lib/english-data'
import { speakEnglish, speakEnglishAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { RoundComplete, RoundProgress, ENGLISH_ROUND_TOTAL } from '../game-ui'
import { useEnglishRound } from '../use-english-round'

type Question = {
  word: VocabWord
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

function makeQuestion(practiceLetter: string | null): Question {
  const pool = practiceLetter
    ? VOCAB.filter((item) => item.en.charAt(0).toUpperCase() === practiceLetter)
    : VOCAB
  const word = pool[Math.floor(Math.random() * pool.length)] ?? VOCAB[0]
  const answer = word.en.charAt(0).toUpperCase()
  const distractors = shuffle(ALPHABET.filter((item) => item.upper !== answer)).slice(0, 3)
  return {
    word,
    answer,
    options: shuffle([answer, ...distractors.map((item) => item.upper)]),
  }
}

/** 自然拼读 chant：R, R, Rabbit */
function promptOf(question: Question): string {
  return `${question.answer}, ${question.answer}, ${question.word.en}`
}

export function PhonicsGame({
  taskId,
  backHref,
}: {
  taskId: string | null
  backHref?: string
}) {
  const [question, setQuestion] = useState<Question | null>(null)
  const [practiceLetter, setPracticeLetter] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [wrongOption, setWrongOption] = useState<string | null>(null)
  const [hasTried, setHasTried] = useState(false)

  const { solved, firstTryCorrect, finished, checked, checkingIn, error, earnedStars, isParent, addSolved, reset } =
    useEnglishRound(taskId)

  useEffect(() => {
    setQuestion(makeQuestion(null))
  }, [])

  /** 新题自动播报字母 chant，如「R, R, Rabbit」；新题打断上一题语音 */
  useEffect(() => {
    if (question) {
      stopSpeak()
      speakEnglish(promptOf(question))
    }
  }, [question])

  useEffect(() => () => stopSpeak(), [])

  const nextQuestion = () => {
    setQuestion(makeQuestion(practiceLetter))
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  /** 答对：等「Yes! 单词」读完再出新题，期间按钮保持禁用 */
  const choose = async (option: string) => {
    if (!question || locked) return
    if (option === question.answer) {
      setLocked(true)
      addSolved(!hasTried)
      stopSpeak()
      await speakEnglishAsync(`Yes! ${question.word.en}`)
      nextQuestion()
    } else {
      setWrongOption(option)
      setHasTried(true)
    }
  }

  const restart = () => {
    reset()
    setQuestion(makeQuestion(practiceLetter))
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  /** 切换练习字母：清空进度，从该字母对应的单词里重新随机出题 */
  const changeLetter = (letter: string | null) => {
    if (letter === practiceLetter) return
    setPracticeLetter(letter)
    reset()
    setQuestion(makeQuestion(letter))
    setLocked(false)
    setWrongOption(null)
    setHasTried(false)
  }

  return (
    <>
      <PageHeader
        title="自然拼读"
        subtitle="看图片，选出单词的首字母"
        backHref={backHref}
        backLabel="返回英语"
      />
      <div className="flex flex-col gap-5 px-5 pb-6">
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-7 gap-1.5">
            <button
              type="button"
              onClick={() => changeLetter(null)}
              aria-pressed={practiceLetter === null}
              className={cn(
                'h-9 rounded-lg text-xs font-semibold transition-colors',
                practiceLetter === null
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              )}
            >
              全部
            </button>
            {ALPHABET.map((item) => (
              <button
                key={item.upper}
                type="button"
                onClick={() => changeLetter(item.upper)}
                aria-pressed={practiceLetter === item.upper}
                className={cn(
                  'h-9 rounded-lg text-sm font-semibold transition-colors',
                  practiceLetter === item.upper
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                )}
              >
                {item.upper}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            选择想练习的字母，题目会从对应单词中随机生成
          </p>
        </div>

        <RoundProgress done={solved} />

        {finished ? (
          <RoundComplete
            total={ENGLISH_ROUND_TOTAL}
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
              <p className="text-8xl leading-none" aria-label={question.word.zh}>
                {question.word.emoji}
              </p>
              <Button size="sm" variant="outline" onClick={() => speakEnglish(promptOf(question))}>
                <Volume2 aria-hidden="true" />
                再听一遍
              </Button>
            </section>

            <div className="grid grid-cols-4 gap-2">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => choose(option)}
                  onAnimationEnd={() =>
                    setWrongOption((cur) => (cur === option ? null : cur))
                  }
                  disabled={locked}
                  className={cn(
                    'flex h-20 items-center justify-center rounded-2xl border bg-background text-4xl font-bold transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-70',
                    wrongOption === option &&
                      'math-shake border-destructive bg-destructive/10 text-destructive',
                  )}
                >
                  {option}
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
