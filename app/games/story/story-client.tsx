'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Volume2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/components/auth-provider'
import { handleGameCheckin } from '@/lib/rewards'
import { speakChinese } from '@/lib/tts'
import { cn } from '@/lib/utils'

type StoryResponse = {
  story?: string
  masteredCount?: number
  outOfBounds?: string[]
  error?: string
}

export function StoryClient({ taskId }: { taskId: string | null }) {
  const { role } = useAuth()
  const isParent = role === 'parent'
  const [story, setStory] = useState('')
  const [masteredCount, setMasteredCount] = useState(0)
  const [outOfBounds, setOutOfBounds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [checked, setChecked] = useState(false)
  const [earnedStars, setEarnedStars] = useState(0)

  const generate = useCallback(async () => {
    setLoading(true)
    setError('')
    setStory('')
    setChecked(false)
    try {
      const res = await fetch('/api/generate-story', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as StoryResponse
      if (!res.ok) throw new Error(data.error ?? `生成失败（HTTP ${res.status}）`)
      setStory(data.story ?? '')
      setMasteredCount(data.masteredCount ?? 0)
      setOutOfBounds(data.outOfBounds ?? [])
    } catch (err) {
      console.error('[StoryClient] 生成故事失败:', err)
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void generate()
  }, [generate])

  /** 按句号/问号/感叹号切句，保留标点 */
  const sentences = useMemo(() => {
    if (!story) return []
    return story.match(/[^。！？!?\n]+[。！？!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [story]
  }, [story])

  const handleCheckin = async () => {
    if (!taskId || saving || checked) return
    setSaving(true)
    setError('')
    try {
      // 故事阅读无答题环节，完成阅读即视为全部答对
      const stars = await handleGameCheckin(taskId, 1, 1, isParent)
      setEarnedStars(stars)
      setChecked(true)
    } catch (err) {
      console.error('[StoryClient] 打卡失败:', err)
      setError(`打卡失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="AI 汉字小故事" subtitle="只用你认识的字写成的故事" />
      <div className="flex flex-col gap-5 px-5 pb-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">正在用你认识的字写故事…</p>
          </div>
        )}

        {!loading && error && !story && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => void generate()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              重试
            </Button>
          </div>
        )}

        {story && (
          <>
            {masteredCount > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                基于你认识的 {masteredCount} 个字生成
              </p>
            )}

            {/* 逐句大字展示，点句子或喇叭朗读 */}
            <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
              {sentences.map((sentence, i) => (
                <div key={i} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => speakChinese(sentence)}
                    className="flex-1 text-left text-2xl font-medium leading-relaxed transition-colors hover:text-primary"
                    aria-label={`朗读：${sentence}`}
                  >
                    {sentence}
                  </button>
                  <button
                    type="button"
                    onClick={() => speakChinese(sentence)}
                    className="mt-1 shrink-0 text-muted-foreground hover:text-primary"
                    aria-label="朗读这句"
                  >
                    <Volume2 className="size-5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </section>

            {outOfBounds.length > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                提示：故事里出现了少量还没认识的字（{outOfBounds.join('、')}）
              </p>
            )}

            <Button variant="outline" onClick={() => void generate()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              换一个故事
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="mt-2">
              {checked ? (
                <div className="flex flex-col items-center gap-2">
                  <Badge variant="secondary" className="text-emerald-700">
                    打卡成功，等待家长审核
                  </Badge>
                  <p className="text-base font-semibold text-amber-600">
                    家长审核通过后可获得 {earnedStars} 颗星星 ⭐
                  </p>
                </div>
              ) : (
                <>
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={handleCheckin}
                    disabled={saving || !taskId}
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {saving ? '打卡中…' : '完成打卡'}
                  </Button>
                  {!taskId && (
                    <p className={cn('mt-2 text-center text-xs text-destructive')}>
                      未找到「识字」线上任务，暂时无法打卡
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
