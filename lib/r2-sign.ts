import { createHash, createHmac } from 'node:crypto'

/**
 * Cloudflare R2 预签名 URL（AWS SigV4）。
 * 与 @aws-sdk/s3-request-presigner 的签名结果一致，但只用 Node 内置 crypto，
 * 避免 Turbopack 把 aws-sdk 外部化导致构建产物缺失。
 */

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
const REGION = 'auto'

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** RFC 3986 编码（SigV4 要求），保留 A-Z a-z 0-9 - _ . ~ */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export type R2PresignParams = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  key: string
  method: 'PUT' | 'DELETE'
  /** 仅在 PUT 时参与签名；调用方 PUT 时必须发送同样的 Content-Type */
  contentType?: string
  expiresIn?: number
}

export function presignR2Url(params: R2PresignParams): string {
  const host = `${params.accountId}.r2.cloudflarestorage.com`
  // S3 对象路径形如 /<bucket>/<key>；Key 可能含斜杠，逐段编码后保留路径分隔符
  const canonicalUri = `/${uriEncode(params.bucket)}/${params.key.split('/').map(uriEncode).join('/')}`

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20261027T120000Z
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`

  const signedHeaders = params.contentType ? 'content-type;host' : 'host'
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${params.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(params.expiresIn ?? 3600),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  // 查询参数必须按 key 升序并以 RFC3986 编码拼接
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(queryParams[k])}`)
    .join('&')

  const canonicalHeaders = params.contentType
    ? `content-type:${params.contentType}\nhost:${host}\n`
    : `host:${host}\n`

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${params.secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request',
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/** 从 R2 环境变量读取配置，缺失时返回缺失项名称列表 */
export function readR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  const publicBase = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').replace(/\/+$/, '')

  const missing = [
    !accountId && 'R2_ACCOUNT_ID',
    !accessKeyId && 'R2_ACCESS_KEY_ID',
    !secretAccessKey && 'R2_SECRET_ACCESS_KEY',
    !bucket && 'R2_BUCKET_NAME',
    !publicBase && 'NEXT_PUBLIC_R2_PUBLIC_URL',
  ].filter(Boolean) as string[]

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBase, missing }
}
