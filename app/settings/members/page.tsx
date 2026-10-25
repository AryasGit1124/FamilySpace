import { PageHeader } from '@/components/page-header'
import { fetchCurrentFamily, fetchFamilyMembers } from '@/lib/supabase-queries'
import { MembersView } from './members-view'

/** 每次进入都重新查成员，家庭成员变化后刷新即可看到最新列表 */
export const dynamic = 'force-dynamic'

export default async function MembersPage() {
  const [family, members] = await Promise.all([
    fetchCurrentFamily().catch((err: unknown) => {
      console.error('[MembersPage] 读取家庭信息失败:', err)
      return null
    }),
    fetchFamilyMembers().catch((err: unknown) => {
      console.error('[MembersPage] 读取家庭成员失败:', err)
      return []
    }),
  ])

  return (
    <>
      <PageHeader
        title="用户管理"
        subtitle="家庭码与家庭成员"
        backHref="/settings"
        backLabel="返回设置"
      />
      <MembersView family={family} members={members} />
    </>
  )
}
