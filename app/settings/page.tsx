import { SettingsView } from '@/components/settings-view'
import { fetchAllRewards, fetchRedemptionRecords } from '@/lib/supabase-queries'

/** 每次进入都重新查询奖励，商城配置 tab 内增删改后 router.refresh() 立即生效 */
export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const { tab } = await searchParams

  const [rewards, records] = await Promise.all([
    fetchAllRewards().catch((err: unknown) => {
      console.error('[SettingsPage] 读取奖励失败:', err)
      return []
    }),
    fetchRedemptionRecords().catch((err: unknown) => {
      console.error('[SettingsPage] 读取兑换记录失败:', err)
      return []
    }),
  ])

  return (
    <SettingsView
      initialTab={Array.isArray(tab) ? tab[0] : tab}
      rewards={rewards}
      records={records}
    />
  )
}
