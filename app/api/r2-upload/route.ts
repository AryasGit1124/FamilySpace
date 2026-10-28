import { NextResponse } from 'next/server'
import { presignR2Url, readR2Config, uriEncode } from '@/lib/r2-sign'

/**
 * 生成 Cloudflare R2 的预签名 PUT 地址（SigV4）。
 * 前端拿到 uploadUrl 后直接 PUT 到 R2（不经过 Next.js 服务器），
 * publicUrl 用于写入 media 表的 file_url / thumb_url。
 */
export async function POST(request: Request) {
  const { accountId, accessKeyId, secretAccessKey, bucket, publicBase, missing } = readR2Config()
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `缺少 R2 环境变量：${missing.join('、')}（本地写在 .env.local，线上写在部署平台）` },
      { status: 500 },
    )
  }

  let body: { fileName?: unknown; fileType?: unknown } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const rawName = typeof body?.fileName === 'string' ? body.fileName : ''
  if (!rawName.trim()) {
    return NextResponse.json({ error: '缺少 fileName' }, { status: 400 })
  }
  const fileType = typeof body?.fileType === 'string' && body.fileType ? body.fileType : 'application/octet-stream'

  // 文件名可能含中文/空格/斜杠，先去掉路径分隔符再生成 Key
  const safeName = rawName.replace(/[/\\]/g, '_').trim()
  const fileKey = `${Date.now()}_${safeName}`

  const uploadUrl = presignR2Url({
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    key: fileKey,
    method: 'PUT',
    contentType: fileType,
    expiresIn: 3600,
  })

  return NextResponse.json({
    uploadUrl,
    publicUrl: `${publicBase}/${uriEncode(fileKey)}`,
    key: fileKey,
  })
}
