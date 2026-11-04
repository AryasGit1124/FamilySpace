/** 媒体上传：图片压缩、视频抽帧封面、R2 预签名直传（成长档案等复用） */

export type MediaType = 'image' | 'video'

/** 根据 MIME 或扩展名判断文件类型 */
export function resolveMediaType(file: File): MediaType {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name) ? 'video' : 'image'
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

/** Canvas → JPEG File（toBlob 失败时回退 dataURL） */
function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
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

function waitVideoEvent(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.removeEventListener(event, onDone)
      reject(new Error(`等待 ${event} 超时`))
    }, timeoutMs)
    const onDone = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, onDone)
      resolve()
    }
    video.addEventListener(event, onDone)
  })
}

/** 等到浏览器真正呈现下一帧，避免把黑屏画进封面 */
async function waitVideoFrame(video: HTMLVideoElement) {
  const v = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number
  }
  if (typeof v.requestVideoFrameCallback === 'function') {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 2000)
      v.requestVideoFrameCallback?.(() => {
        window.clearTimeout(timer)
        resolve()
      })
    })
    return
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
}

/** 判断画布是否几乎全黑（很多浏览器 seek 后尚未呈现画面就直接绘制会得到黑图） */
function isMostlyBlack(canvas: HTMLCanvasElement) {
  const sample = document.createElement('canvas')
  sample.width = 32
  sample.height = 32
  const ctx = sample.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(canvas, 0, 0, 32, 32)
  const { data } = ctx.getImageData(0, 0, 32, 32)
  let bright = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 60) bright += 1
  }
  return bright / (32 * 32) < 0.05
}

/** 从本地视频抽一帧生成封面；浏览器无法解码或抽到黑帧时返回 null，不生成假封面 */
export async function extractVideoCover(
  file: File,
  onDebug?: (reason: string) => void,
): Promise<File | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  // 部分移动端浏览器（iOS Safari）只渲染视口内可见的 video，这里放视口内但几乎透明
  video.style.cssText =
    'position:fixed;left:0;top:0;width:160px;height:90px;opacity:0.01;pointer-events:none;z-index:-1'
  document.body.appendChild(video)

  const draw = async () => {
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) throw new Error('当前浏览器无法解码视频画面')
    await waitVideoFrame(video)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 不可用')
    ctx.drawImage(video, 0, 0, width, height)
    if (isMostlyBlack(canvas)) throw new Error('抽到黑帧')
    return canvasToFile(canvas, `${file.name.replace(/\.[^.]+$/, '')}-cover.jpg`)
  }

  try {
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.preload = 'auto'
    video.src = url
    video.load()

    // 等首帧数据就绪；部分 MOV 元数据快但首帧慢，留足 12 秒
    try {
      await waitVideoEvent(video, 'loadeddata', 12000)
    } catch (err) {
      if (!video.videoWidth) throw err
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const seekTime = duration > 0 ? Math.min(1, Math.max(0.2, duration * 0.2)) : 0.5
    try {
      const seeked = waitVideoEvent(video, 'seeked', 8000)
      video.currentTime = seekTime
      await seeked
    } catch (err) {
      if (video.readyState < 2) throw err
    }

    // 静音播放片刻可强制浏览器渲染真实画面，比只 seek 更可靠
    try {
      await video.play()
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200))
      video.pause()
    } catch {
      // 自动播放被拦截时继续使用已 seek 的画面
    }

    const cover = await draw()
    return cover
  } catch (err) {
    // 再尝试视频后段画面，避开片头黑场
    try {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      if (duration > 1.5) {
        const seeked = waitVideoEvent(video, 'seeked', 8000)
        video.currentTime = Math.min(duration - 0.2, Math.max(1, duration * 0.5))
        await seeked
        await waitVideoFrame(video)
        return await draw()
      }
    } catch (retryErr) {
      console.warn('[media-upload] 视频抽帧重试失败:', retryErr)
    }
    onDebug?.(err instanceof Error ? err.message : String(err))
    console.warn('[media-upload] 视频抽帧失败，改用页面占位封面:', err)
    return null
  } finally {
    video.pause()
    video.remove()
    URL.revokeObjectURL(url)
  }
}

/** 图片上传前压缩：长边 ≤1920px，失败或变大时回退原文件 */
export async function compressImage(file: File): Promise<File> {
  if (file.type.startsWith('image/') === false || file.type === 'image/gif' || file.size < 1.5 * 1024 * 1024) {
    return file
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`
    return new File([blob], name, { type: 'image/jpeg' })
  } catch (err) {
    console.warn('[media-upload] 图片压缩失败，使用原文件:', err)
    return file
  }
}

/** 删除 R2 上的媒体文件（主文件 + 视频封面），用于删除记录或替换媒体 */
export async function deleteR2Media(
  fileUrl: string | null | undefined,
  coverUrl: string | null | undefined,
): Promise<void> {
  if (!fileUrl && !coverUrl) return
  const res = await fetch('/api/r2-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileUrl: fileUrl ?? '', coverUrl: coverUrl ?? '' }),
  })
  if (!res.ok) throw new Error(`删除 R2 文件失败（HTTP ${res.status}）`)
}

type PresignResponse = { uploadUrl: string; publicUrl: string; key: string }

export type UploadOptions = {
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

/**
 * 上传单个文件到 R2，返回公开访问地址；folder 决定目录（如 growth）。
 * 使用 XHR 以获得真实上传进度，并支持取消。
 */
export async function uploadMediaFile(
  file: File,
  folder: string,
  options: UploadOptions = {},
): Promise<string> {
  const { onProgress, signal } = options
  if (signal?.aborted) throw new DOMException('上传已取消', 'AbortError')

  const presignRes = await fetch('/api/r2-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      folder,
    }),
    signal,
  })
  if (!presignRes.ok) {
    let message = `获取上传地址失败（HTTP ${presignRes.status}）`
    try {
      const data = (await presignRes.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // 非 JSON 响应时沿用默认文案
    }
    throw new Error(message)
  }
  const presign = (await presignRes.json()) as PresignResponse

  await new Promise<void>((resolve, reject) => {
    const abortError = () => new DOMException('上传已取消', 'AbortError')
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('PUT', presign.uploadUrl)
    // 必须与预签名时的 ContentType 一致，否则 R2 会返回 SignatureDoesNotMatch
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    const onAbort = () => xhr.abort()
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort)
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`R2 上传失败（HTTP ${xhr.status}）`))
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

  return presign.publicUrl
}
