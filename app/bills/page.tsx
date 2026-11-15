import { describeBillError, isMissingBillTable } from '@/lib/bills'
import { fetchBills, type BillRow } from '@/lib/supabase-queries'
import { BillsClient } from './bills-client'

/** 每次进入都重新读取，导入后 router.refresh() 立即生效 */
export const dynamic = 'force-dynamic'

/** 家庭账单：导入微信 / 支付宝账单，按月 / 年看收支与分类明细 */
export default async function BillsPage() {
  let bills: BillRow[] = []
  let loadError: string | null = null

  try {
    bills = await fetchBills()
  } catch (err) {
    console.error('[BillsPage] 读取账单失败:', describeBillError(err), err)
    loadError = isMissingBillTable(err)
      ? '账单数据表还没创建：请在 Supabase 执行 scripts/create-family-bills.sql，然后刷新本页'
      : `读取账单失败：${describeBillError(err)}`
  }

  return <BillsClient bills={bills} loadError={loadError} />
}
