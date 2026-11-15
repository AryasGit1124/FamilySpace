import { fetchBills } from '@/lib/supabase-queries'
import { BillsClient } from './bills-client'

/** 每次进入都重新读取，导入后 router.refresh() 立即生效 */
export const dynamic = 'force-dynamic'

/** 家庭账单：导入微信 / 支付宝 CSV，按月 / 年看收支与分类明细 */
export default async function BillsPage() {
  const bills = await fetchBills().catch((err: unknown) => {
    console.error('[BillsPage] 读取账单失败:', err)
    return []
  })

  return <BillsClient bills={bills} />
}
