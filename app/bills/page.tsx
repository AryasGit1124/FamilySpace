import { fetchBillStats } from '@/lib/supabase-queries'
import { BillsClient } from './bills-client'

/** 每次进入都重新统计，导入后 router.refresh() 立即生效 */
export const dynamic = 'force-dynamic'

/** 家庭账单：导入微信 / 支付宝 CSV 并查看本月收支 */
export default async function BillsPage() {
  const stats = await fetchBillStats().catch((err: unknown) => {
    console.error('[BillsPage] 读取账单统计失败:', err)
    return { monthIncome: 0, monthExpense: 0, totalCount: 0, recent: [], month: '' }
  })

  return <BillsClient initialStats={stats} />
}
