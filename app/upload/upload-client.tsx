'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as tus from 'tus-js-client'
import { AlertCircle, CheckCircle2, UploadCloud, X } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchMediaList, fetchSchedulesWithTasks, insertMedia, type MediaRow } from '@/lib/supabase-queries'
import { todayDateKey } from '@/lib/supabase-adapter'
import { getTodayWeekday, weekdays } from '@/lib/mock-data'
import { supabase } from '@/lib/supabase'

const MAX_SIZE = 100 * 1024 * 1024 // 100MB
const ACCEPT = 'video/*,image/*'
const BUCKET = 'course-media'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
/** 直连存储域名：<项目ID>.storage.supabase.co，比走通用域名更快 */
const STORAGE_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace('.supabase.co', '.storage.supabase.co')
/** TUS 分片大小：6MB（Supabase 推荐值） */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024
/** 无任何传输进展超过该时长视为连接卡死（跨境弱网常见：TCP 半死不活，不报错也不传数据） */
const STALL_TIMEOUT_MS = 15_000
/** 卡死后自动断点续传的最大次数（每次续传都从服务器已收到的 offset 继续，不会重传） */
const MAX_STALL_RESTARTS = 10

/** 看门狗识别到连接停滞时抛出的内部错误，用于触发断点续传重试 */
class StallError extends Error {
  constructor() {
    super('传输停滞，自动断点续传')
    this.name = 'StallError'
  }
}

type CourseOption = { id: string; name: string }
type OfflineOption = { value: string; day: number }

/** "19:20:00" → "19:20" */
function timeOnly(hhmmss: string) {
  const [h, m] = hhmmss.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/** 校验文件：只允许视频/图片，且不超过 100MB。返回错误文案，通过则返回 null */
function validateFile(file: File): string | null {
  const byMime = file.type.startsWith('video/') || file.type.startsWith('image/')
  // 有些系统给出的 MIME 为空，用扩展名兜底
  const byExt = /\.(mp4|mov|m4v|webm|avi|mkv|jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.name)
  if (!byMime && !byExt) {
    return '只支持视频或图片文件（如 mp4 / mov / jpg / png）'
  }
  if (file.size > MAX_SIZE) {
    return `文件大小 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 100MB 限制`
  }
  return null
}

/** 根据 MIME 或扩展名判断存入 media.file_type 的类型 */
function resolveFileType(file: File): 'video' | 'image' {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name) ? 'video' : 'image'
}

function humanSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/**
 * 从错误对象里提取可读文案。
 * Supabase 的 PostgrestError 不是 Error 实例，直接 String() 只会得到 [object Object]。
 */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

/**
 * 判断某个文件名是否已上传过。
 * 存储路径为 `<日期>/<时间戳>-<文件名>`，所以用后缀匹配即可；
 * 已上传的文件不允许再次上传，避免重复资料。
 */
function findDuplicateFile(rows: MediaRow[], fileName: string) {
  const safeName = fileName.replace(/[^\w.-]/g, '_')
  return rows.find((r) => {
    const clean = r.file_url.split('?')[0]
    return clean.endsWith(`-${safeName}`) || clean.endsWith(`/${safeName}`)
  })
}

/**
 * 浏览器端视频抽帧：取 0.5 秒处的画面生成 JPEG 封面（宽边 ≤640px）。
 * 同时充当「解码探测」：iPhone 默认拍 HEVC(H.265)，Windows 版 Chrome/Edge 大多没有
 * 解码器，表现为只闻其声不见其画，此时 videoWidth 为 0，抽帧失败返回 null。
 */
