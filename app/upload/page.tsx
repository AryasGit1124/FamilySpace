import { Suspense } from 'react'
import UploadClient from './upload-client'

// useSearchParams 需要 Suspense 边界；页面本身由客户端组件承担
export default function UploadPage() {
  return (
    <Suspense>
      <UploadClient />
    </Suspense>
  )
}
