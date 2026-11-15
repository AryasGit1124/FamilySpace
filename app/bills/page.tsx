import { redirect } from 'next/navigation'

/** 旧入口：/bills 统一跳到账单导入 */
export default function BillsPage() {
  redirect('/bills/import')
}
