'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { Header } from './Header'
import { SideMenu } from './SideMenu'

/**
 * 全局布局包装器：管理左侧抽屉开合；
 * 内容区为顶部 Header（h-16）和底部 TabBar 留出空间；
 * 孩子端不显示汉堡菜单和抽屉，登录页不显示全局框架。
 */
export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const pathname = usePathname()
  const { role } = useAuth()

  const isLogin = pathname === '/login'
  // 家长预览孩子端时按孩子端布局渲染（隐藏菜单与抽屉）
  const isParent = role === 'parent'

  useEffect(() => {
    setIsMenuOpen(false)
  }, [pathname])

  // 切换到孩子身份时立即关掉抽屉
  useEffect(() => {
    if (!isParent) setIsMenuOpen(false)
  }, [isParent])

  if (isLogin) return <>{children}</>

  return (
    <>
      <Header onMenuOpen={() => setIsMenuOpen(true)} />
      {isParent && <SideMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />}
      <div className="pt-16 pb-24">{children}</div>
    </>
  )
}
