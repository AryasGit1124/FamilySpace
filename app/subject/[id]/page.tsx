import Link from 'next/link'
import { AiGameSection } from '@/components/ai-game-section'
import { PageHeader } from '@/components/page-header'
import { ensureModuleTask, fetchOnlineTasksBySubject, fetchSubjectById } from '@/lib/supabase-queries'
import { SUBJECT_MODULES } from '@/lib/subject-modules'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

/** 每次进入都重新查 tasks，AI 生成成功后 router.refresh() 才能拿到新数据 */
export const dynamic = 'force-dynamic'

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const subject = await fetchSubjectById(id).catch((err: unknown) => {
    console.error('[SubjectPage] subjects 查询失败:', err)
    return null
  })

  if (!subject) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-20 text-center">
        <p className="font-medium">找不到这个学科</p>
        <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
          返回今日
        </Link>
      </div>
    )
  }

  // 学科内置子模块（如语文→识字乐园）自动补建任务，幂等；失败不阻塞页面
  await Promise.all(
    SUBJECT_MODULES.filter((m) => m.subjectName === subject.name).map((m) =>
      ensureModuleTask({ subject_id: subject.id, title: m.title, game_route: m.gameRoute }).catch(
        (err: unknown) => console.error(`[SubjectPage] 补建模块任务失败（${m.title}）:`, err),
      ),
    ),
  )

  // 学科页只展示 AI 游戏（旧选择题播放器 + 新多题型播放器）；普通任务和子模块入口（如识字乐园，已有专属卡片）不进列表
  const games = (await fetchOnlineTasksBySubject(id).catch((err: unknown) => {
    console.error('[SubjectPage] tasks 查询失败:', err)
    return []
  })).filter((g) => g.game_route === '/games/ai-play' || g.game_route === '/games/dynamic')

  const meta = getSubjectMeta(subject.id)
  const Icon = meta.icon

  return (
    <>
      <PageHeader
        title={subject.name}
        subtitle="AI 小游戏与线上任务"
        action={
          <span className={cn('flex size-12 items-center justify-center rounded-2xl', meta.tint)}>
            <Icon className="size-6" aria-hidden="true" />
          </span>
        }
      />
      <div className="flex flex-col gap-6 px-5">
        {/* 学科子模块入口卡片（注册表见 lib/subject-modules.ts） */}
        {SUBJECT_MODULES.filter((m) => m.subjectName === subject.name).map((m) => {
          const ModuleIcon = m.icon
          return (
            <Link
              key={m.title}
              href={m.gameRoute}
              className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <span className={cn('flex size-12 items-center justify-center rounded-2xl', m.tint)}>
                <ModuleIcon className="size-6" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-semibold">{m.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{m.desc}</span>
              </span>
            </Link>
          )
        })}
        <AiGameSection subjectId={subject.id} subjectName={subject.name} games={games} />
      </div>
    </>
  )
}
