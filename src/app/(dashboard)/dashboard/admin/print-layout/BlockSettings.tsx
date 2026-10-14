'use client'
import { useRef } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold } from 'lucide-react'
import { PAPER_DOTS, PLACEHOLDERS } from '@/lib/printer/template/types'
import type { PaperWidth, TemplateBlock, TemplateKind, TextSize, TextStyle } from '@/lib/printer/template/types'

const SIZE_LABEL: Record<TextSize, string> = {
  normal: 'Normal',
  tall: 'Tall (2× height)',
  wide: 'Wide (2× width)',
  large: 'Large (2× both)',
}

const inputClass =
  'w-full rounded-lg border border-ink/10 bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-400'
const labelClass = 'block text-xs font-medium text-ink-muted mb-1'

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-ink" />
      {label}
    </label>
  )
}

function StyleControls({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const aligns = [
    { value: 'left', icon: AlignLeft, label: 'Align left' },
    { value: 'center', icon: AlignCenter, label: 'Align centre' },
    { value: 'right', icon: AlignRight, label: 'Align right' },
  ] as const
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <span className={labelClass}>Alignment</span>
        <div className="flex rounded-lg border border-ink/10 overflow-hidden">
          {aligns.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              aria-label={label}
              aria-pressed={style.align === value}
              onClick={() => onChange({ ...style, align: value })}
              className={`px-2.5 py-1.5 ${style.align === value ? 'bg-ink text-surface' : 'bg-surface text-ink-muted hover:text-ink'}`}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={labelClass}>Weight</span>
        <button
          type="button"
          aria-pressed={style.bold}
          onClick={() => onChange({ ...style, bold: !style.bold })}
          className={`flex items-center gap-1 rounded-lg border border-ink/10 px-2.5 py-1.5 text-sm ${style.bold ? 'bg-ink text-surface' : 'bg-surface text-ink-muted hover:text-ink'}`}
        >
          <Bold size={14} /> Bold
        </button>
      </div>
      <div>
        <label className={labelClass}>Size</label>
        <select
          value={style.size}
          onChange={(e) => onChange({ ...style, size: e.target.value as TextSize })}
          className={inputClass}
        >
          {(Object.keys(SIZE_LABEL) as TextSize[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
        </select>
      </div>
    </div>
  )
}

interface Props {
  block: TemplateBlock
  kind: TemplateKind
  paper: PaperWidth
  onChange: (block: TemplateBlock) => void
}

export default function BlockSettings({ block, kind, paper, onChange }: Props) {
  // Remembers which text field had focus so the field chips insert there.
  const lastField = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; key: 'text' | 'rightText' } | null>(null)

  function insertPlaceholder(key: string) {
    if (block.type !== 'text') return
    const target = lastField.current ?? null
    const field = target?.key ?? 'text'
    const current = block[field]
    const el = target?.el
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? current.length
    const token = `{${key}}`
    onChange({ ...block, [field]: current.slice(0, start) + token + current.slice(end) })
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const update = (patch: Partial<TemplateBlock>) => onChange({ ...block, ...patch } as TemplateBlock)

  return (
    <div className="space-y-4">
      <StyleControls style={block.style} onChange={(style) => update({ style })} />

      {block.type === 'text' && (
        <>
          <div>
            <label className={labelClass} htmlFor={`${block.id}-text`}>Text (new lines allowed)</label>
            <textarea
              id={`${block.id}-text`}
              rows={Math.min(4, Math.max(1, block.text.split('\n').length))}
              value={block.text}
              maxLength={500}
              onFocus={(e) => { lastField.current = { el: e.currentTarget, key: 'text' } }}
              onChange={(e) => update({ text: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${block.id}-right`}>Right side of the same line (optional)</label>
            <input
              id={`${block.id}-right`}
              value={block.rightText}
              maxLength={120}
              onFocus={(e) => { lastField.current = { el: e.currentTarget, key: 'rightText' } }}
              onChange={(e) => update({ rightText: e.target.value })}
              className={`${inputClass} font-mono`}
              placeholder="e.g. {date}"
            />
          </div>
          <div>
            <span className={labelClass}>Insert a field (tap to add at the cursor)</span>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS[kind].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.description}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertPlaceholder(p.key)}
                  className="rounded-md bg-surface-overlay px-2 py-1 text-xs font-mono text-ink-muted hover:text-ink hover:bg-brand-50"
                >
                  {`{${p.key}}`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint mt-1.5">
              A line whose fields are all empty is skipped - e.g. &quot;FSSAI NO - {'{fssai}'}&quot; doesn&apos;t print until an FSSAI number is set.
            </p>
          </div>
        </>
      )}

      {block.type === 'logo' && (
        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor={`${block.id}-width`}>
            Width: {block.widthDots} dots (~{Math.round(block.widthDots / 8)} mm)
          </label>
          <input
            id={`${block.id}-width`}
            type="range"
            min={64}
            max={PAPER_DOTS[paper]}
            step={8}
            value={Math.min(block.widthDots, PAPER_DOTS[paper])}
            onChange={(e) => update({ widthDots: Number(e.target.value) })}
            className="w-full accent-ink"
          />
          <p className="text-[11px] text-ink-faint mt-1">A logo never prints larger than the uploaded image.</p>
        </div>
      )}

      {block.type === 'divider' && (
        <div className="w-28">
          <label className={labelClass} htmlFor={`${block.id}-char`}>Line character</label>
          <input
            id={`${block.id}-char`}
            value={block.char}
            maxLength={1}
            onChange={(e) => update({ char: e.target.value.replace(/[^\x21-\x7e]/g, '') })}
            className={`${inputClass} font-mono text-center`}
            placeholder="-"
          />
        </div>
      )}

      {block.type === 'spacer' && (
        <div className="w-28">
          <label className={labelClass} htmlFor={`${block.id}-lines`}>Blank lines</label>
          <input
            id={`${block.id}-lines`}
            type="number"
            min={1}
            max={10}
            value={block.lines}
            onChange={(e) => update({ lines: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            className={inputClass}
          />
        </div>
      )}

      {block.type === 'items' && (
        <div className="space-y-2">
          <Toggle label="Show prices" checked={block.showPrices} onChange={(showPrices) => update({ showPrices })} />
          <Toggle label="Show add-ons under each item" checked={block.showAddons} onChange={(showAddons) => update({ showAddons })} />
        </div>
      )}

      {block.type === 'note' && (
        <div className="space-y-2">
          <div className="sm:max-w-xs">
            <label className={labelClass} htmlFor={`${block.id}-label`}>Label</label>
            <input id={`${block.id}-label`} value={block.label} maxLength={120} onChange={(e) => update({ label: e.target.value })} className={inputClass} />
          </div>
          <Toggle label="Label on its own line" checked={block.labelOnOwnLine} onChange={(labelOnOwnLine) => update({ labelOnOwnLine })} />
          <Toggle label="Divider line above (only when there is a note)" checked={block.dividerAbove} onChange={(dividerAbove) => update({ dividerAbove })} />
          <p className="text-[11px] text-ink-faint">Only prints when the order has a customer note.</p>
        </div>
      )}

      {block.type === 'taxLines' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor={`${block.id}-cgst`}>CGST label</label>
              <input id={`${block.id}-cgst`} value={block.cgstLabel} maxLength={120} onChange={(e) => update({ cgstLabel: e.target.value })} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${block.id}-sgst`}>SGST label</label>
              <input id={`${block.id}-sgst`} value={block.sgstLabel} maxLength={120} onChange={(e) => update({ sgstLabel: e.target.value })} className={`${inputClass} font-mono`} />
            </div>
          </div>
          <p className="text-[11px] text-ink-faint">{'{rate}'} is half the GST % (2.5 for 5% GST). Skipped when the bill has no tax.</p>
          <Toggle label="Divider line below" checked={block.dividerBelow} onChange={(dividerBelow) => update({ dividerBelow })} />
        </div>
      )}

      {block.type === 'upiQr' && (
        <div className="space-y-2">
          <div className="sm:max-w-xs">
            <label className={labelClass} htmlFor={`${block.id}-heading`}>Heading</label>
            <input id={`${block.id}-heading`} value={block.heading} maxLength={120} onChange={(e) => update({ heading: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:max-w-xs">
            <label className={labelClass} htmlFor={`${block.id}-qr`}>QR size: {block.qrSize}</label>
            <input
              id={`${block.id}-qr`}
              type="range"
              min={1}
              max={8}
              value={block.qrSize}
              onChange={(e) => update({ qrSize: Number(e.target.value) })}
              className="w-full accent-ink"
            />
          </div>
          <Toggle label="Show amount under the QR" checked={block.showAmount} onChange={(showAmount) => update({ showAmount })} />
          <p className="text-[11px] text-ink-faint">Only on bills that are not paid yet.</p>
        </div>
      )}

      {block.type === 'paymentStatus' && (
        <div className="space-y-2">
          <div className="sm:max-w-xs">
            <label className={labelClass} htmlFor={`${block.id}-heading`}>Heading</label>
            <input id={`${block.id}-heading`} value={block.heading} maxLength={120} onChange={(e) => update({ heading: e.target.value })} className={inputClass} />
          </div>
          <Toggle label="Show payment mode (UPI / Card / Cash)" checked={block.showMode} onChange={(showMode) => update({ showMode })} />
          <Toggle label="Show payment reference" checked={block.showRef} onChange={(showRef) => update({ showRef })} />
          <Toggle label="Show amount" checked={block.showAmount} onChange={(showAmount) => update({ showAmount })} />
          <p className="text-[11px] text-ink-faint">Only on bills printed after payment (replaces the UPI QR).</p>
        </div>
      )}
    </div>
  )
}
