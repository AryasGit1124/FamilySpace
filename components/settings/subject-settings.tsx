'use client'

import { Fragment, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppState } from '@/components/app-state-provider'
import { AddSubjectDialog } from '@/components/settings/add-subject-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { getSubjectMeta } from '@/lib/subject-meta'
import { cn } from '@/lib/utils'

export function SubjectSettings() {
  const { subjects, setSubjectInTab } = useAppState()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>学科列表</CardTitle>
        <CardDescription>选择哪些学科显示在底部 Tab</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul>
          {subjects.map((subject, i) => {
            const meta = getSubjectMeta(subject.id)
            const Icon = meta.icon
            const switchId = `tab-${subject.id}`
            return (
              <Fragment key={subject.id}>
                {i > 0 && <Separator className="my-3" />}
                <li className="flex items-center gap-3">
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', meta.tint)}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <p className="min-w-0 flex-1 truncate font-medium">{subject.name}</p>
                  <div className="flex items-center gap-2">
                    <label htmlFor={switchId} className="text-xs text-muted-foreground">
                      显示在底部 Tab
                    </label>
                    <Switch
                      id={switchId}
                      checked={subject.showInTab}
                      onCheckedChange={(checked) => setSubjectInTab(subject.id, checked)}
                    />
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ul>
        <Button variant="outline" className="w-full" onClick={() => setDialogOpen(true)}>
          <Plus aria-hidden="true" />
          新增学科
        </Button>
      </CardContent>
      <AddSubjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}
