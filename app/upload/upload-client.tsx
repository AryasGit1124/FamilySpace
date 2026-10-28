'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

type CourseOption = { id: string; name: string }
type OfflineOption = { value: string; day: number }
/** 批量上传时每个文件各自的进度与结果 */
type UploadItem = {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  percent: number
  message?: string
  stalling?: boolean
}

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

/** Canvas → JPEG File；toBlob 失败时回退 dataURL，保证总能拿到图片文件 */
function canvasToCoverFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve) => {
    const fromDataUrl = () => {
      const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1] ?? ''
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      resolve(new File([bytes], name, { type: 'image/jpeg' }))
    }
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(new File([blob], name, { type: 'image/jpeg' }))
        else fromDataUrl()
      },
      'image/jpeg',
      0.7,
    )
  })
}

/** 封面文件名：与源文件同名 + -cover.jpg */
function coverFileName(file: File): string {
  return `${file.name.replace(/\.[^.]+$/, '')}-cover.jpg`
}

/**
 * 强制兜底封面：400×300 蓝色背景 + 大号 ▶ 播放图标 + 白色文件名。
 * 抽帧失败、超时、全黑、尺寸为 0 时使用，保证视频 100% 有封面。
 */
function makeFallbackCover(file: File): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 不可用'))

  // 纯蓝背景
  ctx.fillStyle = '#2563eb'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 居中播放图标
  ctx.beginPath()
  ctx.arc(200, 128, 52, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(182, 96)
  ctx.lineTo(232, 128)
  ctx.lineTo(182, 160)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // 底部白色文件名（超长自动截断）
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 20px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  let label = file.name
  while (ctx.measureText(label).width > canvas.width - 32 && label.length > 4) {
    label = `${label.slice(0, -2)}…`
  }
  ctx.fillText(label, 200, 248)

  return canvasToCoverFile(canvas, coverFileName(file))
}

/** 判断画面是否接近全黑（抽样中心 32×32 区域的平均亮度）；取样异常时按全黑处理，走兜底封面 */
function isNearlyBlack(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const sampleSize = Math.min(32, width, height)
    const sx = Math.max(0, Math.floor((width - sampleSize) / 2))
    const sy = Math.max(0, Math.floor((height - sampleSize) / 2))
    const data = ctx.getImageData(sx, sy, sampleSize, sampleSize).data
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return sum / (sampleSize * sampleSize) < 12
  } catch (err) {
    console.warn('[UploadPage] 画面像素检测失败，按全黑处理:', err)
    return true
  }
}

/** 等待 video 的指定事件；超时或 error 事件都会 reject，供上层走兜底封面 */
function waitForVideoEvent(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`等待 ${event} 超时`))
    }, timeoutMs)

    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, onDone)
      video.removeEventListener('error', onError)
    }
    const onDone = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频解码失败'))
    }

    video.addEventListener(event, onDone)
    video.addEventListener('error', onError)
  })
}

/** Canvas 导出 JPEG；toBlob 抛错（如 Tainted canvases may not be exported）时 reject，触发兜底 */
function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('封面导出为空'))
            return
          }
          console.log('截取的封面 Blob 大小:', blob.size)
          if (blob.size < 1024) {
            reject(new Error('封面图片过小，疑似纯色图'))
            return
          }
          resolve(blob)
        },
        'image/jpeg',
        0.8,
      )
    } catch (err) {
      // 画布被跨域资源污染时，某些浏览器会在 toBlob 同步抛错
      reject(new Error(`Canvas 导出失败：${err instanceof Error ? err.message : String(err)}`))
    }
  })
}

/**
 * 从本地视频抽帧（第 0.5 秒），失败返回 null，由上层生成文字兜底封面。
 *
 * 注意：截帧必须用本地 File 生成的 blob: 地址，绝不能用上传后的 R2 公网 URL——
 * 远程截帧要求 R2 桶配置 CORS 且 `Access-Control-Expose-Headers` 暴露 Accept-Ranges、
 * Content-Range 等头，Canvas 还可能被判为污染而无法导出，速度也慢。本地截帧无此问题。
 */
