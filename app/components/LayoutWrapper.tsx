'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { useAppState } from '@/components/app-state-provider'
import { shouldHideBottomTab } from '@/lib/utils'
import { Header } from './Header'
import { SideMenu } from './SideMenu'

/**
 * 全局布局包装器：左侧抽屉开合状态由 AppStateProvider 统一管理。
 * 底部 Tab 是否显示只由路由决定（见 shouldHideBottomTab），与抽屉状态无关；
 * 抽屉打开时仅用遮罩盖住 Tab，不会让 Tab 卸载。
 * 孩子端不显示汉堡菜单和抽屉，登录页不显示全局框架。
 */
export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { role } = useAuth()
  const { isMenuOpen, openMenu, closeMenu } = useAppState()

  const isLogin = pathname === '/login'
  // 家长管理页不渲染底部 Tab，内容区不再为 Tab 留 96px 空位
  const hideBottomTab = shouldHideBottomTab(pathname)
  // 家长预览孩子端时按孩子端布局渲染（隐藏菜单与抽屉）
  const isParent = role === 'parent'

  // 路由切换时关闭抽屉，避免进入新页面后抽屉还开着
  useEffect(() => {
    closeMenu()
  }, [pathname, closeMenu])

  // 切到孩子端时抽屉会卸载，重置状态避免切回家长端时抽屉意外处于展开
  useEffect(() => {
    if (!isParent) closeMenu()
  }, [isParent, closeMenu])

  if (isLogin) return <>{children}</>

  return (
    <>
      <Header onMenuOpen={openMenu} />
      {isParent && <SideMenu isOpen={isMenuOpen} onClose={closeMenu} />}
      <div className={hideBottomTab ? 'pt-16 pb-8' : 'pt-16 pb-24'}>{children}</div>
    </>
  )
}
