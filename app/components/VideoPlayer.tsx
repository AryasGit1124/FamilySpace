'use client'

import { forwardRef, type VideoHTMLAttributes } from 'react'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'

type VideoPlayerProps = Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  'src' | 'poster' | 'controls' | 'playsInline' | 'preload' | 'className'
> & {
  src: string
  poster?: string | null
  /** 外层容器（含下载按钮）的附加类名 */
  className?: string
  /** 视频黑框容器附加类名 */
  containerClassName?: string
  /** 下载按钮附加类名 */
  downloadClassName?: string
}

/** 统一的视频播放器：居中、黑边适配、移动端不强制全屏，并在下方提供下载按钮 */
export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer(
  { src, poster, className, containerClassName, downloadClassName, ...videoProps },
  ref,
) {
  return (
    <div className={cn('flex w-full flex-col gap-3', className)}>
      <div className={cn('mx-auto w-full overflow-hidden rounded-xl bg-black', containerClassName)}>
        <video
          {...videoProps}
          ref={ref}
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="mx-auto max-h-[70vh] w-full bg-black object-contain"
        />
      </div>
      <a
        href={src}
        download
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700',
          downloadClassName,
        )}
      >
        <Download className="size-4" aria-hidden="true" />
        下载视频到本地
      </a>
    </div>
  )
})
