import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ติดตั้งบนแท็บเล็ต/มือถือได้ (Add to Home Screen)
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.webp', 'favicon.ico', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'ภาพพิมพ์ 142 · ติดตามการผลิต',
        short_name: 'PP142 ผลิต',
        description: 'ระบบติดตามการผลิตแบบ Real-time ของภาพพิมพ์ 142',
        lang: 'th',
        theme_color: '#0f4a42',
        background_color: '#f4f5f2',
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
