import { Suspense } from 'react'
import LibraryClient from './library-client'

// useSearchParams 需要 Suspense 边界；页面本身由客户端组件承担
export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryClient />
    </Suspense>
  )
}
