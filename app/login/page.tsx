'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { useAuth } from '@/components/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  FAMILY_ROLES,
  getStaleDeviceProfiles,
  permissionOf,
  rememberDeviceProfile,
  setActiveFamilyId,
  type FamilyRoleLabel,
} from '@/lib/family'
import { supabase } from '@/lib/supabase'
import {
  fetchFamilyByInviteCode,
  insertFamily,
  seedDefaultSubjects,
  upsertProfile,
  type UserRole,
} from '@/lib/supabase-queries'
import { cn } from '@/lib/utils'

type Mode = 'create' | 'join'

const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateInviteCode() {
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    code += INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)]
  }
  return code
}

function isDuplicateCodeError(err: unknown) {
  const code = (err as { code?: string }).code
  if (code === '23505') return true
  return err instanceof Error && /duplicate|unique/i.test(err.message)
}

/** 把 Supabase 原始报错翻译成能直接照着做的提示 */
function toFriendlyError(err: unknown) {
  const code = (err as { code?: string }).code
  const message = (err as { message?: string }).message ?? ''
  if (code === '42P17') {
    return '数据库策略互相引用导致递归（42P17），请在 Supabase SQL Editor 执行 scripts/enable-rls-strict.sql 修复'
  }
  if (code === '42P01') {
    return 'families / profiles 表不存在，请先在 Supabase SQL Editor 执行 scripts/create-auth-tables.sql'
  }
  if (code === '42501') {
    return '数据库权限不足（RLS 拦截），请确认已执行 scripts/enable-rls-strict.sql，且当前会话已登录'
  }
  if (code === 'PGRST301' || code === 'PGRST116') {
    return '查询被 RLS 策略拦截或没有返回数据，请检查 profiles / families 的策略'
  }
  if (code === 'PGRST202') {
    return '缺少 find_family_by_invite_code 函数，请执行 scripts/enable-rls-strict.sql'
  }
  if (code === 'PGRST204') {
    return `数据库字段和代码不一致（${message}），请执行 scripts/create-auth-tables.sql 补齐表结构`
  }
  if (/anonymous.*disabled/i.test(message)) {
    return 'Supabase 还没有开启匿名登录：请在 Authentication → Providers → Anonymous 中打开'
  }
  return message || (err instanceof Error ? err.message : String(err))
}

