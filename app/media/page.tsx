import Link from 'next/link'
import { Upload } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getWeekDates } from '@/lib/supabase-adapter'
import { requireSupabase } from '@/lib/supabase'
import { resolveFamilyId } from '@/lib/family'
import { scoped } from '@/lib/supabase-queries'

// 每次请求重查 media，保证上传后返回本页能看到最新内容
export const dynamic = 'force-dynamic'

type MediaRow = {
  id: string
  course_name: string
  child_name: string | null
  offline_class: string | null
  media_date: string
  file_url: string
  file_type: 'video' | 'image' | null
  note: string | null
  uploader_name: string | null
  thumb_url: string | null
}

export default async function MediaLibraryPage() {
  const weekDates = getWeekDates()
  const monday = weekDates[1]
  const sunday = weekDates[7]

  let rows: MediaRow[] = []
  let loadError: string | null = null
  try {
    const supabase = await requireSupabase()
    const familyId = await resolveFamilyId()
    const { data, error } = await scoped(
      supabase
        .from('media')
        .select('id, course_name, child_name, offline_class, media_date, file_url, file_type, note, uploader_name, thumb_url'),
      familyId,
    )
      .gte('media_date', monday)
      .lte('media_date', sunday)
      .order('media_date', { ascending: false })
    if (error) throw error
    rows = (data ?? []) as MediaRow[]
  } catch (err) {
    console.error('[MediaLibraryPage] 查询失败:', err)
    loadError = err instanceof Error ? err.message : '加载失败'
  }

  return (
    <>
      <PageHeader
        title="本周视频库"
        subtitle={`${monday} 至 ${sunday}`}
        action={
          <Link href="/upload" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            <Upload aria-hidden="true" />
            上传
          </Link>
        }
      />

      <div className="flex flex-col gap-3 px-5">
        {loadError ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-destructive">
            加载失败：{loadError}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            本周还没有上传资料，点右上角「上传」添加
          </p>
        ) : (
          rows.map((row) => (
            <Card key={row.id} className="overflow-hidden">
              <CardContent className="flex flex-col gap-2 p-0">
                {row.file_type === 'video' ? (
                  <video
                    src={row.file_url}
                    poster={row.thumb_url ?? undefined}
                    controls
                    preload="metadata"
                    className="max-h-72 w-full bg-black object-contain"
                  />
                ) : (
                  // 该图使用普通 img，next.config 已开启 images.unoptimized
                  <img src={row.file_url} alt={row.course_name} className="max-h-72 w-full object-cover" />
                )}
                <div className="flex flex-col gap-1 px-4 pb-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-medium">{row.course_name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{row.media_date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[row.child_name, row.offline_class, row.uploader_name ? `上传者 ${row.uploader_name}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {row.note && <p className="text-sm">{row.note}</p>}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </>
  )
}
