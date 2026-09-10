import React, { useState, useEffect, useRef } from 'react';
import {
    History,
    Clock,
    CheckCircle2,
    Loader2,
    Calendar,
    ChevronRight,
    CalendarClock,
    RefreshCw,
    ChevronDown,
    Zap,
    FileText,
    Plus,
    XCircle,
    Layers, UserRound } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
    Dialog,
    DialogContent,
    DialogTitle
} from './ui/dialog';
import { WorkflowExecution } from '../types';
import { format } from 'date-fns';
import { API_BASE_URL } from '../lib/api';
import ExecutionMonitor from './ExecutionMonitor';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';

const PAGE_SIZE = 15;

// A "root" is a top-level row in the execution tree: either it has no parent, or its
// parent isn't part of the list (so it can't be nested under anything). Children that
// ride along with their parent are nested, not counted as page slots. Mirror this with
// renderExecutionTree's root logic so paging stays aligned with what's rendered.
const countRoots = (list: WorkflowExecution[]): number => {
    const ids = new Set(list.map(e => e.id));
    return list.filter(e => !e.parent_execution_id || !ids.has(e.parent_execution_id)).length;
};

interface WorkflowHistoryProps {
    workflowId?: string;
    namespaceId?: string;
    onReRun?: (workflow: any, inputs: Record<string, string>, startGroupID?: string, startStepID?: string, fromExecutionID?: string) => void;
    status?: string;
    executedBy?: string;
    search?: string;
    tagIds?: string[];
}

