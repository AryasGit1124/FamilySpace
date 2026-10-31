'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PoemPlayground } from '@/app/components/PoemPlayground'
import { useAuth } from '@/components/auth-provider'
import {
  applyQuizResult,
  ensureModuleTaskIdBySubjectName,
  fetchDueReviewChars,
  fetchLiteracyCharsByIds,
  fetchLiteracyCharsByLevel,
  fetchLearnedPoemTitles,
  fetchMasteredChars,
  fetchMasteryMap,
  fetchPoemById,
  fetchPoems,
  fetchUnseenChars,
  insertLearningRecord,
  upsertMastery,
  type LiteracyChar,
  type MasteryStatus,
  type Poem,
} from '@/lib/supabase-queries'
import { handleGameCheckin } from '@/lib/rewards'
import { todayStr } from '@/lib/dates'
import { resolveWordCard, type WordCard } from '@/lib/literacy-words'
import { speakChar, speakChinese, speakLinesAsync, stopSpeak } from '@/lib/tts'
import { cn } from '@/lib/utils'

const LEVELS = [1, 2, 3, 4, 5, 6]
/** 每日任务量：固定 6 字（最多 3 个复习字，其余由新字补足） */
const DAILY_TOTAL = 6
const DAILY_REVIEW = 3
/** Step 3 听音测试题数 */
const QUIZ_COUNT = 5

/** Fisher-Yates 洗牌，返回新数组 */
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** LocalStorage key：按「日期 + 级别」锁定当天任务，中途退出不重抽 */
const dailyTaskKey = (date: string, level: number) => `literacy_daily_task:${date}:${level}`

/** 当前 ISO 周标识（如 2026-W44），用来锁定「本周古诗」 */
function currentWeekKey(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // ISO 周：周四所在的那一周归属该年
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const weeklyPoemKey = (weekKey: string) => `weekly_poem_${weekKey}`
type WeeklyPoem = { id: string; title: string; date: string }

type LockedTask = { date: string; level: number; ids: string[]; reviewIds: string[] }
/** 今日任务：chars 为 6 个字，reviewIds 标记其中哪些是复习字（其余为新学） */
type DailyTask = { chars: LiteracyChar[]; reviewIds: string[] }

/**
 * 今日 6 字任务 = 到期复习字（mastery_level 低的优先，最多 3 个）+ 本级未学新字。
 * 复习不足时用新字补满 6 个；生成后按日期写入 LocalStorage，当天再次进入沿用同一批字。
 */
async function loadTodayTask(level: number): Promise<DailyTask> {
  const today = todayStr()
  const key = dailyTaskKey(today, level)

  try {
    const cached = window.localStorage.getItem(key)
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<LockedTask>
      const ids = Array.isArray(parsed.ids)
        ? parsed.ids.filter((id): id is string => typeof id === 'string')
        : []
      if (ids.length > 0) {
        const rows = await fetchLiteracyCharsByIds(ids)
        // 字表变动（删字）导致回读不全时才重新生成
        if (rows.length === ids.length) {
          const reviewIds = Array.isArray(parsed.reviewIds)
            ? parsed.reviewIds.filter((id): id is string => typeof id === 'string')
            : []
          return { chars: rows, reviewIds: reviewIds.filter((id) => ids.includes(id)) }
        }
      }
    }
  } catch (err) {
    console.warn('[LiteracyDaily] 读取今日任务缓存失败:', err)
  }

  const reviewChars = await fetchDueReviewChars(today, DAILY_REVIEW)
  const newChars = await fetchUnseenChars(level, Math.max(DAILY_TOTAL - reviewChars.length, 0))
  const chars = [...reviewChars, ...newChars].slice(0, DAILY_TOTAL)
  const reviewIds = reviewChars.map((c) => c.id)

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        date: today,
        level,
        ids: chars.map((c) => c.id),
        reviewIds,
      } satisfies LockedTask),
    )
  } catch (err) {
    console.warn('[LiteracyDaily] 写入今日任务缓存失败:', err)
  }
  return { chars, reviewIds }
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

/** Step 2 / Step 3 卡片上方的「复习 / 新学」标签 */
function TaskBadge({ review }: { review: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold md:text-xs',
        review ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700',
      )}
    >
      {review ? '🔄 复习' : '🌟 新学'}
    </span>
  )
}

/** 汉字判断（标点 / 空白不参与古诗匹配） */
const CJK = /[\u4e00-\u9fa5]/

/** 诗里出现过的汉字（去重） */
function poemChars(poem: Poem): string[] {
  const set = new Set<string>()
  for (const line of poem.content) {
    for (const char of Array.from(line)) {
      if (CJK.test(char)) set.add(char)
    }
  }
  return Array.from(set)
}

/**
 * 选本周古诗：优先避开以前挑战过的诗（module = '识字古诗' 的 detail 里记着诗名），
 * 在候选里选与孩子认识的字（去重）交集最多的一首；
 * 交集全为 0 时，退化为字数最少（最简单）的一首兜底。
 */
