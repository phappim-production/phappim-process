import { createClient } from '@supabase/supabase-js'

// ค่ามาจากไฟล์ .env.local (ดู .env.example) หรือ Environment variables ของ Cloudflare Pages
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

// anon key เป็นค่าที่เปิดเผยได้ (ความปลอดภัยมาจาก Row Level Security ในฐานข้อมูล)
// ห้ามใส่ service_role key ในฝั่งหน้าเว็บเด็ดขาด
export const supabase = isConfigured ? createClient(url!, anonKey!) : null
