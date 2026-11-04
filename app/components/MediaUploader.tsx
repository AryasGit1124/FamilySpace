'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { CheckCircle2, UploadCloud, X } from 'lucide-react'
import {
  compressImage,
  deleteR2Media,
  errMsg,
  extractVideoCover,
  resolveMediaType,
  uploadMediaFile,
} from '@/lib/media-upload'

const MAX_SIZE = 100 * 1024 * 1024

export type UploadedMedia = {
  publicUrl: string
  coverUrl: string | null
  mediaType: 'image' | 'video'
  fileName: string
}

export type MediaUploaderHandle = {
  abort: () => void
  reset: () => void
}

type ItemStatus = 'pending' | 'uploading' | 'success' | 'error'

type UploadItem = {
  id: string
  file: File
  previewUrl: string
  status: ItemStatus
  percent: number
  message?: string
  result?: UploadedMedia
}

type Props = {
  /** R2 目录，例如 'growth' 或课程名 */
  folder: string
  /** 单个文件上传成功后回调，返回可直接入库的 URL */
  onUploadSuccess?: (media: UploadedMedia) => void
  /** 移除已上传文件时回调（此时 R2 文件已开始清理） */
  onUploadedRemove?: (media: UploadedMedia) => void
  /** 上传开始/结束时回调，宿主可据此禁用保存按钮 */
  onUploadingChange?: (uploading: boolean) => void
  onError?: (message: string | null) => void
  /** 上传前的异步校验，返回错误文案则跳过该文件 */
  beforeUpload?: (file: File) => Promise<string | null>
  multiple?: boolean
  disabled?: boolean
  label?: string
}

function humanSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

function validateFile(file: File): string | null {
  const byMime = file.type.startsWith('video/') || file.type.startsWith('image/')
  const byExt = /\.(mp4|mov|m4v|webm|avi|mkv|jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.name)
  if (!byMime && !byExt) return '只支持视频或图片文件（如 mp4 / mov / jpg / png）'
  if (file.size > MAX_SIZE) return `文件大小 ${humanSize(file.size)}，超过 100MB 限制`
  return null
}

/**
 * 通用媒体上传器：选择 → 压缩 → R2 直传（进度可取消）→ 视频自动截封面。
 * 上传成功后通过 onUploadSuccess 返回 publicUrl / coverUrl，供「上传资料」和「成长档案」共用。
 */
