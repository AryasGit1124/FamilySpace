import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { fetchMediaById } from '@/lib/supabase-queries'
import { MediaClient } from './media-client'

/** 每次进入都按 id 重新查 media，保证删除/更新后不走缓存 */
export const dynamic = 'force-dynamic'

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const media = await fetchMediaById(id).catch((err: unknown) => {
    console.error('[MediaDetailPage] media 查询失败:', err)
    return null
  })

  if (!media) {
    return (
      <>
        <PageHeader title="资料详情" backHref="/library" backLabel="返回资料库" />
        <div className="px-5">
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            找不到这条资料，可能已被删除。
            <Link href="/library" className="ml-1 text-primary underline-offset-4 hover:underline">
              返回资料库
            </Link>
          </p>
        </div>
      </>
    )
  }

  return <MediaClient media={media} />
}
