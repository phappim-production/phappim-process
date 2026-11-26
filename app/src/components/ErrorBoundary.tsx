import { Component, type ErrorInfo, type ReactNode } from 'react'
import { browserReloadDeps, isStaleBuildError, reloadForStaleBuild } from './staleBuild'

type State = { failed: boolean; reloading: boolean }

// ส่วนใดพังต้องบอกผู้ใช้ว่าเกิดอะไรและทำอะไรต่อ ไม่ใช่เงียบ
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, reloading: false }

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, reloading: isStaleBuildError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleBuildError(error) && reloadForStaleBuild(browserReloadDeps())) return
    if (this.state.reloading) this.setState({ reloading: false })
    console.error('หน้าจอส่วนนี้แสดงไม่ได้', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (this.state.reloading) {
      return (
        <div role="status" className="rounded-2xl border border-info/40 bg-info-soft p-5 text-info">
          <p className="text-lg font-bold">กำลังโหลดระบบรุ่นใหม่… · စနစ်အသစ် ဖွင့်နေတယ်…</p>
          <p className="mt-1 text-ink">ระบบเพิ่งอัปเดต รอสักครู่ · ခဏစောင့်ပါ</p>
        </div>
      )
    }
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger-soft p-5 text-danger">
        <p className="text-lg font-bold">ส่วนนี้แสดงไม่ได้ · ဒီအပိုင်း ပြလို့ မရဘူး</p>
        <p className="mt-1 text-ink">กดโหลดใหม่ ถ้ายังไม่หายให้แจ้งเจ้าของระบบ · ပြန်ဖွင့်ကြည့်ပါ</p>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-3 min-h-12 rounded-xl bg-danger px-5 font-semibold text-white">
          โหลดใหม่ · ပြန်ဖွင့်မယ်
        </button>
      </div>
    )
  }
}
