/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    // 老 iPad（iPadOS < 15.4）不支持 @layer，会把整份样式表整块丢弃导致页面全裸。
    // 构建时把 cascade layers 展平（按层序自动补 :not(#\#) 提权），新老浏览器效果一致。
    '@csstools/postcss-cascade-layers': {},
  },
}

export default config
