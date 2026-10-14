'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ChevronDown, ChevronUp, GripVertical, Lock, Plus, Printer, RotateCcw, Save, Trash2, Upload, AlertTriangle,
} from 'lucide-react'
import { ConfirmModal } from '@/components/dashboard/ConfirmModal'
import { renderTicket, placeholdersIn } from '@/lib/printer/template/render'
import { BLOCK_TYPE_LABEL, ADDABLE_BLOCK_TYPES, newBlock } from '@/lib/printer/template/defaults'
import { DEFAULT_LOGO } from '@/lib/printer/template/defaultLogo'
import { validateTemplate } from '@/lib/printer/template/validate'
import { sampleTicketData } from '@/lib/printer/template/sample'
import { FONT_COLUMNS, PAPER_DOTS, REQUIRED_BLOCK_IDS } from '@/lib/printer/template/types'
import type { PrintTemplate, TemplateBlock, TemplateKind, BlockType } from '@/lib/printer/template/types'
import type { StoredTemplate } from '@/lib/printTemplates'
import BlockSettings from './BlockSettings'
import TicketPreview from './TicketPreview'
import { imageFileToLogo } from './logoUpload'

type Station = 'kitchen' | 'beverage_counter'

const KIND_LABEL: Record<TemplateKind, string> = { bill: 'Customer bill', kot: 'Kitchen ticket (KOT)' }
const STATION_LABEL: Record<Station, string> = { kitchen: 'Kitchen printer', beverage_counter: 'Barista / bill printer' }

interface Props {
  initial: Record<TemplateKind, StoredTemplate>
  fssaiNumber: string | null
}

function blockSummary(block: TemplateBlock): string {
  switch (block.type) {
    case 'text': {
      const first = block.text.split('\n')[0]
      return block.rightText ? `${first}  …  ${block.rightText}` : first
    }
    case 'divider': return block.char.repeat(12)
    case 'spacer': return `${block.lines} blank line${block.lines === 1 ? '' : 's'}`
    case 'logo': return `${block.widthDots} dots wide`
    case 'items': return block.showPrices ? 'Name, quantity and price' : 'Name and quantity'
    case 'note': return block.label || 'Customer note'
    case 'taxLines': return `${block.cgstLabel} / ${block.sgstLabel}`
    case 'upiQr': return block.heading || 'QR code'
    case 'paymentStatus': return block.heading || 'Payment details'
  }
}

const sectionClass = 'bg-surface-raised rounded-2xl border border-ink/5 p-4'
const smallButton =
  'flex items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-1.5 text-sm text-ink hover:bg-surface-overlay disabled:opacity-40 disabled:hover:bg-transparent'

