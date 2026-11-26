import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { listenForInstall } from './lib/install'

listenForInstall()
// หน้าต่างที่ฟอร์มเปิดมาได้สำเนา sessionStorage ของฟอร์มติดมาด้วย · ไม่ลบ = ฟอร์มที่เปิดจากหน้านี้ทีหลังได้ใบเก่า และที่เก็บของแอปเต็ม
try { sessionStorage.removeItem('phappim-confirm-v1.tab') } catch { /* ที่เก็บถูกปิด */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
