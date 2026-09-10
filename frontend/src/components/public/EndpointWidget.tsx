import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Zap, Play, Loader2, CheckCircle2, AlertTriangle, Square, History, RotateCcw, XCircle, Clock, FileText, CalendarClock, Trash2, Repeat } from 'lucide-react';
import { WidgetIcon } from '../../lib/widgetIcons';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { cn } from '../../lib/utils';
import { PageWidget, Schedule, WorkflowInput } from '../../types';
import { ExecutionHistoryEntry } from '../../lib/executionHistory';
import { resolveButtonStyle } from '../ButtonStylePicker';
import AnsiText from '../AnsiText';
import { API_BASE_URL, streamResponseLines, createLineBatcher } from '../../lib/api';
import PublicScheduleDialog from './PublicScheduleDialog';

interface EndpointWidgetProps {
    widget: PageWidget;
    isRunning: boolean;
    result: { success: boolean, message: string } | undefined;
    onRun: (widget: PageWidget, inputs?: Record<string, string>) => void;
    onStop?: (widget: PageWidget) => void;
    history?: ExecutionHistoryEntry[];
    slug?: string;
    pageToken?: string | null;
    onOpenHistory?: () => void;
    // Input definitions for this widget's workflow, so the schedule dialog can collect them.
    workflowInputs?: WorkflowInput[];
}