/** 拼出可复制的完整报错（Supabase 错误对象不可枚举，直接打印会是 {}） */
function describeError(err: unknown): string {
  const { code, message, details, hint } = err as {
    code?: string
    message?: string
    details?: string
    hint?: string
  }
  if (!code && !message && err instanceof Error) return err.message
  return [
    code ? `code=${code}` : '',
    message ? `message=${message}` : '',
    details ? `details=${details}` : '',
    hint ? `hint=${hint}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 某个步骤失败时抛出带步骤名的错误，方便 alert 里定位 */
function stageError(stage: string, err: unknown): Error {
  const friendly = toFriendlyError(err)
  const detail = describeError(err)
  const error = new Error(`${stage}失败：${friendly}${detail && detail !== friendly ? `\n${detail}` : ''}`)
  ;(error as Error & { code?: string }).code = (err as { code?: string }).code
  return error
}

/** alert 里给出可复制的完整信息，方便直接截图反馈 */
function formatAlert(action: string, message: string): string {
  return `${action}失败\n\n${message}\n\n（如仍无法解决，请把这段文字截图给开发者）`
}

/** Supabase 报错对象不可枚举，console.error 直接打印会是 {}，这里显式取出关键字段 */
function logError(label: string, err: unknown) {
  const { code, message, details, hint } = err as {
    code?: string
    message?: string
    details?: string
    hint?: string
  }
  console.error(label, { code, message, details, hint })
}

/** 已登录就复用当前匿名用户，否则创建一个新的匿名用户（无需邮箱） */
async function ensureAnonymousUser(
  client: SupabaseClient,
  role: UserRole,
  displayName: string,
): Promise<User> {
  const {
    data: { session },
  } = await client.auth.getSession()
  if (session?.user) return session.user

  const { data, error } = await client.auth.signInAnonymously({
    options: { data: { role, display_name: displayName } },
  })
  if (error) {
    if (/anonymous.*disabled|anonymous sign-ins are disabled/i.test(error.message)) {
      throw new Error('Supabase 还没有开启匿名登录：请在 Authentication → Providers → Anonymous 中打开')
    }
    throw stageError('匿名登录', error)
  }
  if (!data.user) throw new Error('匿名登录失败：没有返回用户信息，请稍后重试')
  // 会话必须立刻落 cookie，否则后续 families/profiles 的写入会以未登录身份被 RLS 拦截
  if (!data.session) throw new Error('匿名登录失败：没有拿到会话（session 为空），请检查 Supabase URL / Key 配置')
  return data.user
}

/**
 * 登录成功后：删除本设备此前在同一家庭同一角色下遗留的旧匿名 profile，
 * 并记录当前登录，保证用户管理里同一家庭同一角色同一设备只有一条数据。
 */
async function dedupeDeviceProfile(
  client: SupabaseClient,
  familyId: string,
  displayName: string,
  userId: string,
) {
  const staleIds = getStaleDeviceProfiles(familyId, displayName, userId)
  for (const staleId of staleIds) {
    const { error } = await client.from('profiles').delete().eq('id', staleId)
    if (error) console.warn('[Login] 清理旧 profile 失败:', error.message)
  }
  rememberDeviceProfile({ userId, familyId, displayName })
}

export default function LoginPage() {
  const router = useRouter()
  const { refreshProfile } = useAuth()
  const [selectedRole, setSelectedRole] = useState<FamilyRoleLabel>('妈妈')
  const [inviteCode, setInviteCode] = useState('LUT4ZQ')
  const [busy, setBusy] = useState<Mode | null>(null)
  /** 同步锁：网络慢时家长连点也不会触发第二次写入 */
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [fromLink, setFromLink] = useState(false)
  /** 默认选中「加入家庭」，第一次使用的人再切到「创建新家庭」 */
  const [mode, setMode] = useState<Mode>('join')

  // 别人分享的邀请链接形如 /login?code=ABC123，打开后自动填好邀请码
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return
    setInviteCode(code.trim().toUpperCase().slice(0, 6))
    setFromLink(true)
  }, [])

  /** 创建新家庭：匿名登录 → 生成邀请码建家庭 → 默认学科 → 绑定 profiles */
  const handleCreate = async () => {
    if (busyRef.current) return
    if (!supabase) {
      setError('Supabase 未初始化，请检查 .env.local 配置')
      return
    }

    busyRef.current = true
    setBusy('create')
    setError('')
    let stage = '匿名登录'
    try {
      const permission = permissionOf(selectedRole)
      const user = await ensureAnonymousUser(supabase, permission, selectedRole)

      let familyId = ''
      let code = ''
      stage = '创建家庭（families.insert）'
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const nextCode = generateInviteCode()
        try {
          const family = await insertFamily({ name: '我的家', invite_code: nextCode })
          familyId = family.id
          code = nextCode
          break
        } catch (err) {
          if (!isDuplicateCodeError(err)) throw err
        }
      }
      if (!familyId) throw new Error('邀请码生成失败（连续 5 次重复），请稍后重试')

      // 先绑定 profile（RLS 策略依赖 profiles.family_id 判定当前家庭），
      // 再写默认学科，否则 subjects 的写入会被 RLS 拦截
      stage = '绑定家长身份（profiles.upsert）'
      await upsertProfile({
        id: user.id,
        family_id: familyId,
        role: permission,
        display_name: selectedRole,
      })
      stage = '清理旧设备记录（profiles.delete）'
      await dedupeDeviceProfile(supabase, familyId, selectedRole, user.id)

      // 新家庭默认带上语文/数学/英语等学科，失败不阻塞建家庭
      await seedDefaultSubjects(familyId).catch((err: unknown) => {
        console.warn('[Login] 默认学科写入失败:', err)
      })

      setActiveFamilyId(familyId)
      await refreshProfile()

      window.alert(`家庭创建成功！邀请码：${code}\n把邀请码发给家人，就能一起加入这个家。`)
      router.replace('/')
    } catch (err) {
      logError(`[Login] ${stage}失败:`, err)
      const message = stageError(stage, err).message
      setError(message)
      window.alert(formatAlert('创建家庭', message))
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  /** 加入已有家庭：匿名登录 → 邀请码查家庭 → 绑定 profiles */
  const handleJoin = async () => {
    if (busyRef.current) return
    if (!inviteCode.trim()) {
      setError('请输入家庭邀请码')
      return
    }
    if (!supabase) {
      setError('Supabase 未初始化，请检查 .env.local 配置')
      return
    }

    busyRef.current = true
    setBusy('join')
    setError('')
    let stage = '匿名登录'
    try {
      const permission = permissionOf(selectedRole)
      const user = await ensureAnonymousUser(supabase, permission, selectedRole)

      stage = '查询家庭（邀请码）'
      const family = await fetchFamilyByInviteCode(inviteCode.trim().toUpperCase())
      if (!family) throw new Error('邀请码不存在，请确认后重试')

      stage = '绑定家长身份（profiles.upsert）'
      await upsertProfile({
        id: user.id,
        family_id: family.id,
        role: permission,
        display_name: selectedRole,
      })
      stage = '清理旧设备记录（profiles.delete）'
      await dedupeDeviceProfile(supabase, family.id, selectedRole, user.id)
      setActiveFamilyId(family.id)
      await refreshProfile()
      router.replace('/')
    } catch (err) {
      logError(`[Login] ${stage}失败:`, err)
      const message = stageError(stage, err).message
      setError(message)
      window.alert(formatAlert('加入家庭', message))
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-amber-50 via-orange-50 to-white px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-5xl" aria-hidden="true">
            ⭐
          </p>
          <h1 className="mt-3 text-2xl font-black text-gray-800">我的学习台</h1>
          <p className="mt-1 text-sm text-muted-foreground">不用邮箱，选好身份就能开始</p>
        </div>

        <div className="rounded-3xl border border-amber-100 bg-white/95 p-5 shadow-lg shadow-amber-100/60">
          {/* 身份选择：7 种家庭角色，孩子走孩子端，其余走家长端 */}
          <p className="mb-2 text-sm font-semibold">我是</p>
          <div className="grid grid-cols-4 gap-2">
            {FAMILY_ROLES.map((option) => {
              const active = selectedRole === option.label
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedRole(option.label)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-2xl border-2 px-1 py-2 transition-colors',
                    active
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-100 bg-white text-muted-foreground',
                  )}
                >
                  <span className="text-xl" aria-hidden="true">
                    {option.icon}
                  </span>
                  <span className={cn('text-xs font-bold', active && 'text-amber-600')}>
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 模式切换：默认加入家庭，排在第一；创建新家庭放后面 */}
          <div role="tablist" aria-label="选择登录方式" className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-amber-50 p-1">
            {([
              { value: 'join' as const, label: '加入家庭' },
              { value: 'create' as const, label: '创建新家庭' },
            ]).map((tab) => {
              const active = mode === tab.value
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setMode(tab.value)
                    setError('')
                  }}
                  className={cn(
                    'rounded-xl py-2 text-sm font-bold transition-colors',
                    active ? 'bg-white text-amber-700 shadow-sm' : 'text-amber-700/60',
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {mode === 'join' ? (
            <div className="mt-4 flex flex-col gap-2">
              <Label htmlFor="login-invite">家庭邀请码</Label>
              <Input
                id="login-invite"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="ABC123（加入已有家庭时填写）"
                maxLength={6}
                className="tracking-[0.2em]"
              />
              {fromLink && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  已从邀请链接读取家庭码，确认身份后点「加入已有家庭」即可。
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              创建后会生成 6 位邀请码，把它发给家人，其他设备凭码加入。
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {mode === 'join' ? (
              <Button
                type="button"
                className="h-12 w-full rounded-2xl text-base font-bold"
                onClick={() => void handleJoin()}
                disabled={busy !== null}
              >
                {busy === 'join' ? '正在加入…' : '加入已有家庭'}
              </Button>
            ) : (
              <Button
                type="button"
                className="h-12 w-full rounded-2xl text-base font-bold"
                onClick={() => void handleCreate()}
                disabled={busy !== null}
              >
                {busy === 'create' ? '正在创建…' : '创建新家庭'}
              </Button>
            )}
          </div>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            已有家庭码请用「加入家庭」；第一次使用请切到「创建新家庭」。
          </p>
        </div>
      </div>
    </div>
  )
}
