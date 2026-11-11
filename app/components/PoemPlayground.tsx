'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ListOrdered,
  RotateCcw,
  SpellCheck,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Poem } from '@/lib/supabase-queries'
import { speakChinese, speakLinesAsync, stopSpeak } from '@/lib/tts'
import { useAudioRecorder } from '@/lib/use-audio-recorder'
import { cn } from '@/lib/utils'

/** 汉字判断（用于填空挖空，标点不参与） */
const CJK = /[\u4e00-\u9fa5]/
/** 诗内可选字不足 3 个时，用来凑干扰项 */
const FALLBACK_CHARS = '山水月花风雨云天鸟人来去'

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

export type FillQuestion = {
  /** 被挖空的句子下标 */
  lineIndex: number
  /** 把其中一个汉字替换成 □ 后的句子 */
  blanked: string
  answer: string
  options: string[]
}

/** 随机挑一句、随机挖掉一个汉字，生成一道选择填空题 */
function buildFillQuestion(lines: string[]): FillQuestion | null {
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

/** 填空题 TTS 题目文本：请填空，床前明月什么？ */
function fillQuestionSpeech(fill: FillQuestion): string {
  const spoken = fill.blanked.replace('□', '什么').replace(/[，。！？、,.!?]+\s*$/, '')
  return `请填空，${spoken}？`
}

export function PoemPlayground({
  poem,
  knownChars = [],
  onComplete,
  compact = false,
  initialTab = 'read',
  simpleMode = false,
  requireRecording = false,
}: {
  poem: Poem
  /** 孩子已认识的字，朗读时绿色高亮 */
  knownChars?: string[]
  /** 完成「朗读 + 填空或排序」后回调（识字向导用于点亮打卡） */
  onComplete?: () => void
  /** 嵌入模式：紧凑布局，一屏内放下 */
  compact?: boolean
  initialTab?: TabKey
  /** 简化模式：只展示古诗与听读，点「听古诗」或「我已跟读完毕」即可完成，不再要求排序/填空 */
  simpleMode?: boolean
  /** 逐句跟读录音模式：每句都要录音，全部录完才算完成（识字向导 Step 4 使用） */
  requireRecording?: boolean
}) {
  const [tab, setTab] = useState<TabKey>(initialTab)

  /**
   * 古诗逐句展示：跟读录音模式下按标点（，。？！；）再拆一次，
   * 确保每句单独一行、单独录音；其它模式保持原有的整行展示。
   */
  const lines = useMemo(() => {
    const raw = poem.content.map((line) => line.trim()).filter(Boolean)
    if (!requireRecording) return raw
    const pieces = raw
      .flatMap((line) => line.split(/[，。？！；,?!;]/))
      .map((line) => line.trim())
      .filter(Boolean)
    return pieces.length > 0 ? pieces : raw
  }, [poem, requireRecording])
  const knownSet = useMemo(() => new Set(knownChars), [knownChars])

  // 朗读：点过（或整首听完）的句子
  const [readLines, setReadLines] = useState<Set<number>>(new Set())
  const [reading, setReading] = useState(false)
  const readTokenRef = useRef(0)

  /** 简化模式下，点过听读或确认跟读即视为完成 */
  const [simpleDone, setSimpleDone] = useState(false)

  // ── 逐句跟读录音（requireRecording）──
  /** 每句的录音地址：句索引 → Blob URL */
  const [recordings, setRecordings] = useState<Record<number, string>>({})
  /** 当前正在录音的句索引 */
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null)
  /** 句索引的 ref 版：录音停止回调里同步使用，避免闭包拿到旧值 */
  const recordingIndexRef = useRef<number | null>(null)
  /** 正在 TTS 播报的句索引（浅黄高亮） */
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null)

  const recorder = useAudioRecorder({
    minDurationMs: 1000,
    onRecorded: (url) => {
      const index = recordingIndexRef.current
      if (index === null) return
      recordingIndexRef.current = null
      setRecordingIndex(null)
      setRecordings((prev) => ({ ...prev, [index]: url }))
    },
  })

  // 排序小游戏
  const [orderPool, setOrderPool] = useState<number[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [orderWrong, setOrderWrong] = useState<number | null>(null)

  // 填空小游戏
  const [fill, setFill] = useState<FillQuestion | null>(null)
  const [wrongOptions, setWrongOptions] = useState<string[]>([])
  const [fillDone, setFillDone] = useState(false)

  /** 换诗后重置两个小游戏与朗读进度 */
  useEffect(() => {
    setTab(initialTab)
    setReadLines(new Set())
    setReading(false)
    readTokenRef.current += 1
    stopSpeak()
    setOrderPool(shuffle(lines.map((_, i) => i)))
    setPicked([])
    setOrderWrong(null)
    setFill(buildFillQuestion(lines))
    setWrongOptions([])
    setFillDone(false)
    setSimpleDone(false)
    // 换诗：清空逐句录音、停麦克风、停高亮
    setRecordings({})
    recordingIndexRef.current = null
    setRecordingIndex(null)
    setSpeakingIndex(null)
    recorder.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poem.id])

  /** 是否每一句都已录好音（跟读录音模式的通关条件） */
  const allRecorded =
    requireRecording && lines.length > 0 && lines.every((_, index) => Boolean(recordings[index]))

  // 跟读录音模式：全部句子录完才解锁打卡，删掉任一句录音则重新锁定
  useEffect(() => {
    if (!requireRecording) return
    setSimpleDone(allRecorded)
  }, [requireRecording, allRecorded])

  /** 进入填空页 / 换一题时自动读题（点击 Tab 属于用户手势，iPad 不会拦截） */
  useEffect(() => {
    if (tab !== 'fill' || !fill) return
    speakChinese(fillQuestionSpeech(fill))
    // 只在题目或页签变化时读题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, fill])

  const orderDone = lines.length > 0 && picked.length === lines.length
  const readDone = lines.length > 0 && readLines.size >= lines.length
  const gameDone = fillDone || orderDone

  /** 为某一句开始录音（录音前掐断 TTS，避免录进机器音） */
  const startLineRecord = async (index: number) => {
    if (recordingIndex !== null || recorder.isRecording) return
    setSpeakingIndex(null)
    stopSpeak()
    recordingIndexRef.current = index
    setRecordingIndex(index)
    const ok = await recorder.start()
    if (!ok) {
      recordingIndexRef.current = null
      setRecordingIndex(null)
    }
  }

  /** 重录某一句：清掉该句旧录音后重新开始 */
  const reRecordLine = async (index: number) => {
    setRecordings((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    recorder.reset()
    await startLineRecord(index)
  }

  /** 回听某一句的录音 */
  const playLineRecording = (index: number) => {
    stopSpeak()
    recorder.play(recordings[index])
  }

  // 录音过短被丢弃或启动失败时，收起「正在录音」状态
  useEffect(() => {
    if (recordingIndex !== null && !recorder.isRecording && (recorder.hint || recorder.error)) {
      recordingIndexRef.current = null
      setRecordingIndex(null)
    }
  }, [recordingIndex, recorder.isRecording, recorder.hint, recorder.error])

  /** 完成朗读 + 填空/排序后通知宿主（只触发一次） */
  const completedRef = useRef(false)
  useEffect(() => {
    completedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poem.id])
  useEffect(() => {
    if (completedRef.current) return
    const done = simpleMode ? simpleDone : readDone && gameDone
    if (!done) return
    completedRef.current = true
    onComplete?.()
  }, [simpleMode, simpleDone, readDone, gameDone, onComplete])

  /** 听全诗：逐句朗读，播完标记全部句子已读；简化模式下点按即视为完成 */
  const listenAll = useCallback(async () => {
    if (lines.length === 0) return
    if (simpleMode && !requireRecording) setSimpleDone(true)
    const token = ++readTokenRef.current
    stopSpeak()
    setSpeakingIndex(null)
    setReading(true)
    await speakLinesAsync(lines)
    if (readTokenRef.current !== token) return
    setReading(false)
    setReadLines(new Set(lines.map((_, i) => i)))
  }, [lines, simpleMode, requireRecording])

  /** 点单句朗读，并记录该句已读；播放期间该句浅黄高亮 */
  const speakLine = (index: number) => {
    const line = lines[index]
    if (!line) return
    readTokenRef.current += 1
    stopSpeak()
    setReading(false)
    setSpeakingIndex(index)
    speakChinese(line, () => setSpeakingIndex((cur) => (cur === index ? null : cur)))
    setReadLines((prev) => new Set(prev).add(index))
  }

  /** 排序：点击当前应排的下一句才算对 */
  const pickLine = (lineIndex: number) => {
    if (picked.includes(lineIndex)) return
    if (lineIndex !== picked.length) {
      setOrderWrong(lineIndex)
      window.setTimeout(() => {
        setOrderWrong((cur) => (cur === lineIndex ? null : cur))
      }, 600)
      return
    }
    setPicked((prev) => [...prev, lineIndex])
    speakChinese(lines[lineIndex])
  }

  /** 填空：点选后无论对错都朗读完整句子 */
  const chooseFill = (option: string) => {
    if (!fill || fillDone || wrongOptions.includes(option)) return
    stopSpeak()
    speakChinese(fill.blanked.replace('□', option))
    if (option === fill.answer) {
      setFillDone(true)
    } else {
      setWrongOptions((prev) => [...prev, option])
    }
  }

  const nextFill = (regenerate = true) => {
    if (regenerate) {
      setFill(buildFillQuestion(lines))
      setWrongOptions([])
      setFillDone(false)
      return
    }
    if (!fill) return
    speakChinese(fillQuestionSpeech(fill))
  }

  const resetGames = () => {
    setOrderPool(shuffle(lines.map((_, i) => i)))
    setPicked([])
    setOrderWrong(null)
    setFill(buildFillQuestion(lines))
    setWrongOptions([])
    setFillDone(false)
  }

  /** 认识的字绿色高亮 */
  const renderLine = (line: string) =>
    Array.from(line).map((char, index) =>
      knownSet.has(char) ? (
        <span key={index} className="text-emerald-600">
          {char}
        </span>
      ) : (
        <span key={index}>{char}</span>
      ),
    )

  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-col',
        compact ? 'h-full flex-1 gap-1.5 overflow-hidden' : 'gap-5',
      )}
    >
      {/* 顶部功能 Tab：简化模式只保留古诗听读，不显示排序/填空 */}
      {!simpleMode && (
      <div className="flex shrink-0 gap-2">
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
                'flex flex-1 items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors',
                compact ? 'h-9 text-sm' : 'h-10 text-sm',
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
      )}

      {/* 朗读 */}
      {(simpleMode || tab === 'read') && (
        <section
          className={cn(
            'flex min-h-0 flex-1 flex-col rounded-2xl border bg-card',
            compact ? 'gap-1.5 overflow-hidden p-2.5' : 'gap-3 p-5',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className={cn('font-bold', compact ? 'text-base md:text-lg' : 'text-lg')}>
                {poem.title}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[poem.author, poem.category].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button size="sm" onClick={listenAll}>
              <Volume2 aria-hidden="true" />
              {reading ? '朗读中…' : simpleMode ? '🔊 听古诗' : '听全诗'}
            </Button>
          </div>

          {knownSet.size > 0 && (
            <p className="text-xs text-muted-foreground">
              认识的字已标绿，点句子可以逐句听
            </p>
          )}

          <ul
            className={cn(
              'flex flex-col gap-1',
              compact && 'min-h-0 flex-1 overflow-hidden',
              compact && !requireRecording && 'justify-center',
              requireRecording && compact && 'justify-start overflow-y-auto',
            )}
          >
            {requireRecording
              ? lines.map((line, index) => {
                  const recorded = recordings[index]
                  const recordingThis = recordingIndex === index
                  return (
                    <li
                      key={`${poem.id}-${index}`}
                      className={cn(
                        'shrink-0 rounded-xl py-0.5 transition-colors',
                        speakingIndex === index && 'bg-amber-100/80',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 px-2">
                        <span
                          className={cn(
                            'font-bold tracking-wide',
                            compact ? 'text-xl md:text-2xl' : 'text-lg',
                          )}
                        >
                          {renderLine(line)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 px-2 text-[11px]"
                          onClick={() => speakLine(index)}
                        >
                          🔊 听这句
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1">
                        {recorded ? (
                          <>
                            <Button
                              size="sm"
                              className="px-2 text-[11px]"
                              onClick={() => playLineRecording(index)}
                            >
                              ▶️ 听我的声音
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="px-2 text-[11px]"
                              onClick={() => void reRecordLine(index)}
                            >
                              🔄 重录
                            </Button>
                            <span className="text-[11px] font-semibold text-emerald-600">
                              已录音 ✓
                            </span>
                          </>
                        ) : recordingThis ? (
                          <Button
                            size="sm"
                            className="animate-pulse bg-red-600 px-2 text-[11px] text-white hover:bg-red-600"
                            onClick={() => recorder.stop()}
                          >
                            🔴 正在录音...点击停止
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="px-2 text-[11px]"
                            onClick={() => void startLineRecord(index)}
                          >
                            🎤 跟读
                          </Button>
                        )}
                        {!recorded && !recordingThis && (
                          <span className="text-[11px] text-muted-foreground">
                            点「跟读」录这一句
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })
              : lines.map((line, index) => (
                  <li key={`${poem.id}-${index}`}>
                    <button
                      type="button"
                      onClick={() => speakLine(index)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-xl px-2 text-left leading-relaxed transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                        compact ? 'py-0.5 text-xl md:text-2xl' : 'py-1.5 text-lg',
                        readLines.has(index) && 'bg-emerald-50/60',
                        speakingIndex === index && 'bg-amber-100/80',
                      )}
                      aria-label={`朗读：${line}`}
                    >
                      <span className="font-bold tracking-wide">{renderLine(line)}</span>
                      <Volume2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
          </ul>

          {requireRecording && (
            <p className="shrink-0 text-center text-[11px] text-muted-foreground md:text-xs">
              🎙️ 每一句都要跟读录音，才能通关打卡哦！（已录 {Object.keys(recordings).length}/
              {lines.length} 句）
            </p>
          )}
          {!recorder.isSecure ? (
            <p className="shrink-0 text-center text-[11px] font-semibold text-destructive">
              请使用 HTTPS 或 localhost 访问才能录音
            </p>
          ) : recorder.error ? (
            <p className="shrink-0 text-center text-[11px] font-semibold text-destructive">
              {recorder.error.tip}（{recorder.error.name}）
            </p>
          ) : (
            recorder.hint && (
              <p className="shrink-0 text-center text-[11px] text-destructive">{recorder.hint}</p>
            )
          )}

          {simpleMode ? (
            requireRecording ? (
              <p className="shrink-0 rounded-xl bg-muted/50 px-3 py-1.5 text-center text-xs text-muted-foreground">
                {allRecorded
                  ? '✅ 每句都录好了，点底部「完成学习打卡」通关吧！'
                  : `🎙️ 还有 ${lines.length - Object.keys(recordings).length} 句没录音`}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant={simpleDone ? 'secondary' : 'outline'}
                  className="w-full"
                  disabled={simpleDone}
                  onClick={() => setSimpleDone(true)}
                >
                  <CheckCircle2 aria-hidden="true" />
                  {simpleDone ? '已跟读，可以打卡' : '我已跟读完毕'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  {simpleDone
                    ? '打卡已解锁，点底部「完成学习打卡」即可'
                    : '点「听古诗」或「我已跟读完毕」就能解锁打卡'}
                </p>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              {readDone ? '朗读完成，去试试排序或填空吧' : '点句子听读音，跟着读一遍'}
            </p>
          )}
        </section>
      )}

      {/* 排序：简化模式不显示 */}
      {!simpleMode && tab === 'order' && (
        <section
          className={cn(
            'flex min-h-0 flex-1 flex-col rounded-2xl border bg-card',
            compact ? 'gap-1.5 overflow-hidden p-2.5' : 'gap-3 p-5',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">排序小游戏</h2>
            <span className="text-xs text-muted-foreground">
              {picked.length} / {lines.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {poem.title} · 按诗的顺序依次点击句子
          </p>
          <ul className={cn('flex flex-col gap-2', compact && 'min-h-0 flex-1 overflow-hidden')}>
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
                      'w-full rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default',
                      compact ? 'text-base md:text-lg' : 'text-base',
                      used &&
                        'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10',
                      wrong && 'math-shake border-destructive bg-destructive/10 text-destructive',
                      !used && !wrong && 'bg-background hover:bg-muted/60',
                    )}
                  >
                    {lines[lineIndex]}
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

      {/* 填空：简化模式不显示 */}
      {!simpleMode && tab === 'fill' && (
        <section
          className={cn(
            'flex min-h-0 flex-1 flex-col rounded-2xl border bg-card',
            compact ? 'gap-1.5 overflow-hidden p-2.5' : 'gap-3 p-5',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">填空小游戏</h2>
            <div className="flex items-center gap-2">
              {fill && (
                <Button size="xs" variant="outline" onClick={() => nextFill(false)}>
                  <Volume2 aria-hidden="true" />
                  听题目
                </Button>
              )}
              <Button size="xs" variant="outline" onClick={() => nextFill(true)}>
                <RotateCcw aria-hidden="true" />
                换一题
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{poem.title} · 选出 □ 处正确的字</p>
          {fill ? (
            <>
              <p
                className={cn(
                  'text-center font-semibold tracking-wide',
                  compact ? 'text-2xl md:text-3xl' : 'text-2xl',
                  fillDone && 'text-emerald-600',
                )}
              >
                {fillDone ? fill.blanked.replace('□', fill.answer) : fill.blanked}
              </p>
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
                        'flex items-center justify-center rounded-2xl border font-bold transition-colors disabled:cursor-not-allowed',
                        compact ? 'h-14 text-2xl md:h-16 md:text-3xl' : 'aspect-square text-xl',
                        correct &&
                          'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10',
                        wrong && 'math-shake border-destructive/40 bg-destructive/10 text-destructive/60',
                        !wrong && !correct && 'bg-background hover:bg-muted/60',
                      )}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
              {fillDone ? (
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  答对了！
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => nextFill(true)}>
                    下一题
                  </Button>
                </div>
              ) : (
                <p className="h-5 text-center text-xs text-muted-foreground">
                  {wrongOptions.length > 0 ? '再试一次～选完会读整句给你听' : ''}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">这首诗暂时出不了填空题～</p>
          )}
        </section>
      )}
    </div>
  )
}
