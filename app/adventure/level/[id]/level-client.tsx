'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth-provider'
import { MEMORY_EMOJIS } from '@/lib/memory-emojis'
import { insertAdventureProgress } from '@/lib/supabase-queries'
import { handleGameCheckin } from '@/lib/rewards'
import { speakChar, speakChinese } from '@/lib/tts'
import { cn } from '@/lib/utils'

/** 普通关 3 颗心（3 题），Boss 关 5 颗心（5 题） */
const NORMAL_HP = 3
const BOSS_HP = 5
/** 答对后到下一题的间隔，让「攻击成功！」播报完 */
const NEXT_QUESTION_DELAY = 900
/** 与地图页共用同一个 localStorage 键 */
const STORAGE_KEY = 'adventure-max-unlocked-level'

/** 已掌握汉字不足时使用的默认字库（常见字 + 拼音） */
const CHAR_PINYIN: { char: string; pinyin: string }[] = [
  { char: '大', pinyin: 'dà' }, { char: '小', pinyin: 'xiǎo' }, { char: '山', pinyin: 'shān' },
  { char: '水', pinyin: 'shuǐ' }, { char: '日', pinyin: 'rì' }, { char: '月', pinyin: 'yuè' },
  { char: '火', pinyin: 'huǒ' }, { char: '木', pinyin: 'mù' }, { char: '人', pinyin: 'rén' },
  { char: '口', pinyin: 'kǒu' }, { char: '手', pinyin: 'shǒu' }, { char: '耳', pinyin: 'ěr' },
  { char: '足', pinyin: 'zú' }, { char: '鸟', pinyin: 'niǎo' }, { char: '鱼', pinyin: 'yú' },
  { char: '虫', pinyin: 'chóng' }, { char: '花', pinyin: 'huā' }, { char: '草', pinyin: 'cǎo' },
  { char: '星', pinyin: 'xīng' }, { char: '云', pinyin: 'yún' },
]

type MasteredChar = { char: string; pinyin: string | null }

