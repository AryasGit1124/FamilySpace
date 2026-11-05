'use client'

import { useState, useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { CalendarDays, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MediaUploader, type UploadedMedia } from '@/app/components/MediaUploader'
import {
  insertGrowthRecord,
  updateGrowthRecord,
  type GrowthRecord,
} from '@/lib/growth-queries'
import { deleteR2Media, errMsg } from '@/lib/media-upload'
import { todayDateKey } from '@/lib/supabase-adapter'

type Mode = 'media' | 'text'

type Props = {
  /** 有值 = 编辑模式；不传 = 新建 */
  initialData?: GrowthRecord | null
  onClose: () => void
  onSaved: (record: GrowthRecord) => void
}

/**
 * 新建 / 编辑成长档案：
 * 手机端全屏，iPad / 电脑端居中弹窗；顶部 Tab 切换「图文/视频」与「纯文本日记」。
 */
export function GrowthRecordForm({ initialData, onClose, onSaved }: Props) {
  const isEdit = !!initialData
  const [mode, setMode] = useState<Mode>(initialData?.media_type === 'text' ? 'text' : 'media')
  const [recordDate, setRecordDate] = useState(initialData?.record_date || todayDateKey())
  const [content, setContent] = useState(initialData?.content ?? '')
  const [uploaded, setUploaded] = useState<UploadedMedia | null>(null)
  const [uploaderUploading, setUploaderUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // —— 纯文本日记草稿自动保存 ——
  const draftKey = initialData ? `draft_growth_${initialData.id}` : 'draft_growth_new'
  // typing：正在输入；saved：防抖已写入本地；idle：无操作
  const [draftStatus, setDraftStatus] = useState<'idle' | 'typing' | 'saved'>('idle')
  // 打开时若本地有未保存草稿，先暂存起来，等用户确认是否恢复
  const [pendingDraft, setPendingDraft] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const existingPreview =
    initialData?.media_type === 'video'
      ? initialData.cover_url
      : initialData?.file_url ?? null

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setError('')
  }

  // 打开页面时检测本地是否有未保存的草稿（仅对纯文本模式有意义）
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = window.localStorage.getItem(draftKey)
      if (saved && saved.trim().length > 0 && saved !== content) {
        setPendingDraft(saved)
      }
    } catch {
      /* localStorage 不可用时静默忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // 组件卸载时清理防抖定时器，避免内存泄漏
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // 输入变更：纯文本模式下防抖 1s 写入 localStorage
  const handleContentChange = (value: string) => {
    setContent(value)
    if (mode !== 'text') return
    setDraftStatus('typing')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        if (value.trim()) {
          window.localStorage.setItem(draftKey, value)
        } else {
          window.localStorage.removeItem(draftKey)
        }
        setDraftStatus('saved')
      } catch {
        setDraftStatus('idle')
      }
    }, 1000)
  }

  const restoreDraft = () => {
    if (pendingDraft === null) return
    setContent(pendingDraft)
    setDraftStatus('saved')
    setPendingDraft(null)
  }

  const discardDraft = () => {
    try {
      window.localStorage.removeItem(draftKey)
    } catch {
      /* ignore */
    }
    setPendingDraft(null)
  }

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey)
    } catch {
      /* ignore */
    }
    setPendingDraft(null)
    setDraftStatus('idle')
  }

  const canSubmit =
    !submitting && !uploaderUploading && (isEdit || uploaded !== null || content.trim().length > 0)

  // 只保留一个输入框：内容存 content，标题由内容前 15 个字自动生成
  const derivedTitle = Array.from(content.trim()).slice(0, 15).join('') || '成长瞬间'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      const isTextMode = mode === 'text'
      let mediaType: GrowthRecord['media_type'] = isTextMode
        ? 'text'
        : uploaded?.mediaType ?? initialData?.media_type ?? 'text'
      let fileUrl: string | null = isTextMode ? null : uploaded?.publicUrl ?? initialData?.file_url ?? null
      let coverUrl: string | null = isTextMode ? null : uploaded?.coverUrl ?? initialData?.cover_url ?? null
      const replacedMedia = !isTextMode && uploaded !== null

      if (!isTextMode) {
        console.log('[GrowthForm] 准备入库的媒体地址:', {
          mediaType,
          fileUrl,
          coverUrl,
          replacedMedia,
        })
      }

      // 纯文本模式不会保存媒体：清理刚上传但未入库的文件，避免 R2 垃圾
      if (isTextMode && uploaded) {
        void deleteR2Media(uploaded.publicUrl, uploaded.coverUrl).catch((err) => {
          console.warn('[GrowthForm] 清理未入库的 R2 文件失败:', err)
        })
      }

      if (initialData) {
        const removingOldMedia = isTextMode
          ? initialData.file_url !== null || initialData.cover_url !== null
          : replacedMedia
        const updated = await updateGrowthRecord(initialData.id, {
          title: derivedTitle,
          content: content.trim() || null,
          recordDate,
          ...(isTextMode || replacedMedia ? { mediaType, fileUrl, coverUrl } : {}),
        })
        onSaved(updated)
        if (removingOldMedia && (initialData.file_url || initialData.cover_url)) {
          void deleteR2Media(initialData.file_url, initialData.cover_url).catch((err) => {
            console.warn('[GrowthForm] 清理旧 R2 文件失败:', err)
          })
        }
      } else {
        const created = await insertGrowthRecord({
          mediaType,
          fileUrl,
          coverUrl,
          title: derivedTitle,
          content: content.trim() || null,
          recordDate,
        })
        onSaved(created)
      }
      // 写入数据库成功后清除本地草稿，避免下次打开再次提示恢复
      clearDraft()
      onClose()
    } catch (err) {
      console.error('[GrowthForm] 保存记录失败:', err)
      setError(`保存失败：${errMsg(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-white md:h-auto md:items-center md:justify-center md:bg-black/50 md:p-4"
      onClick={() => {
        if (!submitting) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '修改记录' : '记录新瞬间'}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full min-h-0 w-full flex-col bg-white md:mx-auto md:my-auto md:h-[80vh] md:max-h-[80vh] md:max-w-2xl md:overflow-hidden md:rounded-2xl md:shadow-xl"
      >
        {/* 顶部导航：取消 / 标题 / 保存 */}
        <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b px-3 pt-[env(safe-area-inset-top)] md:min-h-16 md:px-5 md:pt-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            取消
          </button>
          <h2 className="truncate text-base font-bold md:text-lg">
            {isEdit ? '修改记录' : '记录新瞬间'}
          </h2>
          <Button
            type="submit"
            form="growth-form"
            disabled={!canSubmit}
            className="h-9 shrink-0 px-4 text-sm"
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                保存中…
              </>
            ) : (
              '保存'
            )}
          </Button>
        </div>

        {/* Tab 切换：仅新建记录时显示；编辑时按原 media_type 锁定模式 */}
        {!isEdit && (
          <div className="shrink-0 px-3 pt-2 md:px-4 md:pt-3">
            <div className="flex rounded-full bg-muted p-1">
              <TabButton active={mode === 'media'} disabled={submitting} onClick={() => switchMode('media')}>
                🖼️ 图文 / 视频
              </TabButton>
              <TabButton active={mode === 'text'} disabled={submitting} onClick={() => switchMode('text')}>
                📝 纯文本日记
              </TabButton>
            </div>
          </div>
        )}

        {error && (
          <p className="mx-3 mt-2 shrink-0 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <form id="growth-form" onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* 日期固定在 Tab 下方，键盘弹起时保持在上方，不参与输入区滚动 */}
          <div className="shrink-0 border-b bg-white px-3 py-2 md:px-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Label htmlFor="growth-date" className="sr-only">
                日期
              </Label>
              <Input
                id="growth-date"
                type="date"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
                className="h-9 flex-1 text-sm"
              />
            </div>
          </div>

          {/* 两个 Tab 都保持挂载，切换时不丢失已选文件与上传结果 */}
          <div className={mode === 'media' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <MediaFields
              content={content}
              onContentChange={handleContentChange}
              existingPreview={uploaded ? null : existingPreview}
              uploadedMedia={uploaded}
              submitting={submitting}
              onUploadSuccess={setUploaded}
              onUploadedRemove={() => setUploaded(null)}
              onUploadingChange={setUploaderUploading}
              onError={(message) => setError(message ?? '')}
            />
          </div>
          <div className={mode === 'text' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            {/* 检测到本地草稿时的恢复横幅 */}
            {pendingDraft !== null && (
              <div className="mx-3 mt-2 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  检测到上次未保存的草稿，是否恢复？
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={restoreDraft}
                    className="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
                  >
                    恢复草稿
                  </button>
                  <button
                    type="button"
                    onClick={discardDraft}
                    className="rounded-md px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
                  >
                    放弃
                  </button>
                </div>
              </div>
            )}
            <TextFields
              content={content}
              onContentChange={handleContentChange}
              draftStatus={draftStatus}
            />
          </div>
        </form>
      </div>
    </div>
  )
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? 'flex-1 rounded-full bg-white py-2 text-sm font-semibold text-foreground shadow-sm'
          : 'flex-1 rounded-full py-2 text-sm text-muted-foreground transition-colors hover:text-foreground'
      }
    >
      {children}
    </button>
  )
}

type FieldProps = {
  content: string
  onContentChange: (value: string) => void
}

/** Tab 1：文本输入框撑满中间，媒体上传器固定在底部 */
function MediaFields({
  content,
  onContentChange,
  existingPreview,
  uploadedMedia,
  submitting,
  onUploadSuccess,
  onUploadedRemove,
  onUploadingChange,
  onError,
}: FieldProps & {
  existingPreview: string | null
  uploadedMedia: UploadedMedia | null
  submitting: boolean
  onUploadSuccess: (media: UploadedMedia) => void
  onUploadedRemove: () => void
  onUploadingChange: (uploading: boolean) => void
  onError: (message: string | null) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 中间可滚动区：textarea 撑满除底部上传栏外的所有空间 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-4">
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="写点什么吧...（例如：今天学会了自己穿鞋）"
          maxLength={3000}
          className="min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-lg border p-3 text-base outline-none placeholder:text-muted-foreground"
        />

        {uploadedMedia?.mediaType === 'video' && (!uploadedMedia.coverUrl || /\.mov$/i.test(uploadedMedia.fileName)) && (
          <p className="shrink-0 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">
            {uploadedMedia.coverUrl
              ? 'iPhone 原始 MOV/HEVC 视频在部分安卓或电脑浏览器可能播放较慢，建议在手机相册导出为 MP4（H.264）后重新上传。'
              : '当前浏览器无法解码这个视频的封面（常见于 MOV/HEVC），列表会用视频首帧展示；若其他设备播放转圈，建议导出为 MP4（H.264）后重新上传。'}
          </p>
        )}

        {existingPreview && (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={existingPreview} alt="当前媒体" className="size-12 shrink-0 rounded object-cover" />
            <p className="text-[11px] text-muted-foreground">
              当前已有媒体；选择新文件并上传成功后会替换并删除旧文件
            </p>
          </div>
        )}
      </div>

      {/* 底部固定上传栏：贴在键盘上方，随时可点 */}
      <div className="shrink-0 border-t bg-gray-50 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:p-4">
        <MediaUploader
          folder="growth"
          multiple={false}
          disabled={submitting}
          label="📷 添加照片 / 视频"
          onUploadSuccess={onUploadSuccess}
          onUploadedRemove={onUploadedRemove}
          onUploadingChange={onUploadingChange}
          onError={onError}
        />
      </div>
    </div>
  )
}

/** Tab 2：占满全屏的长文本 */
function TextFields({
  content,
  onContentChange,
  draftStatus,
}: FieldProps & { draftStatus: 'idle' | 'typing' | 'saved' }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        id="growth-content"
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        placeholder="今天宝宝说了什么有趣的童言童语？或者发生了什么小故事？"
        maxLength={3000}
        className="min-h-0 w-full flex-1 resize-none overflow-y-auto bg-transparent p-4 text-lg outline-none placeholder:text-muted-foreground"
      />
      {/* 草稿保存状态提示 */}
      <div className="shrink-0 px-4 pb-3 pt-1 text-right text-[11px] text-muted-foreground">
        {draftStatus === 'typing' && <span>正在输入…</span>}
        {draftStatus === 'saved' && <span className="text-emerald-600">草稿已自动保存到本地</span>}
      </div>
    </div>
  )
}
