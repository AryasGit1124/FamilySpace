import { PageHeader } from '@/components/page-header'
import { fetchAllRewards, fetchRedemptionRecords } from '@/lib/supabase-queries'
import { StoreConfigClient } from './store-config-client'

/** 每次进入都重新查询奖励与兑换记录，增删后 router.refresh() 立即生效 */
export const dynamic = 'force-dynamic'

/** 家长端商城配置：管理奖励、查看孩子兑换记录 */
export default async function StoreConfigPage() {
  const [rewards, records] = await Promise.all([
    fetchAllRewards().catch((err: unknown) => {
      console.error('[StoreConfigPage] 读取奖励失败:', err)
      return []
    }),
    fetchRedemptionRecords().catch((err: unknown) => {
      console.error('[StoreConfigPage] 读取兑换记录失败:', err)
      return []
    }),
  ])

  return (
    <>
      <PageHeader
        title="商城配置"
        subtitle="管理可兑换奖励，查看孩子兑换了什么"
        backHref="/settings?tab=store"
        backLabel="返回设置"
      />
      <StoreConfigClient rewards={rewards} records={records} />
    </>
  )
}
