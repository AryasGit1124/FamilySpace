'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MediaUploader,
  type MediaUploaderHandle,
  type UploadedMedia,
} from '@/app/components/MediaUploader'
import { fetchMediaList, fetchSchedulesWithTasks, insertMedia, type MediaRow } from '@/lib/supabase-queries'
import { errMsg } from '@/lib/media-upload'
import { todayDateKey } from '@/lib/supabase-adapter'
import { getTodayWeekday, weekdays } from '@/lib/mock-data'
import { supabase } from '@/lib/supabase'

type CourseOption = { id: string; name: string }
type OfflineOption = { value: string; day: number }

/** "19:20:00" → "19:20" */
function timeOnly(hhmmss: string) {
  const [h, m] = hhmmss.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/**
 * 判断某个文件名是否已上传过。
 * R2 存储键为 `<时间戳>_<URL 编码后的文件名>`，旧数据为 `<日期>/<时间戳>-<文件名>`，
 * 这里统一取路径末段、解码后剥掉时间戳前缀再做比较。
 */
function findDuplicateFile(rows: MediaRow[], fileName: string) {
  const normalize = (name: string) => name.replace(/[^\w.-]/g, '_').toLowerCase()
  const target = normalize(fileName)
  return rows.find((r) => {
    const clean = r.file_url.split('?')[0]
    const rawBase = clean.slice(clean.lastIndexOf('/') + 1)
    let base = rawBase
    try {
      base = decodeURIComponent(rawBase)
    } catch {
      // 非法编码时直接用原始末段
    }
    const stripped = base.replace(/^\d+[-_]/, '')
    return normalize(stripped) === target
  })
}

export default function UploadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  /** 从今日页线下课卡片跳入时预选课程与日期 */
  const preCourseId = searchParams.get('courseId')
  const preDate = searchParams.get('date')
  const uploaderRef = useRef<MediaUploaderHandle>(null)
  /** 已上传资料缓存 —— 用于重复上传检测，提交前会强制刷新 */
  const mediaRef = useRef<MediaRow[] | null>(null)

  const [courses, setCourses] = useState<CourseOption[]>([])
  const [offlineRows, setOfflineRows] = useState<OfflineOption[]>([])
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState('')
  const [mediaDate, setMediaDate] = useState('')
  const [offlineClass, setOfflineClass] = useState('') // 存的是线下课标签文本
  const [note, setNote] = useState('')
  /** MediaUploader 已成功上传的文件（等待入库） */
  const [uploaded, setUploaded] = useState<UploadedMedia[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 默认今天（或 URL 传入的日期）：放到 effect 里，避免服务端与客户端跨天导致 hydration 不一致
  useEffect(() => {
    setMediaDate(preDate || todayDateKey())
  }, [preDate])

  // 课程下拉 + 线下课下拉，都读取真实课表数据（schedules → tasks）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchSchedulesWithTasks()
        if (cancelled) return

        // 课程：按 task_id 去重
        const seen = new Map<string, string>()
        for (const r of rows) {
          if (r.tasks && !seen.has(r.tasks.id)) seen.set(r.tasks.id, r.tasks.title)
        }
        const courseList = [...seen.entries()].map(([id, name]) => ({ id, name }))
        setCourses(courseList)
        // 今日页跳入时优先选 URL 指定的课程，否则保持现状/选第一门
        setCourseId((prev) => {
          if (prev) return prev
          if (preCourseId && courseList.some((c) => c.id === preCourseId)) return preCourseId
          return courseList[0]?.id || ''
        })
        if (courseList.length === 0) setCoursesError('课表里还没有课程，请先去设置页的课表设置添加')

        // 线下课：具体到某天某个时间点的线下课程（先全部存下，再按关联日期筛选）
        const offline = rows
          .filter((r) => r.tasks && r.tasks.type === 'offline')
          .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
          .map((r) => {
            const dayLabel = weekdays.find((w) => w.value === r.day_of_week)?.label ?? `周${r.day_of_week}`
            const time = timeOnly(r.start_time)
            const loc = r.location ? ` · ${r.location}` : ''
            return {
              day: r.day_of_week,
              value: `${dayLabel} ${time} ${r.tasks!.title}${loc}`,
            }
          })
        setOfflineRows(offline)
      } catch (err) {
        console.error('[UploadPage] 课表数据加载失败:', err)
        if (!cancelled) setCoursesError('课表数据加载失败，请稍后刷新重试')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [preCourseId])

  // 按关联日期筛选当天（周几）的线下课
  const offlineOptions = useMemo(() => {
    if (!mediaDate) return []
    const weekday = getTodayWeekday(new Date(`${mediaDate}T00:00:00`))
    return offlineRows.filter((o) => o.day === weekday)
  }, [mediaDate, offlineRows])

  // 换了日期后，原来选的线下课不属于当天就清空，避免存进错误关联
  useEffect(() => {
    if (offlineClass && !offlineOptions.some((o) => o.value === offlineClass)) {
      setOfflineClass('')
    }
  }, [offlineOptions, offlineClass])

  /** 取已上传资料列表（带缓存）；force=true 时强制重新拉取 */
  const getExistingMedia = useCallback(async (force = false) => {
    if (force || !mediaRef.current) {
      mediaRef.current = await fetchMediaList()
    }
    return mediaRef.current
  }, [])

  /** 上传前查重：已上传过同名文件则跳过 */
  const beforeUpload = useCallback(
    async (file: File) => {
      try {
        const existing = await getExistingMedia()
        const dup = findDuplicateFile(existing, file.name)
        if (dup) {
          return `该文件已上传过（${dup.course_name ?? '未分类'} · ${dup.media_date}）`
        }
      } catch (err) {
        console.warn('[UploadPage] 重复检测失败，稍后提交时会再次校验:', err)
      }
      return null
    },
    [getExistingMedia],
  )

  // 文件与文字二选一（也可同时存在）：都没填才禁止提交
  const canSubmit =
    !uploading &&
    !saving &&
    !!courseId &&
    !!mediaDate &&
    (uploaded.length > 0 || note.trim().length > 0)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return

    if (!courseId) {
      setFeedback({ type: 'error', text: '请先选择课程（课表里暂无课程时，请先去课表设置添加）' })
      return
    }
    const textContent = note.trim()
    const batch = uploaded
    if (batch.length === 0 && !textContent) {
      setFeedback({ type: 'error', text: '请选择文件，或填写文字作业内容' })
      return
    }
    if (!supabase) {
      setFeedback({ type: 'error', text: 'Supabase 未初始化，请检查 .env.local 配置' })
      return
    }

    const courseName = courses.find((c) => c.id === courseId)?.name ?? ''

    setFeedback(null)
    setSaving(true)

    // 纯文字作业：不调存储接口，直接写 media 表（file_type='text'，file_url 留空）
    if (batch.length === 0) {
      try {
        await insertMedia({
          course_id: courseId,
          course_name: courseName,
          child_name: null,
          offline_class: offlineClass || null,
          media_date: mediaDate,
          file_url: '',
          file_type: 'text',
          note: textContent,
          uploader_name: '妈妈',
        })
        setFeedback({ type: 'success', text: `文字作业已保存：${courseName} · ${mediaDate} 已保存到本周资料库` })
        mediaRef.current = null
        setNote('')
      } catch (insertErr) {
        setFeedback({ type: 'error', text: `保存记录失败：${errMsg(insertErr)}` })
      } finally {
        setSaving(false)
      }
      return
    }

    // 文件已在 MediaUploader 中上传完成，这里只负责写入资料库
    const failedNames: string[] = []
    let successCount = 0
    for (const media of batch) {
      try {
        await insertMedia({
          course_id: courseId, // 课表 tasks 的 id，即这门课本身
          course_name: courseName,
          child_name: null,
          offline_class: offlineClass || null, // 例如「周一 19:20 英语 · 西溪少年宫5F」
          media_date: mediaDate,
          file_url: media.publicUrl,
          file_type: media.mediaType,
          note: note.trim() || null,
          uploader_name: '妈妈',
          thumb_url: media.coverUrl,
        })
        successCount += 1
        setUploaded((prev) => prev.filter((item) => item.publicUrl !== media.publicUrl))
      } catch (err) {
        console.error('[UploadPage] 文件入库失败:', media.fileName, err)
        failedNames.push(media.fileName)
      }
    }

    // 清掉缓存，下一次重复检测会拿到最新数据
    mediaRef.current = null
    setSaving(false)

    // 已入库的文件从上传器中清空，避免用户误删仍被资料库引用的 R2 文件
    if (successCount > 0) {
      uploaderRef.current?.reset()
      setUploaded([])
    }

    if (failedNames.length === 0) {
      setFeedback({
        type: 'success',
        text: `${successCount} 个文件已全部上传成功，正在返回资料库…`,
      })
      window.setTimeout(() => router.push('/library'), 1200)
    } else {
      setFeedback({
        type: 'error',
        text: `${successCount} 个成功，${failedNames.length} 个保存失败：${failedNames.join('、')}。请重新选择失败的文件再试。`,
      })
    }
  }

  return (
    <>
      <PageHeader title="上传资料" subtitle="视频 / 图片，单个文件不超过 100MB" />
      <div className="flex flex-col gap-4 px-5">
        {feedback && (
          <div
            role="status"
            className={
              feedback.type === 'success'
                ? 'flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800'
                : 'flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive'
            }
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-sm font-medium break-words">{feedback.text}</p>
              {feedback.type === 'success' && (
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => router.push('/library')}>
                    查看本周资料库
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setFeedback(null)}>
                    继续上传
                  </Button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="关闭提示"
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>上传课程资料</CardTitle>
            <CardDescription>填写信息并选择文件，保存后会出现在本周视频库</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start md:gap-6"
            >
              {/* 左栏：课程 / 日期 / 线下课 / 备注（手机单列，iPad 左右分栏） */}
              <div className="flex flex-col gap-4">
                {/* 课程名称 —— 读取课表真实课程 */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="course-id">课程名称</Label>
                  <select
                    id="course-id"
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    disabled={courses.length === 0}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
                  >
                    {courses.length === 0 ? (
                      <option value="">暂无课程</option>
                    ) : (
                      courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    )}
                  </select>
                  {coursesError && <p className="text-xs text-muted-foreground">{coursesError}</p>}
                </div>

                {/* 关联日期 */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="media-date">关联日期</Label>
                  <Input
                    id="media-date"
                    type="date"
                    value={mediaDate}
                    onChange={(e) => setMediaDate(e.target.value)}
                  />
                </div>

                {/* 关联线下课 —— 列出课表里真实的线下课（周几 + 时间 + 课程） */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="offline-class">关联线下课（可选）</Label>
                  <select
                    id="offline-class"
                    value={offlineClass}
                    onChange={(e) => setOfflineClass(e.target.value)}
                    disabled={offlineOptions.length === 0}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
                  >
                    <option value="">不关联</option>
                    {offlineOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.value}
                      </option>
                    ))}
                  </select>
                  {offlineOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {mediaDate
                        ? `所选日期（${weekdays.find((w) => w.value === getTodayWeekday(new Date(`${mediaDate}T00:00:00`)))?.label ?? ''}）当天没有线下课`
                        : '请先选择关联日期'}
                    </p>
                  )}
                </div>

                {/* 备注 / 文字作业 */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="note">文字作业 / 备注</Label>
                  <textarea
                    id="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="可直接粘贴老师发的文字作业，例如：抄写第 3 课生字各 2 遍；也可以只作为文件的备注"
                    rows={4}
                    maxLength={2000}
                    className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  />
                  <p className="text-xs text-muted-foreground">不选文件、只填文字也可以保存，会作为「文字作业」出现在资料库</p>
                </div>
              </div>

              {/* 右栏：通用上传器 + 提交（手机仍在下方，iPad 在右侧） */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>视频 / 图片文件（可多选）</Label>
                  <MediaUploader
                    ref={uploaderRef}
                    folder={courses.find((c) => c.id === courseId)?.name || '未分类'}
                    beforeUpload={beforeUpload}
                    disabled={saving}
                    onUploadingChange={setUploading}
                    onUploadSuccess={(media) => setUploaded((prev) => [...prev, media])}
                    onUploadedRemove={(media) =>
                      setUploaded((prev) => prev.filter((item) => item.publicUrl !== media.publicUrl))
                    }
                    onError={(message) => {
                      if (message) setFeedback({ type: 'error', text: message })
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    建议一次多选批量上传；每个文件都会生成一条独立的资料记录。为了确保视频在所有设备上能顺利播放，建议在 iPhone 设置 -&gt; 相机 -&gt; 格式 中，选择【兼容性最佳】后再拍摄上传哦。
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={!canSubmit} className="flex-1">
                    {saving
                      ? '保存中…'
                      : uploaded.length > 0
                        ? `保存 ${uploaded.length} 个文件`
                        : '保存文字作业'}
                  </Button>
                  {uploading && (
                    <Button type="button" variant="outline" onClick={() => uploaderRef.current?.abort()}>
                      取消上传
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
