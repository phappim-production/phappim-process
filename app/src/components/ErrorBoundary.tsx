import { Component, type ErrorInfo, type ReactNode } from 'react'

// ส่วนใดพังต้องบอกผู้ใช้ว่าเกิดอะไรและทำอะไรต่อ ไม่ใช่เงียบ
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('หน้าจอส่วนนี้แสดงไม่ได้', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger-soft p-5 text-danger">
        <p className="text-lg font-bold">ส่วนนี้แสดงไม่ได้</p>
        <p className="mt-1 text-ink">กดโหลดใหม่ ถ้ายังไม่หายให้แจ้งเจ้าของระบบ</p>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-3 min-h-12 rounded-xl bg-danger px-5 font-semibold text-white">
          โหลดใหม่
        </button>
      </div>
    )
  }
}
