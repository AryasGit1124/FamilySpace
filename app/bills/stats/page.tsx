import { PageHeader } from '@/components/page-header'

/** 数据统计：后续接入分类支出图表 */
export default function BillsStatsPage() {
  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden">
      <PageHeader
        title="数据统计"
        subtitle="按分类看收支结构"
        backHref="/bills/import"
        backLabel="返回账单"
      />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-4 md:px-6">
        <p className="rounded-2xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          统计图表还在开发中，先把账单导入和规则配好吧
        </p>
      </div>
    </div>
  )
}
