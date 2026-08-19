import React, { useState, useEffect } from 'react';
import { CalendarClock, Loader2, Repeat } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { cn } from '../../lib/utils';
import { API_BASE_URL } from '../../lib/api';
import { WorkflowInput } from '../../types';
import { WorkflowInputFields, parseTemplateMap } from '../WorkflowInputFields';
import { DATE_TIME_PLACEHOLDER, getDateTimeMode, isValidDateTimeValue } from '../DateTimeInput';
import { parseMultiInputConfig } from '../../lib/multiInput';

const MAX_REPEAT_DAYS = 10;

// File/dataset inputs need upload/picker infra that doesn't fit a "schedule for later" flow;
// they fall back to a plain text field so the value can still be provided. multi-input and
// multi-select are handled natively below (same JSON value format as WorkflowInputDialog),
// so the value produced here matches an immediate run and the shared draft stays consistent.
const RICH_TYPES = new Set(['file', 'dataset-select', 'dataset-multi-select']);

// Share the exact same input draft as the run-flow WorkflowInputDialog so values a visitor
// typed in one dialog are restored in the other (keyed by public:{slug}:widget:{id}).
const DRAFT_PREFIX = 'wf_input_draft:';

const loadDraft = (key: string | undefined, inputs: WorkflowInput[]): Record<string, string> | null => {
    if (!key) return null;
    try {
        const raw = localStorage.getItem(DRAFT_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const allowed = new Set(inputs.filter(i => i.type !== 'file').map(i => i.key));
        const cleaned: Record<string, string> = {};
        for (const k of Object.keys(parsed)) {
            if (allowed.has(k) && typeof parsed[k] === 'string') cleaned[k] = parsed[k];
        }
        return cleaned;
    } catch {
        return null;
    }
};

const saveDraft = (key: string | undefined, values: Record<string, string>, inputs: WorkflowInput[]) => {
    if (!key) return;
    try {
        const fileKeys = new Set(inputs.filter(i => i.type === 'file').map(i => i.key));
        const toSave: Record<string, string> = {};
        for (const k of Object.keys(values)) {
            if (!fileKeys.has(k)) toSave[k] = values[k];
        }
        localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(toSave));
    } catch {
        // ignore quota/serialize errors
    }
};

