import { fetchRewards, fetchStarTotal } from '@/lib/supabase-queries'
import { StoreClient } from './store-client'

/** 每次进入都重新读取星星总数与库存，兑换后 router.refresh() 立即生效 */
export const dynamic = 'force-dynamic'

/** 星星商城：家长在 rewards_store 配置奖励，孩子用打卡攒的星星兑换 */
export default async function StorePage() {
  const [rewards, starTotal] = await Promise.all([
    fetchRewards().catch((err: unknown) => {
      console.error('[StorePage] 读取奖励失败:', err)
      return []
    }),
    fetchStarTotal().catch((err: unknown) => {
      console.error('[StorePage] 读取星星失败:', err)
      return 0
    }),
  ])

  return <StoreClient rewards={rewards} starTotal={starTotal} />
}
