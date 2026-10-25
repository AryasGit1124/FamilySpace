'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 正在编辑的学科（null 时弹窗不渲染有效内容） */
  subject: { id: string; name: string } | null
  /** 所有学科名 —— 用于重名校验（排除自身） */
  allNames: string[]
  onSubmit: (id: string, name: string) => Promise<void> | void
}

export function EditSubjectDialog({ open, onOpenChange, subject, allNames, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 每次打开时用当前学科名回填
  useEffect(() => {
    if (open && subject) setName(subject.name)
  }, [open, subject])

  const trimmed = name.trim()
  const duplicate = allNames.filter((n) => n !== subject?.name).some((n) => n === trimmed)

  const close = () => {
    if (!submitting) onOpenChange(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!subject || !trimmed || duplicate || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(subject.id, trimmed)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>编辑学科</DialogTitle>
            <DialogDescription>修改学科名称，保存后全站生效</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-subject-name">学科名称</Label>
            <Input
              id="edit-subject-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：语文"
              autoFocus
            />
            {duplicate && <p className="text-xs text-destructive">已有同名学科</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={!trimmed || duplicate || submitting}>
              {submitting ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}