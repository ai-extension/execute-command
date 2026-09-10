import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
    Zap, Loader2, Monitor, Terminal, Clock, Sun, Moon, Copy, Check, Link2, Search,
    FileText, ImageIcon, Frame, Activity, Table2, ArrowUp, Home, PanelLeftOpen, Sparkles
} from 'lucide-react';
import { cn, copyToClipboard as clipboardCopy } from '../lib/utils';
import { WidgetIcon } from '../lib/widgetIcons';
import { topWidthClass, childWidthClass } from '../lib/widgetSizes';
import { Page, PageWidget, PageLayout, WorkflowInput } from '../types';
import { Button } from '../components/ui/button';
import WorkflowInputDialog from '../components/WorkflowInputDialog';
import { API_BASE_URL } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
    HistoryMap,
    ExecutionHistoryEntry,
    loadHistory,
    saveHistory,
    appendEntry,
    updateEntryStatus,
} from '../lib/executionHistory';
import { resolveButtonStyle } from '../components/ButtonStylePicker';

// Extracted Components
import PasswordProtection from '../components/PasswordProtection';
import TerminalWidget from '../components/public/TerminalWidget';
import EndpointWidget from '../components/public/EndpointWidget';
import PageExecutionTerminal from '../components/public/PageExecutionTerminal';
import LoginDialog from '../components/LoginDialog';
import ChartWidget from '../components/public/ChartWidget';
import MetricWidget from '../components/public/MetricWidget';
import DatasetTableWidget from '../components/public/DatasetTableWidget';
import GaugeWidget from '../components/public/GaugeWidget';
import ProgressWidget from '../components/public/ProgressWidget';
import StatGridWidget from '../components/public/StatGridWidget';
import SparklineWidget from '../components/public/SparklineWidget';
import ParentSidebar from '../components/public/ParentSidebar';
import { DEFAULT_UPDATED_LABEL, isUpdatedBadgeVisible, localDate } from '../lib/updatedBadge';

// "Updated" flag shown on widgets whose updated_until window hasn't passed yet.
const UpdatedBadge: React.FC<{ label?: string; icon?: string }> = ({ label, icon }) => (
    <div className="absolute -top-2 -right-1 z-10 pointer-events-none">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-widest shadow-md">
            <WidgetIcon name={icon} fallback={Sparkles} className="w-2.5 h-2.5" />
            {label || DEFAULT_UPDATED_LABEL}
        </span>
    </div>
);