async function extractVideoFrame(file: File): Promise<File | null> {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  try {
    // 1. 创建元素并设置属性（crossOrigin 防止部分浏览器把画面判定为跨域资源）
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    // 2. 先设置 src / load()，再挂事件会漏事件；这里先声明等待句柄，绑定后立即触发加载
    video.src = objectUrl
    const metaPromise = waitForVideoEvent(video, 'loadedmetadata', 2500)
    video.load()
    await metaPromise

    // 3. 真实宽高（竖屏是 1080×1920 这类原生尺寸；HEVC 无法解码时为 0）
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) throw new Error('当前浏览器无法解码视频画面')

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    // 第 0.5 秒；不足 1 秒的短视频取其一半，避免 seek 越界导致 seeked 永不触发
    const seekTime = duration > 0 && duration < 1 ? duration / 2 : 0.5
    console.log(`[UploadPage] 截帧时间点 ${seekTime}s（总时长 ${duration.toFixed(2)}s，尺寸 ${width}×${height}）`)
    const seekPromise = waitForVideoEvent(video, 'seeked', 2500)
    video.currentTime = seekTime
    await seekPromise

    // seeked 表示画面已跳转完成，再等一帧让合成器把画面真正绘制上去
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    // 4. Canvas 尺寸严格等于视频原生宽高，竖屏不变形、不裁切
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 不可用')
    ctx.drawImage(video, 0, 0, width, height)

    // 纯黑画面同样走兜底，避免把黑图当封面
    if (isNearlyBlack(ctx, width, height)) throw new Error('抽到的是全黑画面')

    // 5. 导出 JPEG（内部已处理空 Blob / 过小 / Canvas 污染）
    const blob = await canvasToJpegBlob(canvas)
    return new File([blob], coverFileName(file), { type: 'image/jpeg' })
  } catch (err) {
    console.warn('[UploadPage] 视频抽帧失败:', err)
    return null
  } finally {
    // 6. 释放解码资源与 Object URL，防止内存泄漏
    video.src = ''
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

/** 封面抽帧的硬超时：超过后直接中断，改用文字占位封面，避免卡死上传 */
const COVER_TIMEOUT_MS = 3000

/**
 * 视频封面提取 —— 必定返回一张图片：
 * 优先抽第 0.5 秒的真实画面（Canvas 用视频原生宽高，竖屏不变形）；
 * 解码失败 / 3 秒超时 / 全黑 / 尺寸为 0 时，自动生成文字兜底封面，绝不返回 null、绝不卡住上传。
 */
async function extractVideoCover(file: File): Promise<File> {
  let timedOut = false
  const frame = await Promise.race([
    extractVideoFrame(file),
    new Promise<null>((resolve) =>
      window.setTimeout(() => {
        timedOut = true
        resolve(null)
      }, COVER_TIMEOUT_MS),
    ),
  ])
  if (frame) return frame
  console.warn(
    `[UploadPage] ${timedOut ? `${COVER_TIMEOUT_MS}ms 内未完成抽帧` : '未拿到真实画面'}，使用兜底封面:`,
    file.name,
  )
  return makeFallbackCover(file)
}

/**
 * 探测当前浏览器能否解码该视频的画面（用于上传前提示）。
 * 可解码返回 true；只能出声没有画面 / 完全不支持返回 false。
 * 注意不能复用 extractVideoCover，因为它有文字封面兜底、永远有返回值。
 */
async function probeVideoDecodable(file: File): Promise<boolean> {
  if (!file.type.startsWith('video/')) return true
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('探测超时')), 5000)
      video.onloadedmetadata = () => {
        window.clearTimeout(timer)
        resolve()
      }
      video.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('视频解码失败'))
      }
    })
    return video.videoWidth > 0
  } catch {
    return false
  } finally {
    video.src = ''
    URL.revokeObjectURL(url)
  }
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