function pickPoem(poems: Poem[], known: Set<string>, learnedTitles: Set<string>): Poem | null {
  if (poems.length === 0) return null
  // 优先避开以前挑战过的诗；全学过时退回全量，保证仍有诗可读
  const unlearned = poems.filter((poem) => !learnedTitles.has(poem.title))
  const pool = unlearned.length > 0 ? unlearned : poems
  const scored = pool.map((poem) => ({
    poem,
    hits: poemChars(poem).filter((char) => known.has(char)).length,
  }))
  const max = Math.max(...scored.map((item) => item.hits))
  if (max > 0) {
    const top = scored.filter((item) => item.hits === max)
    return top[Math.floor(Math.random() * top.length)].poem
  }
  // 全都不认识：选汉字最少（最简单）的一首
  const totals = pool.map((poem) => ({ poem, total: poemChars(poem).length }))
  const min = Math.min(...totals.map((item) => item.total))
  const simplest = totals.filter((item) => item.total === min)
  return simplest[Math.floor(Math.random() * simplest.length)].poem
}

/**
 * 单字朗读文本：以组词为准读「字，组词的字」，
 * 保证听到的组词与字卡 UI 上的组词、Emoji 是同一个语义；
 * 数据库和本地词表都没有组词时，降级只读单字。
 */
function cardSpeakText(c: LiteracyChar): string {
  const card = resolveWordCard(c.char, c)
  if (card?.word) return `${c.char}，${card.word}的${c.char}`
  return c.char
}