const PublicPageView = () => {
    const { slug } = useParams();
    const [page, setPage] = useState<Page | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [requiresPassword, setRequiresPassword] = useState(false);
    const [widgets, setWidgets] = useState<PageWidget[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const { showToast, apiFetch, isAuthenticated } = useAuth();
    const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false);

    // Token state
    const [pageToken, setPageToken] = useState<string | null>(null);
    const [tokenExpiresAt, setTokenExpiresAt] = useState<Date | null>(null);
    const [tokenExpired, setTokenExpired] = useState(false);

    // Execution State
    const [runningWidgets, setRunningWidgets] = useState<Record<string, boolean>>({});
    const [executionResults, setExecutionResults] = useState<Record<string, { success: boolean, message: string }>>({});

    // Input Modal State
    const [inputModal, setInputModal] = useState<{
        isOpen: boolean;
        widget: PageWidget | null;
        workflowInputs: WorkflowInput[];
    }>({
        isOpen: false,
        widget: null,
        workflowInputs: []
    });

    const closeInputModal = () => {
        setInputModal({ isOpen: false, widget: null, workflowInputs: [] });
    };

    // Execution history (persisted per slug in localStorage)
    const [historyMap, setHistoryMap] = useState<HistoryMap>({});

    // Resolve the real status of entries persisted as RUNNING. Public history lives in
    // localStorage and is only patched for the *active* run via the live terminal, so a
    // reload (or closing the terminal / starting another run) leaves finished records
    // stuck spinning forever. Reconcile them in a single batched request rather than one
    // call per record.
    const reconcileRunningStatuses = useCallback(async (map: HistoryMap) => {
        if (!slug) return;
        const runningIds = new Set<string>();
        Object.values(map).forEach(list =>
            list.forEach(e => { if (e.status === 'RUNNING') runningIds.add(e.executionId); })
        );
        if (runningIds.size === 0) return;
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (pageToken) headers['X-Page-Token'] = pageToken;
            // Raw fetch (not apiFetch): a tokenless reconcile on a password page returns
            // 401, and apiFetch would clear auth state + toast on non-ok. Mirror
            // EndpointWidget.openLog, which uses plain fetch for the same reason.
            const res = await fetch(`${API_BASE_URL}/public/pages/${slug}/execution-statuses`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ execution_ids: Array.from(runningIds) }),
            });
            if (!res.ok) return;
            const data = await res.json();
            const statuses: { id: string; status: string; executed_by?: string }[] = data.statuses || [];
            const resolved = statuses.filter(s => s.status && s.status !== 'RUNNING');
            if (resolved.length === 0) return;
            setHistoryMap(prev => {
                let next = prev;
                resolved.forEach(s => {
                    Object.keys(next).forEach(widgetId => {
                        if (next[widgetId].some(e => e.executionId === s.id)) {
                            next = updateEntryStatus(next, widgetId, s.id, s.status, s.executed_by);
                        }
                    });
                });
                return next;
            });
        } catch {
            // network/parse error: leave entries as-is, retried next time history opens
        }
    }, [slug, pageToken]);

    useEffect(() => {
        if (slug) {
            const loaded = loadHistory(slug);
            setHistoryMap(loaded);
            reconcileRunningStatuses(loaded);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);
    useEffect(() => {
        if (slug) saveHistory(slug, historyMap);
    }, [slug, historyMap]);

    // Log Streaming State
    const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
    const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
    const [executionLogs, setExecutionLogs] = useState<string>('');
    const [executionStatus, setExecutionStatus] = useState<string | null>(null);
    const [isPollingLogs, setIsPollingLogs] = useState(false);
    const [terminalState, setTerminalState] = useState<'normal' | 'minimized' | 'maximized'>('normal');

    useEffect(() => {
        if (executionStatus === 'SUCCESS' || executionStatus === 'FAILED' || executionStatus === 'CANCELLED') {
            if (activeWidgetId) {
                setRunningWidgets(prev => ({ ...prev, [activeWidgetId]: false }));
                setTimeout(() => {
                    setExecutionResults(prev => {
                        const n = { ...prev };
                        delete n[activeWidgetId];
                        return n;
                    });
                }, 3000);
            }
        }
    }, [executionStatus, activeWidgetId]);
    const { setTheme: setGlobalTheme } = useTheme();
    const [publicTheme, setPublicTheme] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('public-theme') as 'light' | 'dark') || 'light';
    });
    const [isCopied, setIsCopied] = useState(false);

    // Scroll-to-top button visibility
    const [showScrollTop, setShowScrollTop] = useState(false);
    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

    // Parent-widgets floating drawer. Closed by default; a persisted '0' means the visitor
    // explicitly opened it before, so we restore that. Any other value (including no key)
    // keeps it closed.
    const [parentSidebarCollapsed, setParentSidebarCollapsed] = useState<boolean>(
        () => localStorage.getItem('public-parent-sidebar-collapsed') !== '0'
    );
    useEffect(() => {
        localStorage.setItem('public-parent-sidebar-collapsed', parentSidebarCollapsed ? '1' : '0');
    }, [parentSidebarCollapsed]);

    // Persist public-theme separately and drive global ThemeProvider so it doesn't override us
    useEffect(() => {
        localStorage.setItem('public-theme', publicTheme);
        setGlobalTheme(publicTheme);
    }, [publicTheme, setGlobalTheme]);

    // Restore admin theme (both localStorage + class) on unmount
    useEffect(() => {
        const originalTheme = (localStorage.getItem('admin-theme') as 'light' | 'dark')
            || (localStorage.getItem('theme') as 'light' | 'dark')
            || 'dark';
        // Snapshot admin theme so we can restore on unmount even after we overwrite "theme"
        localStorage.setItem('admin-theme', originalTheme);
        return () => {
            localStorage.setItem('theme', originalTheme);
            localStorage.removeItem('admin-theme');
            if (originalTheme === 'dark') {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        };
    }, []);

    const togglePublicTheme = () => {
        setPublicTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    const copyPublicUrl = async () => {
        const success = await clipboardCopy(window.location.href);
        if (success) {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }
    };

    const fetchPageContent = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const url = `${API_BASE_URL}/public/pages/${slug}`;
            const response = await apiFetch(url);
            const data = await response.json();

            if (response.status === 410) {
                setError('This link has expired.');
                setIsLoading(false);
                return;
            }

            if (!response.ok && !data.is_public && !isAuthenticated) {
                setIsLoginDialogOpen(true);
            }

            if (response.status === 401 || data.requires_password) {
                setRequiresPassword(true);
                setPage(data);
            } else if (!response.ok) {
                setError(data.error || 'Access Terminated');
            } else {
                setPage(data);
                setIsAuthorized(true);
                setRequiresPassword(false);
                if (data.layout) {
                    try {
                        const layout: PageLayout = JSON.parse(data.layout);
                        setWidgets(layout.widgets || []);
                    } catch (_) {
                        setWidgets([]);
                    }
                }
            }
        } catch (err) {
            setError('Connection Failure');
        } finally {
            setIsLoading(false);
        }
    }, [slug, isAuthenticated, apiFetch]);

    useEffect(() => {
        fetchPageContent();
    }, [fetchPageContent]);

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsVerifying(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/public/pages/${slug}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await response.json();
            if (response.ok) {
                const pageData = data.page || data;
                setPage(pageData);
                setIsAuthorized(true);
                setRequiresPassword(false);
                setTokenExpired(false);
                setError(null);
                if (data.token) {
                    setPageToken(data.token);
                    setTokenExpiresAt(data.expires_at ? new Date(data.expires_at) : null);
                }
                if (pageData.layout) {
                    try {
                        const layout: PageLayout = JSON.parse(pageData.layout);
                        setWidgets(layout.widgets || []);
                    } catch (_) { }
                }
            } else {
                setError('Invalid password.');
            }
        } catch (err) {
            setError('Verification failed.');
        } finally {
            setIsVerifying(false);
        }
    };

    // Expiry watcher
    useEffect(() => {
        if (!tokenExpiresAt || !isAuthorized) return;
        const check = setInterval(() => {
            if (new Date() >= tokenExpiresAt) {
                setTokenExpired(true);
                setIsAuthorized(false);
                setRequiresPassword(true);
                setPageToken(null);
                setTokenExpiresAt(null);
                clearInterval(check);
            }
        }, 5000);
        return () => clearInterval(check);
    }, [tokenExpiresAt, isAuthorized]);

    // Auto-close completion alert removed in favor of global toast

    // Logs Polling replaced by WebSocket in PageExecutionTerminal

    const runWidget = async (widget: PageWidget, inputs: Record<string, string> = {}) => {
        if (widget.type !== 'ENDPOINT' || !widget.workflow_id) {
            setExecutionResults(prev => ({ ...prev, [widget.id]: { success: false, message: 'INVALID CONFIG' } }));
            return;
        }

        const pw = page?.workflows?.find(p => p.workflow_id === widget.workflow_id);
        const workflowInputs = pw?.workflow?.inputs || [];

        if (workflowInputs.length > 0 && Object.keys(inputs).length === 0) {
            setInputModal({
                isOpen: true,
                widget,
                workflowInputs
            });
            return;
        }

        setInputModal({ isOpen: false, widget: null, workflowInputs: [] });

        // Clear previous execution state before starting new request
        if (activeWidgetId && activeWidgetId !== widget.id) {
            setRunningWidgets(prev => ({ ...prev, [activeWidgetId]: false }));
            setExecutionResults(prev => {
                const n = { ...prev };
                delete n[activeWidgetId];
                return n;
            });
        }
        setActiveExecutionId(null);
        setActiveWidgetId(null);
        setExecutionStatus(null);
        setExecutionLogs('');
        setIsPollingLogs(false);

        setRunningWidgets(prev => ({ ...prev, [widget.id]: true }));
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (pageToken) headers['X-Page-Token'] = pageToken;

            const response = await apiFetch(`${API_BASE_URL}/public/pages/${slug}/run/${widget.workflow_id}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ inputs })
            });

            if (response.status === 401) {
                setTokenExpired(true); setIsAuthorized(false);
                return;
            }

            const data = await response.json();
            if (response.ok) {
                setExecutionResults(prev => ({ ...prev, [widget.id]: { success: true, message: 'SUCCESS' } }));

                // Always track execution in background for status updates
                setActiveExecutionId(data.execution_id);
                setActiveWidgetId(widget.id);
                setExecutionStatus('RUNNING');
                setIsPollingLogs(true);

                // Persist history entry for this run
                if (data.execution_id) {
                    const entry: ExecutionHistoryEntry = {
                        executionId: data.execution_id,
                        widgetId: widget.id,
                        workflowId: widget.workflow_id,
                        inputs,
                        status: 'RUNNING',
                        timestamp: Date.now(),
                        executedBy: data.executed_by || undefined,
                    };
                    setHistoryMap(prev => appendEntry(prev, entry));
                }

                // Determine if logs should be shown (check widget config then fallback to page workflow config)
                const showLog = widget.show_log ?? page?.workflows?.find(pw => pw.workflow_id === widget.workflow_id)?.show_log ?? false;

                if (showLog) {
                    setExecutionLogs('Initializing trace...');
                    setTerminalState('normal');
                } else {
                    showToast('Workflow execution initiated.', 'success');
                }
            } else {
                setExecutionResults(prev => ({ ...prev, [widget.id]: { success: false, message: data.error || 'FAILED' } }));
                showToast(`Execution failed: ${data.error || 'Unknown error'}`, 'error');
            }
        } catch (err) {
            setExecutionResults(prev => ({ ...prev, [widget.id]: { success: false, message: 'ERROR' } }));
            showToast('Error connecting to server.', 'error');
        } finally {
            // No-op: We wait for WebSocket status broadcast to cleanup running state
        }
    };

    const stopWidget = async (widget: PageWidget) => {
        if (!activeExecutionId) return;

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (pageToken) headers['X-Page-Token'] = pageToken;

            await apiFetch(`${API_BASE_URL}/public/pages/${slug}/executions/${activeExecutionId}/stop`, {
                method: 'POST',
                headers
            });
            // The WebSocket will broadcast CANCELLED status, triggering the cleanup automatically
        } catch (err) {
            console.error('Failed to stop execution:', err);
        }
    };

    if (isLoading && !page) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
                <h1 className="text-xl font-bold uppercase ">Establishing Link</h1>
            </div>
        );
    }

    if (requiresPassword && !isAuthorized) {
        return (
            <>
                <PasswordProtection
                    pageTitle={page?.title || ''}
                    password={password}
                    setPassword={setPassword}
                    onSubmit={handlePasswordSubmit}
                    isVerifying={isVerifying}
                    error={error}
                    tokenExpired={tokenExpired}
                    onAdminLogin={() => setIsLoginDialogOpen(true)}
                />
                <LoginDialog
                    isOpen={isLoginDialogOpen}
                    onOpenChange={setIsLoginDialogOpen}
                />
            </>
        );
    }

    // Parent widgets sidebar: only when this page opted in AND the backend actually
    // returned the parent's layout (stripped otherwise). Parsed read-only for display.
    let parentWidgets: PageWidget[] = [];
    if (page?.show_parent_sidebar && page?.parent?.layout) {
        try {
            const pl: PageLayout = JSON.parse(page.parent.layout);
            parentWidgets = pl.widgets || [];
        } catch (_) { /* malformed parent layout — skip sidebar */ }
    }
    const hasParentSidebar = !!(page?.parent?.slug && parentWidgets.length > 0);

    return (
        <div className="min-h-screen transition-colors duration-300">
            <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 pb-20">
                <header className="fixed top-0 left-0 right-0 h-1 bg-primary z-50 shadow-lg" />

                {/* Floating Navigation / Auth / Theme Tools */}
                <div className="fixed top-6 right-6 z-50 flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-10 w-10 rounded-md glass shadow-premium border-white/10"
                        onClick={copyPublicUrl}
                        title="Copy Public Link"
                    >
                        {isCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-10 w-10 rounded-md glass shadow-premium border-white/10"
                        onClick={togglePublicTheme}
                        title={`Switch to ${publicTheme === 'dark' ? 'light' : 'dark'} mode`}
                    >
                        {publicTheme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
                    </Button>
                </div>

                <main className="max-w-6xl mx-auto px-6 pt-24 pb-32">
                    <div className="flex flex-col items-center text-center mb-16 space-y-4">
                        <h1 className="text-5xl md:text-7xl font-black ">{page?.title}</h1>
                        <p className="text-lg text-muted-foreground font-medium italic opacity-70">
                            {page?.description || "Interactive control center."}
                        </p>

                        <div className="flex items-center gap-6 pt-2">
                            {page?.parent?.slug && (
                                <a
                                    href={`/public/pages/${page.parent.slug}`}
                                    className="flex items-center gap-2 text-muted-foreground hover:text-amber-500 transition-colors group"
                                    title={`Back to ${page.parent.title || 'parent page'}`}
                                >
                                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20 transition-colors">
                                        <Home className="w-4 h-4" />
                                    </span>
                                    <span className="text-xs font-black uppercase">{page.parent.title || 'Parent page'}</span>
                                </a>
                            )}
                            <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-primary" />
                                <span className="text-xs font-black uppercase  text-muted-foreground">
                                    {widgets.filter(w => w.type === 'ENDPOINT').length} Endpoints
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-emerald-500" />
                                <span className="text-xs font-black uppercase  text-muted-foreground">
                                    {widgets.filter(w => w.type === 'TERMINAL').length} Terminals
                                </span>
                            </div>
                        </div>

                        {tokenExpiresAt && (
                            <div className="flex items-center gap-2 pt-1 opacity-50">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span className="text-[10px] font-bold text-muted-foreground uppercase ">
                                    Session expires at {tokenExpiresAt.toLocaleTimeString()}
                                </span>
                            </div>
                        )}
                    </div>

                    {widgets.length > 0 && (
                        <div className="mb-10 max-w-xl mx-auto">
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search widgets..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full h-12 pl-11 pr-4 bg-card border border-border rounded-md shadow-sm focus:ring-2 ring-primary/20 focus:border-primary/40 outline-none transition-all placeholder:text-muted-foreground/50 font-medium text-sm"
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-x-[20px] gap-y-8 items-start">
                        {(() => {
                            // Badge window is judged against the server's calendar date
                            // (page.server_time carries the server's own offset), so a
                            // visitor with a skewed clock sees the same thing everyone else does.
                            const today = page?.server_time ? page.server_time.slice(0, 10) : localDate();
                            const isUpdated = (widget: PageWidget) => isUpdatedBadgeVisible(widget, today);

                            const matchesSearch = (widget: PageWidget) => {
                                if (!searchQuery) return true;
                                const q = searchQuery.toLowerCase();
                                const wTitle = (widget.title || '').toLowerCase();
                                const wDesc = (widget.description || '').toLowerCase();
                                return wTitle.includes(q) || wDesc.includes(q);
                            };

                            const renderWidgetBody = (widget: PageWidget): React.ReactNode => {
                                if (widget.type === 'ENDPOINT') {
                                    return (
                                        <EndpointWidget
                                            widget={widget}
                                            isRunning={runningWidgets[widget.id]}
                                            result={executionResults[widget.id]}
                                            onRun={runWidget}
                                            onStop={stopWidget}
                                            history={historyMap[widget.id] || []}
                                            slug={slug}
                                            pageToken={pageToken}
                                            onOpenHistory={() => reconcileRunningStatuses(historyMap)}
                                            workflowInputs={page?.workflows?.find(p => p.workflow_id === widget.workflow_id)?.workflow?.inputs || []}
                                        />
                                    );
                                }
                                if (widget.type === 'TERMINAL') {
                                    return (
                                        <TerminalWidget
                                            widget={widget}
                                            slug={slug || ''}
                                            pageToken={pageToken}
                                        />
                                    );
                                }
                                if (widget.type === 'LINK') {
                                    return (
                                        <div className="group bg-card border border-border rounded-md overflow-hidden hover:border-foreground/20 transition-all shadow-sm h-full flex flex-col">
                                            <div className="flex items-center gap-4 px-8 py-4 border-b border-border bg-card">
                                                <div className="p-2.5 rounded-md bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
                                                    <WidgetIcon name={widget.icon} fallback={Link2} className="w-4 h-4" />
                                                </div>
                                                <div className="flex flex-col min-w-0 flex-1">
                                                    <span className="text-sm font-black truncate">{widget.title || 'Link'}</span>
                                                </div>
                                            </div>
                                            <div className="p-8 flex-1 flex flex-col justify-center">
                                                {widget.description && (
                                                    <p className="text-sm text-muted-foreground mb-4 px-1 whitespace-pre-wrap">{widget.description}</p>
                                                )}
                                                {(() => {
                                                    const r = resolveButtonStyle(widget.style, 'bg-indigo-600');
                                                    return (
                                                        <a href={widget.url || '#'} target={widget.new_tab ? "_blank" : "_self"} rel="noreferrer"
                                                            style={r.style}
                                                            className={cn("h-14 w-full rounded-md flex items-center justify-center text-white font-black text-[10px] shadow-sm cursor-pointer transition-all active:scale-[0.98] hover:brightness-110", r.className)}>
                                                            <Link2 className="w-4 h-4 mr-2" />
                                                            {widget.label || 'OPEN LINK'}
                                                        </a>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    );
                                }
                                if (widget.type === 'TEXT') {
                                    return (
                                        <div className="bg-card border border-border rounded-md overflow-hidden shadow-sm h-full flex flex-col">
                                            <div className="flex items-center gap-4 px-8 py-4 border-b border-border bg-card">
                                                <div className="p-2.5 rounded-md bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20">
                                                    <WidgetIcon name={widget.icon} fallback={FileText} className="w-4 h-4" />
                                                </div>
                                                <span className="text-sm font-black truncate">{widget.title || 'Text'}</span>
                                            </div>
                                            <div className="p-8 flex-1">
                                                <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{widget.content || ''}</div>
                                            </div>
                                        </div>
                                    );
                                }
                                if (widget.type === 'IMAGE') {
                                    return (
                                        <div className="bg-card border border-border rounded-md overflow-hidden shadow-sm h-full flex flex-col">
                                            <div className="flex items-center gap-4 px-8 py-4 border-b border-border bg-card">
                                                <div className="p-2.5 rounded-md bg-pink-500/10 text-pink-500 ring-1 ring-pink-500/20">
                                                    <WidgetIcon name={widget.icon} fallback={ImageIcon} className="w-4 h-4" />
                                                </div>
                                                <span className="text-sm font-black truncate">{widget.title || 'Image'}</span>
                                            </div>
                                            <div className="p-6 flex-1 flex items-center justify-center">
                                                {widget.image_url ? (
                                                    <img src={widget.image_url} alt={widget.alt_text || ''} className="w-full h-auto max-h-[500px] object-contain rounded-md" />
                                                ) : (
                                                    <div className="h-48 w-full flex items-center justify-center rounded-md bg-muted/20 text-muted-foreground">
                                                        <ImageIcon className="w-12 h-12 opacity-20" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }
                                if (widget.type === 'IFRAME') {
                                    return (
                                        <div className="bg-card border border-border rounded-md overflow-hidden shadow-sm h-full flex flex-col">
                                            <div className="flex items-center gap-4 px-8 py-4 border-b border-border bg-card">
                                                <div className="p-2.5 rounded-md bg-violet-500/10 text-violet-500 ring-1 ring-violet-500/20">
                                                    <WidgetIcon name={widget.icon} fallback={Frame} className="w-4 h-4" />
                                                </div>
                                                <span className="text-sm font-black truncate">{widget.title || 'Embedded Content'}</span>
                                            </div>
                                            <div className="p-4 flex-1">
                                                {widget.iframe_url ? (
                                                    <iframe
                                                        src={widget.iframe_url}
                                                        className="w-full rounded-md border border-border/50"
                                                        style={{ height: widget.iframe_height || 400 }}
                                                        sandbox="allow-scripts allow-same-origin allow-popups"
                                                        title={widget.title || 'Embedded content'}
                                                    />
                                                ) : (
                                                    <div className="h-48 flex items-center justify-center rounded-md bg-violet-500/5 border border-violet-500/20 text-violet-400">
                                                        <Frame className="w-8 h-8 opacity-30" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }
                                if (widget.type === 'STATUS') {
                                    const statusColors: Record<string, { bg: string; text: string; dot: string; ring: string }> = {
                                        ok: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', dot: 'bg-emerald-500', ring: 'ring-emerald-500/20' },
                                        warning: { bg: 'bg-amber-500/10', text: 'text-amber-500', dot: 'bg-amber-500', ring: 'ring-amber-500/20' },
                                        error: { bg: 'bg-rose-500/10', text: 'text-rose-500', dot: 'bg-rose-500', ring: 'ring-rose-500/20' },
                                        info: { bg: 'bg-sky-500/10', text: 'text-sky-500', dot: 'bg-sky-500', ring: 'ring-sky-500/20' },
                                    };
                                    const sc = statusColors[widget.status_value || 'ok'];
                                    return (
                                        <div className={cn("border rounded-md overflow-hidden shadow-sm h-full flex flex-col", sc.bg, `border-${(widget.status_value || 'ok') === 'ok' ? 'emerald' : (widget.status_value || 'ok') === 'warning' ? 'amber' : (widget.status_value || 'ok') === 'error' ? 'rose' : 'sky'}-500/20`)}>
                                            <div className="p-8 flex flex-col items-center justify-center gap-3 flex-1">
                                                {widget.icon
                                                    ? <WidgetIcon name={widget.icon} fallback={Activity} className={cn("w-7 h-7", sc.text)} />
                                                    : <div className={cn("w-4 h-4 rounded-full animate-pulse shadow-lg", sc.dot)} />}
                                                <span className={cn("text-lg font-black uppercase tracking-tight", sc.text)}>{widget.status_label || 'Status'}</span>
                                                {widget.description && (
                                                    <p className="text-xs text-muted-foreground text-center">{widget.description}</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }
                                if (widget.type === 'TABLE') {
                                    if (widget.data_source === 'dataset') {
                                        return <DatasetTableWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                    }
                                    return (
                                        <div className="bg-card border border-border rounded-md overflow-hidden shadow-sm h-full flex flex-col">
                                            <div className="flex items-center gap-4 px-8 py-4 border-b border-border bg-card">
                                                <div className="p-2.5 rounded-md bg-orange-500/10 text-orange-500 ring-1 ring-orange-500/20">
                                                    <WidgetIcon name={widget.icon} fallback={Table2} className="w-4 h-4" />
                                                </div>
                                                <span className="text-sm font-black truncate">{widget.title || 'Data Table'}</span>
                                            </div>
                                            <div className="p-6 flex-1 overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead>
                                                        <tr className="border-b-2 border-border">
                                                            {(widget.table_headers || []).map((h, i) => (
                                                                <th key={i} className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-muted-foreground">{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(widget.table_rows || []).map((row, ri) => (
                                                            <tr key={ri} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                                                                {row.map((cell, ci) => (
                                                                    <td key={ci} className="px-4 py-2.5 text-foreground/80 whitespace-pre-wrap">{cell}</td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                {(!widget.table_rows || widget.table_rows.length === 0) && (
                                                    <p className="text-center text-muted-foreground/50 py-8 text-sm font-medium">No data</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }
                                if (widget.type === 'CHART') {
                                    return <ChartWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                }
                                if (widget.type === 'METRIC') {
                                    return <MetricWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                }
                                if (widget.type === 'GAUGE') {
                                    return <GaugeWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                }
                                if (widget.type === 'PROGRESS') {
                                    return <ProgressWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                }
                                if (widget.type === 'STAT_GRID') {
                                    return <StatGridWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                }
                                if (widget.type === 'SPARKLINE') {
                                    return <SparklineWidget widget={widget} slug={slug} pageToken={pageToken} />;
                                }
                                return null;
                            };

                            // Top-level / section frame width (viewport-responsive). Section children
                            // size as a fraction of the SECTION's own width (see childWidthClass);
                            // a min-width floor makes them wrap down when the section is too narrow.
                            const widthFor = (widget: PageWidget) => topWidthClass(widget.size);
                            const childWidthFor = (widget: PageWidget) => childWidthClass(widget.size);

                            const topLevel = widgets.filter(w => !w.parent_id);

                            return topLevel.map(widget => {
                                if (widget.type === 'SECTION') {
                                    const children = widgets.filter(w => w.parent_id === widget.id);
                                    const visibleChildren = children.filter(matchesSearch);
                                    if (!matchesSearch(widget) && visibleChildren.length === 0) return null;
                                    return (
                                        <div key={widget.id} className={cn(widthFor(widget), 'relative')}>
                                            {isUpdated(widget) && <UpdatedBadge label={widget.updated_label} icon={widget.updated_icon} />}
                                            {!widget.hide_header && (
                                                <div className="pt-4 pb-3 border-b-2 border-border/50 mb-6">
                                                    <h2 className="text-2xl font-black flex items-center gap-2.5">
                                                        {widget.icon && <WidgetIcon name={widget.icon} className="w-6 h-6 text-primary" />}
                                                        {widget.title || 'Section Header'}
                                                    </h2>
                                                    {widget.description && (
                                                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{widget.description}</p>
                                                    )}
                                                </div>
                                            )}
                                            {visibleChildren.length > 0 && (
                                                <div className="flex flex-wrap gap-x-[20px] gap-y-8 items-start">
                                                    {visibleChildren.map(child => {
                                                        const body = renderWidgetBody(child);
                                                        if (!body) return null;
                                                        return (
                                                            <div key={child.id} className={cn(childWidthFor(child), 'relative')}>
                                                                {isUpdated(child) && <UpdatedBadge label={child.updated_label} icon={child.updated_icon} />}
                                                                {body}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }
                                if (!matchesSearch(widget)) return null;
                                const body = renderWidgetBody(widget);
                                if (!body) return null;
                                return (
                                    <div key={widget.id} className={cn(widthFor(widget), 'relative')}>
                                        {isUpdated(widget) && <UpdatedBadge label={widget.updated_label} icon={widget.updated_icon} />}
                                        {body}
                                    </div>
                                );
                            });
                        })()}
                    </div>

                    {widgets.length === 0 && (
                        <div className="py-32 text-center opacity-30">
                            <Monitor className="w-12 h-12 mx-auto mb-4" />
                            <p className="text-sm font-bold uppercase">No nodes deployed</p>
                        </div>
                    )}
                </main>

                <WorkflowInputDialog
                    isOpen={inputModal.isOpen}
                    onOpenChange={(open) => !open && closeInputModal()}
                    inputs={inputModal.workflowInputs}
                    confirmLabel="Confirm & Launch"
                    uploadUrl={`${API_BASE_URL}/public/pages/${slug}/upload-input`}
                    headers={pageToken ? { 'X-Page-Token': pageToken } : {}}
                    onConfirm={(values) => {
                        if (inputModal.widget) {
                            runWidget(inputModal.widget, values);
                        }
                    }}
                    onCancel={closeInputModal}
                    storageKey={inputModal.widget ? `public:${slug}:widget:${inputModal.widget.id}` : undefined}
                    title={inputModal.widget?.workflow_name || inputModal.widget?.title || 'Workflow Inputs'}
                />

                {activeExecutionId && slug && (() => {
                    const currentWidget = widgets.find(w => w.id === activeWidgetId);
                    const currentShowLog = currentWidget?.show_log ?? page?.workflows?.find(pw => pw.workflow_id === currentWidget?.workflow_id)?.show_log ?? false;

                    return (
                        <PageExecutionTerminal
                            activeExecutionId={activeExecutionId}
                            workflowId={currentWidget?.workflow_id}
                            slug={slug}
                            pageToken={pageToken}
                            terminalState={terminalState}
                            setTerminalState={setTerminalState}
                            onClose={() => {
                                const widgetId = activeWidgetId;
                                setActiveExecutionId(null);
                                setActiveWidgetId(null);
                                setExecutionStatus(null);
                                setIsPollingLogs(false);
                                // Cleanup runningWidgets and executionResults after a delay
                                if (widgetId) {
                                    setRunningWidgets(prev => ({ ...prev, [widgetId]: false }));
                                    setTimeout(() => {
                                        setExecutionResults(prev => {
                                            const n = { ...prev };
                                            delete n[widgetId];
                                            return n;
                                        });
                                    }, 3000);
                                }
                            }}
                            onStatusChange={(status: string) => {
                                setExecutionStatus(status);
                                if (activeWidgetId && activeExecutionId) {
                                    setHistoryMap(prev => updateEntryStatus(prev, activeWidgetId, activeExecutionId, status));
                                }
                                if (status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED') {
                                    if (activeWidgetId) {
                                        setExecutionResults(prev => ({
                                            ...prev,
                                            [activeWidgetId]: { success: status === 'SUCCESS', message: status }
                                        }));

                                        showToast(status === 'SUCCESS' ? 'Workflow executed successfully!' :
                                            status === 'CANCELLED' ? 'Workflow cancelled.' : 'Workflow execution failed.',
                                            status === 'SUCCESS' ? 'success' : 'error'
                                        );

                                        if (!currentShowLog) {
                                            // Auto cleanup for hidden trackers
                                            setTimeout(() => {
                                                setRunningWidgets(prev => ({ ...prev, [activeWidgetId]: false }));
                                                setTimeout(() => {
                                                    setExecutionResults(prev => {
                                                        const n = { ...prev };
                                                        delete n[activeWidgetId];
                                                        return n;
                                                    });
                                                    setActiveExecutionId(null);
                                                    setActiveWidgetId(null);
                                                }, 3000);
                                            }, 1000);
                                        }
                                    }
                                }
                            }}
                            isHidden={!currentShowLog}
                        />
                    );
                })()}

                <LoginDialog
                    isOpen={isLoginDialogOpen}
                    onOpenChange={setIsLoginDialogOpen}
                />

                {/* Go to Top floating button */}
                {showScrollTop && (
                    <button
                        onClick={scrollToTop}
                        className="fixed bottom-8 right-8 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-110 transition-all duration-200 animate-in fade-in slide-in-from-bottom-4"
                        title="Back to top"
                    >
                        <ArrowUp className="w-5 h-5" />
                    </button>
                )}

                {/* Parent widgets: floating drawer. Closed by default it's just an edge button
                    (like the scroll-to-top control); opening it overlays a floating card on the
                    left margin — fixed, so it never pushes or reflows the page content. */}
                {hasParentSidebar && page?.parent && (
                    parentSidebarCollapsed ? (
                        <button
                            onClick={() => setParentSidebarCollapsed(false)}
                            title={`Show ${page.parent.title || 'parent'} widgets`}
                            className="fixed top-32 left-6 z-50 px-2 py-3 rounded-full bg-card border border-border text-foreground shadow-lg flex flex-col items-center gap-2 hover:scale-105 hover:border-primary/50 transition-all duration-200 animate-in fade-in slide-in-from-left-4"
                        >
                            <PanelLeftOpen className="w-4 h-4" />
                            <span className="text-xs font-black uppercase tracking-widest [writing-mode:vertical-rl]">Sidebar</span>
                        </button>
                    ) : (
                        <div className="fixed left-6 top-32 z-50 w-72 max-w-[calc(100vw-3rem)] animate-in fade-in slide-in-from-left-4 duration-200">
                            <ParentSidebar
                                parentTitle={page.parent.title}
                                parentSlug={page.parent.slug}
                                widgets={parentWidgets}
                                onCollapse={() => setParentSidebarCollapsed(true)}
                            />
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

export default PublicPageView;
