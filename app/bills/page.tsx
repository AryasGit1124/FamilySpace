import { describeBillError, isMissingBillTable } from '@/lib/bills'
import { fetchRawBatches, type RawBatch } from '@/lib/supabase-queries'
import { BillsClient } from './bills-client'

/** 每次进入都重新读取，导入后跳转预览页时数据是最新的 */
export const dynamic = 'force-dynamic'

/** 家庭账单：导入微信 / 支付宝账单到 ODS 原始表 */
export default async function BillsPage() {
  let batches: RawBatch[] = []
  let loadError: string | null = null

  try {
    batches = await fetchRawBatches()
  } catch (err) {
    console.error('[BillsPage] 读取 bill_raw_data 失败:', describeBillError(err), err)
    loadError = isMissingBillTable(err)
      ? '原始账单表还没创建：请在 Supabase 执行 scripts/create-bill-raw-data.sql，然后刷新本页'
      : `读取导入批次失败：${describeBillError(err)}`
  }

  return <BillsClient batches={batches} loadError={loadError} />
}
