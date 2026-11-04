'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GrowthRecordForm } from '../growth-record-form'
import { VideoPlayer } from '@/app/components/VideoPlayer'
import { deleteGrowthRecord, updateGrowthRecord, type GrowthRecord } from '@/lib/growth-queries'
import { extractVideoCover, uploadMediaFile } from '@/lib/media-upload'

export function GrowthDetailClient({ record }: { record: GrowthRecord }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [videoWaiting, setVideoWaiting] = useState(true)
  const [coverUrl, setCoverUrl] = useState(record.cover_url)
  const [fixingCover, setFixingCover] = useState(false)
  const [error, setError] = useState('')

  const handleFixCover = async () => {
    if (fixingCover || !record.file_url) return
    setFixingCover(true)
    setError('')
    try {
      const res = await fetch(record.file_url)
      if (!res.ok) throw new Error(`下载视频失败（HTTP ${res.status}）`)
      const blob = await res.blob()
      const file = new File([blob], `video-${record.id}.mp4`, {
        type: blob.type || 'video/mp4',
      })
      const cover = await extractVideoCover(file)
      if (!cover) throw new Error('当前浏览器无法解码这个视频，请换电脑浏览器重试')
      const url = await uploadMediaFile(cover, 'growth')
      await updateGrowthRecord(record.id, {
        title: record.title,
        content: record.content,
        recordDate: record.record_date,
        coverUrl: url,
      })
      setCoverUrl(url)
      router.refresh()
    } catch (err) {
      console.error('[GrowthDetail] 生成封面失败:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFixingCover(false)
    }
  }

  const handleDelete = async () => {
    if (deleting) return
    if (!window.confirm('确定删除这条成长记录吗？R2 上的文件也会一起删除。')) return
    setDeleting(true)
    setError('')
    try {
      if (record.file_url || record.cover_url) {
        const res = await fetch('/api/r2-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: record.file_url ?? '', coverUrl: record.cover_url ?? '' }),
        })
        if (!res.ok) throw new Error(`删除 R2 文件失败（HTTP ${res.status}）`)
      }
      await deleteGrowthRecord(record.id)
      router.push('/growth')
    } catch (err) {
      console.error('[GrowthDetail] 删除失败:', err)
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* 顶部固定导航栏：返回 / 标题 / 编辑与删除 */}
      <nav className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-white/90 px-3 backdrop-blur md:px-5 dark:bg-background/90">
        <Button
          variant="ghost"
          size="sm"
          className="h-10 gap-1 px-2 text-muted-foreground"
          onClick={() => router.push('/growth')}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
          <span className="text-sm">返回</span>
        </Button>
        <span className="flex-1 truncate text-center text-base font-semibold">回忆详情</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label="编辑记录"
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 text-destructive hover:text-destructive"
          aria-label="删除记录"
          disabled={deleting}
          onClick={() => void handleDelete()}
        >
          {deleting ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-5" aria-hidden="true" />}
        </Button>
      </nav>

      <div className="flex flex-col gap-3 px-4 py-3">
        <header>
          <h1 className="text-xl font-bold leading-snug">{record.title || '成长小记'}</h1>
          <p className="mt-1 text-xs text-gray-400">{record.record_date}</p>
        </header>

        {error && (
          <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {record.media_type === 'video' && record.file_url && (
          <div className="flex flex-col gap-2">
            <VideoPlayer
              src={record.file_url}
              poster={coverUrl}
              muted
              onError={() => setVideoError(true)}
              onCanPlay={() => setVideoWaiting(false)}
              onPlaying={() => setVideoWaiting(false)}
              onWaiting={() => setVideoWaiting(true)}
            />
            {videoWaiting && !videoError && (
              <p className="text-xs text-muted-foreground">视频加载中…如果长时间转圈，可能是 MOV/HEVC 编码，请用下方下载按钮打开。</p>
            )}
            {videoError && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                当前浏览器可能不支持该视频编码（例如 iPhone 的 HEVC/H.265），可以点击下方按钮下载后用系统播放器打开。
              </p>
            )}
            {!coverUrl && (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={fixingCover}
                  onClick={handleFixCover}
                >
                  {fixingCover ? '生成中…' : '生成封面'}
                </Button>
              </div>
            )}
          </div>
        )}

        {record.media_type === 'image' && record.file_url && (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={record.file_url}
              alt={record.title || '成长照片'}
              className="max-h-[75vh] w-auto max-w-full rounded-2xl object-contain shadow-sm"
            />
          </div>
        )}

        {record.content && (
          <article className="rounded-2xl border bg-card px-5 py-6 md:px-8 md:py-8">
            <p className="whitespace-pre-wrap text-lg leading-loose text-gray-700 md:text-xl dark:text-gray-300">
              {record.content}
            </p>
          </article>
        )}
      </div>

      {editing && (
        <GrowthRecordForm
          initialData={record}
          onClose={() => setEditing(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  )
}
