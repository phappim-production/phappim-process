import type { Word } from '../i18n/lang'

export const skipQueueHead = (firstNo: string): Word => ({ th: 'งานนี้ยังไม่ถึงคิว (คิวแรกคือ {first}) · ใส่เหตุผลที่ต้องเริ่มก่อน', vars: { first: firstNo } })
export const SKIP_QUEUE_PLACEHOLDER = 'เช่น ผ้างานคิวแรกยังไม่มา'
