import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { fetchGrowthRecord } from '@/lib/growth-queries'
import { GrowthDetailClient } from './growth-detail-client'

export const dynamic = 'force-dynamic'

export default async function GrowthDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const record = await fetchGrowthRecord(id).catch((err: unknown) => {
    console.error('[GrowthDetailPage] 查询失败:', err)
    return null
  })

  if (!record) {
    return (
      <>
        <PageHeader title="成长记录" backHref="/growth" backLabel="返回成长档案" />
        <div className="px-5">
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            找不到这条记录，可能已被删除。
            <Link href="/growth" className="ml-1 text-primary underline-offset-4 hover:underline">
              返回成长档案
            </Link>
          </p>
        </div>
      </>
    )
  }

  return <GrowthDetailClient record={record} />
}
