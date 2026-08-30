import { AlertTriangle } from 'lucide-react'

// Never use window.confirm() for destructive actions in this app — the
// staff APK wraps the dashboard in an Android WebView with no
// WebChromeClient configured, so window.confirm() silently returns false
// with no dialog shown at all, and the action just does nothing.
export function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }: {
  title: string; message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-3 mb-3">
            <div className="p-2 rounded-xl bg-red-50 shrink-0"><AlertTriangle size={18} className="text-red-600" /></div>
            <div>
              <h3 className="font-semibold text-ink text-base">{title}</h3>
              <p className="text-ink-muted text-sm mt-1">{message}</p>
            </div>
          </div>
        </div>
        <div className="flex border-t border-ink/8">
          <button onClick={onCancel} className="flex-1 py-3.5 text-sm font-medium text-ink-muted hover:bg-surface-overlay transition-colors">Cancel</button>
          <div className="w-px bg-ink/8" />
          <button onClick={onConfirm} className="flex-1 py-3.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
