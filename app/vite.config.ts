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
      includeAssets: ['logo.webp'],
      manifest: {
        name: 'ภาพพิมพ์ 142 · ติดตามการผลิต',
        short_name: 'PP142 ผลิต',
        description: 'ระบบติดตามการผลิตแบบ Real-time ของภาพพิมพ์ 142',
        lang: 'th',
        theme_color: '#0f4a42',
        background_color: '#f4f5f2',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
})
