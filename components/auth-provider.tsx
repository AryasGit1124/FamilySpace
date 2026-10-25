'use client'

import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { setActiveFamilyId } from '@/lib/family'
import { supabase } from '@/lib/supabase'
import { fetchProfile, type ProfileRow, type UserRole } from '@/lib/supabase-queries'

type AuthContextValue = {
  user: User | null
  profile: ProfileRow | null
  /** 当前生效的角色：家长开启「孩子端预览」后为 child */
  role: UserRole | null
  /** 家长是否正在预览孩子端 */
  viewAsChild: boolean
  setViewAsChild: (next: boolean) => void
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** 全局登录状态：监听 Supabase Auth，未登录时重定向到 /login */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewAsChild, setViewAsChildState] = useState(false)

  /** 家长切到孩子端只影响界面展示，不改动数据库里的真实角色 */
  const setViewAsChild = useCallback((next: boolean) => setViewAsChildState(next), [])

  /** 有 session 就拉取 profiles；表里还没有记录时先用注册时写入的角色兜底 */
  const applySession = useCallback(async (nextUser: User | null) => {
    setUser(nextUser)
    if (!nextUser) {
      setProfile(null)
      setActiveFamilyId(null)
      return
    }

    const row = await fetchProfile(nextUser.id)
    if (row) {
      setProfile(row)
      setActiveFamilyId(row.family_id)
      return
    }

    const metaRole: UserRole = nextUser.user_metadata?.role === 'child' ? 'child' : 'parent'
    setActiveFamilyId(null)
    setProfile({
      id: nextUser.id,
      family_id: null,
      role: metaRole,
      display_name:
        typeof nextUser.user_metadata?.display_name === 'string'
          ? nextUser.user_metadata.display_name
          : null,
    })
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      void applySession(data.session?.user ?? null).finally(() => {
        if (active) setLoading(false)
      })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      // 延迟到回调外再查库，避免在 Supabase Auth 回调里发请求造成死锁
      setTimeout(() => {
        if (active) void applySession(session?.user ?? null)
      }, 0)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [applySession])

  // 全局路由守卫：未登录且不在登录页时强制跳转
  useEffect(() => {
    if (loading) return
    if (!user && pathname !== '/login') {
      router.replace('/login')
      return
    }

    // 已登录但还没绑定家庭：回登录页选身份 + 创建/加入家庭
    if (user && profile && !profile.family_id && pathname !== '/login') {
      router.replace('/login')
      return
    }

    // 孩子端不允许通过 URL 进入管理页面（资料库允许，老师布置的任务要看）
    const isAdminPath = pathname.startsWith('/settings') || pathname.startsWith('/upload')
    if (user && profile?.role === 'child' && isAdminPath) {
      router.replace('/')
    }
  }, [user, profile, loading, pathname, router])

  /** 登录/加入家庭写库后调用，重新读取当前 session 的 role、family_id 与家庭角色 */
  const refreshProfile = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.auth.getUser()
    if (!data.user) return
    setUser(data.user)
    const row = await fetchProfile(data.user.id)
    if (row) {
      setProfile(row)
      setActiveFamilyId(row.family_id)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setViewAsChildState(false)
    setActiveFamilyId(null)
    router.replace('/login')
  }, [router])

  const value = useMemo(() => {
    const effectiveRole: UserRole | null = viewAsChild ? 'child' : (profile?.role ?? null)
    return {
      user,
      profile,
      role: effectiveRole,
      viewAsChild,
      setViewAsChild,
      loading,
      refreshProfile,
      signOut,
    }
  }, [user, profile, viewAsChild, setViewAsChild, loading, refreshProfile, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内部使用')
  return context
}
