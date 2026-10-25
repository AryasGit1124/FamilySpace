'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { AddSubjectDialog } from '@/components/settings/add-subject-dialog'
import { EditSubjectDialog } from '@/components/settings/edit-subject-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  countTasksBySubject,
  deleteSubject,
  fetchSubjects,
  insertSubject,
  updateSubject,
  updateSubjectShowInTab,
} from '@/lib/supabase-queries'
import { mapColorToTint } from '@/lib/supabase-adapter'
import { cn } from '@/lib/utils'
import type { Subject } from '@/lib/mock-data'
import { getSubjectMeta } from '@/lib/subject-meta'

export function SubjectSettings() {
  const router = useRouter()
  const pathname = usePathname()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Subject | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ subject: Subject; taskCount: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = await fetchSubjects()
      setSubjects(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: '',
          showInTab: r.show_in_tab,
          color: r.color ?? undefined,
          sortOrder: r.sort_order ?? undefined,
        })),
      )
    } catch (err) {
      console.error('[SubjectSettings] 加载失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 每次路由变化（从其他页切回设置页）都重新拉取 —— 保证开关状态与 DB 一致，
  // 否则 Next.js 软导航会保留旧的客户端 state，导致显式取反在 stale UI 上写错值
  useEffect(() => {
    load()
  }, [load, pathname])

  const handleAdd = async (name: string, showInTab: boolean) => {
    try {
      const row = await insertSubject(name)
      if (!showInTab) await updateSubjectShowInTab(row.id, false)
      await load()
      router.refresh()
      window.dispatchEvent(new Event('subjects-changed'))
    } catch (err) {
      console.error('[SubjectSettings] 新增失败:', err)
    }
  }

  const handleToggleShow = async (id: string, checked: boolean) => {
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, showInTab: checked } : s)))
    try {
      await updateSubjectShowInTab(id, checked)
      router.refresh()
      window.dispatchEvent(new Event('subjects-changed'))
    } catch (err) {
      console.error('[SubjectSettings] 更新失败，回滚:', err)
      setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, showInTab: !checked } : s)))
    }
  }

  const handleEditSubmit = async (id: string, name: string) => {
    try {
      await updateSubject(id, name)
      await load()
      router.refresh()
      window.dispatchEvent(new Event('subjects-changed'))
    } catch (err) {
      console.error('[SubjectSettings] 编辑失败:', err)
    }
  }

  // 点垃圾桶后先查任务数，让确认弹窗能明确告知级联影响范围
  const handleDeleteClick = async (subject: Subject) => {
    let taskCount = 0
    try {
      taskCount = await countTasksBySubject(subject.id)
    } catch (err) {
      console.error('[SubjectSettings] 统计任务数失败:', err)
    }
    setConfirmDel({ subject, taskCount })
  }

  const handleDeleteConfirm = async () => {
    if (!confirmDel || deleting) return
    setDeleting(true)
    try {
      await deleteSubject(confirmDel.subject.id)
      await load()
      router.refresh()
      window.dispatchEvent(new Event('subjects-changed'))
    } catch (err) {
      console.error('[SubjectSettings] 删除失败:', err)
      await load()
    } finally {
      setDeleting(false)
      setConfirmDel(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>学科列表</CardTitle>
        <CardDescription>勾选的学科会出现在底部 Tab 栏</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p>
        ) : subjects.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            还没有学科，点击下方新增
          </p>
        ) : (
          <ul className="flex flex-col">
            {subjects.map((subject, i) => {
              const tint = subject.color ? mapColorToTint(subject.color) : getSubjectMeta(subject.id).tint
              const switchId = `tab-${subject.id}`
              return (
                <li key={subject.id}>
                  {i > 0 && <Separator className="my-3" />}
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-sm',
                        tint,
                      )}
                    >
                      {subject.name.slice(0, 1)}
                    </span>
                    <p className="min-w-0 flex-1 truncate font-medium">{subject.name}</p>
                    <div className="flex items-center gap-2">
                      <label htmlFor={switchId} className="text-xs text-muted-foreground whitespace-nowrap">
                        底部 Tab
                      </label>
                      <Switch
                        id={switchId}
                        checked={subject.showInTab}
                        // Base UI Switch 的 onCheckedChange 参数语义与 Radix 不同，
                        // 受控模式下直接取反当前值最可靠，不依赖回调参数。
                        onCheckedChange={() => handleToggleShow(subject.id, !subject.showInTab)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setEditing(subject)}
                        aria-label={`编辑学科：${subject.name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteClick(subject)}
                        aria-label={`删除学科：${subject.name}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <Button variant="outline" className="w-full" onClick={() => setDialogOpen(true)} disabled={loading}>
          <Plus aria-hidden="true" />
          新增学科
        </Button>
      </CardContent>
      <AddSubjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleAdd}
        subjects={subjects}
      />

      <EditSubjectDialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        subject={editing ? { id: editing.id, name: editing.name } : null}
        allNames={subjects.map((s) => s.name)}
        onSubmit={handleEditSubmit}
      />

      {/* 删除确认：学科删除会级联删掉该学科下的所有任务及其排期/模板/打卡/资料 */}
      {confirmDel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="删除学科确认"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !deleting && setConfirmDel(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              <p className="font-semibold">确定删除学科「{confirmDel.subject.name}」吗？</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmDel.taskCount > 0
                ? `该学科下有 ${confirmDel.taskCount} 个任务，删除后这些任务及其课表排期、每周模板、打卡记录、上传资料会一起被删除，且无法恢复。`
                : '该学科下暂无任务。删除后无法恢复。'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDel(null)} disabled={deleting}>
                取消
              </Button>
              <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? '删除中…' : '确认删除'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}