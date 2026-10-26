'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import { handleGameCheckin } from '@/lib/rewards'
import { speakChinese, speakChineseAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { MathBackLink } from '@/app/math/game-ui'

/** 每个环节的题数 / 总题数：4 个环节各 4 题，共 16 题 */
const QUESTIONS_PER_STEP = 4
const TOTAL_QUESTIONS = 16
const STEP_LABELS = ['点数', '匹配', '比大小', '加减法'] as const
type StepKind = (typeof STEP_LABELS)[number]

const EMOJIS = ['🍎', '🐟', '⭐', '🍌', '🐰', '🌸', '🐱', '🚗', '🎈', '🍓']
/** 比大小 / 加减法统一用苹果做具象配图 */
const APPLE = '🍎'

type CountQ = { kind: '点数'; emoji: string; count: number; options: number[] }
type MatchQ = { kind: '匹配'; target: number; boxes: { emoji: string; count: number }[] }
type CompareQ = { kind: '比大小'; a: number; b: number }
type AddQ = { kind: '加减法'; a: number; b: number; operator: '+' | '-'; answer: number; options: number[] }
type Question = CountQ | MatchQ | CompareQ | AddQ

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

/** 正确项 + 两个附近范围的干扰项 */
function buildNumberOptions(answer: number, min: number, max: number): number[] {
  const values = new Set<number>([answer])
  const deltas = [1, -1, 2, -2, 3, -3]
  let guard = 0
  while (values.size < 3 && guard < 100) {
    guard += 1
    const candidate = answer + deltas[Math.floor(Math.random() * deltas.length)]
    if (candidate >= min && candidate <= max) values.add(candidate)
  }
  while (values.size < 3) {
    const candidate = rand(min, max)
    if (!values.has(candidate)) values.add(candidate)
  }
  return shuffle(Array.from(values))
}

function makeCountQ(): CountQ {
  const count = rand(1, 10)
  return {
    kind: '点数',
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    count,
    options: buildNumberOptions(count, 1, 10),
  }
}

function makeMatchQ(): MatchQ {
  const target = rand(1, 10)
  const counts = buildNumberOptions(target, 1, 10)
  const emojis = shuffle(EMOJIS).slice(0, counts.length)
  return {
    kind: '匹配',
    target,
    boxes: counts.map((count, i) => { void i; return { emoji: emojis[i], count } }),
  }
}

function makeCompareQ(): CompareQ {
  let a = rand(1, 20)
  let b = rand(1, 20)
  while (a === b) b = rand(1, 20)
  return Math.random() < 0.5 ? { kind: '比大小', a, b } : { kind: '比大小', a: b, b: a }
}

/** 加减法题目：加法 A+B <= maxNumber；减法 A >= B 且 A <= maxNumber，结果非负 */
function generateAddSubQuestion(maxNumber: number): AddQ {
  if (Math.random() < 0.5) {
    const a = rand(1, maxNumber - 1)
    const b = rand(1, maxNumber - a)
    const answer = a + b
    return { kind: '加减法', a, b, operator: '+', answer, options: buildNumberOptions(answer, 0, maxNumber) }
  }
  const a = rand(2, maxNumber)
  const b = rand(1, a)
  const answer = a - b
  return { kind: '加减法', a, b, operator: '-', answer, options: buildNumberOptions(answer, 0, maxNumber) }
}

function makeQuestion(kind: StepKind, maxNumber: number): Question {
  switch (kind) {
    case '点数':
      return makeCountQ()
    case '匹配':
      return makeMatchQ()
    case '比大小':
      return makeCompareQ()
    default:
      return generateAddSubQuestion(maxNumber)
  }
}

/** 每题的 TTS 播报文案 */
function questionSpeech(q: Question): string {
  switch (q.kind) {
    case '点数':
      return '一共有几个？'
    case '匹配':
      return `请找出数量是 ${q.target} 的图片`
    case '比大小':
      return `${q.a} 和 ${q.b}，哪个大？`
    default:
      return `${q.a} ${q.operator === '+' ? '加' : '减'} ${q.b} 等于几？`
  }
}

/** 本次闯关（16 题）的星星规则：首答 16 题全对 → 2 星；≥14 题（90%以上） → 1 星；否则 0 星 */
function mathDailyStarRule(accuracy: number): number {
  const correct = Math.round(accuracy * TOTAL_QUESTIONS)
  if (correct >= TOTAL_QUESTIONS) return 2
  if (correct >= 14) return 1
  return 0
}

/** 具象配图：一组 Emoji，可把前 cut 个标成「被减掉」的灰字删除线 */
function EmojiStack({
  emoji,
  count,
  cut = 0,
}: {
  emoji: string
  count: number
  cut?: number
}) {
  return (
    <div className="flex max-w-[120px] flex-wrap justify-center gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            'text-2xl leading-none md:text-3xl',
            i < cut && 'text-muted-foreground line-through opacity-40',
          )}
        >
          {emoji}
        </span>
      ))}
    </div>
  )
}