type PresignResponse = { uploadUrl: string; publicUrl: string; key: string }

/** 向后端申请 R2 预签名上传地址（1 小时有效）；subjectName 决定 R2 里的「课程/年月」目录 */
async function presignUpload(fileName: string, fileType: string, subjectName: string): Promise<PresignResponse> {
  const res = await fetch('/api/r2-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileType, subjectName }),
  })
  if (!res.ok) {
    let message = `获取 R2 上传地址失败（HTTP ${res.status}）`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // 响应不是 JSON 时沿用默认文案
    }
    throw new Error(message)
  }
  return (await res.json()) as PresignResponse
}

/** 用 XHR 把文件直接 PUT 到 R2（带真实进度、支持取消；不经过 Next.js 服务器） */
function putToR2(
  uploadUrl: string,
  file: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abortError = () => new DOMException('上传已取消', 'AbortError')
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    // 必须与预签名时使用的 ContentType 一致，否则 R2 会返回 SignatureDoesNotMatch
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    const onAbort = () => xhr.abort()

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort)
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`R2 上传失败（HTTP ${xhr.status}）${xhr.responseText ? `：${xhr.responseText.slice(0, 120)}` : ''}`))
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('R2 上传网络错误，请检查 Bucket 的 CORS 是否允许本站点 PUT 请求'))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.send(file)
  })
}

/**
 * 上传单个文件到 Cloudflare R2：申请预签名 → 直传 → 返回可公开访问的 URL。
 */
