import { redirect } from 'next/navigation'

/** 旧识字乐园入口页已废弃：4 个子功能合并进 /chinese/literacy/daily 向导 */
export default function LiteracyPage() {
  redirect('/chinese/literacy/daily')
}