type Question = {
  kind: 'chinese' | 'math' | 'logic'
  /** 题面主体：大汉字 / 算式 / 规律序列 */
  body: string
  /** TTS 播报的提示语 */
  prompt: string
  options: string[]
  answer: string
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

/** 语文题：看汉字选正确拼音。优先用孩子已掌握的字；高关卡增加到 4 个选项 */
function genChinese(masteredChars: MasteredChar[], level: number): Question {
  const optionCount = level >= 10 ? 4 : 3
  const masteredPool = masteredChars.filter(
    (item): item is { char: string; pinyin: string } => Boolean(item.pinyin),
  )
  // 至少需要 1 个目标字 + (optionCount-1) 个不同拼音的干扰项
  const pool = masteredPool.length >= optionCount ? masteredPool : CHAR_PINYIN

  const target = pool[Math.floor(Math.random() * pool.length)]
  const distractors = shuffle(pool.filter((item) => item.pinyin !== target.pinyin))
    .slice(0, optionCount - 1)
    .map((item) => item.pinyin)
  return {
    kind: 'chinese',
    body: target.char,
    prompt: '这个字念什么？',
    options: shuffle([target.pinyin, ...distractors]),
    answer: target.pinyin,
  }
}

/** 数学题：范围取 adventure_levels 表的 difficulty_max；前 2 关只出加法，之后随机加减 */
function genMath(difficultyMax: number, level: number): Question {
  const max = difficultyMax
  const isAdd = level <= 2 ? true : Math.random() < 0.5
  let a = 0
  let b = 0
  if (isAdd) {
    a = randInt(1, max - 1)
    b = randInt(1, max - a)
  } else {
    a = randInt(2, max)
    b = randInt(1, a - 1)
  }
  const answer = isAdd ? a + b : a - b
  const options = new Set<number>([answer])
  while (options.size < 3) options.add(randInt(0, max))
  return {
    kind: 'math',
    body: `${a} ${isAdd ? '+' : '-'} ${b} = ?`,
    prompt: `算一算，${a} ${isAdd ? '加' : '减'} ${b} 等于几？`,
    options: shuffle(Array.from(options)).map(String),
    answer: String(answer),
  }
}

/** 逻辑题：emoji 找规律，选下一个（ABAB / AABB / ABC 三种模式） */
function genLogic(): Question {
  const emojis = shuffle(MEMORY_EMOJIS).slice(0, 3).map((item) => item.emoji)
  const mode = randInt(0, 2)
  let sequence: string[]
  let answer: string
  if (mode === 0) {
    sequence = [emojis[0], emojis[1], emojis[0], emojis[1]]
    answer = emojis[0]
  } else if (mode === 1) {
    sequence = [emojis[0], emojis[0], emojis[1], emojis[1], emojis[0]]
    answer = emojis[0]
  } else {
    sequence = [emojis[0], emojis[1], emojis[2], emojis[0]]
    answer = emojis[1]
  }
  return {
    kind: 'logic',
    body: [...sequence, '❓'].join(' '),
    prompt: '找规律，下一个是什么？',
    options: shuffle([...emojis]),
    answer,
  }
}

function loadMaxUnlocked(): number {
  try {
    const value = Number.parseInt(window.localStorage.getItem(STORAGE_KEY) ?? '', 10)
    if (Number.isInteger(value) && value >= 1) return value
  } catch {
    // 忽略损坏数据
  }
  return 1
}

function saveMaxUnlocked(level: number) {
  window.localStorage.setItem(STORAGE_KEY, String(Math.max(level, loadMaxUnlocked())))
}

type Phase = 'fight' | 'chest' | 'opened'

/** 题型按 语文 → 数学 → 逻辑 循环，普通关 3 题、Boss 关 5 题 */
const QUESTION_CYCLE: ('chinese' | 'math' | 'logic')[] = ['chinese', 'math', 'logic']

export function LevelChallenge({
  level,
  maxLevel,
  boss,
  difficultyMax,
  masteredChars,
  serverPassed,
  taskId,
}: {
  level: number
  /** 关卡总数（adventure_levels 表行数） */
  maxLevel: number
  /** 是否 Boss 关（5 颗心 5 题） */
  boss: boolean
  /** 数学题数值范围上限（adventure_levels.difficulty_max） */
  difficultyMax: number
  masteredChars: MasteredChar[]
  /** Supabase adventure_progress 里的通关记录，与本地进度取并集判断解锁 */
  serverPassed: number[]
  /** 打卡任务 id（冒险岛模块任务） */
  taskId: string | null
}) {
  const router = useRouter()
  const { role } = useAuth()
  const isParent = role === 'parent'
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [hp, setHp] = useState(NORMAL_HP)
  const [totalHp, setTotalHp] = useState(NORMAL_HP)
  const [phase, setPhase] = useState<Phase>('fight')
  const [wrongPicks, setWrongPicks] = useState<string[]>([])
  const [shakeKey, setShakeKey] = useState(0)
  const [locked, setLocked] = useState<boolean | null>(null)
  /** 首答正确数（本题没点错过就答对） */
  const [firstTryCorrect, setFirstTryCorrect] = useState(0)
  const [earnedStars, setEarnedStars] = useState(0)
  const advanceTimer = useRef<number | null>(null)
  const recordedRef = useRef(false)

  const valid = level >= 1 && level <= maxLevel
  const monster = boss ? '👹' : '👾'

  // 初始化：合并本地与服务端进度判断是否解锁；按血量生成题目（客户端生成，避免 hydration 不匹配）
  useEffect(() => {
    if (!valid) return
    const serverMax = serverPassed.length > 0 ? Math.max(...serverPassed) + 1 : 1
    const maxUnlocked = Math.max(loadMaxUnlocked(), serverMax)
    setLocked(level > maxUnlocked)

    const total = boss ? BOSS_HP : NORMAL_HP
    setTotalHp(total)
    setHp(total)
    setQuestions(
      Array.from({ length: total }, (_, i) => {
        const kind = QUESTION_CYCLE[i % QUESTION_CYCLE.length]
        return kind === 'chinese'
          ? genChinese(masteredChars, level)
          : kind === 'math'
            ? genMath(difficultyMax, level)
            : genLogic()
      }),
    )
    return () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, valid])

  const question = questions[qIndex] ?? null

  // 每出现一道新题自动播报提示语
  useEffect(() => {
    if (!question || phase !== 'fight') return
    if (question.kind === 'chinese') {
      speakChar(question.body)
    } else {
      speakChinese(question.prompt)
    }
  }, [question, phase])

  if (!valid) {
    return (
      <>
        <PageHeader title="关卡不存在" backHref="/adventure" backLabel="返回地图" />
        <p className="px-5 text-sm text-muted-foreground">冒险岛只有第 1 ~ {maxLevel} 关哦。</p>
      </>
    )
  }

  if (locked === null) {
    return (
      <>
        <PageHeader title={`第 ${level} 关`} backHref="/adventure" backLabel="返回地图" />
        <div className="px-5" aria-hidden="true">
          <div className="h-40 rounded-2xl bg-muted/60" />
        </div>
      </>
    )
  }

  if (locked) {
    return (
      <>
        <PageHeader title={`第 ${level} 关`} backHref="/adventure" backLabel="返回地图" />
        <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
          <span className="text-5xl" aria-hidden="true">🔒</span>
          <p className="font-medium">这一关还没解锁</p>
          <p className="text-sm text-muted-foreground">先通关第 {level - 1} 关再来挑战吧</p>
        </div>
      </>
    )
  }

  const choose = (option: string) => {
    if (!question || phase !== 'fight') return
    if (wrongPicks.includes(option)) return

    if (option === question.answer) {
      if (wrongPicks.length === 0) setFirstTryCorrect((c) => c + 1)
      const nextHp = hp - 1
      setHp(nextHp)
      speakChinese(
        nextHp === 0 ? `攻击成功！${boss ? 'Boss' : '怪兽'}被打败啦！` : '攻击成功！',
      )
      if (nextHp === 0) {
        setPhase('chest')
      } else {
        advanceTimer.current = window.setTimeout(() => {
          advanceTimer.current = null
          setWrongPicks([])
          setQIndex((i) => i + 1)
        }, NEXT_QUESTION_DELAY)
      }
    } else {
      setWrongPicks((prev) => [...prev, option])
      setShakeKey((k) => k + 1)
      speakChinese('再试一次')
    }
  }

  /** 领取宝箱：更新解锁进度（localStorage + Supabase）并打卡 */
  const openChest = () => {
    if (phase !== 'chest') return
    setPhase('opened')
    speakChinese('太棒了，通关啦！')

    if (!recordedRef.current) {
      recordedRef.current = true
      saveMaxUnlocked(level + 1)
      // Supabase 进度（跨设备同步）：表未建时静默降级，本地进度已保留
      void insertAdventureProgress(level)
      // 通关打卡：按首答正确率发放星星
      if (taskId) {
        handleGameCheckin(taskId, totalHp, firstTryCorrect, isParent)
          .then((stars) => setEarnedStars(stars))
          .catch((err: unknown) => {
            console.error('[Level] 打卡失败:', err)
          })
      }
    }
  }

  const backToMap = () => {
    // 保底再写一次本地进度（正常在领宝箱时已写入）
    saveMaxUnlocked(level + 1)
    router.push('/adventure')
  }

  return (
    <>
      <PageHeader
        title={boss ? `第 ${level} 关 · Boss 战` : `第 ${level} 关`}
        backHref="/adventure"
        backLabel="返回地图"
      />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {/* 怪兽区 */}
        <section className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-5">
          {phase === 'fight' ? (
            <>
              <span key={shakeKey} className={cn('text-7xl', shakeKey > 0 && 'math-shake')} aria-hidden="true">
                {monster}
              </span>
              <div className="text-xl tracking-widest" aria-label={`怪兽剩余 ${hp} 点血`}>
                {Array.from({ length: totalHp }, (_, i) => (i < hp ? '❤️' : '🤍')).join('')}
              </div>
              <p className="text-xs text-muted-foreground">
                {boss ? 'Boss 有 5 颗心，答对 5 题才能打败它' : '答对题目就能攻击怪兽'}
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={openChest}
                disabled={phase === 'opened'}
                aria-label={phase === 'chest' ? '打开宝箱' : '宝箱已打开'}
                className={cn('text-7xl transition-transform', phase === 'chest' && 'animate-bounce hover:scale-110')}
              >
                🎁
              </button>
              {phase === 'opened' && (
                <>
                  <div className="flex gap-1 text-5xl" aria-hidden="true">
                    {Array.from({ length: Math.max(earnedStars, 1) }, (_, i) => (
                      <span
                        key={i}
                        className="animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }}
                      >
                        ⭐
                      </span>
                    ))}
                  </div>
                  <p className="text-base font-medium text-amber-600">
                    本次答对 {totalHp} 题（首答正确 {firstTryCorrect} 题），获得 {earnedStars} 颗星星！
                  </p>
                  <Button size="lg" className="mt-1 text-lg" onClick={backToMap}>
                    继续前进
                  </Button>
                </>
              )}
              {phase === 'chest' && (
                <p className="text-sm text-muted-foreground">{boss ? 'Boss' : '怪兽'}被打败啦，快点击宝箱！</p>
              )}
            </>
          )}
        </section>

        {/* 题目卡片区（iPad 大按钮） */}
        {phase === 'fight' && question && (
          <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">
              第 {qIndex + 1} 题 / 共 {totalHp} 题 ·{' '}
              {question.kind === 'chinese' ? '语文' : question.kind === 'logic' ? '逻辑' : '数学'}
            </p>
            <button
              type="button"
              onClick={() =>
                question.kind === 'chinese' ? speakChar(question.body) : speakChinese(question.prompt)
              }
              aria-label="播放题目语音"
              className={cn(
                'flex min-h-28 items-center justify-center rounded-xl bg-muted/50 px-3 py-5 text-center',
                question.kind === 'logic'
                  ? 'text-4xl leading-relaxed tracking-wider'
                  : 'text-5xl font-bold tracking-widest',
              )}
            >
              {question.body}
            </button>
            <div className={cn('grid gap-3', question.options.length === 4 ? 'grid-cols-2' : 'grid-cols-3')}>
              {question.options.map((option) => {
                const wrong = wrongPicks.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={wrong}
                    onClick={() => choose(option)}
                    className={cn(
                      'flex items-center justify-center rounded-2xl border bg-background p-6 font-semibold transition-colors hover:bg-muted active:scale-95',
                      question.kind === 'logic' ? 'text-4xl' : 'text-3xl',
                      wrong && 'math-shake opacity-40',
                    )}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* 显式退出入口，防止孩子卡住进不去 */}
        {phase === 'fight' && (
          <Button variant="outline" className="self-center" onClick={() => router.push('/adventure')}>
            退出关卡
          </Button>
        )}
      </div>
    </>
  )
}