// PublicScheduleDialog lets a public visitor schedule an ENDPOINT widget's workflow. Large
// two-column layout (mirrors the admin schedule form): left = timing, right = workflow
// inputs (only when the workflow declares any). Default is a one-time run; opting into
// repeat turns it into a daily run for up to MAX_REPEAT_DAYS days (backend → RECURRING).
const PublicScheduleDialog: React.FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    slug?: string;
    pageToken?: string | null;
    workflowId?: string;
    title: string;
    inputs?: WorkflowInput[];
    // Shared draft key with the run-flow input dialog (public:{slug}:widget:{id}).
    storageKey?: string;
    onCreated?: () => void;
}> = ({ open, onOpenChange, slug, pageToken, workflowId, title, inputs = [], storageKey, onCreated }) => {
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [repeat, setRepeat] = useState(false);
    const [repeatDays, setRepeatDays] = useState(3);
    const [values, setValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sortedInputs = [...inputs].sort((a, b) => (a.order || 0) - (b.order || 0));
    const hasInputs = sortedInputs.length > 0;

    // Local (not UTC) date for the date-input min, so evening users in western timezones can
    // still pick "today". The real past-guard is the getTime() check in submit().
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // On open: seed text-ish inputs from their default, then overlay the shared draft so
    // previously-typed values (from here OR the run dialog) are restored.
    useEffect(() => {
        if (!open) return;
        const seed: Record<string, string> = {};
        for (const inp of inputs) {
            if (inp.type === 'multi-input') {
                seed[inp.key] = inp.collapse_initially ? '[]' : '[{}]';
            } else if (inp.type === 'multi-select') {
                seed[inp.key] = '[]';
            } else if (RICH_TYPES.has(inp.type)) {
                seed[inp.key] = '';
            } else {
                // A template-map default_value is config (auto-fill), not a real value → start empty
                // so the shared textarea renders blank instead of raw JSON (matches the run dialog).
                seed[inp.key] = parseTemplateMap(inp.default_value) ? '' : (inp.default_value || '');
            }
        }
        const draft = loadDraft(storageKey, inputs);
        setValues(draft ? { ...seed, ...draft } : seed);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Persist to the shared draft as the visitor types (two-way sync with the run dialog).
    useEffect(() => {
        if (open && storageKey && inputs.length > 0) saveDraft(storageKey, values, inputs);
    }, [values, open, storageKey, inputs]);

    // NOTE: do not clear `values` here — that would run the save effect while still open and
    // wipe the shared draft. Values are re-seeded from the draft on next open.
    const reset = () => {
        setDate(''); setTime(''); setRepeat(false); setRepeatDays(3); setError(null);
    };

    // Native date/time pickers only open from the calendar icon by default; open on any click.
    const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
        try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* unsupported */ }
    };

    // multi-select value is a JSON array string (same format WorkflowInputDialog produces),
    // so a scheduled run receives the exact same value an immediate run would.
    const parseMultiSelect = (v: string): string[] => {
        try {
            const a = JSON.parse(v || '[]');
            if (Array.isArray(a)) return a.map(String);
        } catch { /* legacy comma-joined draft */ }
        return (v || '').split(',').map(s => s.trim()).filter(Boolean);
    };

    // multi-input value is a JSON array of row objects (same as WorkflowInputDialog).
    const parseRows = (v: string): Record<string, string>[] => {
        try {
            const rows = JSON.parse(v || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch {
            return [];
        }
    };

    // Required-field emptiness, type-aware (a JSON "[]" must count as empty).
    const isInputEmpty = (inp: WorkflowInput, val: string): boolean => {
        const v = (val ?? '').trim();
        if (inp.type === 'multi-select' || inp.type === 'dataset-multi-select') {
            return parseMultiSelect(v).length === 0;
        }
        if (inp.type === 'multi-input') {
            const rows = parseRows(v);
            return !rows.some(r => r && Object.values(r).some(x => String(x ?? '').trim() !== ''));
        }
        return v === '' || v === '[]';
    };

    const submit = async () => {
        setError(null);
        if (!slug || !workflowId) { setError('Missing page context.'); return; }
        if (!date || !time) { setError('Pick a date and time.'); return; }

        const runAtLocal = new Date(`${date}T${time}`);
        if (isNaN(runAtLocal.getTime())) { setError('Invalid date/time.'); return; }
        if (runAtLocal.getTime() <= Date.now()) { setError('Pick a time in the future.'); return; }

        const missing = sortedInputs.filter(i => i.required && isInputEmpty(i, values[i.key] || ''));
        if (missing.length > 0) {
            setError(`Fill required input(s): ${missing.map(m => m.label || m.key).join(', ')}`);
            return;
        }

        // A malformed date/time is only rejected by the backend when the schedule fires,
        // long after this dialog closed — so catch it here while the visitor can fix it.
        for (const inp of sortedInputs) {
            if (inp.type === 'date' || inp.type === 'time') {
                const val = values[inp.key] || '';
                if (isInputEmpty(inp, val)) continue;
                const mode = getDateTimeMode(inp.type, inp.include_time);
                if (!isValidDateTimeValue(mode, val)) {
                    setError(`${inp.label || inp.key} must be ${DATE_TIME_PLACEHOLDER[mode]}`);
                    return;
                }
                continue;
            }
            if (inp.type !== 'multi-input') continue;
            const dateTimeFields = parseMultiInputConfig(inp.default_value)
                .filter(f => f.type === 'date' || f.type === 'time');
            if (dateTimeFields.length === 0) continue;
            for (const row of parseRows(values[inp.key] || '')) {
                for (const f of dateTimeFields) {
                    const rowVal = String(row[f.key] ?? '');
                    if (rowVal.trim() === '') continue;
                    const mode = getDateTimeMode(f.type, f.include_time);
                    if (!isValidDateTimeValue(mode, rowVal)) {
                        setError(`${inp.label || inp.key} — ${f.label || f.key} must be ${DATE_TIME_PLACEHOLDER[mode]}`);
                        return;
                    }
                }
            }
        }

        const days = Math.min(Math.max(1, repeatDays), MAX_REPEAT_DAYS);
        setSubmitting(true);
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (pageToken) headers['X-Page-Token'] = pageToken;
            const res = await fetch(`${API_BASE_URL}/public/pages/${slug}/schedule/${workflowId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    run_at: runAtLocal.toISOString(),
                    repeat,
                    repeat_days: repeat ? days : 0,
                    inputs: values,
                }),
            });
            if (!res.ok) {
                let msg = `Failed (${res.status})`;
                try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
                setError(msg);
                return;
            }
            reset();
            onOpenChange(false);
            onCreated?.();
        } catch (e: any) {
            setError(e?.message || 'Network error');
        } finally {
            setSubmitting(false);
        }
    };

    // Match the shared WorkflowInputFields look (bg-background, h-9, text-xs) so the timing
    // column and the workflow-inputs column read as one consistent form.
    const fieldCls = "w-full h-9 px-3 bg-background border border-border rounded-md text-xs font-semibold outline-none focus:border-primary/50 focus:ring-2 ring-primary/20 transition-all";

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
            <DialogContent className={cn("p-0 max-h-[90vh] flex flex-col overflow-hidden", hasInputs ? "max-w-[860px]" : "max-w-md")}>
                <DialogHeader className="px-6 pt-6 pb-2">
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarClock className="w-4 h-4 text-primary" />
                        <span>Schedule run</span>
                        <span className="text-xs text-muted-foreground font-normal">— {title}</span>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row min-h-0">
                    {/* Left: timing */}
                    <div className={cn("p-6 space-y-4 md:overflow-y-auto custom-scrollbar", hasInputs ? "md:w-1/2" : "w-full")}>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Date</label>
                                <input type="date" min={todayStr} value={date} onClick={openPicker} onChange={e => setDate(e.target.value)} className={cn(fieldCls, "cursor-pointer")} />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Time</label>
                                <input type="time" value={time} onClick={openPicker} onChange={e => setTime(e.target.value)} className={cn(fieldCls, "cursor-pointer")} />
                            </div>
                        </div>

                        <label className="flex items-start gap-3 rounded-md border border-border bg-muted/20 px-3 py-3 cursor-pointer hover:border-primary/40 transition-colors">
                            <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary shrink-0" />
                            <span className="flex flex-col">
                                <span className="text-xs font-bold flex items-center gap-1.5"><Repeat className="w-3.5 h-3.5" /> Repeat daily</span>
                                <span className="text-[10px] text-muted-foreground/70">Run every day at this time for up to {MAX_REPEAT_DAYS} days.</span>
                            </span>
                        </label>

                        {repeat && (
                            <div className="space-y-1.5 pl-1">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Repeat for (days)</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={MAX_REPEAT_DAYS}
                                    value={repeatDays}
                                    onChange={e => setRepeatDays(Math.min(MAX_REPEAT_DAYS, Math.max(1, parseInt(e.target.value || '1', 10))))}
                                    className={cn(fieldCls, "w-28")}
                                />
                            </div>
                        )}
                    </div>

                    {/* Right: workflow inputs — shared renderer with the run-flow dialog.
                        richFallback → file/dataset render as plain text (schedule posts JSON, no upload/picker). */}
                    {hasInputs && (
                        <div className="md:w-1/2 p-6 border-t md:border-t-0 md:border-l border-border space-y-4 md:overflow-y-auto custom-scrollbar bg-muted/10">
                            <WorkflowInputFields
                                inputs={sortedInputs}
                                values={values}
                                setValues={setValues}
                                richFallback
                                showRequiredMark
                            />
                        </div>
                    )}
                </div>

                {error && <p className="text-xs text-rose-500 font-medium px-6">{error}</p>}

                <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting} className="gap-2">
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                        Schedule
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PublicScheduleDialog;
