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

  let body: { fileName?: unknown; fileType?: unknown; subjectName?: unknown } | null = null
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

  // 文件名可能含中文/空格/斜杠，去掉路径分隔符与特殊字符后再生成 Key
  const safeName = rawName.replace(/[/\\:*?"<>|#%\s]+/g, '_').trim()
  // 按「学科(课程) / 年月」分目录：英语/2026-10/1723456789_reading.mp4
  const subject = sanitizeSegment(typeof body?.subjectName === 'string' ? body.subjectName : '') || '未分类'
  const fileKey = `${subject}/${currentMonth()}/${Date.now()}_${safeName}`

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
    publicUrl: `${publicBase}/${fileKey.split('/').map(uriEncode).join('/')}`,
    key: fileKey,
  })
}

/** 目录名清洗：去掉空格与 URL 特殊字符，保留中文/字母/数字/连字符 */
function sanitizeSegment(value: string): string {
  return value
    .replace(/[/\\:*?"<>|#%]+/g, ' ') // 路径与 URL 保留字符
    .replace(/\s+/g, '-') // 空格换连字符
    .replace(/^[-.]+|[-.]+$/g, '') // 去掉首尾的连字符/点
    .slice(0, 40)
}

/** 北京时间当月，形如 2026-10 */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  return `${year}-${month}`
}
