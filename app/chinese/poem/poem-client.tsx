'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ListOrdered,
  RotateCcw,
  SpellCheck,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import type { Poem } from '@/lib/supabase-queries'
import { speakChinese, speakLines } from '@/lib/tts'
import { cn } from '@/lib/utils'

/** 汉字判断（用于填空挖空，标点不参与） */
const CJK = /[\u4e00-\u9fa5]/
/** 诗内可选字不足 3 个时，用来凑干扰项 */
const FALLBACK_CHARS = '山水月花风雨云天鸟人来去'
/** 可选的年龄范围 */
const AGE_OPTIONS = [3, 4, 5, 6, 7, 8]
const DEFAULT_AGE = 4
const AGE_STORAGE_KEY = 'poem-age'

type TabKey = 'read' | 'order' | 'fill'

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'read', label: '朗读', icon: Volume2 },
  { key: 'order', label: '排序', icon: ListOrdered },
  { key: 'fill', label: '填空', icon: SpellCheck },
]

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 稳定哈希：同一天同一年龄选出的诗保持一致 */
function hashString(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

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

type PoemMeta = {
  poem: Poem
  /** 认识的汉字数 / 诗中汉字数 */
  known: number
  total: number
  ratio: number
  /** 综合相关度：认识比例为主，级别与年龄匹配为辅 */
  score: number
}

/** 按年龄和孩子认识的字，计算每首诗的相关度 */
function buildMetas(poems: Poem[], knownChars: string[], age: number): PoemMeta[] {
  const knownSet = new Set(knownChars)
  const targetLevel = age <= 4 ? 1 : age <= 6 ? 2 : 3

  return poems.map((poem) => {
    const chars = poemChars(poem)
    const known = chars.filter((char) => knownSet.has(char)).length
    const ratio = chars.length > 0 ? known / chars.length : 0
    const levelGap = Math.abs((poem.level ?? 1) - targetLevel)
    const levelBonus = levelGap === 0 ? 0.25 : levelGap === 1 ? 0.1 : 0
    return { poem, known, total: chars.length, ratio, score: ratio * 0.75 + levelBonus }
  })
}

/** 每天从相关度最高的几首里随机挑一首（当天稳定，换天自动换） */
function pickDailyPoem(metas: PoemMeta[], age: number, dateKey: string): string | null {
  if (metas.length === 0) return null
  const top = [...metas].sort((a, b) => b.score - a.score).slice(0, 3)
  return top[hashString(`${dateKey}-${age}`) % top.length].poem.id
}

type FillQuestion = {
  /** 被挖空的句子下标 */
  lineIndex: number
  /** 把其中一个汉字替换成 □ 后的句子 */
  blanked: string
  answer: string
  options: string[]
}

/** 随机挑一句、随机挖掉一个汉字，生成一道选择填空题 */
function buildFillQuestion(poem: Poem): FillQuestion | null {
  const lines = poem.content.filter((line) => line.trim())
  if (lines.length === 0) return null

  const lineIndex = Math.floor(Math.random() * lines.length)
  const chars = Array.from(lines[lineIndex])
  const positions = chars
    .map((char, index) => ({ char, index }))
    .filter(({ char }) => CJK.test(char))
  if (positions.length === 0) return null

  const target = positions[Math.floor(Math.random() * positions.length)]
  const blanked = chars.map((char, index) => (index === target.index ? '□' : char)).join('')

  const pool = new Set<string>()
  for (const line of lines) {
    for (const char of Array.from(line)) {
      if (CJK.test(char) && char !== target.char) pool.add(char)
    }
  }
  const distractors = shuffle(Array.from(pool)).slice(0, 3)
  while (distractors.length < 3) {
    const char = FALLBACK_CHARS[Math.floor(Math.random() * FALLBACK_CHARS.length)]
    if (char !== target.char && !distractors.includes(char)) distractors.push(char)
  }

  return {
    lineIndex,
    blanked,
    answer: target.char,
    options: shuffle([target.char, ...distractors]),
  }
}

export function PoemClient({
  poems,
  knownChars,
  todayKey,
  backHref,
}: {
  poems: Poem[]
  knownChars: string[]
  todayKey: string
  backHref?: string
}) {
  const [age, setAge] = useState(DEFAULT_AGE)
  const [tab, setTab] = useState<TabKey>('read')

  const metas = useMemo(() => buildMetas(poems, knownChars, age), [poems, knownChars, age])
  const dailyId = useMemo(() => pickDailyPoem(metas, age, todayKey), [metas, age, todayKey])

  // 每天只展示一首：今日推荐
  const poem = poems.find((item) => item.id === dailyId) ?? poems[0] ?? null
  const meta = metas.find((item) => item.poem.id === poem?.id) ?? null

  // 排序小游戏
  const [orderPool, setOrderPool] = useState<number[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [orderWrong, setOrderWrong] = useState<number | null>(null)

  // 填空小游戏
  const [fill, setFill] = useState<FillQuestion | null>(null)
  const [wrongOptions, setWrongOptions] = useState<string[]>([])
  const [fillDone, setFillDone] = useState(false)

  /** 换诗后重置两个小游戏 */
  useEffect(() => {
    if (!poem) return
    setOrderPool(shuffle(poem.content.map((_, i) => i)))
    setPicked([])
    setOrderWrong(null)
    setFill(buildFillQuestion(poem))
    setWrongOptions([])
    setFillDone(false)
  }, [poem])

  /** 读取上次选择的年龄 */
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(AGE_STORAGE_KEY))
    if (AGE_OPTIONS.includes(saved)) setAge(saved)
  }, [])

  const changeAge = (next: number) => {
    setAge(next)
    window.localStorage.setItem(AGE_STORAGE_KEY, String(next))
    // 年龄变了，重新挑今日推荐
    setTab('read')
  }

  const resetGames = () => {
    if (!poem) return
    setOrderPool(shuffle(poem.content.map((_, i) => i)))
    setPicked([])
    setOrderWrong(null)
    setFill(buildFillQuestion(poem))
    setWrongOptions([])
    setFillDone(false)
  }

  /** 排序：点击当前应排的下一句才算对 */
  const pickLine = (lineIndex: number) => {
    if (!poem || picked.includes(lineIndex)) return
    if (lineIndex !== picked.length) {
      setOrderWrong(lineIndex)
      window.setTimeout(() => {
        setOrderWrong((cur) => (cur === lineIndex ? null : cur))
      }, 600)
      return
    }
    setPicked((prev) => [...prev, lineIndex])
    speakChinese(poem.content[lineIndex])
  }

  const chooseFill = (option: string) => {
    if (!fill || fillDone || wrongOptions.includes(option)) return
    if (option === fill.answer) {
      setFillDone(true)
      speakChinese(fill.blanked.replace('□', fill.answer))
    } else {
      setWrongOptions((prev) => [...prev, option])
    }
  }

  const nextFill = () => {
    if (!poem) return
    setFill(buildFillQuestion(poem))
    setWrongOptions([])
    setFillDone(false)
  }

  const ageSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="poem-age" className="text-xs text-muted-foreground">
        年龄
      </label>
      <select
        id="poem-age"
        value={age}
        onChange={(e) => changeAge(Number(e.target.value))}
        className="h-9 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {AGE_OPTIONS.map((value) => (
          <option key={value} value={value}>
            {value} 岁
          </option>
        ))}
      </select>
    </div>
  )

  if (!poem) {
    return (
      <>
        <PageHeader
          title="古诗诵读"
          subtitle="听一听，跟一跟"
          action={ageSelect}
          backHref={backHref}
          backLabel="返回语文"
        />
        <div className="px-5 pb-6">
          <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
            还没有古诗数据，请先执行 scripts/seed-poems.sql 导入诗库。
          </p>
        </div>
      </>
    )
  }

  const orderDone = picked.length === poem.content.length

  return (
    <>
      <PageHeader
        title="古诗诵读"
        subtitle={`已认识 ${knownChars.length} 个字 · 今日古诗`}
        action={ageSelect}
        backHref={backHref}
        backLabel="返回语文"
      />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {/* 顶部功能 Tab */}
        <div className="flex gap-2">
          {TABS.map((item) => {
            const Icon = item.icon
            const active = tab === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-pressed={active}
                className={cn(
                  'flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            )
          })}
        </div>

        {/* 朗读 */}
        {tab === 'read' && (
          <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{poem.title}</h2>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    今日推荐
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[poem.author, poem.category].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button size="sm" onClick={() => speakLines(poem.content)}>
                <Volume2 aria-hidden="true" />
                听全诗
              </Button>
            </div>

            {meta && (
              <p className="text-xs text-muted-foreground">
                这首诗里的 {meta.total} 个汉字，你认识 {meta.known} 个（
                {Math.round(meta.ratio * 100)}%）
              </p>
            )}

            <ul className="flex flex-col gap-1">
              {poem.content.map((line, index) => (
                <li key={`${poem.id}-${index}`}>
                  <button
                    type="button"
                    onClick={() => speakChinese(line)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-lg leading-relaxed transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-label={`朗读：${line}`}
                  >
                    <span>{line}</span>
                    <Volume2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">点句子听读音，跟着读一遍</p>
          </section>
        )}

        {/* 排序 */}
        {tab === 'order' && (
          <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">排序小游戏</h2>
              <span className="text-xs text-muted-foreground">
                {picked.length} / {poem.content.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {poem.title} · 按诗的顺序依次点击句子
            </p>
            <ul className="flex flex-col gap-2">
              {orderPool.map((lineIndex) => {
                const used = picked.includes(lineIndex)
                const wrong = orderWrong === lineIndex
                return (
                  <li key={`${poem.id}-order-${lineIndex}`}>
                    <button
                      type="button"
                      onClick={() => pickLine(lineIndex)}
                      disabled={used}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2 text-left text-base transition-colors disabled:cursor-default',
                        used &&
                          'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10',
                        wrong && 'border-destructive bg-destructive/10 text-destructive',
                        !used && !wrong && 'bg-background hover:bg-muted/60',
                      )}
                    >
                      {poem.content[lineIndex]}
                    </button>
                  </li>
                )
              })}
            </ul>
            {orderDone && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                排序完成，真棒！
                <Button size="xs" variant="outline" className="ml-auto" onClick={resetGames}>
                  <RotateCcw aria-hidden="true" />
                  再来一次
                </Button>
              </div>
            )}
          </section>
        )}

        {/* 填空 */}
        {tab === 'fill' && (
          <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">填空小游戏</h2>
              <Button size="xs" variant="outline" onClick={nextFill}>
                <RotateCcw aria-hidden="true" />
                换一题
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{poem.title} · 选出 □ 处正确的字</p>
            {fill ? (
              <>
                <p className="text-center text-2xl font-semibold tracking-wide">{fill.blanked}</p>
                <div className="grid grid-cols-4 gap-2">
                  {fill.options.map((option) => {
                    const wrong = wrongOptions.includes(option)
                    const correct = fillDone && option === fill.answer
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => chooseFill(option)}
                        disabled={wrong || fillDone}
                        className={cn(
                          'flex aspect-square items-center justify-center rounded-2xl border text-xl font-bold transition-colors',
                          correct &&
                            'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10',
                          wrong && 'border-destructive/40 bg-destructive/10 text-destructive/60',
                          !wrong && !correct && 'bg-background hover:bg-muted/60',
                        )}
                      >
                        {option}
                      </button>
                    )
                  })}
                </div>
                {fillDone && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    答对了！
                    <Button size="xs" variant="outline" className="ml-auto" onClick={nextFill}>
                      下一题
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">这首诗暂时出不了填空题～</p>
            )}
          </section>
        )}
      </div>
    </>
  )
}
