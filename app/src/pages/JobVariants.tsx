import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { specMockups, specVariants, type Variant } from '../data/jobMockups'
import { mockupThumbUrl, signMockups } from '../data/mockups'
import { Tr } from '../i18n/Tr'
import { useT } from '../i18n/lang'
import { IconImage } from '../components/icons'
import type { Job } from '../proto/model'

type Pic = { no: number; name: string; url: string | null }
type Loaded = { variants: Variant[]; pics: Pic[] }

async function loadVariants(jobId: string): Promise<Loaded | 'error'> {
  if (!supabase) return { variants: [], pics: [] }
  const { data, error } = await supabase.from('jobs').select('spec, mockup_path').eq('id', jobId).single()
  if (error) return 'error'
  const row = data as { spec: unknown; mockup_path: string | null }
  const list = specMockups(row.spec, row.mockup_path)
  const urls = await signMockups(list.map(m => m.path))
  return { variants: specVariants(row.spec, list.length), pics: list.map((m, i) => ({ no: i + 1, name: m.name, url: urls.get(m.path) ?? null })) }
}

function Thumb({ pic, size }: { pic: Pic | undefined; size: string }) {
  const t = useT()
  const box = `${size} grid shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-paper text-muted`
  if (!pic?.url) return <span className={box}><IconImage className="size-6" /></span>
  return (
    <a href={pic.url} target="_blank" rel="noreferrer" className={box} aria-label={t('เปิดรูป {n} เต็มจอ', { n: pic.no })}>
      <img src={mockupThumbUrl(pic.url)} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
    </a>
  )
}

// แสดงเมื่องานมีหลายแบบ หรือมีรูปมากกว่า 1 รูป · งานแบบเดียวรูปเดียวดูจากรูปด้านบนพอ
export function JobVariants({ job }: { job: Pick<Job, 'id' | 'unit'> & Partial<Pick<Job, 'qty' | 'mockup'>> }) {
  const t = useT()
  const [data, setData] = useState<Loaded | 'error' | null>(null)
  useEffect(() => {
    let alive = true
    void loadVariants(job.id).then(r => { if (alive) setData(r) })
    return () => { alive = false }
  }, [job.id, job.qty, job.mockup])

  if (data === null) return <p className="text-muted"><Tr inline th="กำลังโหลดแบบและรูปของงาน…" /></p>
  if (data === 'error') return <p role="alert" className="text-danger"><Tr inline th="โหลดแบบและรูปของงานไม่ได้ ปิดแล้วเปิดงานนี้อีกครั้ง" /></p>
  const { variants, pics } = data
  if (variants.length <= 1 && pics.length <= 1 && !variants.some(v => v.img && v.img > 1)) return null

  return (
    <div className="grid gap-4 rounded-2xl border border-line bg-card p-4 shadow-card">
      {variants.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold"><Tr inline th="แบบในงานนี้ ({n} แบบ)" vars={{ n: variants.length }} /></h3>
          <ul className="divide-y divide-line">
            {variants.map((v, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Thumb pic={v.img ? pics[v.img - 1] : undefined} size="size-16" />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{[v.name, v.color].filter(Boolean).join(' · ') || t('แบบที่ {n}', { n: i + 1 })}</p>
                  {v.sizes && <p className="break-words text-muted">{v.sizes}</p>}
                  {v.img && <p className="text-muted">{t('รูป {n}', { n: v.img })}</p>}
                </div>
                <span className="shrink-0 font-bold">{v.qty.toLocaleString('th-TH')} {t(job.unit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pics.length > 1 && (
        <section>
          <h3 className="mb-2 font-semibold"><Tr inline th="รูปม็อคอัพทั้งหมด ({n} รูป)" vars={{ n: pics.length }} /></h3>
          <ul className="grid grid-cols-3 gap-2">
            {pics.map(p => (
              <li key={p.no} className="grid justify-items-center gap-1 text-center">
                <Thumb pic={p} size="aspect-square w-full" />
                <span className="w-full break-words text-sm text-muted">{t('รูป {n}', { n: p.no })}{p.name ? ` · ${p.name}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