async function uploadToR2(
  file: File,
  subjectName: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError')
  const presign = await presignUpload(file.name, file.type || 'application/octet-stream', subjectName)
  await putToR2(presign.uploadUrl, file, onProgress, signal)
  return presign.publicUrl
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
  /** 当前上传的中止控制器：取消上传 / 组件卸载时触发，中断进行中的 R2 PUT */
  const abortRef = useRef<AbortController | null>(null)

  const [courses, setCourses] = useState<CourseOption[]>([])
  const [offlineRows, setOfflineRows] = useState<OfflineOption[]>([])
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [courseId, setCourseId] = useState('')
  const [mediaDate, setMediaDate] = useState('')
  const [offlineClass, setOfflineClass] = useState('') // 存的是线下课标签文本
  const [note, setNote] = useState('')
  /** 多选文件列表（逐个上传，每个文件生成一条独立 media 记录） */
  const [files, setFiles] = useState<File[]>([])
  /** 视频在当前浏览器无法解码画面（HEVC 等）时置 true，仅提示不拦截 */
  const [codecWarn, setCodecWarn] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** 批量上传时每个文件的进度与结果 */
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 默认今天（或 URL 传入的日期）：放到 effect 里，避免服务端与客户端跨天导致 hydration 不一致
  useEffect(() => {
    setMediaDate(preDate || todayDateKey())
  }, [preDate])

  // 组件卸载时中止正在进行的上传（中断 R2 PUT）
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

  /** 选文件时立即校验：格式/大小/是否重复，不合格的直接剔除并提示 */
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    // 清空 input，允许再次选择同一批文件
    e.target.value = ''
    if (picked.length === 0) {
      setFiles([])
      return
    }

    const errors: string[] = []
    let existing: MediaRow[] | null = null
    try {
      existing = await getExistingMedia()
    } catch (err) {
      console.warn('[UploadPage] 重复检测失败，稍后提交时会再次校验:', err)
    }

    const accepted: File[] = []
    for (const pickedFile of picked) {
      const err = validateFile(pickedFile)
      if (err) {
        errors.push(`${pickedFile.name}：${err}`)
        continue
      }
      if (existing) {
        const dup = findDuplicateFile(existing, pickedFile.name)
        if (dup) {
          errors.push(
            `${pickedFile.name}：该文件已上传过（${dup.course_name ?? '未分类'} · ${dup.media_date}）`,
          )
          continue
        }
      }
      if (accepted.some((f) => f.name === pickedFile.name && f.size === pickedFile.size)) {
        errors.push(`${pickedFile.name}：本次选择中重复，已跳过`)
        continue
      }
      accepted.push(pickedFile)
    }

    setFiles(accepted)
    setUploads([])
    setFeedback(errors.length > 0 ? { type: 'error', text: errors.join('；') } : null)

    // 视频解码探测：HEVC 在 Windows Chrome/Edge 上通常只有声音没有画面，提前提示
    setCodecWarn(false)
    const firstVideo = accepted.find((f) => resolveFileType(f) === 'video')
    if (firstVideo) {
      void probeVideoDecodable(firstVideo).then((ok) => {
        if (!ok) setCodecWarn(true)
      })
    }
  }

  /** 从待上传列表中移除单个文件 */
  const removeFile = (index: number) => {
    if (uploading) return
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // 文件与文字二选一（也可同时存在）：都没填才禁止提交
  const canSubmit = !uploading && !!courseId && !!mediaDate && (files.length > 0 || note.trim().length > 0)

  /** 更新批量列表中某个文件的进度/状态 */
  const updateUpload = (id: string, patch: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (uploading) return

    if (!courseId) {
      setFeedback({ type: 'error', text: '请先选择课程（课表里暂无课程时，请先去课表设置添加）' })
      return
    }
    const textContent = note.trim()
    const batch = files
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
    setUploading(true)

    // 纯文字作业：不调存储接口，直接写 media 表（file_type='text'，file_url 留空）
    if (batch.length === 0) {
      setUploads([])
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

    const items: UploadItem[] = batch.map((f, index) => ({
      id: `${Date.now()}-${index}-${f.name}`,
      file: f,
      status: 'pending',
      percent: 0,
    }))
    setUploads(items)

    const controller = new AbortController()
    abortRef.current = controller

    const failedNames: string[] = []
    /** 本批次内已成功上传的文件名，避免同一批里同名文件重复上传 */
    const uploadedNames = new Set<string>()
    let existingRows: MediaRow[] | null = null
    try {
      // 提交前强制刷新一次，避免别的窗口刚传过同一文件
      existingRows = await getExistingMedia(true)
    } catch (err) {
      console.warn('[UploadPage] 重复检测失败，继续上传:', err)
    }

    let successCount = 0
    try {
      // 串行处理：一个文件「上传视频 → 生成并上传封面 → 写 media」全部完成，再处理下一个
      for (const [index, item] of items.entries()) {
        if (controller.signal.aborted) return

        const invalid = validateFile(item.file)
        if (invalid) {
          updateUpload(item.id, { status: 'error', message: invalid })
          failedNames.push(item.file.name)
          continue
        }

        const batchLabel = `第 ${index + 1}/${items.length} 个`
        console.log(`[UploadPage] 开始处理 ${batchLabel}文件：${item.file.name}`)

        try {
          // 1. 图片先压缩再上传（视频无法在浏览器端压缩，按原文件上传）
          const prepared = await compressImage(item.file)

          // 2. 再查一次重复（含本批次已成功上传的文件）
          if (
            uploadedNames.has(prepared.name) ||
            (existingRows && findDuplicateFile(existingRows, prepared.name))
          ) {
            updateUpload(item.id, { status: 'error', message: '该文件已上传过，已跳过' })
            failedNames.push(item.file.name)
            continue
          }

          updateUpload(item.id, {
            status: 'uploading',
            percent: 0,
            stalling: false,
            message: `${batchLabel} · 准备上传…`,
          })

          // 3. 预签名直传 Cloudflare R2（浏览器直接 PUT 到 R2，不经过 Next.js 服务器）
          const startedAt = performance.now()
          let fileUrl: string
          try {
            fileUrl = await uploadToR2(
              prepared,
              courseName,
              (loaded, total) => {
                const elapsed = (performance.now() - startedAt) / 1000
                const speed = elapsed > 0 ? loaded / elapsed / 1024 / 1024 : 0
                updateUpload(item.id, {
                  percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
                  stalling: false,
                  message:
                    total > 0
                      ? `${batchLabel} · ${humanSize(loaded)} / ${humanSize(total)} · ${speed.toFixed(1)}MB/s`
                      : `${batchLabel} · 上传中…`,
                })
              },
              controller.signal,
            )
          } catch (uploadErr) {
            // 用户主动取消/页面已离开：静默结束，不报错
            if (uploadErr instanceof Error && uploadErr.name === 'AbortError') return
            throw new Error(`上传到 R2 失败：${errMsg(uploadErr)}`)
          }

          // 4. 视频：必定生成封面（真实帧或蓝色兜底图）并上传
          // 注意用 resolveFileType 判断（MIME 为空的 .mov 也要算视频），否则会漏掉封面
          const isVideo = resolveFileType(prepared) === 'video'
          let coverUrl: string | null = null
          if (isVideo) {
            updateUpload(item.id, { percent: 100, message: `${batchLabel} · 正在生成封面…` })
            console.log(`[UploadPage] 正在生成第 ${index + 1}/${items.length} 个视频封面...`, prepared.name)

            const cover = await extractVideoCover(prepared)
            console.log(
              `[UploadPage] 第 ${index + 1}/${items.length} 个封面生成成功：${cover.name}（${humanSize(cover.size)}）`,
            )

            try {
              coverUrl = await uploadToR2(cover, courseName, undefined, controller.signal)
            } catch (coverErr) {
              // 用户在封面上传期间点了取消：按取消处理，不再继续写库
              if (coverErr instanceof Error && coverErr.name === 'AbortError') return
              // 封面上传失败只降级为「无封面」，视频本身照常入库
              console.error(
                `[UploadPage] 第 ${index + 1}/${items.length} 个封面上传失败，降级为无封面:`,
                coverErr,
              )
              coverUrl = null
            }
            console.log(
              `[UploadPage] 第 ${index + 1}/${items.length} 个封面地址：${coverUrl ?? '（空，已降级）'}`,
            )
          }

          // 5. 视频地址与封面地址都拿到后，才写入 media 表（每个文件一条记录）
          // 注：media 表的封面字段实际名为 thumb_url（并非 cover_url），这里存的就是封面地址
          await insertMedia({
            course_id: courseId, // 课表 tasks 的 id，即这门课本身
            course_name: courseName,
            child_name: null,
            offline_class: offlineClass || null, // 例如「周一 19:20 英语 · 西溪少年宫5F」
            media_date: mediaDate,
            file_url: fileUrl,
            file_type: resolveFileType(prepared),
            note: note.trim() || null,
            uploader_name: '妈妈',
            thumb_url: coverUrl,
          })
          console.log(
            `[UploadPage] 第 ${index + 1}/${items.length} 个文件入库完成：${prepared.name}（封面：${coverUrl ?? '无'}）`,
          )

          uploadedNames.add(prepared.name)
          successCount += 1
          updateUpload(item.id, { status: 'success', percent: 100, stalling: false, message: '已保存到本周资料库' })
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
          console.error('[UploadPage] 单个文件上传失败:', item.file.name, err)
          updateUpload(item.id, { status: 'error', stalling: false, message: errMsg(err) })
          failedNames.push(item.file.name)
        }
      }

      // 清掉缓存，下一次重复检测会拿到最新数据
      mediaRef.current = null

      if (failedNames.length === 0) {
        setFiles([])
        setFeedback({
          type: 'success',
          text: `${successCount} 个文件已全部上传成功，正在返回资料库…`,
        })
        // 全部成功后提示并跳转回资料库
        window.setTimeout(() => router.push('/library'), 1200)
      } else {
        setFeedback({
          type: 'error',
          text: `${successCount} 个成功，${failedNames.length} 个失败：${failedNames.join('、')}。失败的文件已保留，可再次提交重试。`,
        })
        // 只保留失败的文件，方便直接重试
        setFiles(batch.filter((f) => failedNames.includes(f.name)))
      }
    } catch (err) {
      // 用户取消：静默结束
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[UploadPage] 上传异常:', err)
      setFeedback({ type: 'error', text: `上传异常：${errMsg(err)}` })
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
              {/* 文件选择（支持多选） */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="media-file">视频 / 图片文件（可多选）</Label>
                <label
                  htmlFor="media-file"
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed p-5 text-center transition-colors hover:bg-muted/40"
                >
                  <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">
                    {files.length > 0
                      ? `已选择 ${files.length} 个文件，点击可重新选择`
                      : '点击选择文件（支持多选）'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    支持 mp4 / mov / jpg / png 等，单个文件最大 100MB
                  </span>
                </label>
                <input
                  ref={fileInputRef}
                  id="media-file"
                  type="file"
                  multiple
                  accept={ACCEPT}
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="sr-only"
                />

                {/* 已选文件列表（上传前可单个移除） */}
                {files.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {files.map((item, index) => (
                      <li
                        key={`${item.name}-${item.size}-${index}`}
                        className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {humanSize(item.size)} ·{' '}
                          {resolveFileType(item) === 'video' ? '视频' : '图片'}
                          {resolveFileType(item) === 'image' && item.size >= 1.5 * 1024 * 1024
                            ? '（自动压缩）'
                            : ''}
                        </span>
                        {!uploading && (
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            aria-label={`移除 ${item.name}`}
                            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {codecWarn && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                    有视频可能是 iPhone 的 HEVC 格式，在部分电脑浏览器上只有声音没有画面。请让拍摄设备的相机格式改为【兼容性最佳】后重新拍摄上传。
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  建议一次多选批量上传；每个文件都会生成一条独立的资料记录。为了确保视频在所有设备上能顺利播放，建议在 iPhone 设置 -&gt; 相机 -&gt; 格式 中，选择【兼容性最佳】后再拍摄上传哦。
                </p>
              </div>

              {/* 批量上传进度：逐文件显示 0-100% */}
              {uploads.length > 0 && (
                <div className="flex flex-col gap-2">
                  {uploads.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1 rounded-lg border p-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                        <span
                          className={
                            item.status === 'success'
                              ? 'shrink-0 font-medium text-emerald-600'
                              : item.status === 'error'
                                ? 'shrink-0 font-medium text-destructive'
                                : 'shrink-0 text-muted-foreground'
                          }
                        >
                          {item.status === 'success'
                            ? '✅ 完成'
                            : item.status === 'error'
                              ? '上传失败'
                              : item.status === 'uploading'
                                ? `${item.percent}%`
                                : '等待中'}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={
                            item.status === 'success'
                              ? 'h-full rounded-full bg-emerald-500 transition-[width] duration-200'
                              : item.status === 'error'
                                ? 'h-full rounded-full bg-destructive transition-[width] duration-200'
                                : 'h-full rounded-full bg-primary transition-[width] duration-200'
                          }
                          style={{ width: `${item.status === 'success' ? 100 : item.percent}%` }}
                        />
                      </div>
                      {item.message && (
                        <p className="text-[11px] text-muted-foreground">{item.message}</p>
                      )}
                      {item.stalling && (
                        <p className="text-[11px] text-amber-600">
                          网络波动，正在自动续传（已传部分不会重传）…
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={!canSubmit} className="flex-1">
                  {uploading
                    ? '上传中…'
                    : files.length > 0
                      ? `上传 ${files.length} 个文件并保存`
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
