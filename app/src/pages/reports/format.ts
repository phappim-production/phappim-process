const thaiDate = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' })

export function formatReportDate(at: number | string) {
  const date = typeof at === 'number' ? new Date(at) : new Date(at.length === 10 ? `${at}T00:00:00+07:00` : at)
  return thaiDate.format(date)
}
