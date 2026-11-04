'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ImageIcon, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { GrowthRecordForm } from './growth-record-form'
import { deleteGrowthRecord, fetchGrowthRecords, type GrowthRecord } from '@/lib/growth-queries'
import { errMsg } from '@/lib/media-upload'

export default function GrowthPage() {
  const [records, setRecords] = useState<GrowthRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingRecord, setEditingRecord] = useState<GrowthRecord | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setRecords(await fetchGrowthRecords())
    } catch (err) {
      console.error('[GrowthPage] 加载成长档案失败:', err)
      // 查询失败（如缺 content 字段）时清空列表，避免残留数据让页面渲染崩溃
      setRecords([])
      setError('加载数据失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleDelete = async (record: GrowthRecord) => {
    if (deletingId) return
    if (!window.confirm('确定删除这条成长记录吗？R2 上的文件也会一起删除。')) return
    setDeletingId(record.id)
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
      setRecords((prev) => prev.filter((r) => r.id !== record.id))
    } catch (err) {
      console.error('[GrowthPage] 删除失败:', err)
      setError(`删除失败：${errMsg(err)}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="成长档案"
        subtitle="记录孩子每一个值得收藏的瞬间"
        action={
          <Button onClick={() => setShowForm(true)}>
            <Plus aria-hidden="true" />
            记录新瞬间
          </Button>
        }
      />

      <div className="px-5 pb-8">
        {error && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded-lg border border-destructive/30 px-3 py-1 text-xs font-medium transition-colors hover:bg-destructive/10"
            >
              重试
            </button>
          </div>
        )}

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            正在加载成长档案…
          </p>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-center">
            <ImageIcon className="size-10 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">还没有记录，点击右上角「记录新瞬间」开始吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {records.map((record) => (
              <div
                key={record.id}
                className="relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                <Link href={`/growth/${record.id}`} className="block">
                  <GrowthThumb record={record} />
                </Link>
                <button
                  type="button"
                  onClick={() => setEditingRecord(record)}
                  aria-label="编辑这条记录"
                  className="absolute right-11 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-white/90 text-muted-foreground shadow-sm transition-colors hover:bg-white hover:text-foreground"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(record)}
                  disabled={deletingId === record.id}
                  aria-label="删除这条记录"
                  className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-white/90 text-muted-foreground shadow-sm transition-colors hover:bg-white hover:text-destructive disabled:opacity-60"
                >
                  {deletingId === record.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <GrowthRecordForm onClose={() => setShowForm(false)} onSaved={() => void load()} />
      )}
      {editingRecord && (
        <GrowthRecordForm
          initialData={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSaved={() => void load()}
        />
      )}
    </>
  )
}

/** 卡片主体：图片缩略图 / 视频封面 / 文字便利贴 */
function GrowthThumb({ record }: { record: GrowthRecord }) {
  if (record.media_type === 'text') {
    return (
      <div className="flex aspect-[4/3] flex-col gap-1.5 overflow-hidden bg-amber-50 p-3 dark:bg-amber-500/10">
        <p className="line-clamp-1 text-sm font-bold text-amber-900 dark:text-amber-200">
          {record.title || '成长小记'}
        </p>
        <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-amber-800/80 dark:text-amber-200/80">
          {record.content || ''}
        </p>
        <p className="mt-auto text-[10px] text-amber-700/70 dark:text-amber-300/70">{record.record_date}</p>
      </div>
    )
  }

  if (record.media_type === 'video') {
    return (
      <div className="relative aspect-[4/3] bg-slate-900">
        {record.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={record.cover_url}
            alt={record.title || '成长视频'}
            className="size-full object-cover"
            loading="lazy"
            onError={(e) => {
              // 封面地址失效时隐藏，露出下方播放占位
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          // 没有封面时用柔和渐变占位，避免视频元素未加载时整块黑屏
          <div className="size-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white">
            <Play className="size-5" aria-hidden="true" />
          </span>
        </span>
        <RecordCaption record={record} />
      </div>
    )
  }

  return (
    <div className="relative aspect-[4/3] bg-muted">
      {record.file_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={record.file_url}
          alt={record.title || '成长照片'}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <ImageIcon className="size-8" aria-hidden="true" />
        </div>
      )}
      <RecordCaption record={record} />
    </div>
  )
}

function RecordCaption({ record }: { record: GrowthRecord }) {
  if (!record.title) return null
  return (
    <p className="absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-xs font-semibold text-white">
      {record.title}
    </p>
  )
}
