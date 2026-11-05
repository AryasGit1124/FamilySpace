import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 底部 Tab 栏只由「路由」决定是否渲染，与侧边栏开合状态无关。
 * 家长管理页不显示底部 Tab；孩子学习 / 娱乐页（/、/chinese、/math、/english、
 * /logic、/adventure、/store 及其子路由）以及其他页面正常显示。
 */
const HIDE_BOTTOM_TAB_PREFIXES = ['/upload', '/library', '/stats', '/parent', '/settings', '/growth']

export function shouldHideBottomTab(pathname: string): boolean {
  if (pathname === '/login') return true
  return HIDE_BOTTOM_TAB_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
