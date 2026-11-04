/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // 局域网调试：允许手机通过 192.168.x.x / 10.x.x.x 等内网 IP 加载 dev 资源(HMR/JS)，
  // 否则 Next 会对跨源请求 /_next/* 返回 403，手机端只有 SSR 首屏、所有按钮失效
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
    '172.17.*.*',
    '172.18.*.*',
    '*.local',
  ],
  // ffmpeg.wasm 仅在浏览器端动态加载，排除出服务端打包
  serverExternalPackages: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
