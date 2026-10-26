'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, BookOpenText, CheckCircle2, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth-provider'
import {
  fetchDailyContent,
  fetchLiteracyCharsByLevel,
  fetchMasteryMap,
  saveDailyContent,
  upsertMastery,
  type LiteracyChar,
  type MasteryStatus,
} from '@/lib/supabase-queries'
import { handleGameCheckin } from '@/lib/rewards'
import { todayDateKey } from '@/lib/supabase-adapter'
import { speakChar, speakChinese, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

const LEVELS = [1, 2, 3, 4, 5, 6]
/** Step 2 每天学的新字数 / Step 3 听音测试题数 */
const LEARN_COUNT = 5
const QUIZ_COUNT = 5
const STEP_LABELS = ['摸底测试', '学新字', '听音选字', '读故事打卡']

/** Fisher-Yates 洗牌，返回新数组 */
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Supabase 错误对象的 message/code 等属性不可枚举，需显式提取 */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

type QuizQuestion = { target: LiteracyChar; options: LiteracyChar[] }

export function DailyClient({ taskId, backHref }: { taskId: string | null; backHref?: string }) {
  const router = useRouter()
  const { role } = useAuth()
  const isParent = role === 'parent'

  const [step, setStep] = useState(1)
  const [error, setError] = useState('')

  // ── Step 1：摸底测试（字墙）──
  const [level, setLevel] = useState(1)
  const [chars, setChars] = useState<LiteracyChar[]>([])
  const [mastery, setMastery] = useState<Record<string, MasteryStatus>>({})
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<LiteracyChar | null>(null)
  const [saving, setSaving] = useState(false)
  /** 本次摸底中点了「不认识」的字 */
  const [unknownChars, setUnknownChars] = useState<LiteracyChar[]>([])

  // ── Step 2：学字卡 ──
  const [todayLearnChars, setTodayLearnChars] = useState<LiteracyChar[]>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  // ── Step 3：听音识字 ──
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [qIndex, setQIndex] = useState(0)
  /** 当前题已点错的选项 id */
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set())
  const [answered, setAnswered] = useState(false)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)

  // ── Step 4：AI 故事 + 结算打卡 ──
  const [checkingIn, setCheckingIn] = useState(false)
  const [earnedStars, setEarnedStars] = useState<number | null>(null)
  const [story, setStory] = useState('')
  const [storyLoading, setStoryLoading] = useState(false)
  const [storyError, setStoryError] = useState('')
  /** TTS 全文播完才解锁打卡 */
  const [storyListened, setStoryListened] = useState(false)
  const [listening, setListening] = useState(false)
  /** 防止进入 Step 4 时重复请求故事 */
  const storyRequestedRef = useRef(false)

  const load = useCallback(async (lv: number) => {
    setLoading(true)
    setError('')
    setActive(null)
    try {
      const [rows, map] = await Promise.all([fetchLiteracyCharsByLevel(lv), fetchMasteryMap()])
      setChars(rows)
      setMastery(map)
    } catch (err) {
      console.error('[LiteracyDaily] 加载字库失败:', err)
      setError(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(level)
  }, [level, load])

  const masteredCount = chars.filter((c) => mastery[c.id] === 'mastered').length

  // ──────────────── Step 1 逻辑 ────────────────

  const openTest = (c: LiteracyChar) => {
    // 摸底测试不允许自动发音：孩子要先自己认字，想不起来时再手动点「播放读音」
    stopSpeak()
    setActive(c)
  }

  const mark = async (status: MasteryStatus) => {
    if (!active || saving) return
    setSaving(true)
    setError('')
    try {
      await upsertMastery(active.id, status)
      setMastery((prev) => ({ ...prev, [active.id]: status }))
      setUnknownChars((prev) => {
        const rest = prev.filter((c) => c.id !== active.id)
        return status === 'review' ? [...rest, active] : rest
      })
      setActive(null)
    } catch (err) {
      console.error('[LiteracyDaily] 写入 child_mastery 失败:', errMsg(err), err)
      setError(`保存失败：${errMsg(err)}`)
    } finally {
      setSaving(false)
    }
  }

  // ──────────────── Step 2 逻辑 ────────────────

  /** 从摸底不认识字里随机抽 5 个；不足则用本级未掌握的字补足 */
  const enterStep2 = () => {
    let picked = shuffle(unknownChars).slice(0, LEARN_COUNT)
    if (picked.length < LEARN_COUNT) {
      const candidates = chars.filter(
        (c) => mastery[c.id] !== 'mastered' && !picked.some((p) => p.id === c.id),
      )
      picked = [...picked, ...shuffle(candidates)].slice(0, LEARN_COUNT)
    }
    setTodayLearnChars(picked)
    setCardIndex(0)
    setFlipped(false)
    setStep(2)
  }

  const currentCard = todayLearnChars[cardIndex]

  const flipCard = () => {
    if (!currentCard) return
    stopSpeak()
    speakChar(currentCard.char, currentCard.pinyin)
    setFlipped((f) => !f)
  }

  const goCard = (delta: number) => {
    setCardIndex((i) => Math.min(todayLearnChars.length - 1, Math.max(0, i + delta)))
    setFlipped(false)
  }

  // ──────────────── Step 3 逻辑 ────────────────

  /** 题库 = 今天学的 5 个新字 + 本级已认识的字，随机抽 5 题，各配 3 个干扰项 */
  const enterStep3 = () => {
    const masteredPool = chars.filter(
      (c) => mastery[c.id] === 'mastered' && !todayLearnChars.some((t) => t.id === c.id),
    )
    let targets = shuffle([...todayLearnChars, ...shuffle(masteredPool)]).slice(0, QUIZ_COUNT)
    // 极端情况：新字和已认识字都不够 5 个，用本级其他字补齐
    if (targets.length < QUIZ_COUNT) {
      const rest = chars.filter((c) => !targets.some((t) => t.id === c.id))
      targets = [...targets, ...shuffle(rest)].slice(0, QUIZ_COUNT)
    }
    const qs: QuizQuestion[] = targets.map((target) => {
      const distractors = shuffle(chars.filter((c) => c.char !== target.char)).slice(0, 3)
      return { target, options: shuffle([target, ...distractors]) }
    })
    setQuestions(qs)
    setQIndex(0)
    setWrongIds(new Set())
    setAnswered(false)
    setFirstTryCorrect(0)
    setStep(3)
  }

  const currentQ = questions[qIndex]

  // 题目变化时自动播放读音（先打断旧语音）
  useEffect(() => {
    if (step !== 3 || !currentQ) return
    stopSpeak()
    speakChar(currentQ.target.char, currentQ.target.pinyin)
  }, [step, qIndex, currentQ])

  /** 点选项：首答对才计分；点错抖动可继续点；点对自动切下一题 */
  const answer = (opt: LiteracyChar) => {
    if (!currentQ || answered || wrongIds.has(opt.id)) return
    if (opt.id === currentQ.target.id) {
      if (wrongIds.size === 0) setFirstTryCorrect((n) => n + 1)
      setAnswered(true)
      stopSpeak()
      speakChar(currentQ.target.char, currentQ.target.pinyin)
      if (qIndex + 1 < questions.length) {
        setTimeout(() => {
          setQIndex((i) => i + 1)
          setWrongIds(new Set())
          setAnswered(false)
        }, 800)
      }
    } else {
      setWrongIds((prev) => new Set(prev).add(opt.id))
    }
  }

  // ──────────────── Step 4 逻辑 ────────────────

  /** 今天新学的字（用于故事高亮） */
  const highlightChars = new Set(todayLearnChars.map((c) => c.char))

  // 进入 Step 4 时加载故事：先查 daily_contents 缓存，没有再调 AI 生成
  useEffect(() => {
    if (step !== 4 || storyRequestedRef.current) return
    storyRequestedRef.current = true
    let cancelled = false
    ;(async () => {
      setStoryLoading(true)
      setStoryError('')
      const dateKey = todayDateKey()
      try {
        const cached = await fetchDailyContent('literacy_story', dateKey)
        if (cached) {
          if (!cancelled) setStory(cached)
          return
        }
        const res = await fetch('/api/generate-story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extraChars: todayLearnChars.map((c) => c.char) }),
        })
        const data: unknown = await res.json().catch(() => null)
        const storyText =
          data && typeof data === 'object' ? (data as { story?: unknown }).story : undefined
        if (!res.ok || typeof storyText !== 'string' || !storyText.trim()) {
          const apiError =
            data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
          throw new Error(typeof apiError === 'string' ? apiError : `生成失败（HTTP ${res.status}）`)
        }
        if (!cancelled) setStory(storyText.trim())
        // 写缓存失败不影响展示
        saveDailyContent('literacy_story', dateKey, storyText.trim()).catch((err) =>
          console.warn('[LiteracyDaily] 故事缓存写入失败:', err),
        )
      } catch (err) {
        console.error('[LiteracyDaily] 加载故事失败:', err)
        if (!cancelled) {
          setStoryError(err instanceof Error ? err.message : '生成故事失败，请稍后重试')
        }
      } finally {
        if (!cancelled) setStoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  /** 听故事：TTS 播报全文，自然播完（音频 onend）才解锁打卡按钮 */
  const listenStory = () => {
    if (!story) return
    stopSpeak()
    setListening(true)
    speakChinese(story, () => {
      setListening(false)
      setStoryListened(true)
    })
  }

  /** 重新开始：清空向导各步骤状态 */
  const resetWizard = () => {
    setUnknownChars([])
    setTodayLearnChars([])
    setCardIndex(0)
    setFlipped(false)
    setQuestions([])
    setQIndex(0)
    setWrongIds(new Set())
    setAnswered(false)
    setFirstTryCorrect(0)
    setStory('')
    setStoryError('')
    setStoryListened(false)
    setListening(false)
    storyRequestedRef.current = false
    setStep(1)
  }

  const handleCheckin = async () => {
    if (!taskId || checkingIn || earnedStars !== null) return
    setCheckingIn(true)
    setError('')
    try {
      const stars = await handleGameCheckin(taskId, questions.length, firstTryCorrect, isParent)
      setEarnedStars(stars)
    } catch (err) {
      console.error('[LiteracyDaily] 打卡失败:', err)
      setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCheckingIn(false)
    }
  }

  // ──────────────── 渲染 ────────────────

  return (
    <>
      <PageHeader
        title="今日识字打卡"
        subtitle="摸底 → 学字 → 听音 → 读故事，完成打卡"
        backHref={backHref}
        backLabel="返回语文主页"
      />

      {/* 步骤条 */}
      <div className="flex items-center gap-1 px-5 pb-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1
          return (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs font-bold',
                  step > n && 'bg-emerald-500 text-white',
                  step === n && 'bg-primary text-primary-foreground',
                  step < n && 'bg-muted text-muted-foreground',
                )}
              >
                {n}
              </span>
              <span
                className={cn(
                  'text-[11px]',
                  step === n ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-4 px-5 pb-6">
        {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {/* ════════ Step 1：摸底测试（字墙） ════════ */}
        {step === 1 && (
          <>
            <div className="flex items-center gap-3">
              <label htmlFor="daily-level" className="text-sm font-medium">
                级别
              </label>
              <select
                id="daily-level"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv} 级
                  </option>
                ))}
              </select>
              <span className="ml-auto text-sm text-muted-foreground">
                已认识 <span className="font-semibold text-emerald-600">{masteredCount}</span> / 共 {chars.length} 字
              </span>
            </div>

            {loading ? (
              <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                正在加载字库…
              </p>
            ) : chars.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                {level} 级还没有汉字，先在 literacy_chars 表里补充数据吧
              </p>
            ) : (
              <ul className="grid grid-cols-4 gap-2 md:grid-cols-6 md:gap-4 lg:grid-cols-8">
                {chars.map((c) => {
                  const status = mastery[c.id]
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openTest(c)}
                        aria-label={`测试汉字 ${c.char}`}
                        className={cn(
                          'relative flex aspect-square min-h-[60px] w-full items-center justify-center rounded-xl border bg-card text-3xl font-bold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md md:min-h-[100px] md:rounded-2xl md:text-5xl lg:text-6xl',
                          status === 'mastered' && 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-none',
                          status === 'review' && 'border-red-300 bg-red-50 text-red-700 shadow-none',
                        )}
                      >
                        {c.char}
                        {status === 'mastered' && (
                          <span className="absolute right-1 top-1 text-[10px]" aria-hidden="true">✅</span>
                        )}
                        {status === 'review' && (
                          <span className="absolute right-1 top-1 text-[10px]" aria-hidden="true">❓</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <p className="text-xs text-muted-foreground">
              点字听读音并判断认不认识；摸底出 {unknownChars.length} 个不认识的字
            </p>
            <Button className="h-12 w-full text-base" disabled={loading || chars.length === 0} onClick={enterStep2}>
              下一步：学习新字
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </>
        )}

        {/* ════════ Step 2：学字卡 ════════ */}
        {step === 2 && (
          <div className="flex flex-col gap-4 md:mx-auto md:w-full md:max-w-2xl lg:max-w-3xl">
            {todayLearnChars.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center">
                <p className="text-lg font-bold">本级没有需要学的新字 🎉</p>
                <p className="text-sm text-muted-foreground">可以直接进入听音识字</p>
              </div>
            ) : (
              <>
                <p className="text-center text-sm text-muted-foreground">
                  今天要学 {todayLearnChars.length} 个新字（第 {cardIndex + 1} / {todayLearnChars.length} 张）
                </p>
                <button
                  type="button"
                  onClick={flipCard}
                  aria-label={`字卡 ${currentCard.char}，点击翻转并朗读`}
                  className="flex h-72 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 bg-card transition-all hover:bg-muted/40 md:h-96"
                >
                  {!flipped ? (
                    <>
                      <span className="text-9xl font-bold leading-none md:text-[10rem] lg:text-[11rem]">{currentCard.char}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground md:text-base">
                        <Volume2 className="size-3.5 md:size-5" aria-hidden="true" />
                        点击听读音、看拼音
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-5xl font-bold text-primary md:text-7xl">
                        {currentCard.pinyin ?? currentCard.char}
                      </span>
                      <span className="text-2xl text-muted-foreground md:text-4xl">{currentCard.char}</span>
                      <span className="text-xs text-muted-foreground md:text-base">再点一次翻回</span>
                    </>
                  )}
                </button>
                <div className="flex items-center justify-between gap-3">
                  <Button variant="outline" onClick={() => goCard(-1)} disabled={cardIndex === 0}>
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    上一张
                  </Button>
                  <div className="flex gap-1.5">
                    {todayLearnChars.map((c, i) => (
                      <span
                        key={c.id}
                        className={cn('size-2 rounded-full', i === cardIndex ? 'bg-primary' : 'bg-muted')}
                      />
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => goCard(1)}
                    disabled={cardIndex >= todayLearnChars.length - 1}
                  >
                    下一张
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </>
            )}
            <Button className="h-12 w-full text-base" onClick={enterStep3}>
              下一步：听音识字
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        {/* ════════ Step 3：听音识字 ════════ */}
        {step === 3 && currentQ && (
          <>
            <p className="text-center text-sm text-muted-foreground">
              第 {qIndex + 1} / {questions.length} 题 · 听读音，选出正确的字
            </p>
            <button
              type="button"
              onClick={() => {
                stopSpeak()
                speakChar(currentQ.target.char, currentQ.target.pinyin)
              }}
              aria-label="重听读音"
              className="mx-auto flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 md:size-32"
            >
              <Volume2 className="size-10 md:size-14" aria-hidden="true" />
            </button>
            <div className="grid grid-cols-2 gap-3">
              {currentQ.options.map((opt) => {
                const wrong = wrongIds.has(opt.id)
                const correct = answered && opt.id === currentQ.target.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => answer(opt)}
                    disabled={wrong}
                    className={cn(
                      'flex h-28 items-center justify-center rounded-2xl border-2 bg-card text-5xl font-bold transition-all hover:bg-muted/40 disabled:cursor-not-allowed md:h-36 md:text-7xl',
                      wrong && 'math-shake border-destructive bg-destructive/10 text-destructive opacity-50',
                      correct && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {opt.char}
                  </button>
                )
              })}
            </div>
            {answered && qIndex + 1 >= questions.length && (
              <Button className="h-12 w-full text-base" onClick={() => setStep(4)}>
                下一步：生成故事
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            )}
          </>
        )}

        {/* ════════ Step 4：AI 专属故事（听完才能打卡） ════════ */}
        {step === 4 && (
          <div className="flex w-full flex-col items-center gap-4 rounded-2xl border bg-card p-6 md:mx-auto md:max-w-3xl md:p-8">
            <p className="flex items-center gap-2 text-lg font-bold">
              <BookOpenText className="size-5 text-primary" aria-hidden="true" />
              今天的故事
            </p>

            {storyLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                老师正在为你写故事…
              </p>
            ) : storyError ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-destructive">{storyError}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    storyRequestedRef.current = false
                    setStep(3)
                    setTimeout(() => setStep(4), 0)
                  }}
                >
                  重试
                </Button>
              </div>
            ) : story ? (
              /* 故事正文：逐行大字展示，今天新学的字红色高亮 */
              <div className="w-full rounded-2xl bg-amber-50/60 p-4">
                {story
                  .split(/(?<=[。！？；!?；\n])/)
                  .filter((line) => line.trim())
                  .map((line, li) => (
                    <p key={li} className="text-xl leading-loose tracking-wide md:text-3xl">
                      {[...line].map((ch, ci) =>
                        highlightChars.has(ch) ? (
                          <span key={ci} className="font-bold text-red-500">
                            {ch}
                          </span>
                        ) : (
                          <span key={ci}>{ch}</span>
                        ),
                      )}
                    </p>
                  ))}
              </div>
            ) : null}

            {story && (
              <Button variant="outline" className="h-12 w-full text-base" onClick={listenStory}>
                <Volume2 className="size-4" aria-hidden="true" />
                {listening ? '朗读中…' : storyListened ? '再听一遍' : '听故事'}
              </Button>
            )}

            {earnedStars === null ? (
              <>
                <Button
                  className="h-12 w-full text-base"
                  onClick={handleCheckin}
                  disabled={!storyListened || checkingIn || !taskId || !story}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  {checkingIn ? '打卡中…' : storyListened ? '确认打卡' : '先听完故事才能打卡'}
                </Button>
                {!taskId && <p className="text-xs text-destructive">未找到「识字」线上任务，暂时无法打卡</p>}
              </>
            ) : (
              /* 结算框 */
              <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-center">
                <p className="text-base font-bold text-emerald-800">
                  今天学会了 {todayLearnChars.length} 个新字，首答正确 {firstTryCorrect} 题，获得 {earnedStars} 颗星星！
                </p>
                <Button className="h-12 w-full text-base" onClick={() => router.push('/')}>
                  返回主页
                </Button>
              </div>
            )}
            {earnedStars === null && (
              <Button variant="outline" onClick={resetWizard}>
                重新开始
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Step 1 测试弹窗：挂载在页面根节点下，fixed inset-0 相对视口定位，不受字墙容器影响 */}
      {step === 1 && active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!saving) setActive(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`测试汉字 ${active.char}`}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm md:max-w-2xl lg:max-w-4xl h-auto min-h-[50vh] flex flex-col items-center justify-center relative p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="关闭"
              disabled={saving}
              onClick={() => setActive(null)}
              className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                stopSpeak()
                speakChar(active.char, active.pinyin)
              }}
              aria-label={`重听汉字 ${active.char} 的读音`}
              className="flex flex-col items-center rounded-2xl transition-colors hover:bg-muted/40"
            >
              <span className="text-[8rem] md:text-[12rem] lg:text-[16rem] font-bold leading-none">
                {active.char}
              </span>
              {active.pinyin && (
                <span className="text-3xl md:text-5xl text-gray-500 mt-4">{active.pinyin}</span>
              )}
              <span className="mt-4 flex items-center gap-1 text-sm text-muted-foreground md:text-lg">
                <Volume2 className="size-4 md:size-6" aria-hidden="true" />
                点击卡片可听读音
              </span>
            </button>
            {/* 独立的手动发音入口：家长想不起来时可以点一下辅助，绝不自动播放 */}
            <button
              type="button"
              onClick={() => {
                stopSpeak()
                speakChar(active.char, active.pinyin)
              }}
              className="mt-5 flex items-center gap-2 rounded-full border-2 border-primary/30 bg-primary/5 px-6 py-3 text-lg font-medium text-primary transition-colors hover:bg-primary/10 active:scale-95 md:px-8 md:py-4 md:text-2xl"
            >
              <Volume2 className="size-5 md:size-7" aria-hidden="true" />
              播放读音
            </button>
            <div className="w-full max-w-md flex gap-4 md:gap-8 mt-8">
              <Button
                variant="outline"
                className="flex-1 py-4 md:py-6 text-2xl md:text-4xl font-bold rounded-2xl"
                disabled={saving}
                onClick={() => mark('review')}
              >
                不认识
              </Button>
              <Button
                className="flex-1 py-4 md:py-6 text-2xl md:text-4xl font-bold rounded-2xl"
                disabled={saving}
                onClick={() => mark('mastered')}
              >
                认识了
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