async function extractVideoThumb(file: File): Promise<File | null> {
  if (!file.type.startsWith('video/')) return null
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('抽帧超时')), 10_000)
      video.onloadeddata = () => {
        clearTimeout(timer)
        resolve()
      }
      video.onerror = () => {
        clearTimeout(timer)
        reject(new Error('视频解码失败'))
      }
    })

    // 有画面才能抽帧；HEVC 在不解码的浏览器里 videoWidth 为 0
    if (video.videoWidth === 0) return null

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
    })

    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 640 / video.videoWidth)
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    if (!blob) return null
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-thumb.jpg', { type: 'image/jpeg' })
  } catch (err) {
    console.warn('[UploadPage] 视频抽帧失败（可能当前浏览器无法解码该视频）:', err)
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 探测当前浏览器能否解码该视频的画面（用于上传前提示）。
 * 可解码返回 true；只能出声没有画面 / 完全不支持返回 false。
 */
async function probeVideoDecodable(file: File): Promise<boolean> {
  const thumb = await extractVideoThumb(file)
  return thumb !== null
}

/**
 * 图片上传前压缩：长边 ≤1920px、质量 0.82。
 * 手机照片动辄 3~8MB，压完通常不到 500KB，肉眼几乎看不出差别，上传速度提升明显。
 * 压缩失败或结果反而更大时，回退原文件。
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1.5 * 1024 * 1024) {
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const maxSide = 1920
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()

    const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82))
    if (!blob || blob.size >= file.size) return file

    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext
    return new File([blob], name, { type })
  } catch (err) {
    console.warn('[UploadPage] 图片压缩失败，使用原文件:', err)
    return file
  }
}

/**
 * TUS 分片（断点续传）上传。
 * - endpoint 使用直连存储域名 <项目ID>.storage.supabase.co，绕过通用域名的转发层
 * - 单请求失败会按 retryDelays 自动重试，并从已上传的 offset 续传，不会从 0 重来
 * - 每片 6MB（Supabase 推荐值）
 * - 停滞看门狗：跨境弱网下 TCP 连接可能"半死不活"（不报错也不传数据，tus 默认无超时，
 *   会一直等下去，表现为进度卡在 99% 不动）。检测到 STALL_TIMEOUT_MS 无任何进展后
 *   主动中止并重新发起上传，tus 凭 fingerprint 自动从服务器 offset 续传。
 * - 取消/卸载清理：传入 AbortSignal，触发后 abort 当前 tus 实例并抛出 AbortError；
 *   断点（fingerprint）会保留，下次传同一文件可从断点继续。
 */
async function tusUpload(
  path: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  onStall?: () => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!STORAGE_BASE || !ANON_KEY) throw new Error('缺少 Supabase 环境变量')

  const abortError = () => new DOMException('上传已取消', 'AbortError')

  // 有登录态就用 access_token，没有（本项目未启用 Auth）则退回 anon key
  let token = ANON_KEY
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
    if (data.session?.access_token) token = data.session.access_token
  } catch (err) {
    console.warn('[UploadPage] 获取 session 失败，使用 anon key:', err)
  }

  // 断点续传重新开始时 offset 可能回退（服务器只确认已提交的片），进度条取历史最大值避免倒退
  let maxLoaded = 0

  for (let attempt = 0; attempt <= MAX_STALL_RESTARTS; attempt++) {
    if (signal?.aborted) throw abortError()
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let lastActivity = Date.now()
        /** 所有退出路径统一走这里，保证看门狗和 abort 监听都被清理 */
        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          clearInterval(watchdog)
          signal?.removeEventListener('abort', onAbort)
          fn()
        }

        const upload = new tus.Upload(file, {
          endpoint: `${STORAGE_BASE}/storage/v1/upload/resumable`,
          retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
          chunkSize: TUS_CHUNK_SIZE,
          headers: {
            apikey: ANON_KEY,
            authorization: `Bearer ${token}`,
            'x-upsert': 'false',
          },
          metadata: {
            bucketName: BUCKET,
            objectName: path,
            contentType: file.type || 'application/octet-stream',
            cacheControl: '31536000',
          },
          removeFingerprintOnSuccess: true,
          onProgress: (bytesUploaded, bytesTotal) => {
            lastActivity = Date.now()
            maxLoaded = Math.max(maxLoaded, bytesUploaded)
            onProgress(maxLoaded, bytesTotal)
          },
          onChunkComplete: () => {
            lastActivity = Date.now()
          },
          onSuccess: () => settle(resolve),
          onError: (err) => settle(() => reject(err)),
        })

        const watchdog = setInterval(() => {
          if (settled || Date.now() - lastActivity <= STALL_TIMEOUT_MS) return
          // 注意不能 abort(true)：true 会向服务器发 DELETE 终止整个上传任务，断点就丢了
          upload.abort(false).catch(() => {})
          settle(() => reject(new StallError()))
        }, 3000)

        const onAbort = () => {
          upload.abort(false).catch(() => {})
          settle(() => reject(abortError()))
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        upload.start()
      })
      return // 上传成功
    } catch (err) {
      if (err instanceof StallError && attempt < MAX_STALL_RESTARTS) {
        console.warn(`[UploadPage] 传输停滞，第 ${attempt + 1} 次断点续传（已传 ${(maxLoaded / 1024 / 1024).toFixed(1)}MB）`)
        onStall?.()
        continue
      }
      if (err instanceof StallError) {
        throw new Error('网络持续中断，已自动续传多次仍未完成，请切换网络（如手机热点/关闭代理）后重试')
      }
      throw err
    }
  }
}