const WorkflowHistory: React.FC<WorkflowHistoryProps> = ({
    workflowId,
    namespaceId,
    onReRun,
    status,
    executedBy,
    search,
    tagIds
}) => {
    const { apiFetch } = useAuth();
    const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [total, setTotal] = useState(0);
    const offsetRef = useRef(0);
    const [selectedExec, setSelectedExec] = useState<WorkflowExecution | null>(null);
    const [isMonitorMaximized, setIsMonitorMaximized] = useState(false);
    // Id of the execution whose detail is being fetched before its popup opens, so
    // the clicked row can show a loading indicator during the wait.
    const [loadingExecId, setLoadingExecId] = useState<string | null>(null);
    // Latest execution whose detail was requested, so a slower earlier fetch can't
    // clobber the selection when rows are clicked in quick succession.
    const detailReqRef = useRef<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [now, setNow] = useState(Date.now());

    const { token } = useAuth();

    // Effect for ticking timer
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    // Effect for WebSocket status updates
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let baseUrl = API_BASE_URL;
        if (baseUrl.startsWith('/')) {
            baseUrl = `${window.location.host}${baseUrl}`;
        } else {
            baseUrl = baseUrl.replace(/^http(s)?:\/\//, '');
        }

        const wsUrl = `${protocol}//${baseUrl}/ws?token=${token || ''}&status_only=true`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'status' && msg.target_type === 'workflow') {
                    setExecutions(prev => prev.map(exec => {
                        if (exec.id === msg.execution_id) {
                            const updates: Partial<WorkflowExecution> = { status: msg.status };
                            if (exec.status === 'RUNNING' && msg.status !== 'RUNNING' && !exec.finished_at) {
                                updates.finished_at = new Date().toISOString();
                            }
                            return { ...exec, ...updates };
                        }
                        return exec;
                    }));
                }
            } catch (err) {
                console.error('Failed to process status message:', err);
            }
        };

        ws.onopen = () => {
            // Subscribe to all currently running executions
            executions.forEach(exec => {
                if (exec.status === 'RUNNING') {
                    ws.send(JSON.stringify({
                        type: 'subscribe',
                        execution_id: exec.id
                    }));
                }
            });
        };

        return () => ws.close();
    }, [token]);

    // Effect to subscribe to running executions whenever list or connection changes
    useEffect(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN && executions.length > 0) {
            executions.forEach(exec => {
                if (exec.status === 'RUNNING') {
                    wsRef.current?.send(JSON.stringify({
                        type: 'subscribe',
                        execution_id: exec.id
                    }));
                }
            });
        }
    }, [executions, token]); // Re-subscribe if list changes or token changes (new WS)

    const loadPage = async (currentOffset: number, replace = false) => {
        if (replace) setLoading(true);
        else setLoadingMore(true);

        try {
            let url = '';
            if (workflowId) {
                url = `${API_BASE_URL}/workflows/${workflowId}/executions?limit=${PAGE_SIZE}&offset=${currentOffset}`;
            } else if (namespaceId) {
                url = `${API_BASE_URL}/namespaces/${namespaceId}/executions?limit=${PAGE_SIZE}&offset=${currentOffset}`;
            } else {
                return;
            }

            if (status && status !== 'ALL') url += `&status=${status}`;
            if (executedBy) url += `&executed_by=${executedBy}`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            if (tagIds && tagIds.length > 0) {
                tagIds.forEach(id => {
                    url += `&tag_ids=${id}`;
                });
            }

            const response = await apiFetch(url);
            if (response.ok) {
                const data = await response.json();
                const items: WorkflowExecution[] = Array.isArray(data) ? data : (data.items || []);
                const totalCount: number = Array.isArray(data) ? data.length : (data.total || 0);
                setTotal(totalCount);
                setExecutions(prev => replace ? items : [...prev, ...items]);
                // The namespace endpoint paginates parent executions only and ships their
                // child (sub-workflow / hook) rows alongside. Those children are nested by
                // renderExecutionTree, so advance the offset by the number of ROOT rows in
                // this page (parent missing => still a root, e.g. the per-workflow view).
                offsetRef.current = currentOffset + countRoots(items);
            }
        } catch (error) {
            console.error('Failed to fetch history:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const refresh = () => {
        offsetRef.current = 0;
        setExecutions([]);
        setTotal(0);
        loadPage(0, true);
    };

    useEffect(() => {
        if (workflowId || namespaceId) refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workflowId, namespaceId, status, executedBy, search, tagIds]);

    const fetchExecutionDetail = async (exec: WorkflowExecution) => {
        // Fetch the full execution (workflow groups+steps + per-step statuses)
        // BEFORE opening the popup, so the sidebar step tree is already populated
        // the moment the monitor appears. Falls back to the lightweight row on error.
        detailReqRef.current = exec.id;
        setLoadingExecId(exec.id);
        try {
            const response = await apiFetch(`${API_BASE_URL}/executions/${exec.id}`);
            const data = response.ok ? await response.json() : exec;
            if (detailReqRef.current !== exec.id) return; // a newer row was clicked
            setSelectedExec(data);
        } catch (error) {
            console.error('Failed to fetch execution detail:', error);
            if (detailReqRef.current === exec.id) setSelectedExec(exec);
        } finally {
            setLoadingExecId(cur => (cur === exec.id ? null : cur));
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'SUCCESS':
                return <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" />Success</Badge>;
            case 'FAILED':
                return <Badge variant="destructive" className="bg-red-500/10 text-red-500 border-red-500/20"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
            case 'CANCELLED':
                return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Cancelled</Badge>;
            case 'RUNNING':
                return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    // Run id, start, duration and runner used to read as one grey string. No frames — the
    // coloured icon plus breathing room is what separates them.
    const META_CHIP = "flex items-center gap-1 shrink-0";

    // Who launched the run. A schedule or a hook has no account behind it, and a Google
    // account may carry only an address.
    const runnerLabel = (exec: WorkflowExecution): string => {
        const user = exec.user;
        if (!user) return 'System';
        return user.full_name || user.username || user.email || 'System';
    };

    const getTriggerBadge = (exec: WorkflowExecution) => {
        switch (exec.trigger_source) {
            case 'SCHEDULE':
                return (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 font-black text-[10px] uppercase tracking-widest px-2 py-0.5">
                        <Calendar className="w-3 h-3 mr-1" /> Scheduled
                    </Badge>
                );
            case 'PAGE':
                return (
                    <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20 font-black text-[10px] uppercase tracking-widest px-2 py-0.5">
                        <FileText className="w-3 h-3 mr-1" /> Page: {exec.page?.title || 'Public'}
                    </Badge>
                );
            case 'HOOK':
                return (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 font-black text-[10px] uppercase tracking-widest px-2 py-0.5">
                        <Zap className="w-3 h-3 mr-1" /> Hook
                    </Badge>
                );
            case 'STEP':
                return (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-black text-[10px] uppercase tracking-widest px-2 py-0.5">
                        <Zap className="w-3 h-3 mr-1" /> Step Action
                    </Badge>
                );
            default:
                return (
                    <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/20 font-black text-[10px] uppercase tracking-widest px-2 py-0.5">
                        <Plus className="w-3 h-3 mr-1" /> Manual
                    </Badge>
                );
        }
    };

    const getDuration = (start: string, end?: string) => {
        const startTime = new Date(start).getTime();
        const endTime = end ? new Date(end).getTime() : now;
        const diff = Math.floor((endTime - startTime) / 1000);
        if (diff < 0) return '0s';
        if (diff < 60) return `${diff}s`;
        return `${Math.floor(diff / 60)}m ${diff % 60}s`;
    };

    const [expandedExecs, setExpandedExecs] = useState<Set<string>>(new Set());

    const toggleExpand = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setExpandedExecs(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Helper to group executions for nested display
    const renderExecutionTree = () => {
        // Group by parent
        const childrenMap: Record<string, WorkflowExecution[]> = {};
        const roots: WorkflowExecution[] = [];

        executions.forEach(exec => {
            if (exec.parent_execution_id) {
                if (!childrenMap[exec.parent_execution_id]) {
                    childrenMap[exec.parent_execution_id] = [];
                }
                childrenMap[exec.parent_execution_id].push(exec);
            } else {
                roots.push(exec);
            }
        });

        // Some "children" might have parents that aren't in this page/list
        // We should treat them as roots if their parent isn't found in executions
        executions.forEach(exec => {
            if (exec.parent_execution_id && !executions.find(e => e.id === exec.parent_execution_id)) {
                if (!roots.find(r => r.id === exec.id)) {
                    roots.push(exec);
                }
            }
        });

        const renderExecRow = (exec: WorkflowExecution, depth = 0) => {
            const hasChildren = childrenMap[exec.id]?.length > 0;
            const isExpanded = expandedExecs.has(exec.id);

            return (
                <div key={exec.id} className="space-y-2">
                    <Card
                        className={cn(
                            "bg-white/5 border-white/10 hover:bg-white/[0.08] transition-colors cursor-pointer group overflow-hidden relative",
                            depth > 0 && "ml-8 before:absolute before:left-[-20px] before:top-1/2 before:w-[20px] before:h-[1px] before:bg-white/10"
                        )}
                        onClick={() => fetchExecutionDetail(exec)}
                    >
                        <CardContent className="p-3 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className={cn(
                                    "w-1 h-9 rounded-full shrink-0",
                                    exec.status === 'SUCCESS' ? 'bg-green-500' :
                                        exec.status === 'FAILED' ? 'bg-red-500' :
                                            exec.status === 'CANCELLED' ? 'bg-yellow-500' : 'bg-blue-500'
                                )} />
                                {hasChildren && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 p-0 hover:bg-white/10 shrink-0"
                                        onClick={(e) => toggleExpand(e, exec.id)}
                                    >
                                        <ChevronDown className={cn("w-4 h-4 transition-transform", !isExpanded && "-rotate-90")} />
                                    </Button>
                                )}
                                <div className="space-y-1 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="shrink-0">{getStatusBadge(exec.status)}</span>
                                        <span
                                            className="text-sm font-bold text-foreground truncate min-w-0 flex-1"
                                            title={exec.workflow?.name}
                                        >
                                            {exec.workflow?.name || 'Workflow'}
                                        </span>
                                        <span className="shrink-0">{getTriggerBadge(exec)}</span>
                                    </div>
                                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground font-medium">
                                        <span className={cn(META_CHIP, "font-mono")}>#{exec.id.slice(0, 8)}</span>
                                        <span className={META_CHIP}>
                                            <Calendar className="w-3 h-3 text-sky-500" />
                                            {format(new Date(exec.started_at), 'MMM d, HH:mm:ss')}
                                        </span>
                                        <span className={META_CHIP}>
                                            <Clock className="w-3 h-3 text-amber-500" />
                                            {getDuration(exec.started_at, exec.finished_at)}
                                        </span>
                                        <span className={META_CHIP} title={exec.user?.email || undefined}>
                                            <UserRound className="w-3 h-3 text-emerald-500" />
                                            {runnerLabel(exec)}
                                        </span>
                                        {exec.workflow?.tags && exec.workflow.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1">
                                                {exec.workflow.tags.map(tag => (
                                                    <span
                                                        key={tag.id}
                                                        className="px-1 py-0 rounded text-[10px] font-bold border"
                                                        style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}
                                                    >
                                                        {tag.name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {loadingExecId === exec.id
                                ? <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                                : <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />}
                        </CardContent>
                    </Card>

                    {hasChildren && isExpanded && (
                        <div className="border-l border-white/10 ml-4 pl-4 space-y-2">
                            {childrenMap[exec.id].map(child => renderExecRow(child, depth + 1))}
                        </div>
                    )}
                </div>
            );
        };

        return roots.map(root => renderExecRow(root));
    };

    // `total` counts root executions only (children are nested), so page against roots.
    const parentCount = countRoots(executions);
    const hasMore = parentCount < total;

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4 pt-4">
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-emerald-500" />
                    <h3 className="font-semibold text-sm">Execution History</h3>
                    {total > 0 && (
                        <Badge variant="outline" className="text-[10px] font-black px-1.5 py-0">
                            {total} runs
                        </Badge>
                    )}
                </div>
                <Button variant="ghost" size="sm" onClick={refresh} className="gap-1 text-xs">
                    <RefreshCw className="w-3 h-3" /> Refresh
                </Button>
            </div>

            {executions.length === 0 ? (
                <div className="text-center py-12 bg-white/5 border border-dashed rounded-md">
                    <History className="w-8 h-8 mx-auto text-muted-foreground animate-pulse mb-2" />
                    <p className="text-sm text-muted-foreground">No execution history found.</p>
                </div>
            ) : (
                <div className="space-y-2 px-1">
                    {renderExecutionTree()}

                    {/* Load More button */}
                    {hasMore && (
                        <div className="pt-2 flex justify-center">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => loadPage(offsetRef.current)}
                                disabled={loadingMore}
                                className="gap-2 border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5 font-bold text-xs"
                            >
                                {loadingMore ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                )}
                                {loadingMore ? 'Loading...' : `Load more (${total - parentCount} remaining)`}
                            </Button>
                        </div>
                    )}
                    {!hasMore && parentCount >= PAGE_SIZE && (
                        <p className="text-center text-[10px] text-muted-foreground/40 font-bold uppercase tracking-widest pt-2">
                            All {total} runs loaded
                        </p>
                    )}
                </div>
            )}

            <Dialog open={!!selectedExec} onOpenChange={(open: boolean) => !open && setSelectedExec(null)}>
                <DialogContent hideClose className={cn(
                    "p-0 overflow-hidden bg-slate-950 border-white/10 shadow-2xl flex flex-col focus:outline-none transition-all duration-300",
                    isMonitorMaximized
                        ? "fixed inset-0 w-screen h-screen max-w-none rounded-none !m-0 border-0 translate-x-0 translate-y-0 left-0 top-0"
                        : "max-w-5xl w-[90vw] h-[85vh] rounded-md border-2"
                )}>
                    <DialogTitle className="sr-only">Execution Detail</DialogTitle>
                    {selectedExec && (
                        <ExecutionMonitor
                            // Re-key by execution id so switching to a different record
                            // remounts fresh (no stale workflow/steps); enriching the
                            // SAME record (row -> detail) keeps the id, so no remount.
                            key={selectedExec.id}
                            mode={selectedExec.status === 'RUNNING' ? 'LIVE' : 'HISTORICAL'}
                            execution={selectedExec}
                            onClose={() => setSelectedExec(null)}
                            isMaximized={isMonitorMaximized}
                            onMaximizedChange={setIsMonitorMaximized}
                            onReRun={onReRun}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default WorkflowHistory;
