/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // ffmpeg.wasm 仅在浏览器端动态加载，排除出服务端打包
  serverExternalPackages: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', 'msedge-tts', 'ws'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