const statusStyle = (status: string) => {
    if (status === 'SUCCESS') return { cls: 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/30', Icon: CheckCircle2 };
    if (status === 'FAILED') return { cls: 'bg-rose-500/10 text-rose-500 ring-rose-500/30', Icon: AlertTriangle };
    if (status === 'CANCELLED') return { cls: 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/30', Icon: XCircle };
    return { cls: 'bg-primary/10 text-primary ring-primary/30', Icon: Loader2 };
};

const formatTime = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
};

const formatInputs = (inputs: Record<string, string>) => {
    const keys = Object.keys(inputs);
    if (keys.length === 0) return '(no inputs)';
    return keys.map(k => `${k}: ${inputs[k]}`).join(' · ');
};

// One shape for every widget action, so a run, a stop and a schedule button no longer
// disagree on height, radius and hover feedback. Hover changes brightness, never hue:
// repainting a green button violet was the old default-variant behaviour.
const WIDGET_PRIMARY_ACTION = "h-14 rounded-md font-black text-xs transition-all active:scale-[0.98]";
const WIDGET_SQUARE_ACTION = "h-14 w-14 shrink-0 rounded-md flex items-center justify-center transition-all active:scale-[0.98]";
const WIDGET_ICON_ACTION = "h-9 w-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border";

const EndpointWidget: React.FC<EndpointWidgetProps> = ({
    widget,
    isRunning,
    result,
    onRun,
    onStop,
    history = [],
    slug,
    pageToken,
    onOpenHistory,
    workflowInputs = [],
}) => {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyTab, setHistoryTab] = useState<'executions' | 'schedules'>('executions');
    const [logEntry, setLogEntry] = useState<ExecutionHistoryEntry | null>(null);
    const [logLines, setLogLines] = useState<string[]>([]);
    const [logLoading, setLogLoading] = useState(false);
    const [logError, setLogError] = useState<string | null>(null);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [schedulesLoading, setSchedulesLoading] = useState(false);
    const [cancelling, setCancelling] = useState<string | null>(null);
    const lastEntry = history[0];
    const hasHistory = history.length > 0;
    const canSchedule = !!widget.allow_schedule;
    const styleResolved = resolveButtonStyle(widget.style, 'premium-gradient');
    // Schedule button is a flat outline that borrows the run button's colour for its icon +
    // border only (transparent fill). widget.style is one of: 'premium-gradient' (indigo),
    // 'custom:#hex', or a preset className that embeds its colour as rgba(...) in a shadow
    // (e.g. Cyber Rose). Derive one representative colour — applied inline so Tailwind's JIT
    // purge can't drop a dynamically-built class.
    const runAccent = (() => {
        const raw = widget.style;
        if (!raw || raw.includes('premium-gradient')) return '#6366f1';
        if (raw.startsWith('custom:')) {
            const h = raw.slice('custom:'.length);
            return h.startsWith('#') ? h : `#${h}`;
        }
        const m = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : '#6366f1';
    })();

    const logReqRef = useRef(0);

    // Fetch schedules this page created for THIS widget's workflow. Raw fetch (not apiFetch)
    // to mirror openLog: a tokenless read on a password page 401s without clobbering auth.
    const fetchSchedules = useCallback(async () => {
        if (!slug || !widget.workflow_id) return;
        setSchedulesLoading(true);
        try {
            const headers: Record<string, string> = {};
            if (pageToken) headers['X-Page-Token'] = pageToken;
            const res = await fetch(`${API_BASE_URL}/public/pages/${slug}/schedules?workflow_id=${widget.workflow_id}`, { headers });
            if (!res.ok) { setSchedules([]); return; }
            const data = await res.json();
            setSchedules(Array.isArray(data.schedules) ? data.schedules : []);
        } catch {
            setSchedules([]);
        } finally {
            setSchedulesLoading(false);
        }
    }, [slug, pageToken, widget.workflow_id]);

    const cancelSchedule = async (id: string) => {
        if (!slug) return;
        setCancelling(id);
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (pageToken) headers['X-Page-Token'] = pageToken;
            const res = await fetch(`${API_BASE_URL}/public/pages/${slug}/schedules/${id}/cancel`, { method: 'POST', headers });
            if (res.ok) setSchedules(prev => prev.filter(s => s.id !== id));
        } catch {
            /* leave list as-is; user can retry */
        } finally {
            setCancelling(null);
        }
    };

    // Load schedules whenever the history dialog is open (either tab may show a count/badge).
    useEffect(() => {
        if (historyOpen && canSchedule) fetchSchedules();
    }, [historyOpen, canSchedule, fetchSchedules]);

    const openLog = async (entry: ExecutionHistoryEntry) => {
        // Stale-request guard: if another entry is opened mid-stream, older
        // streams must stop appending so their lines don't bleed into the new view.
        const reqId = ++logReqRef.current;
        setLogEntry(entry);
        setLogLines([]);
        setLogError(null);
        if (!slug) {
            setLogError('Missing page slug.');
            return;
        }
        setLogLoading(true);
        try {
            const headers: Record<string, string> = {};
            if (pageToken) headers['X-Page-Token'] = pageToken;
            const res = await fetch(`${API_BASE_URL}/public/pages/${slug}/executions/${entry.executionId}/logs`, { headers });
            if (logReqRef.current !== reqId) return;
            if (!res.ok) {
                const txt = await res.text();
                setLogError(`Failed to load log (${res.status})${txt ? ': ' + txt.slice(0, 200) : ''}`);
                return;
            }
            // Stream the body so lines render as chunks arrive instead of
            // blocking until the whole log file downloads. Batched per frame to
            // avoid a re-render per chunk on large logs.
            const batcher = createLineBatcher(batch => {
                if (logReqRef.current === reqId) setLogLines(prev => [...prev, ...batch]);
            });
            await streamResponseLines(res, lines => {
                if (logReqRef.current !== reqId) return;
                batcher.push(lines);
            });
            batcher.flush();
        } catch (e: any) {
            if (logReqRef.current === reqId) setLogError(e?.message || 'Failed to load log');
        } finally {
            if (logReqRef.current === reqId) setLogLoading(false);
        }
    };

    const triggerRerun = (inputs: Record<string, string>) => {
        setHistoryOpen(false);
        onRun(widget, inputs);
    };

    return (
        <div className={cn(
            "p-8 bg-card border border-border rounded-md shadow-xl flex flex-col justify-between min-h-[260px] transition-all hover:border-foreground/20 group w-full"
        )}>
            <div>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <div className="p-2.5 rounded-md bg-primary/10 text-primary ring-1 ring-primary/20">
                            <WidgetIcon name={widget.icon} fallback={Zap} className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black leading-tight">{widget.title}</h3>
                            <Badge variant="outline" className="text-[10px] font-black px-1.5 h-4 mt-1 border-primary/30 text-primary/70">Terminal Access Port</Badge>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {lastEntry && (
                            <div className="relative group/rerun">
                                <button
                                    type="button"
                                    onClick={() => triggerRerun(lastEntry.inputs)}
                                    className={WIDGET_ICON_ACTION}
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                                <div className="absolute top-full right-0 mt-2 px-3 py-1.5 rounded-md bg-popover text-popover-foreground text-[11px] font-bold whitespace-nowrap shadow-lg border border-border opacity-0 group-hover/rerun:opacity-100 pointer-events-none transition-opacity duration-150 z-10">
                                    Re-run last execution
                                </div>
                            </div>
                        )}
                        {(hasHistory || canSchedule) && (
                            <button
                                type="button"
                                onClick={() => {
                                    setHistoryTab(hasHistory ? 'executions' : 'schedules');
                                    setHistoryOpen(true);
                                    onOpenHistory?.();
                                }}
                                title="View history & schedules"
                                className={cn("relative", WIDGET_ICON_ACTION)}
                            >
                                <History className="w-4 h-4" />
                                {hasHistory && (
                                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-black flex items-center justify-center">
                                        {history.length}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-[13px] font-medium text-muted-foreground mt-6 opacity-60 leading-relaxed whitespace-pre-wrap">
                    {widget.description || "Launch automated system orchestration pipeline with real-time feedback loop."}
                </p>
            </div>

            <div className="pt-10">
                {isRunning ? (
                    <div className="flex items-center gap-3">
                        <Button
                            disabled
                            variant="plain"
                            style={styleResolved.style}
                            className={cn(
                                WIDGET_PRIMARY_ACTION, "flex-1 shadow-premium",
                                styleResolved.className
                            )}
                        >
                            <div className="flex items-center gap-3 opacity-70">
                                <Loader2 className="w-6 h-6 animate-spin" />
                                <span>Running...</span>
                            </div>
                        </Button>
                        <Button
                            onClick={() => onStop && onStop(widget)}
                            className={cn(WIDGET_SQUARE_ACTION, "bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/50 shadow-premium group/stop")}
                        >
                            <Square className="w-5 h-5 fill-current opacity-70 group-hover/stop:opacity-100 transition-opacity" />
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        {canSchedule && (
                            <div className="relative group/sched">
                                <button
                                    type="button"
                                    onClick={() => setScheduleOpen(true)}
                                    style={{ color: runAccent, borderColor: runAccent }}
                                    className={cn(WIDGET_SQUARE_ACTION, "flex-col gap-1 border-2 bg-transparent hover:bg-foreground/5")}
                                >
                                    <CalendarClock className="w-5 h-5" />
                                    <span className="text-[8px] font-black uppercase tracking-[0.15em]">Plan</span>
                                </button>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-md bg-popover text-popover-foreground text-[11px] font-bold whitespace-nowrap shadow-lg border border-border opacity-0 group-hover/sched:opacity-100 pointer-events-none transition-opacity duration-150">
                                    Schedule a run
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-popover" />
                                </div>
                            </div>
                        )}
                        <Button
                            onClick={() => onRun(widget)}
                            disabled={isRunning}
                            variant="plain"
                            style={result ? undefined : styleResolved.style}
                            className={cn(
                                WIDGET_PRIMARY_ACTION, "flex-1 shadow-premium hover:brightness-110",
                                result ? (result.success ? "bg-emerald-500 text-white" : "bg-rose-500 text-white") : styleResolved.className
                            )}
                        >
                            {result ? (
                                <div className="flex items-center gap-2">
                                    {result.success ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                                    <span>{result.message}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <Play className="w-5 h-5 fill-current" />
                                    <span>{widget.label || 'Initiate'}</span>
                                </div>
                            )}
                        </Button>
                    </div>
                )}
            </div>

            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <History className="w-4 h-4" />
                            <span>{canSchedule ? 'History & Schedules' : 'Execution History'}</span>
                            <span className="text-xs text-muted-foreground font-normal">— {widget.title}</span>
                        </DialogTitle>
                    </DialogHeader>
                    {canSchedule && (
                        <div className="flex items-center gap-1 border-b border-border -mt-1 mb-1">
                            {(['executions', 'schedules'] as const).map(tab => (
                                <button
                                    key={tab}
                                    type="button"
                                    onClick={() => setHistoryTab(tab)}
                                    className={cn(
                                        "px-3 py-2 text-xs font-black uppercase tracking-widest border-b-2 -mb-px transition-colors",
                                        historyTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {tab === 'executions' ? 'Executions' : 'Schedules'}
                                    {tab === 'executions' && hasHistory && <span className="ml-1.5 opacity-60">({history.length})</span>}
                                    {tab === 'schedules' && schedules.length > 0 && <span className="ml-1.5 opacity-60">({schedules.length})</span>}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className={cn("overflow-y-auto flex-1 -mx-2 px-2 space-y-2", historyTab === 'schedules' && canSchedule && "hidden")}>
                        {history.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">No history yet.</p>
                        ) : history.map(entry => {
                            const { cls, Icon } = statusStyle(entry.status);
                            const isFinal = entry.status !== 'RUNNING';
                            return (
                                <div key={entry.executionId} className="border border-border rounded-md p-4 bg-card/50 flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className={cn("flex items-center gap-2 px-2 py-1 rounded-md ring-1", cls)}>
                                            <Icon className={cn("w-3.5 h-3.5", entry.status === 'RUNNING' && 'animate-spin')} />
                                            <span className="text-[10px] font-black uppercase tracking-wider">{entry.status}</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                            <Clock className="w-3 h-3" />
                                            <span>{formatTime(entry.timestamp)}</span>
                                        </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground break-all">
                                        <span className="font-mono opacity-60">{entry.executionId.slice(0, 8)}</span>
                                        <span className="mx-2">·</span>
                                        <span>{formatInputs(entry.inputs)}</span>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openLog(entry)}
                                            className="h-8 gap-2"
                                        >
                                            <FileText className="w-3.5 h-3.5" />
                                            View Log
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={!isFinal || isRunning}
                                            onClick={() => triggerRerun(entry.inputs)}
                                            className="h-8 gap-2"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            Re-run
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {canSchedule && (
                        <div className={cn("overflow-y-auto flex-1 -mx-2 px-2 space-y-2", historyTab !== 'schedules' && "hidden")}>
                            {schedulesLoading ? (
                                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                            ) : schedules.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">No schedules yet.</p>
                            ) : schedules.map(s => {
                                const active = s.status === 'ACTIVE';
                                const recurring = s.type === 'RECURRING';
                                const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString() : '—';
                                return (
                                    <div key={s.id} className="border border-border rounded-md p-4 bg-card/50 flex flex-col gap-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className={cn("flex items-center gap-2 px-2 py-1 rounded-md ring-1", active ? "bg-emerald-500/10 text-emerald-500 ring-emerald-500/30" : "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30")}>
                                                {recurring ? <Repeat className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
                                                <span className="text-[10px] font-black uppercase tracking-wider">{active ? 'Active' : 'Paused'}</span>
                                            </div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{recurring ? 'Daily' : 'One-time'}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground space-y-0.5">
                                            <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Next: <span className="text-foreground/80">{fmt(s.next_run_at)}</span></div>
                                            {recurring && <div>Until: <span className="text-foreground/80">{fmt(s.end_date)}</span></div>}
                                            {s.last_run_status && <div>Last: <span className="text-foreground/80">{s.last_run_status}{s.last_run_at ? ` · ${fmt(s.last_run_at)}` : ''}</span></div>}
                                        </div>
                                        <div className="flex justify-end">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={cancelling === s.id}
                                                onClick={() => cancelSchedule(s.id)}
                                                className="h-8 gap-2 text-rose-500 hover:text-rose-600 border-rose-500/40 hover:bg-rose-500/10"
                                            >
                                                {cancelling === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <PublicScheduleDialog
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                slug={slug}
                pageToken={pageToken}
                workflowId={widget.workflow_id}
                title={widget.title}
                inputs={workflowInputs}
                storageKey={slug ? `public:${slug}:widget:${widget.id}` : undefined}
                onCreated={() => { setHistoryTab('schedules'); fetchSchedules(); }}
            />

            <Dialog open={!!logEntry} onOpenChange={(open) => { if (!open) { setLogEntry(null); setLogLines([]); setLogError(null); } }}>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            <span>Execution Log</span>
                            {logEntry && (
                                <span className="text-xs text-muted-foreground font-normal font-mono">— {logEntry.executionId.slice(0, 8)}</span>
                            )}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 overflow-y-auto bg-black/90 rounded-md p-4 font-mono text-xs leading-relaxed scrollbar-thin">
                        {logError ? (
                            <div className="text-rose-400">{logError}</div>
                        ) : logLines.length > 0 ? (
                            <>
                                {logLines.map((line, i) => (
                                    <div key={i} className="whitespace-pre-wrap min-h-[1.2rem] text-zinc-200">
                                        <AnsiText text={line} />
                                    </div>
                                ))}
                                {logLoading && (
                                    <div className="flex items-center gap-2 text-zinc-500 mt-1">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        <span>Streaming…</span>
                                    </div>
                                )}
                            </>
                        ) : logLoading ? (
                            <div className="flex items-center gap-2 text-zinc-500">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Loading log...</span>
                            </div>
                        ) : (
                            <div className="text-zinc-600">(empty)</div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default EndpointWidget;