export function MathDailyClient({ taskId, backHref }: { taskId: string | null; backHref?: string }) {
  const router = useRouter()
  const { role } = useAuth()
  const isParent = role === 'parent'

  /** 当前游戏步骤 0-3；4 表示结算页 */
  const [stepIndex, setStepIndex] = useState(0)
  /** 当前游戏内第几题（0/1） */
  const [qIndex, setQIndex] = useState(0)
  const [question, setQuestion] = useState<Question | null>(null)
  const [totalFirstTryCorrect, setTotalFirstTryCorrect] = useState(0)
  /** 当前题已点错的选项 key */
  const [wrongKeys, setWrongKeys] = useState<Set<string>>(new Set())
  const [locked, setLocked] = useState(false)
  /** 比大小：选对后填入表达式的符号（null = 还没答对） */
  const [filledSymbol, setFilledSymbol] = useState<string | null>(null)
  /** 加减法难度：5 / 10 / 20 以内 */
  const [maxNumber, setMaxNumber] = useState(10)

  const [checkingIn, setCheckingIn] = useState(false)
  const [earnedStars, setEarnedStars] = useState<number | null>(null)
  const [error, setError] = useState('')

  const stepKind: StepKind = STEP_LABELS[Math.min(stepIndex, STEP_LABELS.length - 1)]
  const doneCount = Math.min(stepIndex * QUESTIONS_PER_STEP + qIndex, TOTAL_QUESTIONS)

  // 步骤、题号或加减法难度变化时出新题
  useEffect(() => {
    if (stepIndex < STEP_LABELS.length) {
      setQuestion(makeQuestion(STEP_LABELS[stepIndex], maxNumber))
      setWrongKeys(new Set())
      setLocked(false)
      setFilledSymbol(null)
    }
  }, [stepIndex, qIndex, maxNumber])

  /** 切换加减法难度：重置本关 2 题并按新难度重新出题 */
  const switchDifficulty = (n: number) => {
    if (n === maxNumber || locked) return
    setQIndex(0)
    setMaxNumber(n)
  }

  // 新题自动播报（先打断旧语音）
  useEffect(() => {
    if (question && stepIndex < STEP_LABELS.length) {
      stopSpeak()
      speakChinese(questionSpeech(question))
    }
  }, [question, stepIndex])

  // 卸载清理
  useEffect(() => () => stopSpeak(), [])

  const advance = useCallback(() => {
    if (qIndex + 1 < QUESTIONS_PER_STEP) {
      setQIndex((i) => i + 1)
    } else {
      setStepIndex((s) => s + 1)
      setQIndex(0)
    }
  }, [qIndex])

  /** 统一点选逻辑：首答对计分；点错抖动可重选；点对等语音播完再进下一题 */
  const pick = async (key: string, isCorrect: boolean) => {
    if (locked || wrongKeys.has(key)) return
    if (isCorrect) {
      if (wrongKeys.size === 0) setTotalFirstTryCorrect((n) => n + 1)
      setLocked(true)
      stopSpeak()
      if (question?.kind === '比大小') {
        // 视觉填入：符号填进表达式，朗读完整句子（如「4 小于 13」）
        setFilledSymbol(key)
        const symbolWord = key === '<' ? '小于' : key === '>' ? '大于' : '等于'
        await speakChineseAsync(`${question.a} ${symbolWord} ${question.b}`)
      } else {
        await speakChineseAsync('答对了')
      }
      advance()
    } else {
      setWrongKeys((prev) => new Set(prev).add(key))
    }
  }

  const handleCheckin = async () => {
    if (!taskId || checkingIn || earnedStars !== null) return
    setCheckingIn(true)
    setError('')
    try {
      const stars = await handleGameCheckin(taskId, TOTAL_QUESTIONS, totalFirstTryCorrect, isParent, mathDailyStarRule)
      setEarnedStars(stars)
    } catch (err) {
      console.error('[MathDaily] 打卡失败:', err)
      setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCheckingIn(false)
    }
  }

  const optionBtnClass = (key: string, extra?: string) =>
    cn(
      'flex items-center justify-center rounded-2xl border-2 bg-card font-bold transition-all hover:bg-muted/50 disabled:cursor-not-allowed',
      wrongKeys.has(key) && 'math-shake border-destructive bg-destructive/10 text-destructive opacity-50',
      extra,
    )

  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] w-full max-w-5xl flex-col overflow-hidden px-3 pb-2">
      {/* 顶部只保留返回入口与极简进度，不再有标题和步骤条 */}
      <div className="flex shrink-0 items-center justify-between pt-1">
        <MathBackLink href={backHref ?? '/math'} label="返回数学" />
        {stepIndex < STEP_LABELS.length && (
          <span className="text-[11px] font-medium text-muted-foreground">
            第 {doneCount + 1} / {TOTAL_QUESTIONS} 题 · {stepKind}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-1 shrink-0 rounded-xl bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* ════════ 结算页 ════════ */}
      {stepIndex >= STEP_LABELS.length ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center">
            <p className="text-lg font-bold">今日闯关完成！🎉</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              首答正确 <span className="font-semibold text-foreground">{totalFirstTryCorrect}</span> / {TOTAL_QUESTIONS} 题
            </p>
            {earnedStars !== null ? (
              <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-emerald-50 p-4">
                <p className="text-base font-bold text-emerald-800">
                  今日闯关完成！首答正确 {totalFirstTryCorrect}/{TOTAL_QUESTIONS} 题，获得 {earnedStars} 颗星星⭐
                </p>
                {isParent && <p className="text-xs text-muted-foreground">（家长测试模式：未实际写入打卡和星星）</p>}
                <Button className="h-12 w-full text-base" onClick={() => router.push('/')}>
                  返回主页
                </Button>
              </div>
            ) : (
              <>
                <Button className="h-12 w-full text-base" onClick={handleCheckin} disabled={checkingIn || !taskId}>
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  {checkingIn ? '打卡中…' : '确认打卡'}
                </Button>
                {!taskId && <p className="text-xs text-destructive">未找到「数学乐园」线上任务，暂时无法打卡</p>}
              </>
            )}
          </div>
        </div>
      ) : !question ? (
        <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">题目准备中…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
          {/* ════════ Step 1：点数 ════════ */}
          {question.kind === '点数' && (
            <>
              <div className="flex shrink-0 items-center justify-center gap-2 md:gap-3">
                <p className="text-lg font-bold md:text-2xl">看看一共有几个？</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1 px-3 py-1.5 text-xs md:px-4 md:py-2 md:text-sm"
                  onClick={() => {
                    stopSpeak()
                    speakChinese(questionSpeech(question))
                  }}
                >
                  <Volume2 className="size-4" aria-hidden="true" />
                  听一听
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border bg-card p-4">
                <div className="flex max-w-full flex-wrap items-center justify-center gap-2 md:gap-3">
                  {Array.from({ length: question.count }).map((_, i) => (
                    <span key={i} className="text-4xl leading-none md:text-5xl" aria-hidden="true">
                      {question.emoji}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-2 md:gap-4">
                {question.options.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={locked || wrongKeys.has(String(n))}
                    onClick={() => pick(String(n), n === question.count)}
                    className={optionBtnClass(String(n), 'h-16 text-4xl md:h-20 md:text-5xl')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ════════ Step 2：数量匹配 ════════ */}
          {question.kind === '匹配' && (
            <>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
                <p className="shrink-0 text-lg font-bold md:text-2xl">
                  找出数量是 <span className="text-2xl text-primary md:text-3xl">{question.target}</span> 的图片
                </p>
                <div className="grid min-h-0 w-full flex-1 grid-cols-3 items-stretch gap-2 md:gap-4">
                  {question.boxes.map((box, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={locked || wrongKeys.has(String(i))}
                      onClick={() => pick(String(i), box.count === question.target)}
                      aria-label={`第 ${i + 1} 个图框`}
                      className={optionBtnClass(
                        String(i),
                        'h-full w-full rounded-3xl bg-white shadow-sm',
                      )}
                    >
                      {/* Emoji 像一朵云一样紧凑聚在卡片正中心，不使用 justify-between / space-x */}
                      <div className="flex flex-wrap content-center items-center justify-center gap-1 p-2 md:gap-2">
                        {Array.from({ length: box.count }).map((_, j) => (
                          <span
                            key={j}
                            className="flex size-8 items-center justify-center text-2xl leading-none md:size-10 md:text-3xl"
                            aria-hidden="true"
                          >
                            {box.emoji}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    stopSpeak()
                    speakChinese(questionSpeech(question))
                  }}
                >
                  <Volume2 aria-hidden="true" />
                  再听一遍
                </Button>
              </div>
            </>
          )}

          {/* ════════ Step 3：比大小（数字 + 苹果配图 + 中间 [?]） ════════ */}
          {question.kind === '比大小' && (
            <>
              <div className="flex min-h-0 flex-1 items-center justify-center gap-4 rounded-2xl border bg-card p-4 md:gap-10">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-6xl font-bold">{question.a}</span>
                  <EmojiStack emoji={APPLE} count={question.a} />
                </div>
                {filledSymbol ? (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-4xl font-bold text-primary-foreground shadow-md">
                    {filledSymbol}
                  </span>
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-primary/50 text-2xl font-bold text-primary">
                    ?
                  </span>
                )}
                <div className="flex flex-col items-center gap-2">
                  <span className="text-6xl font-bold">{question.b}</span>
                  <EmojiStack emoji={APPLE} count={question.b} />
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-2 md:gap-4">
                {(['<', '>', '='] as const).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    disabled={locked || wrongKeys.has(sym)}
                    onClick={() =>
                      pick(
                        sym,
                        sym === (question.a > question.b ? '>' : question.a < question.b ? '<' : '='),
                      )
                    }
                    className={optionBtnClass(sym, 'h-16 text-5xl md:h-20 md:text-6xl')}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ════════ Step 4：加减法（算式 + 苹果配图） ════════ */}
          {question.kind === '加减法' && (
            <>
              <div className="flex shrink-0 justify-center gap-2">
                {[5, 10, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={locked}
                    onClick={() => switchDifficulty(n)}
                    className={cn(
                      'rounded-full border-2 px-4 py-1 text-xs font-bold transition-colors disabled:opacity-60 md:text-sm',
                      maxNumber === n
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {n}以内
                  </button>
                ))}
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center gap-3 rounded-2xl border bg-card p-3 md:gap-6">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-5xl font-bold md:text-6xl">{question.a}</span>
                  <EmojiStack
                    emoji={APPLE}
                    count={question.a}
                    cut={question.operator === '-' ? question.b : 0}
                  />
                </div>
                <span className="text-4xl font-bold text-primary md:text-5xl">{question.operator}</span>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-5xl font-bold md:text-6xl">{question.b}</span>
                  {question.operator === '+' ? (
                    <EmojiStack emoji={APPLE} count={question.b} />
                  ) : (
                    <span className="max-w-[80px] text-center text-[10px] text-muted-foreground">
                      划掉 {question.b} 个
                    </span>
                  )}
                </div>
                <span className="text-4xl font-bold text-muted-foreground md:text-5xl">= ?</span>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-2 md:gap-4">
                {question.options.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={locked || wrongKeys.has(String(n))}
                    onClick={() => pick(String(n), n === question.answer)}
                    className={optionBtnClass(String(n), 'h-16 text-4xl md:h-20 md:text-5xl')}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="shrink-0 text-center text-[10px] text-muted-foreground">
            第一次就点对才能拿满分星星哦
          </p>
        </div>
      )}
    </div>
  )
}
