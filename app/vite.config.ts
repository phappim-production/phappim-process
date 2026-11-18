import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ฟอร์มใบยืนยันการผลิตเป็นไฟล์เดียวที่รากโปรเจกต์ (แก้ที่เดียว) · คัดลอกขึ้นเว็บเดียวกันที่ /confirmation.html
// ให้แอดมินกดเปิดจากหน้ารับงานได้ ไม่ต้องมีไฟล์ในเครื่อง · Cloudflare Pages ตัด .html → ลิงก์ใช้ /confirmation
const CONFIRMATION_FORM = '/confirmation.html'
const formSource = fileURLToPath(new URL('../production-confirmation.html', import.meta.url))
function confirmationForm(): Plugin {
  return {
    name: 'pp142-confirmation-form',
    configureServer(server) {
      server.middlewares.use('/confirmation', (_req, res) => {   // ครอบ /confirmation และ /confirmation.html
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(readFileSync(formSource, 'utf8'))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: CONFIRMATION_FORM.slice(1), source: readFileSync(formSource, 'utf8') })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    confirmationForm(),
    // ติดตั้งบนแท็บเล็ต/มือถือได้ (Add to Home Screen)
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['logo.webp', 'favicon.ico', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png'],
      // ไม่ให้ service worker ตอบหน้าแอปแทนฟอร์มใบยืนยัน / หน้าเก็บสเปกสินค้า (หน้าแยก ไม่ใช่เส้นทางของแอป)
      workbox: { navigateFallbackDenylist: [/^\/confirmation(\.html)?$/, /^\/spec-check(\.html)?$/] },
      manifest: {
        name: 'ภาพพิมพ์ 142 · ติดตามการผลิต',
        short_name: 'PP142 ผลิต',
        description: 'ระบบติดตามการผลิตแบบ Real-time ของภาพพิมพ์ 142',
        lang: 'th',
        theme_color: '#0f4a42',
        background_color: '#f2f4f3',
        display: 'standalone',
        start_url: '/',
        // ไอคอนสร้างจากโลโก้ด้วย assets/make_icons.py
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
