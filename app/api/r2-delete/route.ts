import { NextResponse } from 'next/server'
import { presignR2Url, readR2Config } from '@/lib/r2-sign'

/**
 * 删除 R2 上的资料文件（视频/图片 + 封面）。
 * 接收 { fileUrl, coverUrl }，由服务端逐条执行 DELETE。
 * - 某个文件不存在或删除失败不会中断整体流程，失败项在 failed 里返回
 * - 调用方（前端）应在拿到响应后再删除 media 表记录
 */
export async function POST(request: Request) {
  const { accountId, accessKeyId, secretAccessKey, bucket, missing } = readR2Config()
  const needKeys = missing.filter((name) => name !== 'NEXT_PUBLIC_R2_PUBLIC_URL')
  if (needKeys.length > 0) {
    return NextResponse.json(
      { error: `缺少 R2 环境变量：${needKeys.join('、')}（本地写在 .env.local，线上写在部署平台）` },
      { status: 500 },
    )
  }

  let body: { fileUrl?: unknown; coverUrl?: unknown } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const fileUrl = typeof body?.fileUrl === 'string' ? body.fileUrl.trim() : ''
  const coverUrl = typeof body?.coverUrl === 'string' ? body.coverUrl.trim() : ''
  if (!fileUrl && !coverUrl) {
    return NextResponse.json({ error: '缺少 fileUrl / coverUrl' }, { status: 400 })
  }

  const config = {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
  }

  const deleted: string[] = []
  const failed: { url: string; error: string }[] = []

  // 逐个删除，互不影响
  for (const url of [fileUrl, coverUrl].filter(Boolean)) {
    const key = extractObjectKey(url)
    if (!key) {
      failed.push({ url, error: '无法从链接解析出对象 Key' })
      continue
    }
    try {
      const deleteUrl = presignR2Url({ ...config, key, method: 'DELETE', expiresIn: 300 })
      const res = await fetch(deleteUrl, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      deleted.push(key)
    } catch (err) {
      failed.push({ url, error: err instanceof Error ? err.message : String(err) })
    }
  }

  if (failed.length > 0) {
    console.warn('[r2-delete] 部分文件删除失败:', failed)
  }

  return NextResponse.json({ ok: true, deleted, failed })
}

/** 从公开访问地址中取出对象 Key（去掉域名与开头的斜杠，并解码） */
function extractObjectKey(fileUrl: string): string | null {
  let pathname: string
  try {
    pathname = new URL(fileUrl).pathname
  } catch {
    return null
  }
  let key: string
  try {
    key = decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch {
    key = pathname.replace(/^\/+/, '')
  }
  if (!key || key.split('/').some((seg) => seg === '..' || seg === '.')) return null
  return key
}
