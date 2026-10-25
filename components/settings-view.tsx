'use client'

import { PageHeader } from '@/components/page-header'
import { ScheduleSettings } from '@/components/settings/schedule-settings'
import { SubjectSettings } from '@/components/settings/subject-settings'
import { TaskSettings } from '@/components/settings/task-settings'
import { WeeklyTemplateSettings } from '@/components/settings/weekly-template-settings'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StoreConfigClient } from '@/app/settings/store-config/store-config-client'
import type { RewardItem, StarLedgerEntry } from '@/lib/supabase-queries'

type Props = {
  initialTab?: string
  rewards: RewardItem[]
  records: StarLedgerEntry[]
}

export function SettingsView({ initialTab, rewards, records }: Props) {
  return (
    <>
      <PageHeader title="设置" />
      <div className="px-5">
        <Tabs defaultValue={initialTab === 'store' ? 'store' : 'subjects'}>
          <TabsList className="h-10 w-full">
            <TabsTrigger value="subjects">学科设置</TabsTrigger>
            <TabsTrigger value="schedule">课表设置</TabsTrigger>
            <TabsTrigger value="tasks">任务列表</TabsTrigger>
            <TabsTrigger value="template">每周任务模板</TabsTrigger>
            <TabsTrigger value="store">商城配置</TabsTrigger>
          </TabsList>
          <TabsContent value="subjects" className="pt-2">
            <SubjectSettings />
          </TabsContent>
          <TabsContent value="schedule" className="pt-2">
            <ScheduleSettings />
          </TabsContent>
          <TabsContent value="tasks" className="pt-2">
            <TaskSettings />
          </TabsContent>
          <TabsContent value="template" className="pt-2">
            <WeeklyTemplateSettings />
          </TabsContent>
          <TabsContent value="store" className="pt-2">
            {/* 抵消外层 px-5，商城配置组件自带内边距 */}
            <div className="-mx-5">
              <StoreConfigClient rewards={rewards} records={records} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