/** 播放单字读音：Step 2 / Step 3 共用，统一走组词读音（内部先 stopSpeak 防止重叠） */
function speakCard(c: LiteracyChar) {
  stopSpeak()
  speakChinese(cardSpeakText(c))
}

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
  /** 字墙全量铺满：由容器尺寸 + 字数算出的格子边长与列数 */
  const [wallCell, setWallCell] = useState({ cols: 0, size: 0, gap: 8 })
  /** 字墙测量容器（用于按可视区尺寸铺满一屏） */
  const wallRef = useRef<HTMLDivElement | null>(null)

  // ── Step 2：学字卡（learn 学字卡 / quiz 找一找 两个子页面交替） ──
  const [todayLearnChars, setTodayLearnChars] = useState<LiteracyChar[]>([])
  /** 当前学到第几个字（0-4） */
  const [currentWordIndex, setCurrentWordIndex] = useState(0)
  /** 子页面：learn = 学字卡，quiz = 找一找 */
  const [subStep, setSubStep] = useState<'learn' | 'quiz'>('learn')
  /** 今日 6 字全部学完并测完 */
  const [learnDone, setLearnDone] = useState(false)
  const [flipped, setFlipped] = useState(false)
  /** 找一找：本题的候选字（目标字 + 3 个干扰字） */
  const [findOptions, setFindOptions] = useState<LiteracyChar[]>([])
  /** 找一找：点错的字 id，用于抖动标记 */
  const [findWrongIds, setFindWrongIds] = useState<Set<string>>(new Set())
  /** 找一找：是否已找出目标字（答对才解锁「下一个字」） */
  const [findSolved, setFindSolved] = useState(false)
  /** 找一找：答对后防止连点的标记（state 更新有延迟，用 ref 立即生效） */
  const findSolvedRef = useRef(false)
  /** 听音选字：答对后防止连点的标记 */
  const answeredRef = useRef(false)

  /** 今日任务里属于复习字的 id（其余为新学字），用于 Step 2 / Step 3 标签 */
  const [reviewCharIds, setReviewCharIds] = useState<string[]>([])
  /** Step 3 每个字的首次作答结果：true = 第一次就选对 */
  const quizResultsRef = useRef<Map<string, boolean>>(new Map())

  // ── Step 3：听音识字 ──
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [qIndex, setQIndex] = useState(0)
  /** 当前题已点错的选项 id */
  const [wrongIds, setWrongIds] = useState<Set<string>>(new Set())
  const [answered, setAnswered] = useState(false)
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)

  // ── Step 4：古诗跟读 + 填空 + 结算打卡 ──
  const [checkingIn, setCheckingIn] = useState(false)
  const [earnedStars, setEarnedStars] = useState<number | null>(null)
  /** 跨级别已认识的字（child_mastery.status = 'mastered'） */
  const [knownChars, setKnownChars] = useState<string[]>([])
  /** 以前挑战过的古诗名（用于本周推荐避重） */
  const [learnedPoemTitles, setLearnedPoemTitles] = useState<string[]>([])
  const [poems, setPoems] = useState<Poem[]>([])
  const [poemLoading, setPoemLoading] = useState(true)
  /** 今日匹配到的古诗 */
  const [poem, setPoem] = useState<Poem | null>(null)
  /** 在古诗组件里完成「朗读 + 填空/排序」后才能打卡 */
  const [poemCompleted, setPoemCompleted] = useState(false)

  /** 孩子认识的字：已掌握的 + 今天 Step 2 刚学的（Step 4 高亮以此为准） */
  const knownCharSet = useMemo(
    () => new Set([...knownChars, ...todayLearnChars.map((c) => c.char)]),
    [knownChars, todayLearnChars],
  )

  const load = useCallback(async (lv: number) => {
    setLoading(true)
    setError('')
    setActive(null)
    // 换级别后旧的学字/题目作废，避免用到上一级别的字
    setTodayLearnChars([])
    setQuestions([])
    try {
      const [rows, map, task] = await Promise.all([
        fetchLiteracyCharsByLevel(lv),
        fetchMasteryMap(),
        loadTodayTask(lv),
      ])
      setChars(rows)
      setMastery(map)
      // 今日任务由「复习 + 新学」混合生成并锁定，不再从摸底结果里随机抽
      setTodayLearnChars(task.chars)
      setReviewCharIds(task.reviewIds)
      setCurrentWordIndex(0)
      setSubStep('learn')
      setLearnDone(false)
      setFlipped(false)
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

  // 字墙一次性铺满：按容器宽高与总字数反解「最优列数 + 格子边长」，
  // 保证任意字数（60 字左右）在 iPad 横竖屏和手机上都能全部塞进一屏，不出现滚动
  useEffect(() => {
    if (step !== 1 || loading) return
    const el = wallRef.current
    if (!el) return
    const compute = () => {
      const n = chars.length
      // p-2 的 16px 内边距不参与格子布局
      const w = el.clientWidth - 16
      const h = el.clientHeight - 16
      if (!n || w <= 0 || h <= 0) return
      const gap = w >= 700 ? 16 : 8
      let best = { cols: 1, size: 0, gap }
      for (let c = 1; c <= Math.min(n, 16); c++) {
        const r = Math.ceil(n / c)
        const size = Math.min((w - gap * (c - 1)) / c, (h - gap * (r - 1)) / r)
        if (size > best.size + 0.5) best = { cols: c, size, gap }
      }
      setWallCell(best)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [step, loading, chars.length])

  /** 字号跟随格子边长缩放（clamp 兜底），保证字刚好撑满格子且不会溢出 */
  const wallFontSize = wallCell.size
    ? `clamp(0.9rem, ${Math.round(wallCell.size * 0.55)}px, 6rem)`
    : undefined

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

  /** 播报找一找提问：「这是花朵，请在下面找出，花」；只由按钮/进入页面触发，先打断上一段语音 */
  const askFind = (c: LiteracyChar) => {
    stopSpeak()
    const word = resolveWordCard(c.char, c)?.word
    speakChinese(word ? `这是${word}，请在下面找出，${c.char}` : `请在下面找出，${c.char}`)
  }

  /** 新卡出现 / 换卡时：只读「字，组词的字」，找一找提问改由喇叭按钮手动触发 */
  const announceCard = (c: LiteracyChar) => {
    speakCard(c)
  }

  /** 重听找一找提问（手动触发） */
  const replayFindQuestion = () => {
    if (!currentCard) return
    askFind(currentCard)
  }

  /** 进入 Step 2：直接使用当天已锁定的「3 复习 + 3 新」任务，不再随机抽字 */
  const enterStep2 = () => {
    setStep(2)
    const c = todayLearnChars[currentWordIndex]
    // 在按钮点击上下文内播报当前字卡，规避 iPad 自动播放拦截；找一找页面不播报
    if (c && subStep === 'learn' && !learnDone) announceCard(c)
  }

  const currentCard = todayLearnChars[currentWordIndex]
  /** 字卡词图：Emoji / 组词 / 语境句统一以数据库 word 为准，缺失字段回退本地预置表 */
  const wordCard: WordCard | null = currentCard ? resolveWordCard(currentCard.char, currentCard) : null

  // 换字时重出「找一找」选项：目标字 + 3 个本级干扰字，顺序随机
  useEffect(() => {
    if (step !== 2 || !currentCard) return
    const pool = chars.filter((c) => c.id !== currentCard.id)
    setFindOptions(shuffle([currentCard, ...shuffle(pool).slice(0, 3)]))
    setFindWrongIds(new Set())
    setFindSolved(false)
    findSolvedRef.current = false
    // 只在字变化时重出题，chars 变化（切级别）已由 load 清空 Step 2 状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, currentWordIndex])

  const flipCard = () => {
    if (!currentCard) return
    // 点击上下文内同步朗读「字，组词的字」，规避 iPad 的自动播放拦截；
    // 读完不自动接提问，找一找提问只能由喇叭按钮手动触发
    speakCard(currentCard)
    setFlipped((f) => !f)
  }

  /** 学字卡 → 找一找：同步在点击手势内播报提问，规避 iPad 自动播放拦截 */
  const goToQuiz = () => {
    if (!currentCard) return
    setSubStep('quiz')
    setFindWrongIds(new Set())
    findSolvedRef.current = false
    askFind(currentCard)
  }

  /** 答错后的辅助入口：只切回当前字的字卡（不动 step / currentWordIndex），并重新朗读 */
  const returnToCard = () => {
    if (!currentCard) return
    stopSpeak()
    setSubStep('learn')
    speakCard(currentCard)
  }

  /** 答对并播完语音后：还有下一个字就回到学字卡，否则进入通关状态 */
  const finishQuizRound = () => {
    if (currentWordIndex >= todayLearnChars.length - 1) {
      setLearnDone(true)
      return
    }
    const nextIndex = currentWordIndex + 1
    setCurrentWordIndex(nextIndex)
    setSubStep('learn')
    setFlipped(false)
    const next = todayLearnChars[nextIndex]
    if (next) speakCard(next)
  }

  /** 找一找：点对闪绿并朗读「答对啦 + 字词」，语音播完后才切下一个字 */
  const pickFind = async (opt: LiteracyChar) => {
    if (!currentCard || findSolvedRef.current) return
    if (opt.id === currentCard.id) {
      findSolvedRef.current = true
      setFindSolved(true)
      const word = wordCard?.word
      const cardText = word ? `${currentCard.char}，${word}的${currentCard.char}` : currentCard.char
      stopSpeak()
      await speakLinesAsync(['答对啦', cardText])
      finishQuizRound()
    } else {
      setFindWrongIds((prev) => new Set(prev).add(opt.id))
      stopSpeak()
      speakChinese('再试一次哦')
    }
  }

  // ──────────────── Step 3 逻辑 ────────────────

  /** 题库 = 今日 6 个字（3 复习 + 3 新），每个字都要考到，各配 3 个干扰项 */
  const enterStep3 = () => {
    // 从 Step 3 退回 Step 2 再前进时不重新出题，保留已答进度
    if (questions.length > 0) {
      setStep(3)
      return
    }
    quizResultsRef.current = new Map()
    const masteredPool = chars.filter(
      (c) => mastery[c.id] === 'mastered' && !todayLearnChars.some((t) => t.id === c.id),
    )
    let targets =
      todayLearnChars.length > 0
        ? todayLearnChars.slice()
        : shuffle(masteredPool).slice(0, QUIZ_COUNT)
    // 极端情况：今日任务为空且本级也没有已认识的字，用本级其他字补齐
    if (targets.length === 0) targets = shuffle(chars).slice(0, QUIZ_COUNT)
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
    answeredRef.current = false
    speakCard(currentQ.target)
  }, [step, qIndex, currentQ])

  /** 点选项：首答对才计分；点错抖动可继续点；点对等语音播完再切下一题 */
  const answer = async (opt: LiteracyChar) => {
    if (!currentQ || answeredRef.current || wrongIds.has(opt.id)) return
    if (opt.id === currentQ.target.id) {
      // 记录该字的首次作答结果：之前点过错就记为「不是一次答对」
      quizResultsRef.current.set(currentQ.target.id, wrongIds.size === 0)
      if (wrongIds.size === 0) setFirstTryCorrect((n) => n + 1)
      answeredRef.current = true
      setAnswered(true)
      stopSpeak()
      await speakLinesAsync(['答对啦', cardSpeakText(currentQ.target)])
      if (qIndex + 1 < questions.length) {
        setQIndex((i) => i + 1)
        setWrongIds(new Set())
        setAnswered(false)
      }
    } else {
      if (!quizResultsRef.current.has(currentQ.target.id)) {
        quizResultsRef.current.set(currentQ.target.id, false)
      }
      setWrongIds((prev) => new Set(prev).add(opt.id))
      // 点错时读出被点的字，孩子能听到自己选了什么
      speakCard(opt)
    }
  }

  // ──────────────── Step 4 逻辑 ────────────────

  /** 拉诗库与跨级别已认识的字（诗库不随级别变化，只请求一次） */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [poemRows, mastered, learnedTitles] = await Promise.all([
          fetchPoems(),
          fetchMasteredChars(),
          // 表或 detail 字段尚未就绪时不阻塞古诗推荐
          fetchLearnedPoemTitles().catch((err: unknown) => {
            console.warn('[LiteracyDaily] 读取已学古诗失败:', errMsg(err))
            return [] as string[]
          }),
        ])
        if (cancelled) return
        setPoems(poemRows)
        setKnownChars(mastered)
        setLearnedPoemTitles(learnedTitles)
      } catch (err) {
        console.error('[LiteracyDaily] 加载古诗失败:', err)
        if (!cancelled) setError(`加载古诗失败：${errMsg(err)}`)
      } finally {
        if (!cancelled) setPoemLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 记忆结果已回写（同一次学习流程只回写一次，防止来回切步骤重复加等级） */
  const memoryAppliedRef = useRef(false)

  /** 进入 Step 4：先把 Step 3 的作答结果回写 child_mastery，再清空古诗重新匹配 */
  const enterStep4 = async () => {
    stopSpeak()
    setPoemCompleted(false)
    setPoem(null)

    if (!memoryAppliedRef.current) {
      try {
        await Promise.all(
          todayLearnChars.map(async (c) => {
            const firstTry = quizResultsRef.current.get(c.id)
            // 没被考到的字（极端情况）不更新记忆
            if (firstTry === undefined) return
            await applyQuizResult(c.id, firstTry)
          }),
        )
        memoryAppliedRef.current = true
      } catch (err) {
        console.error('[LiteracyDaily] 回写记忆数据失败:', errMsg(err), err)
        setError(`记忆数据保存失败：${errMsg(err)}`)
      }
    }
    setStep(4)
  }

  /**
   * 选本周古诗（一周锁定一首）：
   * 1. 先读 localStorage `weekly_poem_${weekKey}`，命中则按诗 ID 回读数据库；
   * 2. 未命中或有变化时按「认识字交集最多 + 避开已学」重新挑，并写入本周缓存；
   * 3. 诗库/认识字/已学诗名都就绪后才算，避免用到半成品数据。
   */
  useEffect(() => {
    if (step !== 4 || poem || poemLoading) return
    let cancelled = false
    ;(async () => {
      const weekKey = currentWeekKey()
      try {
        const cached = window.localStorage.getItem(weeklyPoemKey(weekKey))
        if (cached) {
          const parsed = JSON.parse(cached) as Partial<WeeklyPoem>
          if (typeof parsed.id === 'string') {
            const row = await fetchPoemById(parsed.id).catch((err: unknown) => {
              console.warn('[LiteracyDaily] 回读本周古诗失败:', errMsg(err))
              return null
            })
            if (cancelled) return
            if (row) {
              setPoem(row)
              return
            }
          }
        }
      } catch (err) {
        console.warn('[LiteracyDaily] 读取本周古诗缓存失败:', errMsg(err))
      }

      const picked = pickPoem(poems, knownCharSet, new Set(learnedPoemTitles))
      if (cancelled) return
      if (!picked) {
        setPoem(null)
        return
      }
      try {
        window.localStorage.setItem(
          weeklyPoemKey(weekKey),
          JSON.stringify({ id: picked.id, title: picked.title, date: todayStr() } satisfies WeeklyPoem),
        )
      } catch (err) {
        console.warn('[LiteracyDaily] 写入本周古诗缓存失败:', errMsg(err))
      }
      setPoem(picked)
    })()
    return () => {
      cancelled = true
    }
  }, [step, poem, poemLoading, poems, knownCharSet, learnedPoemTitles])

  /** 上一步：语音打断并退回上一个环节（各步骤状态保留，回到下一步可继续） */
  const goBackStep = () => {
    if (step <= 1) return
    stopSpeak()
    setError('')
    setStep(step - 1)
  }

  /** 重新开始：重置步骤进度，但保留当天已锁定的 6 字任务 */
  const resetWizard = () => {
    setUnknownChars([])
    setCurrentWordIndex(0)
    setSubStep('learn')
    setLearnDone(false)
    setFlipped(false)
    setFindSolved(false)
    setFindWrongIds(new Set())
    findSolvedRef.current = false
    answeredRef.current = false
    setQuestions([])
    setQIndex(0)
    setWrongIds(new Set())
    setAnswered(false)
    setFirstTryCorrect(0)
    setPoem(null)
    setPoemCompleted(false)
    // 重置结算状态：否则二次进入 Step 4 时 earnedStars 仍非 null，
    // 会导致打卡按钮一直显示「今日已打卡」
    setEarnedStars(null)
    setCheckingIn(false)
    setStep(1)
  }

  const handleCheckin = async () => {
    if (checkingIn || earnedStars !== null) return
    // 在古诗组件里完成朗读 + 填空/排序才允许打卡
    if (!poemCompleted) return
    setCheckingIn(true)
    setError('')
    try {
      // 服务端没查到识字任务时，这里再兜底补建一次，避免「学完却打不了卡」
      let id = taskId
      if (!id) {
        id = await ensureModuleTaskIdBySubjectName({
          subjectName: '语文',
          title: '识字乐园',
          gameRoute: '/chinese/literacy/daily',
        })
      }
      if (!id) throw new Error('未能创建识字任务，请稍后重试')

      const stars = await handleGameCheckin(id, questions.length, firstTryCorrect, isParent)
      setEarnedStars(stars)
      // 打卡成功：语音播报今日总结
      stopSpeak()
      speakChinese(summaryText)
      // 学习得分记录；表未建好时只记日志，不影响打卡
      try {
        await insertLearningRecord({
          recordDate: todayStr(),
          subject: '语文',
          module: '识字乐园',
          newCount,
          reviewCount,
          totalCount: todayLearnChars.length,
          firstTryCorrect,
          score: stars,
        })
      } catch (err) {
        console.warn('[LiteracyDaily] 写入 learning_records 失败:', errMsg(err), err)
      }

      // 记录本周挑战过的古诗（诗名写进 detail，供下周推荐避重）；失败不影响打卡
      if (poem) {
        try {
          await insertLearningRecord({
            recordDate: todayStr(),
            subject: '语文',
            module: '识字古诗',
            newCount: 0,
            reviewCount: 0,
            totalCount: poemChars(poem).length,
            firstTryCorrect: 0,
            score: stars,
            detail: poem.title,
          })
        } catch (err) {
          console.warn('[LiteracyDaily] 写入古诗学习记录失败:', errMsg(err), err)
        }
      }
    } catch (err) {
      console.error('[LiteracyDaily] 打卡失败:', err)
      setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCheckingIn(false)
    }
  }

  // ──────────────── 渲染 ────────────────

  /** 今日复习字 / 新学字数量（任务锁定后恒定） */
  const reviewCount = todayLearnChars.filter((c) => reviewCharIds.includes(c.id)).length
  const newCount = todayLearnChars.length - reviewCount
  const summaryText = `今天新学了 ${newCount} 个字，复习了 ${reviewCount} 个字，你太棒啦`
  const canCheckin = poemCompleted

  return (
    <>
      {/* 统一页面骨架：占满可视高度（扣掉全局 Header 4rem 与固定底部 Tab 6rem），
          纵向 = 顶部返回入口 + 自适应内容区 + 固定底部操作栏，整页不滚动 */}
      <div className="flex h-[calc(100dvh-10rem)] max-h-screen flex-col overflow-hidden bg-gray-50">
      {/* 顶部只保留「返回语文主页」入口 */}
      {backHref && (
        <div className="flex-none px-5 pb-1 pt-1">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            返回语文主页
          </Link>
        </div>
      )}

      {/* 内容区：居中自适应，各 Step 只负责自己的内容，不包含底部按钮 */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-4">
        {error && (
          <p className="mb-2 w-full max-w-md shrink-0 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* ════════ Step 1：摸底测试（字墙，一屏铺满） ════════ */}
        {step === 1 && (
          <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
            <div className="flex shrink-0 items-center gap-3">
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
              <p className="flex flex-1 items-center justify-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
                正在加载字库…
              </p>
            ) : chars.length === 0 ? (
              <p className="flex flex-1 items-center justify-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
                {level} 级还没有汉字，先在 literacy_chars 表里补充数据吧
              </p>
            ) : (
              /* 全量字墙：不翻页、不滚动，所有字按算出的格子边长一次性铺满容器 */
              <div
                ref={wallRef}
                className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
              >
                <ul
                  className={cn(
                    'grid',
                    !wallCell.size && 'grid-cols-6 gap-2 md:grid-cols-10 md:gap-4',
                  )}
                  style={
                    wallCell.size
                      ? {
                          gap: wallCell.gap,
                          gridTemplateColumns: `repeat(${wallCell.cols}, ${wallCell.size}px)`,
                          gridAutoRows: `${wallCell.size}px`,
                        }
                      : undefined
                  }
                >
                  {chars.map((c) => {
                    const status = mastery[c.id]
                    return (
                      <li key={c.id} className="min-h-0 min-w-0">
                        <button
                          type="button"
                          onClick={() => openTest(c)}
                          aria-label={`测试汉字 ${c.char}`}
                          style={wallFontSize ? { fontSize: wallFontSize } : undefined}
                          className={cn(
                            'relative flex h-full w-full items-center justify-center rounded-xl border bg-card font-bold leading-none shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md md:rounded-2xl',
                            !wallFontSize && 'text-[clamp(1rem,2.6vw,3rem)]',
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
              </div>
            )}

            <p className="shrink-0 text-center text-xs text-muted-foreground">
              已点出不认识 {unknownChars.length} 字
            </p>
          </div>
        )}

        {/* ════════ Step 2：学字卡 ⇄ 找一找（两个子页面交替，各自铺满全屏） ════════ */}
        {step === 2 && (
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center md:mx-auto md:max-w-5xl">
            {todayLearnChars.length === 0 ? (
              <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 rounded-2xl border bg-card p-8 text-center">
                <p className="text-lg font-bold">本级没有需要学的新字 🎉</p>
                <p className="text-sm text-muted-foreground">可以直接进入听音识字</p>
              </div>
            ) : learnDone ? (
              /* 今日任务学完并测完：通关动画 */
              <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-emerald-300 bg-emerald-50/60 text-center">
                <span className="animate-bounce text-7xl md:text-9xl">🎉</span>
                <p className="text-2xl font-bold text-emerald-700 md:text-4xl">
                  {todayLearnChars.length} 个字全部学会啦！
                </p>
                <p className="text-sm text-muted-foreground md:text-lg">
                  准备好去「听音识字」挑战了吗？
                </p>
              </div>
            ) : subStep === 'learn' ? (
              /* ── 子页面 A：学字卡（一张巨卡吃满全屏） ── */
              <>
                <div className="flex shrink-0 items-center justify-center gap-2 pb-1">
                  <TaskBadge review={reviewCharIds.includes(currentCard.id)} />
                  <p className="text-center text-xs text-muted-foreground md:text-sm">
                    第 {currentWordIndex + 1} / {todayLearnChars.length} 个字 · 看看它，记住它
                  </p>
                </div>
                <div className="relative min-h-0 w-full flex-1 rounded-3xl [perspective:1400px]">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`字卡 ${currentCard.char}，点击翻转`}
                    onClick={flipCard}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        flipCard()
                      }
                    }}
                    className="grid h-full w-full cursor-pointer grid-rows-1 rounded-3xl transition-transform duration-500 ease-out"
                    style={{
                      transformStyle: 'preserve-3d',
                      transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                    }}
                  >
                    {/* 正面：极限放大的汉字；非当前面用 invisible 主动隐藏，兼容 iPad Safari */}
                    <div
                      className={cn(
                        'col-start-1 row-start-1 flex flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl border-2 bg-card p-3 shadow-sm [backface-visibility:hidden] [-webkit-backface-visibility:hidden] md:gap-2 md:p-4',
                        flipped && 'invisible',
                      )}
                      style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                    >
                      <span className="text-[min(30vh,36vw)] font-bold leading-none">
                        {currentCard.char}
                      </span>
                      {currentCard.pinyin && (
                        <span className="text-lg text-muted-foreground md:text-3xl">
                          {currentCard.pinyin}
                        </span>
                      )}
                      {wordCard?.word && (
                        <span className="text-[10px] text-muted-foreground md:text-sm">
                          点一点，翻过来看词图
                        </span>
                      )}
                    </div>

                    {/* 背面：大 Emoji + 醒目组词 + 语境句 */}
                    <div
                      className={cn(
                        'col-start-1 row-start-1 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-primary/40 bg-card p-6 text-center [backface-visibility:hidden] [-webkit-backface-visibility:hidden] md:gap-3 md:p-8',
                        !flipped && 'invisible',
                      )}
                      style={{
                        backfaceVisibility: 'hidden',
                        WebkitBackfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                      }}
                    >
                      {wordCard?.emoji && (
                        <span className="text-[clamp(3rem,9vh,7rem)] leading-none">
                          {wordCard.emoji}
                        </span>
                      )}
                      {wordCard?.word && (
                        <span className="text-[clamp(2rem,6vh,4.5rem)] font-bold">
                          {wordCard.word}
                        </span>
                      )}
                      {wordCard?.sentence && (
                        <span className="text-[clamp(1rem,2.6vh,1.75rem)] font-medium text-primary">
                          {wordCard.sentence}
                        </span>
                      )}
                      {wordCard?.structure && (
                        <span className="text-xs text-muted-foreground md:text-sm">
                          结构：{wordCard.structure}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground md:text-xs">
                        再点一次翻回正面
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      speakCard(currentCard)
                    }}
                    aria-label={`播放 ${currentCard.char} 的读音`}
                    className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary/90 px-2.5 py-1 text-xs font-bold text-primary-foreground shadow-md transition-transform hover:scale-105 md:right-4 md:top-4 md:px-4 md:py-2 md:text-base"
                  >
                    <Volume2 className="size-3.5 md:size-5" aria-hidden="true" />
                    听一听
                  </button>
                </div>
              </>
            ) : (
              /* ── 子页面 B：听音找字（上半屏巨大 Emoji 提示，下半屏 4 个巨字选项） ── */
              <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-between gap-2 md:gap-3">
                <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 md:gap-2">
                  <TaskBadge review={reviewCharIds.includes(currentCard.id)} />
                  {/* 词图占满上半屏剩余空间；按钮放在外层，永远不会被 Emoji 挤掉 */}
                  <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
                    <span
                      className="text-[18vh] leading-none md:text-[24vh]"
                      role="img"
                      aria-label="词语图片提示"
                    >
                      {wordCard?.emoji || '✨'}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 gap-2 px-4 py-2 text-sm md:px-6 md:py-3 md:text-base"
                    onClick={replayFindQuestion}
                  >
                    <Volume2 className="size-4" aria-hidden="true" />
                    再听一遍
                  </Button>
                </div>

                <div className="grid w-full max-w-5xl shrink-0 grid-cols-4 gap-2 md:gap-4">
                  {findOptions.map((opt) => {
                    const wrong = findWrongIds.has(opt.id)
                    const right = findSolved && opt.id === currentCard.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => pickFind(opt)}
                        disabled={findSolved}
                        className={cn(
                          'flex h-[16vh] w-full items-center justify-center rounded-3xl border-2 bg-background text-4xl font-bold transition-all md:h-[18vh] md:text-6xl lg:text-7xl',
                          wrong && 'math-shake border-destructive bg-destructive/10 text-destructive',
                          right && 'border-emerald-500 bg-emerald-100 text-emerald-700',
                          !wrong && !right && 'hover:-translate-y-0.5 hover:shadow-md',
                        )}
                      >
                        {opt.char}
                      </button>
                    )
                  })}
                </div>

                {/* 答题结果统一显示在选项下方、页面中部 */}
                <div className="flex h-6 shrink-0 flex-col items-center justify-center md:h-8">
                  {findSolved ? (
                    <p className="text-base font-bold text-emerald-600 md:text-xl">答对啦！🎉</p>
                  ) : findWrongIds.size > 0 ? (
                    <p className="text-base font-bold text-destructive md:text-xl">再找找看～</p>
                  ) : null}
                </div>

                {!findSolved && findWrongIds.size > 0 && (
                  <Button
                    variant="ghost"
                    className="shrink-0 px-3 py-1.5 text-xs md:text-sm"
                    onClick={returnToCard}
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    返回看看字卡
                  </Button>
                )}

                <p className="shrink-0 text-[10px] text-muted-foreground md:text-xs">
                  第 {currentWordIndex + 1} / {todayLearnChars.length} 个字
                </p>
              </div>
            )}
          </div>
        )}

        {/* ════════ Step 3：听音识字 ════════ */}
        {step === 3 && currentQ && (
          <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
            <p className="flex flex-wrap items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              {todayLearnChars.some((c) => c.id === currentQ.target.id) && (
                <TaskBadge review={reviewCharIds.includes(currentQ.target.id)} />
              )}
              第 {qIndex + 1} / {questions.length} 题 · 听读音，选出正确的字
            </p>
            <button
              type="button"
              onClick={() => speakCard(currentQ.target)}
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
                      'flex h-28 items-center justify-center rounded-2xl border-2 bg-card text-5xl font-bold transition-all hover:bg-muted/40 disabled:cursor-not-allowed md:h-auto md:min-h-0 md:flex-1 md:text-7xl',
                      wrong && 'math-shake border-destructive bg-destructive/10 text-destructive opacity-50',
                      correct && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                    )}
                  >
                    {opt.char}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ════════ Step 4：古诗互动（朗读 + 排序/填空），完成后才能打卡 ════════ */}
        {step === 4 && (
          <div className="flex h-full min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden">
            <div className="flex w-full shrink-0 items-center">
              <button
                type="button"
                onClick={goBackStep}
                className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 md:text-sm"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                上一步
              </button>
            </div>

            {poemLoading ? (
              <p className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
                正在加载古诗…
              </p>
            ) : !poem ? (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                还没有古诗数据，请先执行 scripts/seed-poems.sql 导入诗库
              </p>
            ) : (
              <div className="flex min-h-0 w-full flex-1 flex-col">
                <PoemPlayground
                  poem={poem}
                  knownChars={Array.from(knownCharSet)}
                  compact
                  onComplete={() => setPoemCompleted(true)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作栏：统一容器类，永远吸附在内容区下方 */}
      {step === 1 && (
        <div className="mx-auto flex w-full max-w-2xl flex-none gap-4 px-4 pb-8 pt-4 lg:max-w-4xl">
          <Button
            className="w-full py-4 text-base md:text-lg"
            disabled={loading || chars.length === 0}
            onClick={enterStep2}
          >
            下一步：学习新字
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="mx-auto flex w-full max-w-2xl flex-none gap-4 px-4 pb-8 pt-4 lg:max-w-4xl">
          {learnDone ? (
            <Button className="w-full py-4 text-base md:text-lg" onClick={enterStep3}>
              进入下一步：听音识字
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : todayLearnChars.length === 0 ? (
            <>
              <Button
                variant="outline"
                className="shrink-0 py-4 text-base md:text-lg"
                onClick={goBackStep}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                上一步
              </Button>
              <Button className="flex-1 py-4 text-base md:text-lg" onClick={enterStep3}>
                下一步：听音识字
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </>
          ) : subStep === 'learn' ? (
            <>
              <Button
                variant="outline"
                className="shrink-0 py-4 text-base md:text-lg"
                onClick={goBackStep}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                上一步
              </Button>
              <Button className="flex-1 py-4 text-base md:text-lg" onClick={goToQuiz}>
                我记住了，去测试
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </>
          ) : (
            /* 找一找子页面：只回到当前字的字卡，不后退整个 step */
            <Button
              variant="outline"
              className="w-full py-4 text-base md:text-lg"
              onClick={returnToCard}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              返回看看字卡
            </Button>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="mx-auto flex w-full max-w-2xl flex-none gap-4 px-4 pb-8 pt-4 lg:max-w-4xl">
          <Button variant="outline" className="shrink-0 py-4 text-base md:text-lg" onClick={goBackStep}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            上一步
          </Button>
          <Button
            className="flex-1 py-4 text-base md:text-lg"
            disabled={!(answered && qIndex + 1 >= questions.length)}
            onClick={enterStep4}
          >
            下一步：古诗跟读
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="mx-auto flex w-full max-w-2xl flex-none flex-col gap-2 px-4 pb-8 pt-4 lg:max-w-4xl">
          {earnedStars !== null ? (
            /* 打卡成功：温馨总结 + 等待家长审核 */
            <div className="flex flex-col items-center gap-2">
              <p className="text-center text-base font-bold text-emerald-700 md:text-lg">
                {summaryText}！
              </p>
              <p className="text-center text-sm font-bold text-emerald-700 md:text-base">
                <CheckCircle2 className="mr-1 inline size-4 align-[-2px]" aria-hidden="true" />
                打卡成功！家长审核通过后就能获得 {earnedStars} 颗星星啦 ⭐
              </p>
              <div className="flex w-full gap-2">
                <Button
                  variant="outline"
                  className="flex-1 py-3 text-sm md:text-base"
                  onClick={resetWizard}
                >
                  重新开始
                </Button>
                <Button
                  className="flex-1 py-3 text-sm md:text-base"
                  onClick={() => router.push('/')}
                >
                  返回主页
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                className="w-full py-4 text-base font-bold md:text-lg"
                disabled={!canCheckin || checkingIn}
                onClick={handleCheckin}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {checkingIn ? '打卡中…' : '完成学习打卡'}
              </Button>
              {!canCheckin && (
                <p className="text-center text-[11px] text-muted-foreground md:text-xs">
                  先在古诗里完成朗读和排序或填空，就能打卡啦
                </p>
              )}
            </>
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
