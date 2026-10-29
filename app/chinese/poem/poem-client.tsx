'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { PoemPlayground } from '@/app/components/PoemPlayground'
import type { Poem } from '@/lib/supabase-queries'

/** 汉字判断（用于相关度计算） */
const CJK = /[\u4e00-\u9fa5]/
/** 可选的年龄范围 */
const AGE_OPTIONS = [3, 4, 5, 6, 7, 8]
const DEFAULT_AGE = 4
const AGE_STORAGE_KEY = 'poem-age'

type PoemMeta = {
  poem: Poem
  /** 认识的汉字数 / 诗中汉字数 */
  known: number
  total: number
  ratio: number
  /** 综合相关度：认识比例为主，级别与年龄匹配为辅 */
  score: number
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

  const metas = useMemo(() => buildMetas(poems, knownChars, age), [poems, knownChars, age])
  const dailyId = useMemo(() => pickDailyPoem(metas, age, todayKey), [metas, age, todayKey])

  // 每天只展示一首：今日推荐
  const poem = poems.find((item) => item.id === dailyId) ?? poems[0] ?? null

  /** 读取上次选择的年龄 */
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(AGE_STORAGE_KEY))
    if (AGE_OPTIONS.includes(saved)) setAge(saved)
  }, [])

  const changeAge = (next: number) => {
    setAge(next)
    window.localStorage.setItem(AGE_STORAGE_KEY, String(next))
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

  return (
    <>
      <PageHeader
        title="古诗诵读"
        subtitle={`已认识 ${knownChars.length} 个字 · 今日古诗`}
        action={ageSelect}
        backHref={backHref}
        backLabel="返回语文"
      />
      <div className="px-5 pb-6">
        <PoemPlayground poem={poem} knownChars={knownChars} />
      </div>
    </>
  )
}
