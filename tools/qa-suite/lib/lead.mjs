// ใช้ไฟล์ TypeScript ของหน้าเว็บตัวจริง (Node ตัด type เอง · ไฟล์ .ts import กันโดยไม่ใส่นามสกุล)
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.') && !/\.\w+$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
        return next(`${specifier}.ts`, context)
      }
      throw err
    }
  },
})

const appFile = rel => import(new URL(`../../../app/src/${rel}`, import.meta.url).href)
const lead = await appFile('proto/leadTime.ts')
const menus = await appFile('auth/menus.ts')
const access = await appFile('auth/access.ts')

export const { leadDaysFor, leadDayN, LEAD_WARN_RATIO } = lead
export const { roleMenu, ROUTES } = menus
export const { canOpenPage } = access
