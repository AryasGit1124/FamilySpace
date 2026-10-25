'use client'

import { useState, type FormEvent } from 'react'
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
import { Switch } from '@/components/ui/switch'
import type { Subject } from '@/lib/mock-data'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (name: string, showInTab: boolean) => Promise<void> | void
  subjects?: Subject[]
}

export function AddSubjectDialog({ open, onOpenChange, onSubmit, subjects = [] }: Props) {
  const [name, setName] = useState('')
  const [showInTab, setShowInTab] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = name.trim()
  const duplicate = subjects.some((s) => s.name === trimmed)

  const close = () => {
    if (!submitting) {
      setName('')
      setShowInTab(true)
      onOpenChange(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed || duplicate || submitting) return
    setSubmitting(true)
    try {
      await onSubmit?.(trimmed, showInTab)
      close()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>新增学科</DialogTitle>
            <DialogDescription>新学科会出现在学科列表中</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="subject-name">学科名称</Label>
            <Input
              id="subject-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：美术"
              maxLength={10}
              autoFocus
              aria-invalid={duplicate || undefined}
            />
            {duplicate && <p className="text-xs text-destructive">该学科已存在</p>}
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="subject-show-in-tab">显示在底部 Tab</Label>
            <Switch id="subject-show-in-tab" checked={showInTab} onCheckedChange={() => setShowInTab((v) => !v)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={!trimmed || duplicate || submitting}>
              {submitting ? '提交中…' : '确认'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
