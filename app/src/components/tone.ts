export type Tone = 'danger' | 'warn' | 'info' | 'ok' | 'brand' | 'neutral' | 'dtf'
export const TONE: Record<Tone, { text: string; soft: string; dot: string }> = {
  danger: { text: 'text-danger', soft: 'bg-danger-soft text-danger', dot: 'bg-danger' },
  warn: { text: 'text-warn', soft: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  info: { text: 'text-info', soft: 'bg-info-soft text-info', dot: 'bg-info' },
  ok: { text: 'text-ok', soft: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  brand: { text: 'text-brand', soft: 'bg-brand-soft text-brand', dot: 'bg-brand' },
  neutral: { text: 'text-muted', soft: 'bg-paper text-muted', dot: 'bg-muted/50' },
  dtf: { text: 'text-dtf', soft: 'bg-dtf-soft text-dtf', dot: 'bg-dtf' },
}
