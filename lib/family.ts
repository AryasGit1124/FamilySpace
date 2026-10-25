/**
 * 家庭上下文：当前家庭 id 的解析 + 家庭成员角色定义。
 *
 * 服务端（Server Component）没有 localStorage，所以登录后额外写一份 cookie，
 * 服务端渲染时直接读该 cookie；浏览器端优先用 AuthProvider 设置的 activeFamilyId，
 * 读不到再回退 cookie。
 *
 * 本文件同时被服务端和客户端引用，next/headers 必须用动态 import 且只在服务端分支执行。
 */

export type UserRole = 'parent' | 'child'

/** 登录时可选的家庭角色；图标与权限分组一一对应 */
export const FAMILY_ROLES = [
  { label: '爸爸', icon: '👨', role: 'parent' },
  { label: '妈妈', icon: '👩', role: 'parent' },
  { label: '爷爷', icon: '🧓', role: 'parent' },
  { label: '奶奶', icon: '👵', role: 'parent' },
  { label: '外公', icon: '🧔', role: 'parent' },
  { label: '外婆', icon: '👩‍🦳', role: 'parent' },
  { label: '孩子', icon: '🧒', role: 'child' },
] as const satisfies readonly { label: string; icon: string; role: UserRole }[]

export type FamilyRoleLabel = (typeof FAMILY_ROLES)[number]['label']

/** 角色名 → 权限分组（孩子端 / 家长端） */
export function permissionOf(label: string): UserRole {
  const found = FAMILY_ROLES.find((r) => r.label === label)
  return found ? found.role : 'parent'
}

/** 成员列表 / 页面标题展示用：优先 display_name，缺失时按权限分组兜底 */
export function roleLabel(displayName: string | null | undefined, role: UserRole): string {
  if (displayName) return displayName
  return role === 'child' ? '孩子' : '家长'
}

export const FAMILY_COOKIE = 'fs_family_id'

const DEVICE_PROFILES_KEY = 'fs_device_profiles'

type DeviceProfileEntry = {
  userId: string
  familyId: string
  displayName: string
}

function readDeviceProfiles(): DeviceProfileEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(DEVICE_PROFILES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (e): e is DeviceProfileEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as DeviceProfileEntry).userId === 'string' &&
        typeof (e as DeviceProfileEntry).familyId === 'string' &&
        typeof (e as DeviceProfileEntry).displayName === 'string',
    )
  } catch {
    return []
  }
}

/**
 * 查找当前设备上、同一家庭同一角色此前登录遗留的旧匿名用户 profile id。
 * 再次登录同一家庭同一角色时，把旧 profile 删掉，确保用户管理里只保留当前登录的一条。
 */
export function getStaleDeviceProfiles(
  familyId: string,
  displayName: string,
  currentUserId: string,
): string[] {
  return readDeviceProfiles()
    .filter(
      (e) =>
        e.familyId === familyId &&
        e.displayName === displayName &&
        e.userId !== currentUserId,
    )
    .map((e) => e.userId)
}

/** 登录成功后记录：当前设备在这个家庭下用哪个角色登录过，供下次登录去重 */
export function rememberDeviceProfile(entry: DeviceProfileEntry) {
  if (typeof window === 'undefined') return
  try {
    const next = readDeviceProfiles().filter(
      (e) => !(e.familyId === entry.familyId && e.displayName === entry.displayName),
    )
    next.push(entry)
    window.localStorage.setItem(DEVICE_PROFILES_KEY, JSON.stringify(next))
  } catch {
    // localStorage 不可用时忽略，不影响登录
  }
}

let activeFamilyId: string | null = null

function readCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${FAMILY_COOKIE}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}

function writeCookie(id: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${FAMILY_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
}

function removeCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${FAMILY_COOKIE}=; path=/; max-age=0; samesite=lax`
}

/** 浏览器端：AuthProvider 拿到 profile 后同步设置，顺便落 cookie 供服务端读取 */
export function setActiveFamilyId(id: string | null) {
  activeFamilyId = id
  if (id) writeCookie(id)
  else removeCookie()
}

/** 解析当前家庭 id；未登录 / 还没加入家庭时返回 null */
export async function resolveFamilyId(): Promise<string | null> {
  if (activeFamilyId) return activeFamilyId

  // 服务端：直接读当前请求的 cookie
  if (typeof window === 'undefined') {
    try {
      const { cookies } = await import('next/headers')
      return (await cookies()).get(FAMILY_COOKIE)?.value ?? null
    } catch {
      return null
    }
  }

  return readCookie()
}
