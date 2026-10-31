'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpenCheck, CheckCircle2, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import { handleTeacherCheckin } from '@/lib/rewards'
import {
  deleteMedia,
  deleteMediaAssets,
  fetchTodayCheckin,
  updateMediaTeaching,
  type MediaRow,
} from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

/** 播放进度写入 localStorage 的最小间隔 */
const SAVE_INTERVAL_MS = 2000

type TeachingStatus = NonNullable<MediaRow['teaching_status']>

const STATUS_OPTIONS: { value: TeachingStatus; label: string; icon: typeof BookOpenCheck; activeClass: string }[] = [
  {
    value: 'learned',
    label: '已带学',
    icon: BookOpenCheck,
    activeClass: 'border-emerald-500 bg-emerald-500 text-white shadow-sm hover:bg-emerald-600',
  },
  {
    value: 'need_review',
    label: '需重看',
    icon: TriangleAlert,
    activeClass: 'border-orange-500 bg-orange-500 text-white shadow-sm hover:bg-orange-600',
  },
]

export function MediaClient({ media }: { media: MediaRow }) {
  const { role } = useAuth()
  const isParent = role === 'parent'
  const router = useRouter()

  const videoRef = useRef<HTMLVideoElement>(null)
  /** 上次写入进度的时间戳，用于 2 秒节流 */
  const lastSaveRef = useRef(0)
  const storageKey = `media_progress_${media.id}`

  // 协同标记与陪伴备注：初始值来自服务端，更新后只改本地状态（多端靠刷新同步）
  const [status, setStatus] = useState<MediaRow['teaching_status']>(media.teaching_status)
  const [note, setNote] = useState(media.parent_note ?? '')
  const [savedNote, setSavedNote] = useState(media.parent_note ?? '')
  const [savingStatus, setSavingStatus] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [markFeedback, setMarkFeedback] = useState<string | null>(null)
  /** 当前浏览器无法解码视频画面（HEVC 等）时置 true，展示提示横幅 */
  const [codecIssue, setCodecIssue] = useState(false)

  // ── 线下课打卡：资料的 course_id 就是课表任务 id ──
  const courseTaskId = media.course_id
  const [checkedIn, setCheckedIn] = useState(false)
  const [checkinLoading, setCheckinLoading] = useState(Boolean(courseTaskId))
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkFeedback, setCheckFeedback] = useState<string | null>(null)

  // 进入页面时查一次今天是否已给该课程打卡
  useEffect(() => {
    if (!courseTaskId) {
      setCheckinLoading(false)
      return
    }
    let cancelled = false
    setCheckinLoading(true)
    fetchTodayCheckin(courseTaskId)
      .then((done) => {
        if (!cancelled) setCheckedIn(done)
      })
      .catch((err: unknown) => {
        console.warn('[MediaClient] 查询打卡状态失败:', err)
      })
      .finally(() => {
        if (!cancelled) setCheckinLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [courseTaskId])

  /** 线下课打卡：写入待审核 checkins，家长确认后才发放星星 */
  const handleCheckin = async () => {
    if (!courseTaskId || checkedIn || checkingIn) return
    setCheckingIn(true)
    setCheckFeedback(null)
    try {
      const { earned } = await handleTeacherCheckin(courseTaskId, '')
      setCheckedIn(true)
      window.dispatchEvent(new Event('checkins-changed'))
      // 打卡即视为已完成学习：同步标记「已带学」，资料库和孩子端都能看到
      try {
        await updateMediaTeaching(media.id, { teaching_status: 'learned' })
        setStatus('learned')
      } catch (err) {
        console.warn('[MediaClient] 打卡后标记已带学失败:', err)
      }
      setCheckFeedback(
        earned > 0
          ? `🎉 打卡成功！家长审核通过后，你将获得 ${earned} 颗星星 ⭐`
          : '今天已经打过卡啦，明天继续加油',
      )
    } catch (err) {
      console.error('[MediaClient] 线下课打卡失败:', err)
      setCheckFeedback('打卡失败，请重试')
    } finally {
      setCheckingIn(false)
    }
  }

  // 断点续播：元数据加载完成后，若上次进度有效（>0 且未超过总时长）则跳转到该位置
  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    // 只能出声没有画面：视频轨解码失败（典型：HEVC 在 Windows Chrome/Edge）
    if (video.videoWidth === 0) setCodecIssue(true)
    const saved = Number(localStorage.getItem(storageKey) ?? 0)
    if (saved > 0 && Number.isFinite(video.duration) && saved < video.duration) {
      video.currentTime = saved
    }
  }

  // 播放中每 2 秒把当前进度存入 localStorage
  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video) return
    const now = Date.now()
    if (now - lastSaveRef.current < SAVE_INTERVAL_MS) return
    lastSaveRef.current = now
    localStorage.setItem(storageKey, String(video.currentTime))
  }

  // 重看：回到开头并播放
  const handleReplay = () => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = 0
    void video.play().catch(() => {})
  }

  // 切换协同标记：点当前已选中的按钮则取消标记，否则切到新状态
  const handleToggleStatus = async (next: TeachingStatus) => {
    if (savingStatus) return
    const target = status === next ? null : next
    setSavingStatus(true)
    setMarkFeedback(null)
    try {
      await updateMediaTeaching(media.id, { teaching_status: target })
      setStatus(target)
    } catch (err) {
      console.error('[MediaClient] 更新标记失败:', err)
      setMarkFeedback('标记保存失败，请重试')
    } finally {
      setSavingStatus(false)
    }
  }

  // 保存陪伴备注
  const handleSaveNote = async () => {
    if (savingNote) return
    const value = note.trim()
    setSavingNote(true)
    setMarkFeedback(null)
    try {
      await updateMediaTeaching(media.id, { parent_note: value || null })
      setSavedNote(value)
      setNote(value)
    } catch (err) {
      console.error('[MediaClient] 保存备注失败:', err)
      setMarkFeedback('备注保存失败，请重试')
    } finally {
      setSavingNote(false)
    }
  }

  /** 删除资料：先删 R2 上的文件与封面（失败只告警），再删 media 记录并返回资料库 */
  const handleDelete = async () => {
    if (!window.confirm('确定要删除这个资料吗？文件将无法恢复。')) return
    setDeleting(true)
    setMarkFeedback(null)
    try {
      await deleteMediaAssets(media.file_url, media.thumb_url)
      await deleteMedia(media.id)
      router.push('/library')
    } catch (err) {
      console.error('[MediaClient] 删除资料失败:', err)
      setMarkFeedback('删除失败，请重试')
      setDeleting(false)
    }
  }

  const isVideo = media.file_type === 'video'
  const isText = media.file_type === 'text'
  const statusMeta = status ? STATUS_OPTIONS.find((o) => o.value === status) : null

  return (
    <>
      <PageHeader
        title={media.course_name ?? '课程资料'}
        subtitle={media.media_date}
        backHref="/library"
        backLabel="返回资料库"
      />

      <div className="flex flex-col gap-4 px-5 pb-8">
        {/* 内容区：文字作业大字居中展示；视频/图片渲染播放器或图片（iPad 竖屏 max-w-3xl，横屏 max-w-5xl） */}
        {isText ? (
          <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-amber-50 p-6 text-center md:p-10">
            <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
              📝 文字作业
            </span>
            <p className="mt-4 whitespace-pre-wrap text-xl leading-relaxed text-amber-950 md:text-2xl md:leading-relaxed">
              {media.note?.trim() || '（无内容）'}
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl bg-black lg:max-w-5xl">
            {isVideo ? (
              <video
                ref={videoRef}
                src={media.file_url}
                poster={media.thumb_url ?? undefined}
                controls
                preload="metadata"
                className="max-h-[70vh] w-full bg-black object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onError={() => setCodecIssue(true)}
              />
            ) : (
              // 该图使用普通 img，next.config 已开启 images.unoptimized
              <img
                src={media.file_url}
                alt={media.course_name ?? '资料图片'}
                className="max-h-[70vh] w-full object-contain"
              />
            )}
          </div>
        )}

        {isVideo && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleReplay}>
              <RotateCcw aria-hidden="true" />
              重看
            </Button>
          </div>
        )}

        {/* 视频画面解码失败提示（HEVC 等） */}
        {codecIssue && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            当前浏览器无法播放该视频的画面（iPhone 默认的 HEVC 格式在 Windows
            上通常只有声音）。请改用 Safari / iPad 打开；以后拍摄可在 iPhone「设置 → 相机 →
            格式」里选「兼容性最佳」。
          </p>
        )}

        {/* 基础信息：上传人、上传时间、课程名（课程名在标题） */}
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          {[
            media.offline_class,
            media.uploader_name ? `上传者 ${media.uploader_name}` : null,
            `上传于 ${new Date(media.created_at).toLocaleString('zh-CN', { hour12: false })}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* ── 线下课打卡：孩子端和家长端都能看到 ── */}
        <div className="mx-auto w-full max-w-3xl lg:max-w-5xl">
          <Button
            type="button"
            onClick={() => void handleCheckin()}
            disabled={!courseTaskId || checkedIn || checkingIn || checkinLoading}
            className={cn(
              'h-14 w-full rounded-2xl text-lg font-bold',
              checkedIn && 'bg-muted text-muted-foreground hover:bg-muted',
            )}
          >
            <CheckCircle2 className="size-6" aria-hidden="true" />
            {checkinLoading
              ? '查询打卡状态…'
              : !courseTaskId
                ? '该资料未关联课程，无法打卡'
                : checkingIn
                  ? '打卡中…'
                  : checkedIn
                    ? '今日已打卡'
                    : '完成学习打卡'}
          </Button>
          {checkFeedback && (
            <p className="mt-2 text-center text-sm font-medium text-emerald-700">{checkFeedback}</p>
          )}
        </div>

        {isParent ? (
          /* ── 家长端：协同标记 + 陪伴备注（数据存 Supabase，另一端刷新即可看到） ── */
          <div className="flex flex-col gap-4 rounded-xl border p-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">带学标记</p>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map(({ value, label, icon: Icon, activeClass }) => {
                  const active = status === value
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={savingStatus}
                      onClick={() => void handleToggleStatus(value)}
                      className={cn(
                        'flex h-12 items-center justify-center gap-1.5 rounded-xl border text-base font-medium transition-colors disabled:opacity-60',
                        active ? activeClass : 'border-input bg-background hover:bg-muted/50',
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">陪伴备注</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：今天跟读了 3 遍，最后一段还不太熟"
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              />
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  disabled={savingNote || note.trim() === savedNote}
                  onClick={() => void handleSaveNote()}
                >
                  {savingNote ? '保存中…' : '保存备注'}
                </Button>
                {markFeedback && <p className="text-xs text-destructive">{markFeedback}</p>}
              </div>
            </div>

            {/* 危险操作：物理删除 R2 文件与数据库记录 */}
            <div className="border-t pt-3">
              <Button
                type="button"
                variant="outline"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="w-full text-destructive hover:text-destructive"
              >
                <Trash2 aria-hidden="true" />
                {deleting ? '删除中…' : '删除这个资料'}
              </Button>
            </div>
          </div>
        ) : (
          /* ── 孩子端：只读展示家长标记结果和备注 ── */
          (statusMeta || savedNote) && (
            <div className="flex flex-col gap-2 rounded-xl border p-4">
              {statusMeta && (
                <p
                  className={cn(
                    'inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
                    status === 'learned' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700',
                  )}
                >
                  <statusMeta.icon className="size-4" aria-hidden="true" />
                  {statusMeta.label}
                </p>
              )}
              {savedNote && <p className="text-sm text-muted-foreground">爸爸妈妈说：{savedNote}</p>}
            </div>
          )
        )}

        {media.note && <p className="text-sm">{media.note}</p>}
      </div>
    </>
  )
}
