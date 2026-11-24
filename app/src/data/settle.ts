// หลังกดบันทึก: รอรอบโหลดที่เริ่มหลังบันทึกเสร็จ (ซึ่งเห็นข้อมูลที่เพิ่งบันทึกแน่นอน) แทนการสั่งโหลดเองซ้ำกับรอบที่ Realtime สั่ง
export type Settler = {
  loadStarted: () => number
  loadFinished: (index: number) => void
  wait: () => { after: number; done: Promise<void> }
  waiting: () => number
}

export function createSettler(): Settler {
  let started = 0
  let waiters: { after: number; resolve: () => void }[] = []
  return {
    loadStarted: () => ++started,
    loadFinished(index) {
      const ready = waiters.filter(w => w.after < index)
      waiters = waiters.filter(w => w.after >= index)
      for (const w of ready) w.resolve()
    },
    wait() {
      const after = started
      let resolve: () => void = () => {}
      const done = new Promise<void>(r => { resolve = r })
      waiters.push({ after, resolve })
      return { after, done }
    },
    waiting: () => waiters.length,
  }
}
