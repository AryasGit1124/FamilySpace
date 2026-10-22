'use client'

import { useState, type FormEvent } from 'react'
import { useAppState } from '@/components/app-state-provider'
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

export function AddSubjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { subjects, addSubject } = useAppState()
  const [name, setName] = useState('')
  const [showInTab, setShowInTab] = useState(true)

  const trimmed = name.trim()
  const duplicate = subjects.some((s) => s.name === trimmed)

  const close = () => {
    setName('')
    setShowInTab(true)
    onOpenChange(false)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed || duplicate) return
    addSubject(trimmed, showInTab)
    close()
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
            <Switch id="subject-show-in-tab" checked={showInTab} onCheckedChange={setShowInTab} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              取消
            </Button>
            <Button type="submit" disabled={!trimmed || duplicate}>
              确认
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
