'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import {
  countMasteredChars,
  fetchLiteracyCharsByLevel,
  fetchMasteryMap,
  upsertMastery,
  type LiteracyChar,
  type MasteryStatus,
} from '@/lib/supabase-queries'
import { speakChinese } from '@/lib/tts'
import { cn } from '@/lib/utils'

const levels = [1, 2, 3, 4, 5, 6]

export default function LiteracyTestPage() {
  const [level, setLevel] = useState(1)
  const [chars, setChars] = useState<LiteracyChar[]>([])
  const [mastery, setMastery] = useState<Record<string, MasteryStatus>>({})
  const [masteredCount, setMasteredCount] = useState(0)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (lv: number) => {
    setLoading(true)
    setError('')
    try {
      const [rows, map, count] = await Promise.all([
        fetchLiteracyCharsByLevel(lv),
        fetchMasteryMap(),
        countMasteredChars(),
      ])
      setChars(rows)
      setMastery(map)
      setMasteredCount(count)
      setIndex(0)
    } catch (err) {
      console.error('[LiteracyTest] 加载失败:', err)
      setError(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(level)
  }, [level, load])

  const current = chars[index]
  const finished = !loading && chars.length > 0 && index >= chars.length

  const mark = async (status: MasteryStatus) => {
    if (!current || saving) return
    setSaving(true)
    setError('')
    try {
      await upsertMastery(current.id, status)
      setMastery((prev) => ({ ...prev, [current.id]: status }))
      setMasteredCount(await countMasteredChars())
      speakChinese(current.char)
      setIndex((i) => i + 1)
    } catch (err) {
      console.error('[LiteracyTest] 写入 child_mastery 失败:', err)
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="识字测试" subtitle="点汉字听读音，会读就点「认识了」" />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {/* 级别选择 */}
        <div className="flex items-center gap-3">
          <label htmlFor="literacy-level" className="text-sm font-medium">
            级别
          </label>
          <select
            id="literacy-level"
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {levels.map((lv) => (
              <option key={lv} value={lv}>
                {lv} 级
              </option>
            ))}
          </select>
          <span className="ml-auto text-sm text-muted-foreground">
            {chars.length > 0 ? `${Math.min(index + 1, chars.length)} / ${chars.length}` : '共 0 字'}
          </span>
        </div>

        {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            正在加载汉字…
          </p>
        ) : chars.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {level} 级还没有汉字，先在 literacy_chars 表里补充数据吧
          </p>
        ) : finished ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center">
            <p className="text-lg font-bold">{level} 级这轮学完了 🎉</p>
            <p className="text-sm text-muted-foreground">已认识 {masteredCount} 个字</p>
            <Link href="/games/literacy-card" className="text-sm text-primary underline-offset-4 hover:underline">
              去字卡练习不认识的字
            </Link>
            <Button variant="outline" onClick={() => setIndex(0)}>
              再来一轮
            </Button>
          </div>
        ) : (
          <>
            {/* 大卡片：点击朗读 */}
            <button
              type="button"
              onClick={() => speakChinese(current.char)}
              className={cn(
                'flex h-64 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 bg-card transition-colors',
                'hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              )}
              aria-label={`朗读汉字 ${current.char}`}
            >
              <span className="text-8xl font-bold leading-none">{current.char}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Volume2 className="size-3.5" aria-hidden="true" />
                点击听读音
              </span>
            </button>

            {mastery[current.id] && (
              <div className="flex justify-center">
                <Badge variant="secondary">
                  {mastery[current.id] === 'mastered' ? '上次标记：已认识' : '上次标记：不认识'}
                </Badge>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="h-12 flex-1 text-base"
                disabled={saving}
                onClick={() => mark('review')}
              >
                不认识
              </Button>
              <Button className="h-12 flex-1 text-base" disabled={saving} onClick={() => mark('mastered')}>
                认识了
              </Button>
            </div>
          </>
        )}

        {/* 底部统计 */}
        <div className="mt-2 flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3 text-sm">
          <span className="text-muted-foreground">已认识</span>
          <span className="font-semibold">
            {masteredCount} 个字
          </span>
        </div>
        <div className="flex justify-center">
          <Link href="/games/literacy-card" className="text-sm text-primary underline-offset-4 hover:underline">
            去字卡练习 →
          </Link>
        </div>
      </div>
    </>
  )
}
