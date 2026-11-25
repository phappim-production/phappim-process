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
  build: {
    rolldownOptions: {
      output: {
        // ไลบรารีไม่เปลี่ยนทุกครั้งที่ขึ้นเว็บ · แยกไฟล์ให้เครื่องหน้างานไม่ต้องโหลดซ้ำหลัง deploy
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    confirmationForm(),
    // ติดตั้งบนแท็บเล็ต/มือถือได้ (Add to Home Screen)
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['logo.webp', 'favicon.ico', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png'],
      // ฟอร์มใบยืนยัน / หน้าเก็บสเปก / หน้าสลับบัญชีของระบบจำลอง เป็นหน้าแยก · workbox เทียบทั้ง path และ ?query จึงต้องรับ ?… ด้วย
      workbox: {
        navigateFallbackDenylist: [/^\/confirmation(\.html)?(\?|$)/, /^\/spec-check(\.html)?(\?|$)/, /^\/__qa\//],
        // ฟอนต์มาจาก Google ไม่อยู่ในไฟล์ของแอป · เก็บไว้ในเครื่องให้เปิดแอปตอนเน็ตช้า/หลุดแล้วตัวอักษรยังถูกแบบ
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css', expiration: { maxEntries: 8 } } },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//, handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-files', cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 60, maxAgeSeconds: 365 * 24 * 60 * 60 } },
          },
        ],
      },
      manifest: {
        name: 'ภาพพิมพ์ 142 · ติดตามการผลิต',
        short_name: 'PP142 ผลิต',
        description: 'ระบบติดตามการผลิตแบบ Real-time ของภาพพิมพ์ 142',
        lang: 'th',
        theme_color: '#0b3e3d',
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