export const MediaUploader = forwardRef<MediaUploaderHandle, Props>(function MediaUploader(
  {
    folder,
    onUploadSuccess,
    onUploadedRemove,
    onUploadingChange,
    onError,
    beforeUpload,
    multiple = true,
    disabled = false,
    label,
  },
  ref,
) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const uploadingRef = useRef(false)
  const itemsRef = useRef<UploadItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // 卸载时中断上传并释放所有本地预览地址
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  const setItem = (id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const setUploadingState = (value: boolean) => {
    uploadingRef.current = value
    setUploading(value)
    onUploadingChange?.(value)
  }

  /** 删除已成功上传的 R2 文件（用户主动移除或替换时） */
  const dropUploaded = (item: UploadItem) => {
    if (item.result) {
      onUploadedRemove?.(item.result)
      void deleteR2Media(item.result.publicUrl, item.result.coverUrl).catch((err) => {
        console.warn('[MediaUploader] 清理已移除的 R2 文件失败:', err)
      })
    }
    URL.revokeObjectURL(item.previewUrl)
  }

  const clearItems = (deleteUploaded: boolean) => {
    itemsRef.current.forEach((item) => {
      if (deleteUploaded) dropUploaded(item)
      else URL.revokeObjectURL(item.previewUrl)
    })
    setItems([])
  }

  useImperativeHandle(ref, () => ({
    abort: () => abortRef.current?.abort(),
    reset: () => {
      abortRef.current?.abort()
      clearItems(false)
    },
  }))

  const uploadBatch = async (batch: UploadItem[]) => {
    if (batch.length === 0) return
    const controller = new AbortController()
    abortRef.current = controller
    setUploadingState(true)

    for (const item of batch) {
      if (controller.signal.aborted) break
      try {
        if (beforeUpload) {
          const reason = await beforeUpload(item.file)
          if (reason) {
            setItem(item.id, { status: 'error', message: reason })
            continue
          }
        }

        setItem(item.id, { status: 'uploading', percent: 0, message: '准备上传…' })
        const prepared = await compressImage(item.file)
        const isVideo = resolveMediaType(item.file) === 'video'

        const startedAt = performance.now()
        const publicUrl = await uploadMediaFile(prepared, folder, {
          signal: controller.signal,
          onProgress: (loaded, total) => {
            const elapsed = (performance.now() - startedAt) / 1000
            const speed = elapsed > 0 ? loaded / elapsed / 1024 / 1024 : 0
            setItem(item.id, {
              percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
              message:
                total > 0
                  ? `${humanSize(loaded)} / ${humanSize(total)} · ${speed.toFixed(1)}MB/s`
                  : '上传中…',
            })
          },
        })

        let coverUrl: string | null = null
        let coverWarning = ''
        if (isVideo) {
          setItem(item.id, { percent: 100, message: '正在生成封面…' })
          try {
            const cover = await extractVideoCover(prepared, (reason) => {
              coverWarning = reason
            })
            if (cover) {
              coverUrl = await uploadMediaFile(cover, folder, { signal: controller.signal })
            } else {
              // 本地文件解码失败时，用已上传的视频地址再尝试一次（部分移动端浏览器对本地 File 解码有限制）
              setItem(item.id, { message: '本地封面生成失败，正在通过视频地址重试…' })
              const remoteRes = await fetch(publicUrl, { signal: controller.signal })
              if (remoteRes.ok) {
                const blob = await remoteRes.blob()
                const retryFile = new File([blob], item.file.name, {
                  type: blob.type || item.file.type || 'video/mp4',
                })
                const retryCover = await extractVideoCover(retryFile, (reason) => {
                  coverWarning = reason
                })
                if (retryCover) {
                  coverUrl = await uploadMediaFile(retryCover, folder, { signal: controller.signal })
                }
              }
            }
            if (!coverUrl) {
              console.warn('[MediaUploader] 无法生成视频封面:', coverWarning)
            }
          } catch (coverErr) {
            if (coverErr instanceof Error && coverErr.name === 'AbortError') throw coverErr
            // 封面失败只降级为无封面，视频本身照常可用
            console.error('[MediaUploader] 封面上传失败，降级为无封面:', coverErr)
          }
        }

        const result: UploadedMedia = {
          publicUrl,
          coverUrl,
          mediaType: isVideo ? 'video' : 'image',
          fileName: item.file.name,
        }
        setItem(item.id, {
          status: 'success',
          percent: 100,
          message:
            isVideo && !coverUrl
              ? `已上传（未能生成封面${coverWarning ? `：${coverWarning}` : ''}）`
              : '已上传',
          result,
        })
        onUploadSuccess?.(result)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setItem(item.id, { status: 'pending', percent: 0, message: '已取消上传' })
          break
        }
        console.error('[MediaUploader] 上传失败:', item.file.name, err)
        setItem(item.id, { status: 'error', message: errMsg(err) })
        onError?.(`${item.file.name}：${errMsg(err)}`)
      }
    }

    abortRef.current = null
    setUploadingState(false)
  }

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (uploadingRef.current) return
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return

    const selected = multiple ? picked : picked.slice(0, 1)
    if (!multiple) clearItems(true)
    onError?.(null)

    const fresh: UploadItem[] = []
    const errors: UploadItem[] = []

    for (const file of selected) {
      const invalid = validateFile(file)
      const duplicated = fresh.some((f) => f.file.name === file.name && f.file.size === file.size)
      const base: UploadItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'pending',
        percent: 0,
      }
      if (invalid || duplicated) {
        errors.push({
          ...base,
          status: 'error',
          message: duplicated ? '本次选择中重复，已跳过' : (invalid ?? ''),
        })
        continue
      }
      fresh.push(base)
    }

    setItems((prev) => (multiple ? [...prev, ...fresh, ...errors] : [...fresh, ...errors]))
    if (errors.length > 0) onError?.(errors.map((item) => `${item.file.name}：${item.message}`).join('；'))
    if (fresh.length > 0) void uploadBatch(fresh)
  }

  const handleRemove = (item: UploadItem) => {
    if (uploadingRef.current) return
    dropUploaded(item)
    setItems((prev) => prev.filter((i) => i.id !== item.id))
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="media-uploader-input"
        className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed p-4 text-center transition-colors hover:bg-muted/40"
      >
        <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium">
          {items.length > 0 ? `已选择 ${items.length} 个文件，点击可重新选择` : (label ?? '点击选择图片 / 视频')}
        </span>
        <span className="text-xs text-muted-foreground">
          支持 mp4 / mov / jpg / png 等，单个文件最大 100MB
        </span>
      </label>
      <input
        ref={inputRef}
        id="media-uploader-input"
        type="file"
        multiple={multiple}
        accept="video/*,image/*"
        onChange={handleSelect}
        disabled={uploading || disabled}
        className="sr-only"
      />

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 rounded-lg border p-2">
              <div className="flex items-center gap-2">
                {item.file.type.startsWith('video/') ? (
                  <video
                    src={item.previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="size-10 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{item.file.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {humanSize(item.file.size)} ·{' '}
                    {resolveMediaType(item.file) === 'video' ? '视频' : '图片'}
                  </p>
                </div>
                <span
                  className={
                    item.status === 'success'
                      ? 'shrink-0 text-xs font-medium text-emerald-600'
                      : item.status === 'error'
                        ? 'shrink-0 text-xs font-medium text-destructive'
                        : 'shrink-0 text-xs text-muted-foreground'
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
                {!uploading && (
                  <button
                    type="button"
                    onClick={() => handleRemove(item)}
                    aria-label={`移除 ${item.file.name}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {(item.status === 'uploading' || item.status === 'success' || item.status === 'error') && (
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
              )}
              {item.message && <p className="text-[11px] text-muted-foreground">{item.message}</p>}
              {item.status === 'success' && (
                <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  已上传，保存后生效
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