export default function UploadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  /** 从今日页线下课卡片跳入时预选课程与日期 */
  const preCourseId = searchParams.get('courseId')
  const preDate = searchParams.get('date')
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 已上传资料缓存 —— 用于重复上传检测，提交前会强制刷新 */
  const mediaRef = useRef<MediaRow[] | null>(null)
  /** 当前上传的中止控制器：取消上传 / 组件卸载时触发，妥善清理 tus 实例 */
  const abortRef = useRef<AbortController | null>(null)

  const [courses, setCourses] = useState<CourseOption[]>([])
  const [offlineRows, setOfflineRows] = useState<OfflineOption[]>([])
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState('')
  const [mediaDate, setMediaDate] = useState('')
  const [offlineClass, setOfflineClass] = useState('') // 存的是线下课标签文本
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  /** 视频在当前浏览器无法解码画面（HEVC 等）时置 true，仅提示不拦截 */
  const [codecWarn, setCodecWarn] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** 看门狗触发断点续传时置 true，用于界面提示 */
  const [stalling, setStalling] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [progress, setProgress] = useState<{
    percent: number
    loaded: number
    total: number
    speed: number
    eta: number
  } | null>(null)

  // 默认今天（或 URL 传入的日期）：放到 effect 里，避免服务端与客户端跨天导致 hydration 不一致
  useEffect(() => {
    setMediaDate(preDate || todayDateKey())
  }, [preDate])

  // 组件卸载时中止正在进行的上传，清理 tus 实例与看门狗定时器
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

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

  /** 选文件时立即校验：格式/大小/是否重复，不合格直接拦截并清空选择 */
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    if (!picked) {
      setFile(null)
      return
    }
    const err = validateFile(picked)
    if (err) {
      setFeedback({ type: 'error', text: err })
      e.target.value = '' // 清空，避免把非法文件挂在 input 上
      setFile(null)
      return
    }
    try {
      const dup = findDuplicateFile(await getExistingMedia(), picked.name)
      if (dup) {
        setFeedback({
          type: 'error',
          text: `该文件已上传过（${dup.course_name ?? '未分类'} · ${dup.media_date}），不能重复上传`,
        })
        e.target.value = ''
        setFile(null)
        return
      }
    } catch (err) {
      console.warn('[UploadPage] 重复检测失败，稍后提交时会再次校验:', err)
    }
    setFile(picked)
    setFeedback(null)
    // 视频解码探测：HEVC 在 Windows Chrome/Edge 上通常只有声音没有画面，提前提示
    setCodecWarn(false)
    if (picked.type.startsWith('video/')) {
      void probeVideoDecodable(picked).then((ok) => {
        // 探测期间用户可能已换文件/清空，简单起见不校验，预警只是提示不影响提交
        if (!ok) setCodecWarn(true)
      })
    }
  }

  // 文件与文字二选一（也可同时存在）：都没填才禁止提交
  const canSubmit = !uploading && !!courseId && !!mediaDate && (!!file || note.trim().length > 0)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (uploading) return

    if (!courseId) {
      setFeedback({ type: 'error', text: '请先选择课程（课表里暂无课程时，请先去课表设置添加）' })
      return
    }
    const textContent = note.trim()
    if (!file && !textContent) {
      setFeedback({ type: 'error', text: '请选择一个文件，或填写文字作业内容' })
      return
    }
    // 提交前再校验一次（防止绕过选择阶段）
    if (file) {
      const err = validateFile(file)
      if (err) {
        setFeedback({ type: 'error', text: err })
        return
      }
    }
    if (!supabase) {
      setFeedback({ type: 'error', text: 'Supabase 未初始化，请检查 .env.local 配置' })
      return
    }

    const courseName = courses.find((c) => c.id === courseId)?.name ?? ''

    setFeedback(null)
    setUploading(true)
    setProgress(null)

    // 纯文字作业：不调存储接口，直接写 media 表（file_type='text'，file_url 留空）
    if (!file) {
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
        // 清掉缓存，下一次重复检测会拿到最新数据
        mediaRef.current = null
        setNote('')
      } catch (insertErr) {
        setFeedback({ type: 'error', text: `保存记录失败：${errMsg(insertErr)}` })
      } finally {
        setUploading(false)
      }
      return
    }
    setStalling(false)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      // 0. 图片先压缩再上传（视频无法在浏览器端压缩，按原文件上传）
      const prepared = await compressImage(file)

      // 0.5 提交前再查一次重复（强制刷新，避免别的窗口刚传过同一文件）
      try {
        const dup = findDuplicateFile(await getExistingMedia(true), prepared.name)
        if (dup) {
          setFeedback({
            type: 'error',
            text: `该文件已上传过（${dup.course_name ?? '未分类'} · ${dup.media_date}），不能重复上传`,
          })
          return
        }
      } catch (err) {
        console.warn('[UploadPage] 重复检测失败，继续上传:', err)
      }

      const safeName = prepared.name.replace(/[^\w.-]/g, '_')
      const path = `${mediaDate}/${Date.now()}-${safeName}`

      // 1. TUS 分片上传到 course-media 桶（失败自动从断点续传）
      const startedAt = performance.now()
      try {
        await tusUpload(
          path,
          prepared,
          (loaded, total) => {
            const elapsed = (performance.now() - startedAt) / 1000
            const speed = elapsed > 0 ? loaded / elapsed / 1024 / 1024 : 0
            setProgress({
              percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
              loaded,
              total,
              speed,
              eta: speed > 0 ? (total - loaded) / 1024 / 1024 / speed : 0,
            })
          },
          () => setStalling(true),
          controller.signal,
        )
      } catch (uploadErr) {
        // 用户主动取消/页面已离开：静默结束，不报错
        if (uploadErr instanceof Error && uploadErr.name === 'AbortError') return
        const raw = uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
        setFeedback({
          type: 'error',
          text: raw.includes('Bucket not found')
            ? `上传失败：存储桶「${BUCKET}」不存在。请到 Supabase Dashboard → Storage 新建一个名为 ${BUCKET} 的 Public 桶。`
            : `上传失败：${raw}`,
        })
        return
      }

      // 1.5 视频抽帧生成封面图并上传（失败不阻塞主流程，只是列表少个缩略图）
      let thumbUrl: string | null = null
      if (prepared.type.startsWith('video/')) {
        const thumb = await extractVideoThumb(prepared)
        if (thumb) {
          try {
            const thumbPath = `${mediaDate}/${Date.now()}-thumb-${safeName}.jpg`
            await tusUpload(thumbPath, thumb, () => {}, undefined, controller.signal)
            thumbUrl = supabase.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl
          } catch (thumbErr) {
            // 用户在抽帧上传期间点了取消：按取消处理，不再继续写库
            if (thumbErr instanceof Error && thumbErr.name === 'AbortError') return
            console.warn('[UploadPage] 封面上传失败，忽略:', thumbErr)
          }
        }
      }

      // 2. 取公开访问地址
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const publicUrl = urlData.publicUrl

      // 3. 连同表单数据一起写入 media 表
      try {
        await insertMedia({
          course_id: courseId, // 课表 tasks 的 id，即这门课本身
          course_name: courseName,
          child_name: null, // 页面上已移除孩子姓名字段
          offline_class: offlineClass || null, // 例如「周一 19:20 英语 · 西溪少年宫5F」
          media_date: mediaDate,
          file_url: publicUrl,
          file_type: resolveFileType(prepared),
          note: note.trim() || null,
          uploader_name: '妈妈',
          thumb_url: thumbUrl,
        })
      } catch (insertErr) {
        setFeedback({
          type: 'error',
          text: `保存记录失败：${errMsg(insertErr)}`,
        })
        return
      }

      // 4. 页面内提示上传成功（不再用 alert，也不再自动跳转）
      setFeedback({ type: 'success', text: `上传成功：${courseName} · ${prepared.name} 已保存到本周资料库` })
      // 清掉缓存，下一次重复检测会拿到最新数据
      mediaRef.current = null
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      // 转码/上传期间用户点了取消：静默结束，不报错
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[UploadPage] 上传异常:', err)
      setFeedback({
        type: 'error',
        text: `上传异常：${errMsg(err)}`,
      })
    } finally {
      abortRef.current = null
      setUploading(false)
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

              {/* 右栏：文件选择 + 上传进度 + 提交（手机仍在下方，iPad 在右侧） */}
              <div className="flex flex-col gap-4">
              {/* 文件选择 */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="media-file">视频 / 图片文件（可选）</Label>
                <label
                  htmlFor="media-file"
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed p-5 text-center transition-colors hover:bg-muted/40"
                >
                  <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{file ? file.name : '点击选择文件'}</span>
                  <span className="text-xs text-muted-foreground">
                    {file
                      ? `${humanSize(file.size)} · ${resolveFileType(file) === 'video' ? '视频' : '图片'}${
                          resolveFileType(file) === 'image' && file.size >= 1.5 * 1024 * 1024 ? '（上传前会自动压缩）' : ''
                        }`
                      : '支持 mp4 / mov / jpg / png 等，最大 100MB'}
                  </span>
                </label>
                <input
                  ref={fileInputRef}
                  id="media-file"
                  type="file"
                  accept={ACCEPT}
                  onChange={handleFileChange}
                  className="sr-only"
                />
                {codecWarn && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                    该视频可能是 iPhone 的 HEVC 格式，在部分电脑浏览器上只有声音没有画面。请让拍摄设备的相机格式改为【兼容性最佳】后重新拍摄上传。
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  为了确保视频在所有设备上能顺利播放，建议在 iPhone 设置 -&gt; 相机 -&gt; 格式 中，选择【兼容性最佳】后再拍摄上传哦。
                </p>
              </div>

              {/* 进度：上传百分比 + 速度 + 预计剩余 */}
              {uploading && (
                <div className="flex flex-col gap-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${progress?.percent ?? 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {progress
                      ? `${progress.percent}% · ${humanSize(progress.loaded)}/${humanSize(progress.total)} · ${progress.speed.toFixed(1)}MB/s${
                          progress.eta > 0.5 ? ` · 剩余约 ${Math.ceil(progress.eta)} 秒` : ''
                        }`
                      : '正在压缩图片并准备上传…'}
                  </p>
                  {stalling && (
                    <p className="text-xs text-amber-600">网络波动，正在自动续传（已传部分不会重传）…</p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={!canSubmit} className="flex-1">
                  {uploading
                    ? progress
                      ? `上传中 ${progress.percent}%`
                      : '处理中…'
                    : file
                      ? '上传并保存'
                      : '保存文字作业'}
                </Button>
                {uploading && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                  >
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
