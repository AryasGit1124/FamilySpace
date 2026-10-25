'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, CalendarDays, CheckCircle2, Image as ImageIcon, Play, Trash2, User, Video, X } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/auth-provider'
import {
  deleteMedia,
  deleteMediaFileByUrl,
  fetchMediaList,
  type MediaRow,
} from '@/lib/supabase-queries'

/** ISO 时间 → "2026-10-23 22:15" */
function formatUploadTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-10-23" → "10月23日" */
function formatDateLabel(date: string) {
  const [, mm, dd] = date.split('-')
  return mm && dd ? `${Number(mm)}月${Number(dd)}日` : date
}

export default function LibraryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { role } = useAuth()
  const isChild = role === 'child'
  /** 从今日页 teacher 任务跳入：只看某门课 */
  const courseParam = searchParams.get('course')
  /** latest=1 时自动把日期定位到该课程最近一次上传的那天 */
  const latestParam = searchParams.get('latest') === '1'

  const [items, setItems] = useState<MediaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [courseFilter, setCourseFilter] = useState<string | null>(courseParam)
  const [dateFilter, setDateFilter] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await fetchMediaList()
      setItems(rows)
    } catch (err) {
      console.error('[Library] 加载失败:', err)
      setNotice({ type: 'error', text: '资料加载失败，请稍后刷新重试' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // URL 参数变化时同步课程筛选
  useEffect(() => {
    setCourseFilter(courseParam)
  }, [courseParam])

  // latest=1：数据加载后，把日期筛选定位到该课程最近一次上传的日期
  useEffect(() => {
    if (!latestParam || !courseParam || items.length === 0) return
    const dates = items
      .filter((it) => (it.course_name ?? '') === courseParam)
      .map((it) => it.media_date)
    if (dates.length > 0) setDateFilter(dates.reduce((a, b) => (a > b ? a : b)))
  }, [latestParam, courseParam, items])

  // 先按课程名称过滤，再按日期过滤
  const byCourse = useMemo(
    () => (courseFilter ? items.filter((it) => (it.course_name ?? '') === courseFilter) : items),
    [items, courseFilter],
  )
  const filtered = useMemo(
    () => (dateFilter ? byCourse.filter((it) => it.media_date === dateFilter) : byCourse),
    [byCourse, dateFilter],
  )

  // 按课程名称分组，保持 media_date 倒序（Map 保留插入顺序）
  const groups = useMemo(() => {
    const map = new Map<string, MediaRow[]>()
    for (const it of filtered) {
      const key = it.course_name?.trim() || '未分类'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return [...map.entries()]
  }, [filtered])

  /** 删除：先删 Storage 文件，再删 media 记录；任一步失败都保留记录并提示 */
  const handleDelete = async (item: MediaRow) => {
    const label = `${item.course_name ?? '未分类'} · ${item.media_date}`
    const ok = window.confirm(`确定删除「${label}」这条资料吗？\n数据库记录和存储文件都会删除，且无法恢复。`)
    if (!ok) return

    setDeletingId(item.id)
    setNotice(null)
    try {
      try {
        await deleteMediaFileByUrl(item.file_url)
      } catch (err) {
        console.error('[Library] 删除存储文件失败:', err)
        setNotice({
          type: 'error',
          text: '删除存储文件失败：缺少删除权限。请在 Supabase Storage 给 course-media 桶添加 delete 策略后重试。',
        })
        return
      }
      await deleteMedia(item.id)
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      setNotice({ type: 'success', text: `已删除：${label}` })
    } catch (err) {
      console.error('[Library] 删除记录失败:', err)
      setNotice({ type: 'error', text: `删除失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <PageHeader title={isChild ? '课程资料' : '本周资料库'} subtitle={isChild ? undefined : '按课程分组，点击卡片查看详情'} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        {/* 课程筛选（今日页 teacher 任务跳入时出现） */}
        {courseFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
              课程：{courseFilter}
              <button
                type="button"
                onClick={() => setCourseFilter(null)}
                aria-label="清除课程筛选"
                className="opacity-70 transition-opacity hover:opacity-100"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}

        {/* 日期筛选 */}
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">按日期筛选</span>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </label>
          {dateFilter && (
            <Button variant="outline" onClick={() => setDateFilter('')}>
              全部
            </Button>
          )}
        </div>

        {notice && (
          <div
            role="status"
            className={
              notice.type === 'success'
                ? 'flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800'
                : 'flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-destructive'
            }
          >
            {notice.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 text-sm font-medium break-words">{notice.text}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="关闭提示"
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {dateFilter
              ? '这一天还没有上传资料'
              : courseFilter
                ? `「${courseFilter}」还没有上传资料`
                : '还没有任何资料，去「上传」页添加吧'}
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-xs text-muted-foreground">
              共 {filtered.length} 条 · {groups.length} 门课程
            </p>
            {groups.map(([courseName, rows]) => (
              <section key={courseName} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{courseName}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {rows.length}
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {rows.map((item) => (
                    <li key={item.id}>
                      {/* 整张卡片可点击进详情页；删除按钮内部 stopPropagation 防冒泡 */}
                      <article
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/media/${item.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            router.push(`/media/${item.id}`)
                          }
                        }}
                        className="cursor-pointer rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <div className="flex items-start gap-3">
                          <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                            {item.thumb_url ? (
                              // 该图使用普通 img，next.config 已开启 images.unoptimized
                              <img src={item.thumb_url} alt="" className="size-9 object-cover" />
                            ) : item.file_type === 'video' ? (
                              <Video className="size-4" aria-hidden="true" />
                            ) : (
                              <ImageIcon className="size-4" aria-hidden="true" />
                            )}
                            {item.file_type === 'video' && (
                              /* 播放角标：提示视频可点击播放 */
                              <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                <Play className="size-2.5 fill-current" aria-hidden="true" />
                              </span>
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{item.course_name?.trim() || '未分类'}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <CalendarDays className="size-3.5" aria-hidden="true" />
                                {formatDateLabel(item.media_date)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <User className="size-3.5" aria-hidden="true" />
                                {item.uploader_name || '—'}
                              </span>
                              <span>上传于 {formatUploadTime(item.created_at)}</span>
                            </div>
                            {item.note && (
                              <p className="mt-2 line-clamp-3 text-sm break-words text-muted-foreground">
                                {item.note}
                              </p>
                            )}
                          </div>
                          {!isChild && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                // 阻止冒泡：删除不触发卡片跳转
                                e.stopPropagation()
                                void handleDelete(item)
                              }}
                              disabled={deletingId === item.id}
                              aria-label={`删除 ${item.course_name ?? '未分类'} ${item.media_date} 的资料`}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