export default function PrintLayoutClient({ initial, fssaiNumber }: Props) {
  const [kind, setKind] = useState<TemplateKind>('bill')
  const [drafts, setDrafts] = useState<Record<TemplateKind, PrintTemplate>>({
    bill: initial.bill.template,
    kot: initial.kot.template,
  })
  const [saved, setSaved] = useState<Record<TemplateKind, StoredTemplate>>(initial)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewPaid, setPreviewPaid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [testStation, setTestStation] = useState<Record<TemplateKind, Station>>({ bill: 'beverage_counter', kot: 'kitchen' })
  const [testing, setTesting] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const draft = drafts[kind]
  const dirty = (k: TemplateKind) => JSON.stringify(drafts[k]) !== JSON.stringify(saved[k].template)
  const anyDirty = dirty('bill') || dirty('kot')

  // Warn before leaving the page with unsaved layout changes.
  useEffect(() => {
    if (!anyDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [anyDirty])

  const validation = useMemo(() => validateTemplate(draft, kind), [draft, kind])
  const errors = validation.ok ? [] : validation.errors

  const sample = useMemo(
    () => sampleTicketData(kind, { paid: previewPaid, fssaiNumber }),
    [kind, previewPaid, fssaiNumber],
  )
  const rendered = useMemo(() => renderTicket(draft, sample, DEFAULT_LOGO), [draft, sample])

  const requiredIds = REQUIRED_BLOCK_IDS[kind]

  function setDraft(next: PrintTemplate) {
    setDrafts((d) => ({ ...d, [kind]: next }))
  }
  function setBlocks(blocks: TemplateBlock[]) {
    setDraft({ ...draft, blocks })
  }
  function updateBlock(updated: TemplateBlock) {
    setBlocks(draft.blocks.map((b) => (b.id === updated.id ? updated : b)))
  }
  function moveBlock(from: number, to: number) {
    if (to < 0 || to >= draft.blocks.length || from === to) return
    const blocks = [...draft.blocks]
    const [moved] = blocks.splice(from, 1)
    blocks.splice(to, 0, moved)
    setBlocks(blocks)
  }
  function addBlock(type: BlockType) {
    const block = newBlock(type, draft.blocks.map((b) => b.id))
    const at = selectedId ? draft.blocks.findIndex((b) => b.id === selectedId) + 1 : draft.blocks.length
    const blocks = [...draft.blocks]
    blocks.splice(at, 0, block)
    setBlocks(blocks)
    setSelectedId(block.id)
  }
  function removeBlock(id: string) {
    setBlocks(draft.blocks.filter((b) => b.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // Narrower paper: shrink any logo that would no longer fit.
  function changePaper(paper: PrintTemplate['paper']) {
    const maxDots = PAPER_DOTS[paper]
    setDraft({
      ...draft,
      paper,
      blocks: draft.blocks.map((b) => (b.type === 'logo' && b.widthDots > maxDots ? { ...b, widthDots: maxDots } : b)),
    })
  }

  function switchKind(next: TemplateKind) {
    setKind(next)
    setSelectedId(null)
  }

  async function save() {
    if (!validation.ok) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/print-templates/${kind}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: validation.template }),
      })
      const json = await res.json()
      if (!res.ok || !json.data) { toast.error(json.error ?? 'Failed to save layout', { duration: 6000 }); return }
      setSaved((s) => ({ ...s, [kind]: json.data }))
      setDrafts((d) => ({ ...d, [kind]: json.data.template }))
      toast.success(`${KIND_LABEL[kind]} layout saved - used for the next print`)
    } catch {
      toast.error('Failed to save layout')
    } finally {
      setSaving(false)
    }
  }

  async function resetToDefault() {
    setConfirmReset(false)
    try {
      const res = await fetch(`/api/admin/print-templates/${kind}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.data) { toast.error(json.error ?? 'Failed to reset'); return }
      setSaved((s) => ({ ...s, [kind]: json.data }))
      setDrafts((d) => ({ ...d, [kind]: json.data.template }))
      setSelectedId(null)
      toast.success(`${KIND_LABEL[kind]} reset to the default layout`)
    } catch {
      toast.error('Failed to reset')
    }
  }

  async function printTest() {
    if (!validation.ok) return
    setTesting(true)
    try {
      const res = await fetch(`/api/admin/print-templates/${kind}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station: testStation[kind], template: validation.template }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to send test print'); return }
      toast.success(`Test ${kind === 'bill' ? 'bill' : 'KOT'} sent to the ${STATION_LABEL[testStation[kind]].toLowerCase()}`)
    } catch {
      toast.error('Failed to send test print')
    } finally {
      setTesting(false)
    }
  }

  async function onLogoFile(file: File | undefined) {
    if (!file) return
    setLogoBusy(true)
    try {
      const logo = await imageFileToLogo(file, PAPER_DOTS[draft.paper])
      setDraft({ ...draft, logo })
      toast.success('Logo updated in the preview - save to use it')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not use that image')
    } finally {
      setLogoBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const hasLogoBlock = draft.blocks.some((b) => b.type === 'logo')
  const savedInfo = saved[kind]

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Print Layout</h1>
          <p className="text-ink-muted text-sm mt-0.5">
            Choose what prints on the bill and the kitchen ticket, in what order and style.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-surface-overlay p-1">
          {(['bill', 'kot'] as TemplateKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                kind === k ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {KIND_LABEL[k]}{dirty(k) ? ' •' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div className={`${sectionClass} flex flex-wrap items-center gap-2`}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty(kind) || !validation.ok || saving}
          className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save layout'}
        </button>
        <button type="button" onClick={() => setDrafts((d) => ({ ...d, [kind]: saved[kind].template }))} disabled={!dirty(kind)} className={smallButton}>
          Undo changes
        </button>
        <button type="button" onClick={() => setConfirmReset(true)} disabled={savedInfo.isDefault && !dirty(kind)} className={smallButton}>
          <RotateCcw size={14} /> Reset to default
        </button>
        <div className="flex items-center gap-2 sm:ml-auto">
          <select
            aria-label="Printer for the test print"
            value={testStation[kind]}
            onChange={(e) => setTestStation((s) => ({ ...s, [kind]: e.target.value as Station }))}
            className="rounded-lg border border-ink/10 bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {(Object.keys(STATION_LABEL) as Station[]).map((s) => <option key={s} value={s}>{STATION_LABEL[s]}</option>)}
          </select>
          <button type="button" onClick={printTest} disabled={!validation.ok || testing} className={smallButton}>
            <Printer size={14} /> {testing ? 'Sending…' : 'Print test'}
          </button>
        </div>
        <p className="w-full text-xs text-ink-faint">
          {savedInfo.isDefault
            ? 'Using the default layout.'
            : `Last saved${savedInfo.updatedBy ? ` by ${savedInfo.updatedBy}` : ''}${savedInfo.updatedAt ? ` on ${new Date(savedInfo.updatedAt).toLocaleString('en-IN')}` : ''}.`}
          {' '}Print test uses the layout on screen, saved or not.
        </p>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-status-overdue/30 bg-red-50 p-3 text-sm text-status-overdue">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} /> Fix these before saving:</p>
          <ul className="list-disc pl-6 mt-1 space-y-0.5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-5 items-start">
        {/* ── Editor column ── */}
        <div className="space-y-5 min-w-0">
          <section className={sectionClass}>
            <h2 className="font-display font-semibold text-ink mb-3">Paper &amp; printing</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1" htmlFor="paper">Paper width</label>
                <select id="paper" value={draft.paper} onChange={(e) => changePaper(e.target.value as PrintTemplate['paper'])} className="w-full rounded-lg border border-ink/10 bg-surface px-2 py-1.5 text-sm">
                  <option value="58mm">58 mm</option>
                  <option value="80mm">80 mm</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1" htmlFor="font">Font</label>
                <select id="font" value={draft.font} onChange={(e) => setDraft({ ...draft, font: e.target.value as PrintTemplate['font'] })} className="w-full rounded-lg border border-ink/10 bg-surface px-2 py-1.5 text-sm">
                  <option value="A">Regular ({FONT_COLUMNS[draft.paper].A} per line)</option>
                  <option value="B">Condensed ({FONT_COLUMNS[draft.paper].B} per line)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1" htmlFor="feed">Blank lines at end</label>
                <input id="feed" type="number" min={0} max={10} value={draft.feedLines} onChange={(e) => setDraft({ ...draft, feedLines: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} className="w-full rounded-lg border border-ink/10 bg-surface px-2 py-1.5 text-sm" />
              </div>
              <div className="flex items-end pb-1.5">
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={draft.cut} onChange={(e) => setDraft({ ...draft, cut: e.target.checked })} className="h-4 w-4 accent-ink" />
                  Cut paper
                </label>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-muted">Logo:</span>
              <span className="text-sm text-ink">{draft.logo ? `Custom (${draft.logo.width}×${draft.logo.height})` : 'The Bread Chapter (built-in)'}</span>
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={logoBusy} className={smallButton}>
                <Upload size={14} /> {logoBusy ? 'Converting…' : 'Upload logo'}
              </button>
              {draft.logo && (
                <button type="button" onClick={() => setDraft({ ...draft, logo: null })} className={smallButton}>
                  Use built-in logo
                </button>
              )}
              {!hasLogoBlock && <span className="text-xs text-ink-faint">(add a Logo block to print it)</span>}
            </div>
          </section>

          <section className={sectionClass}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="font-display font-semibold text-ink">Sections, top to bottom</h2>
              <div className="flex flex-wrap gap-1.5">
                {ADDABLE_BLOCK_TYPES.map((type) => (
                  <button key={type} type="button" onClick={() => addBlock(type)} className={`${smallButton} py-1 text-xs`}>
                    <Plus size={12} /> {BLOCK_TYPE_LABEL[type]}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-ink-faint mb-3">
              Tick to show, drag (or use the arrows) to move, tap a row to edit it.
              <Lock size={11} className="inline mx-1 -mt-0.5" />
              marks parts that must stay on{kind === 'bill' ? ' a GST bill' : ''}.
            </p>

            <ol className="space-y-1.5">
              {draft.blocks.map((block, index) => {
                const required = requiredIds.includes(block.id)
                const selected = selectedId === block.id
                const deletable = !required && ADDABLE_BLOCK_TYPES.includes(block.type)
                const fields = block.type === 'text' ? [...placeholdersIn(block.text), ...placeholdersIn(block.rightText)] : []
                return (
                  <li
                    key={block.id}
                    draggable
                    onDragStart={(e) => { dragIndex.current = index; e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(index) }}
                    onDragLeave={() => setDragOver((v) => (v === index ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragIndex.current !== null) moveBlock(dragIndex.current, index)
                      dragIndex.current = null
                      setDragOver(null)
                    }}
                    onDragEnd={() => { dragIndex.current = null; setDragOver(null) }}
                    className={`rounded-xl border transition-colors ${
                      selected ? 'border-brand-400 bg-brand-50/40' : dragOver === index ? 'border-brand-300' : 'border-ink/8 bg-surface'
                    } ${block.enabled ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-center gap-2 px-2 py-2">
                      <GripVertical size={16} className="text-ink-faint cursor-grab shrink-0 hidden sm:block" aria-hidden />
                      <input
                        type="checkbox"
                        checked={block.enabled}
                        disabled={required}
                        aria-label={`Show ${BLOCK_TYPE_LABEL[block.type]}`}
                        onChange={(e) => updateBlock({ ...block, enabled: e.target.checked })}
                        className="h-4 w-4 accent-ink shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedId(selected ? null : block.id)}
                        className="flex-1 min-w-0 text-left"
                        aria-expanded={selected}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          {BLOCK_TYPE_LABEL[block.type]}
                          {required && <Lock size={11} className="text-ink-faint" aria-label="Required" />}
                          {fields.length > 0 && <span className="text-[10px] font-normal text-ink-faint">uses {fields.map((f) => `{${f}}`).join(' ')}</span>}
                        </span>
                        <span className="block text-xs text-ink-muted truncate font-mono">{blockSummary(block)}</span>
                      </button>
                      <div className="flex shrink-0">
                        <button type="button" aria-label="Move up" onClick={() => moveBlock(index, index - 1)} disabled={index === 0} className="p-1.5 text-ink-muted hover:text-ink disabled:opacity-30">
                          <ChevronUp size={16} />
                        </button>
                        <button type="button" aria-label="Move down" onClick={() => moveBlock(index, index + 1)} disabled={index === draft.blocks.length - 1} className="p-1.5 text-ink-muted hover:text-ink disabled:opacity-30">
                          <ChevronDown size={16} />
                        </button>
                        {deletable && (
                          <button type="button" aria-label="Delete section" onClick={() => removeBlock(block.id)} className="p-1.5 text-ink-muted hover:text-status-overdue">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <div className="border-t border-ink/8 px-3 py-3">
                        <BlockSettings block={block} kind={kind} paper={draft.paper} onChange={updateBlock} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        </div>

        {/* ── Preview column ── */}
        <aside className="lg:sticky lg:top-4 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-semibold text-ink">Preview</h2>
            {kind === 'bill' && (
              <div className="flex gap-1 rounded-lg bg-surface-overlay p-0.5">
                {[false, true].map((paid) => (
                  <button
                    key={String(paid)}
                    type="button"
                    onClick={() => setPreviewPaid(paid)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium ${previewPaid === paid ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted'}`}
                  >
                    {paid ? 'Paid' : 'Not paid'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <TicketPreview ticket={rendered} />
          <p className="text-[11px] text-ink-faint max-w-[420px]">
            Sample order. Built by the same code that prints, at the printer&apos;s real width
            ({draft.paper}, {rendered.columns} characters per line). Paper texture and the printer&apos;s own font may differ slightly.
          </p>
        </aside>
      </div>

      {confirmReset && (
        <ConfirmModal
          title="Reset to default layout?"
          message={`The ${KIND_LABEL[kind].toLowerCase()} goes back to the original layout and your changes are deleted. This applies to the next print.`}
          confirmLabel="Reset"
          onConfirm={resetToDefault}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  )
}
