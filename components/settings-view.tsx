'use client'

import { PageHeader } from '@/components/page-header'
import { ScheduleSettings } from '@/components/settings/schedule-settings'
import { SubjectSettings } from '@/components/settings/subject-settings'
import { WeeklyTemplateSettings } from '@/components/settings/weekly-template-settings'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SettingsView() {
  return (
    <>
      <PageHeader title="设置" />
      <div className="px-5">
        <Tabs defaultValue="subjects">
          <TabsList className="h-10 w-full">
            <TabsTrigger value="subjects">学科设置</TabsTrigger>
            <TabsTrigger value="schedule">课表设置</TabsTrigger>
            <TabsTrigger value="template">每周任务模板</TabsTrigger>
          </TabsList>
          <TabsContent value="subjects" className="pt-2">
            <SubjectSettings />
          </TabsContent>
          <TabsContent value="schedule" className="pt-2">
            <ScheduleSettings />
          </TabsContent>
          <TabsContent value="template" className="pt-2">
            <WeeklyTemplateSettings />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
