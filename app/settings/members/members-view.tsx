'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Share2, Trash2, Users } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { FAMILY_ROLES, roleLabel } from '@/lib/family'
import { deleteProfile, type FamilyInfo, type FamilyMember } from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type Props = {
  family: FamilyInfo | null
  members: FamilyMember[]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function iconOf(member: FamilyMember) {
  const found = FAMILY_ROLES.find((r) => r.label === member.display_name)
  if (found) return found.icon
  return member.role === 'child' ? '🧒' : '👤'
}

/** 家庭码 + 邀请链接分享 + 成员列表 */
export function MembersView({ family, members }: Props) {
  const router = useRouter()
  const { user } = useAuth()
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const inviteLink = family && origin ? `${origin}/login?code=${family.invite_code}` : ''

  const handleRemove = async (member: FamilyMember) => {
    const self = member.id === user?.id
    const ok = window.confirm(
      self
        ? `确定要移除「${roleLabel(member.display_name, member.role)}」吗？这是你自己，移除后将无法再访问本家庭。`
        : `确定要移除「${roleLabel(member.display_name, member.role)}」吗？移除后该成员将无法再访问本家庭。`,
    )
    if (!ok) return
    setRemovingId(member.id)
    try {
      await deleteProfile(member.id)
      if (self) {
        router.replace('/login')
      } else {
        router.refresh()
      }
    } catch (err) {
      console.error('[MembersView] 移除成员失败:', err)
      window.alert('移除失败，请稍后重试')
    } finally {
      setRemovingId(null)
    }
  }

  const copy = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      window.prompt('复制下面的内容', text)
    }
  }

  const share = async () => {
    if (!inviteLink) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: '加入我的家庭',
          text: `用家庭码 ${family?.invite_code} 加入「${family?.name ?? '我的家'}」`,
          url: inviteLink,
        })
        return
      } catch {
        // 用户取消分享时静默返回
        return
      }
    }
    await copy(inviteLink, 'link')
  }

  return (
    <div className="flex flex-col gap-4 px-5">
      {/* 家庭码卡片 */}
      <section className="rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 px-5 py-5 text-white shadow-lg shadow-amber-200/70">
        <p className="text-center text-sm font-medium opacity-90">家庭邀请码</p>
        <p className="mt-1 text-center text-4xl font-black tracking-[0.25em] drop-shadow-sm">
          {family?.invite_code ?? '——'}
        </p>
        <p className="mt-2 text-center text-xs opacity-90">
          {family?.name ?? '我的家'} · 共 {members.length} 位成员
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => family && void copy(family.invite_code, 'code')}
            disabled={!family}
            className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-white/95 text-sm font-bold text-orange-500 transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {copied === 'code' ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === 'code' ? '已复制' : '复制家庭码'}
          </button>
          <button
            type="button"
            onClick={() => void share()}
            disabled={!inviteLink}
            className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-white/95 text-sm font-bold text-orange-500 transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {copied === 'link' ? <Check className="size-4" /> : <Share2 className="size-4" />}
            {copied === 'link' ? '链接已复制' : '分享邀请链接'}
          </button>
        </div>

        {inviteLink && (
          <p className="mt-3 break-all rounded-xl bg-white/20 px-3 py-2 text-[11px] leading-relaxed">
            {inviteLink}
          </p>
        )}
      </section>

      {/* 成员列表 */}
      <section className="rounded-3xl border bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-bold">家庭成员</h2>
          <span className="ml-auto text-xs text-muted-foreground">{members.length} 人</span>
        </div>

        {members.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            还没有成员，把上面的邀请链接发给家人吧
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-2xl bg-muted/40 px-3 py-3"
              >
                <span className="text-2xl" aria-hidden="true">
                  {iconOf(member)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {roleLabel(member.display_name, member.role)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    加入于 {formatDate(member.created_at)}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold',
                    member.role === 'child'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700',
                  )}
                >
                  {member.role === 'child' ? '孩子端' : '家长端'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemove(member)}
                  disabled={removingId === member.id}
                  aria-label={`移除 ${roleLabel(member.display_name, member.role)}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="pb-2 text-center text-xs leading-relaxed text-muted-foreground">
        一个家庭共用一份数据：成员看到的学科、任务、打卡、星星和商城都是同一个家的。
      </p>
    </div>
  )
}
