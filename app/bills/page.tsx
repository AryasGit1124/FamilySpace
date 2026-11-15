import { BillsClient } from './bills-client'

/** 家庭账单：导入微信 / 支付宝账单到 ODS 原始表（数据在浏览器端读取，避免服务端出网抖动） */
export default function BillsPage() {
  return <BillsClient />
}
