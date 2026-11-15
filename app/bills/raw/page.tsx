import { RawBillsClient } from './raw-client'

/** 原始数据预览：数据在浏览器端读取（服务端访问 Supabase 偶发 ECONNRESET） */
export default async function RawBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>
}) {
  const { batch } = await searchParams
  return <RawBillsClient batch={batch} />
}
