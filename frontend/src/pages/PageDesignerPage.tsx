import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Save, ChevronLeft, Plus, Trash2, GripVertical, ArrowLeft, ArrowRight,
    Settings as SettingsIcon, Globe, Lock, Copy,
    Terminal, Zap, Monitor, RefreshCw, X, Palette, Clock, ServerIcon, Link2, Type,
    FileText, ImageIcon, Frame, Activity, Table2, BarChart3, TrendingUp,
    Gauge, Target, LayoutGrid, Sparkles
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { cn, copyToClipboard as clipboardCopy } from '../lib/utils';
import { PageWidget, PageLayout, Server, Workflow, Tag } from '../types';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useNamespace } from '../context/NamespaceContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';
import { SearchableSelect } from '../components/SearchableSelect';
import { TagSelector } from '../components/TagSelector';
import { ButtonStylePicker, resolveButtonStyle } from '../components/ButtonStylePicker';
import { DatasetSourceConfig } from '../components/page-designer/DatasetSourceConfig';
import { searchIcons, WidgetIcon } from '../lib/widgetIcons';
import { DEFAULT_UPDATED_LABEL } from '../lib/updatedBadge';
import { PAGE_WIDGET_SIZES, SIZE_LABELS, normalizeWidgetSize, editorTopWidthClass, childWidthClass } from '../lib/widgetSizes';


const generateId = () => Math.random().toString(36).slice(2, 10);

// ---- Palette / widget factory ----

interface PaletteItem {
    type: PageWidget['type'];
    label: string;
    description: string;
    icon: React.ReactNode;
    iconClass: string; // Full tailwind class fragment so JIT picks each color up.
    requiresTerminal?: boolean;
    groupHeading?: string; // When set, renders a section heading BEFORE this item.
}

const PALETTE_ITEMS: PaletteItem[] = [
    { type: 'ENDPOINT', label: 'Endpoint', description: 'Workflow trigger button',
      icon: <Zap className="w-3.5 h-3.5" />,
      iconClass: 'bg-primary/10 text-primary group-hover:bg-primary/20' },
    { type: 'TERMINAL', label: 'Terminal Screen', description: 'Command output display',
      icon: <Terminal className="w-3.5 h-3.5" />,
      iconClass: 'bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/20',
      requiresTerminal: true },
    { type: 'LINK', label: 'External Link', description: 'Quick link button',
      icon: <Link2 className="w-3.5 h-3.5" />,
      iconClass: 'bg-indigo-500/10 text-indigo-500 group-hover:bg-indigo-500/20' },
    { type: 'SECTION', label: 'Section Header', description: 'Title and description',
      icon: <Type className="w-3.5 h-3.5" />,
      iconClass: 'bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20' },
    { type: 'TEXT', label: 'Text Block', description: 'Rich text content',
      icon: <FileText className="w-3.5 h-3.5" />,
      iconClass: 'bg-sky-500/10 text-sky-500 group-hover:bg-sky-500/20',
      groupHeading: 'Content Widgets' },
    { type: 'IMAGE', label: 'Image', description: 'Display an image',
      icon: <ImageIcon className="w-3.5 h-3.5" />,
      iconClass: 'bg-pink-500/10 text-pink-500 group-hover:bg-pink-500/20' },
    { type: 'IFRAME', label: 'Iframe Embed', description: 'Embed external content',
      icon: <Frame className="w-3.5 h-3.5" />,
      iconClass: 'bg-violet-500/10 text-violet-500 group-hover:bg-violet-500/20' },
    { type: 'STATUS', label: 'Status Indicator', description: 'Show service status',
      icon: <Activity className="w-3.5 h-3.5" />,
      iconClass: 'bg-teal-500/10 text-teal-500 group-hover:bg-teal-500/20' },
    { type: 'TABLE', label: 'Data Table', description: 'Static or dataset rows',
      icon: <Table2 className="w-3.5 h-3.5" />,
      iconClass: 'bg-orange-500/10 text-orange-500 group-hover:bg-orange-500/20' },
    { type: 'CHART', label: 'Chart', description: 'Bar, line, pie, area',
      icon: <BarChart3 className="w-3.5 h-3.5" />,
      iconClass: 'bg-cyan-500/10 text-cyan-500 group-hover:bg-cyan-500/20' },
    { type: 'METRIC', label: 'Metric / KPI', description: 'Big number from dataset',
      icon: <TrendingUp className="w-3.5 h-3.5" />,
      iconClass: 'bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/20' },
    { type: 'GAUGE', label: 'Gauge', description: 'Radial value vs thresholds',
      icon: <Gauge className="w-3.5 h-3.5" />,
      iconClass: 'bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20' },
    { type: 'PROGRESS', label: 'Progress Bar', description: 'Value toward a target',
      icon: <Target className="w-3.5 h-3.5" />,
      iconClass: 'bg-sky-500/10 text-sky-500 group-hover:bg-sky-500/20' },
    { type: 'STAT_GRID', label: 'Stat Grid', description: 'KPI tiles from group-by',
      icon: <LayoutGrid className="w-3.5 h-3.5" />,
      iconClass: 'bg-violet-500/10 text-violet-500 group-hover:bg-violet-500/20' },
    { type: 'SPARKLINE', label: 'Sparkline', description: 'Mini trend + delta',
      icon: <Activity className="w-3.5 h-3.5" />,
      iconClass: 'bg-cyan-500/10 text-cyan-500 group-hover:bg-cyan-500/20' },
];

// Searchable lucide icon grid. `value` is the stored icon name (undefined → the caller's
// own default), and the search box keeps its own state so several pickers can coexist.
const IconPicker: React.FC<{
    value?: string;
    onChange: (name: string | undefined) => void;
    defaultTitle: string;
}> = ({ value, onChange, defaultTitle }) => {
    const [search, setSearch] = useState('');
    const results = searchIcons(search);
    return (
        <>
            <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search icons… e.g. rocket, server, chart"
                className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" />
            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto custom-scrollbar p-0.5">
                <button
                    type="button"
                    title={defaultTitle}
                    onClick={() => onChange(undefined)}
                    className={cn(
                        "h-8 w-8 rounded-md border flex items-center justify-center text-xs font-black transition-all shrink-0",
                        !value ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:bg-muted/40"
                    )}>
                    —
                </button>
                {results.map(name => (
                    <button
                        key={name}
                        type="button"
                        title={name}
                        onClick={() => onChange(name)}
                        className={cn(
                            "h-8 w-8 rounded-md border flex items-center justify-center transition-all shrink-0",
                            value === name ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:bg-muted/40"
                        )}>
                        <WidgetIcon name={name} className="w-4 h-4" />
                    </button>
                ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 px-1">
                {search.trim()
                    ? (results.length >= 72 ? 'Showing first 72 matches — refine your search.' : `${results.length} match${results.length === 1 ? '' : 'es'}${value ? ` · current: ${value}` : ''}`)
                    : `Popular icons · type to search all${value ? ` · current: ${value}` : ''}`}
            </p>
        </>
    );
};

// Editor-only preview of the "updated" badge. The public page hides the badge once the
// server date passes `widget.updated_until`; the designer always shows it (with the date)
// so the author can see and clear a stale window.
const UpdatedUntilTag: React.FC<{ widget: PageWidget }> = ({ widget }) => {
    if (widget.updated_until === undefined) return null;
    return (
        <div className="absolute -top-2 left-3 z-20 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-widest shadow-md">
                <WidgetIcon name={widget.updated_icon} fallback={Sparkles} className="w-2.5 h-2.5" />
                {widget.updated_label || DEFAULT_UPDATED_LABEL}
                {widget.updated_until ? ` · until ${widget.updated_until}` : ' · no date'}
            </span>
        </div>
    );
};

// Label/unit hints per metric-style widget, so the shared Label+Unit pair in the settings
// modal keeps the wording each type used before they were merged.
const METRIC_PLACEHOLDERS: Record<'METRIC' | 'GAUGE' | 'PROGRESS' | 'SPARKLINE', { label: string; unit: string }> = {
    METRIC: { label: 'e.g. Users', unit: 'e.g. orders / hr' },
    GAUGE: { label: 'e.g. CPU', unit: '%' },
    PROGRESS: { label: 'e.g. Quota', unit: 'GB' },
    SPARKLINE: { label: 'e.g. Requests', unit: '/min' },
};

// Per-type defaults. Pulled out of the React component so palette drops can use the
// same factory as the click handlers.
const createWidget = (
    type: PageWidget['type'],
    ctx: { workflows: Workflow[]; servers: Server[] }
): PageWidget => {
    const id = generateId();
    switch (type) {
        case 'ENDPOINT': return {
            id, type, title: 'New Endpoint', size: '3/6',
            workflow_id: ctx.workflows[0]?.id || '',
            workflow_name: ctx.workflows[0]?.name || '',
            label: ctx.workflows[0]?.name || 'Run',
            style: 'premium-gradient', show_log: false,
        };
        case 'TERMINAL': {
            const s = ctx.servers.find(s => s.connection_type === 'LOCAL') || ctx.servers[0];
            return {
                id, type, title: 'Terminal', size: 'full',
                server_id: s?.id || '', server_name: s?.name || '',
                command: 'echo "Hello World"', reload_interval: 'realtime',
            };
        }
        case 'LINK': return {
            id, type, title: 'External Link', size: '2/6',
            url: 'https://', label: 'Open Link', new_tab: true,
            style: 'bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.3)]',
            description: '',
        };
        case 'SECTION': return {
            id, type, title: 'New Section', size: 'full',
            description: 'Group your widgets here...',
        };
        case 'TEXT': return {
            id, type, title: 'Text Block', size: 'full',
            content: 'Enter your text here...',
        };
        case 'IMAGE': return {
            id, type, title: 'Image', size: '3/6',
            image_url: '', alt_text: '',
        };
        case 'IFRAME': return {
            id, type, title: 'Embedded Content', size: 'full',
            iframe_url: '', iframe_height: 400,
        };
        case 'STATUS': return {
            id, type, title: 'Status', size: '2/6',
            status_label: 'Service', status_value: 'ok',
        };
        case 'TABLE': return {
            id, type, title: 'Data Table', size: 'full',
            data_source: 'static',
            table_headers: ['Column 1', 'Column 2', 'Column 3'],
            table_rows: [['Row 1', 'Data', 'Data'], ['Row 2', 'Data', 'Data']],
        };
        case 'CHART': return {
            id, type, title: 'Chart', size: '3/6',
            chart_kind: 'bar',
            data_source: 'static',
            chart_static_data: '[{"key":"A","value":10},{"key":"B","value":20},{"key":"C","value":15}]',
        };
        case 'METRIC': return {
            id, type, title: 'Metric', size: '2/6',
            data_source: 'static',
            metric_label: 'Records',
            metric_static_value: '0',
            metric_format: 'number',
        };
        case 'GAUGE': return {
            id, type, title: 'Gauge', size: '2/6',
            data_source: 'static', metric_static_value: '65', metric_format: 'number',
            metric_label: 'Usage', gauge_min: 0, gauge_max: 100, gauge_warn: 70, gauge_crit: 90,
        };
        case 'PROGRESS': return {
            id, type, title: 'Progress', size: '2/6',
            data_source: 'static', metric_static_value: '40', metric_format: 'number',
            metric_label: 'Progress', progress_target: 100,
        };
        case 'STAT_GRID': return {
            id, type, title: 'Stats', size: '3/6',
            data_source: 'static', metric_format: 'number',
            chart_static_data: '[{"key":"OK","value":12},{"key":"Warning","value":3},{"key":"Error","value":1}]',
        };
        case 'SPARKLINE': return {
            id, type, title: 'Trend', size: '2/6',
            data_source: 'static', metric_format: 'number', metric_label: 'This week',
            chart_static_data: '[{"key":"Mon","value":10},{"key":"Tue","value":14},{"key":"Wed","value":12},{"key":"Thu","value":18},{"key":"Fri","value":22}]',
        };
    }
};

// Insert a widget into the flat layout array at a specific position within its parent's
// list (top-level when parentId is undefined). Children of SECTION widgets immediately
// follow the section in the flat array, so we look up the target slot by mapping the
// "index within parent's children" to a flat array offset.
const insertWidgetAt = (
    list: PageWidget[],
    w: PageWidget,
    parentId: string | undefined,
    indexInList: number
): PageWidget[] => {
    const newW = parentId ? { ...w, parent_id: parentId } : w;
    const inList = list.filter(x => (x.parent_id || undefined) === parentId);
    const clamped = Math.max(0, Math.min(indexInList, inList.length));

    // Past end → insert after last sibling (or after parent if section is empty).
    if (clamped >= inList.length) {
        if (!parentId) return [...list, newW];
        const parentIdx = list.findIndex(x => x.id === parentId);
        // Parent vanished mid-drag (shouldn't normally happen) — drop the parent ref and
        // append at top level so the widget remains visible instead of becoming orphaned.
        if (parentIdx === -1) return [...list, w];
        let lastChildFlatIdx = parentIdx;
        for (let i = parentIdx + 1; i < list.length; i++) {
            if (list[i].parent_id === parentId) lastChildFlatIdx = i;
            else if (!list[i].parent_id) break; // hit next top-level → run ended
        }
        return [...list.slice(0, lastChildFlatIdx + 1), newW, ...list.slice(lastChildFlatIdx + 1)];
    }

    // Insert BEFORE the clamped-th sibling.
    const targetSibling = inList[clamped];
    const targetFlatIdx = list.findIndex(x => x.id === targetSibling.id);
    return [...list.slice(0, targetFlatIdx), newW, ...list.slice(targetFlatIdx)];
};

// Sidebar palette card. Renders identical chrome whether used as the static draggable
// source or its drag clone (via Draggable.renderClone). Click-to-add is wired here too.
interface PaletteCardProps {
    item: PaletteItem;
    innerRef: (el: HTMLElement | null) => void;
    draggableProps: any;
    dragHandleProps: any;
    isDragging?: boolean;
    isPlaceholder?: boolean;
    onClick?: () => void;
}

const PaletteCard: React.FC<PaletteCardProps> = ({
    item, innerRef, draggableProps, dragHandleProps, isDragging, isPlaceholder, onClick,
}) => (
    <div
        ref={innerRef as any}
        {...draggableProps}
        {...dragHandleProps}
        onClick={onClick}
        className={cn(
            "w-full flex items-center justify-between p-3 rounded-md text-left transition-all border group cursor-grab active:cursor-grabbing select-none",
            isDragging
                ? "bg-card border-primary/40 shadow-lg shadow-primary/10"
                : "border-transparent hover:bg-muted hover:border-border",
            isPlaceholder && "opacity-40"
        )}
    >
        <div className="flex items-center gap-3">
            <div className={cn("p-1.5 rounded-md transition-colors", item.iconClass)}>
                {item.icon}
            </div>
            <div>
                <span className="text-sm font-bold block">{item.label}</span>
                <span className="text-[10px] text-muted-foreground uppercase font-medium">{item.description}</span>
            </div>
        </div>
        <Plus className="w-4 h-4 text-muted-foreground" />
    </div>
);

// Two-button toggle reused by TABLE / CHART / METRIC editor panels.
const DataSourceToggle: React.FC<{ widget: PageWidget; onChange: (v: Partial<PageWidget>) => void }> = ({ widget, onChange }) => {
    const cur = widget.data_source || 'static';
    return (
        <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Data Source</label>
            <div className="grid grid-cols-2 gap-1">
                {(['static', 'dataset'] as const).map(opt => (
                    <button key={opt} type="button"
                        onClick={() => onChange({ data_source: opt })}
                        className={cn(
                            'h-8 rounded-md text-[10px] font-black uppercase tracking-widest transition-colors border',
                            cur === opt
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background text-muted-foreground border-border hover:bg-muted'
                        )}>
                        {opt}
                    </button>
                ))}
            </div>
        </div>
    );
};

// Reload picker for dataset-backed widgets. 'off' = no polling.
const ReloadIntervalPicker: React.FC<{ widget: PageWidget; onChange: (v: Partial<PageWidget>) => void }> = ({ widget, onChange }) => (
    <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Auto-Reload</label>
        <select
            value={widget.reload_interval || ''}
            onChange={(e) => onChange({ reload_interval: (e.target.value || undefined) as PageWidget['reload_interval'] })}
            className="h-8 px-2 w-full text-xs font-bold border border-border rounded-md bg-background text-foreground outline-none cursor-pointer"
        >
            <option value="">Off (fetch once)</option>
            <option value="5">Every 5s</option>
            <option value="10">Every 10s</option>
            <option value="30">Every 30s</option>
            <option value="60">Every 1m</option>
        </select>
    </div>
);

const BUTTON_STYLES = [
    { label: 'Premium Blue', value: 'premium-gradient' },
    { label: 'Neon Emerald', value: 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)]' },
    { label: 'Cyber Rose', value: 'bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)]' },
    { label: 'Deep Indigo', value: 'bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.3)]' },
    { label: 'Atomic Amber', value: 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.3)]' },
];

const RELOAD_OPTIONS = [
    { value: 'realtime', label: 'Realtime' },
    { value: '5', label: 'Every 5s' },
    { value: '10', label: 'Every 10s' },
    { value: '30', label: 'Every 30s' },
    { value: '60', label: 'Every 1m' },
];

const PageDesignerPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { activeNamespace } = useNamespace();
    const { apiFetch, hasPermission } = useAuth();

    // Page meta
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [slug, setSlug] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [password, setPassword] = useState('');
    const [tokenTTL, setTokenTTL] = useState<number>(15);
    const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
    const [expirationOption, setExpirationOption] = useState<'none' | '1h' | '1d' | '1w'>('none');
    const [parentId, setParentId] = useState('');
    const [parentTitle, setParentTitle] = useState('');
    const [showParentSidebar, setShowParentSidebar] = useState(false);
    const [availablePages, setAvailablePages] = useState<{ id: string; title: string }[]>([]);

    // Widgets
    const [widgets, setWidgets] = useState<PageWidget[]>([]);
    const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
    const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);

    // Available data
    const [availableWorkflows, setAvailableWorkflows] = useState<Workflow[]>([]);
    const [servers, setServers] = useState<Server[]>([]);

    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'design' | 'settings'>('design');

    const activeWidget = widgets.find(w => w.id === editingWidgetId);

    useEffect(() => {
        const fetchPage = async () => {
            if (!id) return;
            try {
                const r = await apiFetch(`${API_BASE_URL}/pages/${id}`);
                const data = await r.json();
                setTitle(data.title);
                setDescription(data.description);
                setSlug(data.slug);
                setIsPublic(data.is_public);
                setTokenTTL(data.token_ttl_minutes ?? 15);
                setSelectedTags(data.tags || []);
                setParentId(data.parent_id || '');
                setParentTitle(data.parent?.title || '');
                setShowParentSidebar(data.show_parent_sidebar ?? false);
                if (data.has_password) {
                    setPassword('********');
                } else {
                    setPassword('');
                }

                let layoutWidgets: PageWidget[] = [];
                if (data.layout) {
                    try {
                        const layout: PageLayout = JSON.parse(data.layout);
                        layoutWidgets = layout.widgets || [];
                    } catch { /* ignore */ }
                }

                // Normalize legacy widths (half/third/two-third) to the 6-col grid so the
                // width picker matches and saved layouts stay consistent going forward.
                setWidgets(layoutWidgets.map(w => ({ ...w, size: normalizeWidgetSize(w.size) })));
            } catch { /* ignore */ }
        };

        if (id) fetchPage();
    }, [id, activeNamespace, apiFetch]);

    // Query pages in this namespace for the "Parent page" selector (excludes self, server-side search).
    const fetchPages = async (search = '') => {
        if (!activeNamespace) return;
        try {
            const query = search ? `&search=${encodeURIComponent(search)}` : '';
            const r = await apiFetch(`${API_BASE_URL}/namespaces/${activeNamespace.id}/pages?limit=15${query}`);
            const data = await r.json();
            const items = data.items || (Array.isArray(data) ? data : []);
            setAvailablePages(items.filter((p: any) => p.id !== id).map((p: any) => ({ id: p.id, title: p.title })));
        } catch { /* ignore */ }
    };

    useEffect(() => {
        fetchPages();
    }, [activeNamespace, id, apiFetch]);

    const fetchWorkflows = async (search = '') => {
        if (!activeNamespace) return;
        try {
            const query = search ? `&search=${encodeURIComponent(search)}` : '';
            const r = await apiFetch(`${API_BASE_URL}/namespaces/${activeNamespace.id}/workflows?limit=15${query}`);
            const data = await r.json();
            setAvailableWorkflows(data.items || (Array.isArray(data) ? data : []));
        } catch { /* ignore */ }
    };

    const fetchServers = async (search = '') => {
        if (!activeNamespace) return;
        try {
            const query = search ? `&search=${encodeURIComponent(search)}` : '';
            const r = await apiFetch(`${API_BASE_URL}/namespaces/${activeNamespace.id}/servers?limit=15${query}`);
            const data = await r.json();
            setServers(data.items || (Array.isArray(data) ? data : []));
        } catch { /* ignore */ }
    };

    useEffect(() => {
        if (!editingWidgetId) return;
        const widget = widgets.find(w => w.id === editingWidgetId);
        if (!widget) return;

        if (widget.type === 'ENDPOINT') fetchWorkflows();
        if (widget.type === 'TERMINAL') fetchServers();
    }, [editingWidgetId]);

    const calculateExpiration = (option: string) => {
        if (option === 'none') return undefined;
        const d = new Date();
        if (option === '1h') d.setHours(d.getHours() + 1);
        else if (option === '1d') d.setDate(d.getDate() + 1);
        else if (option === '1w') d.setDate(d.getDate() + 7);
        return d.toISOString();
    };

    const handleSave = async () => {
        if (!activeNamespace || !title.trim() || !slug.trim()) return;
        setIsSaving(true);
        try {
            const layout: PageLayout = { widgets };
            const pageWorkflows = widgets
                .filter(w => w.type === 'ENDPOINT' && w.workflow_id)
                .map((w, idx) => ({
                    workflow_id: w.workflow_id,
                    label: w.label || w.title,
                    style: w.style || 'premium-gradient',
                    show_log: w.show_log ?? false,
                    order: idx,
                }));

            const body = {
                title,
                description,
                parent_id: parentId || null,
                show_parent_sidebar: parentId ? showParentSidebar : false,
                slug,
                is_public: isPublic,
                password: password === '********' ? undefined : (password || '__CLEAR_PASSWORD__'),
                token_ttl_minutes: tokenTTL,
                expires_at: calculateExpiration(expirationOption),
                layout: JSON.stringify(layout),
                namespace_id: activeNamespace.id,
                workflows: pageWorkflows,
                tags: selectedTags,
            };

            const r = await apiFetch(`${API_BASE_URL}/pages/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (r.ok) navigate('/pages');
        } catch { /* ignore */ } finally {
            setIsSaving(false);
        }
    };

    // Append a new widget of the given type to the end of the layout. Used by click-to-add.
    // The drag-from-palette path calls insertWidgetAt directly with a positional target.
    const addWidget = (type: PageWidget['type']) => {
        const w = createWidget(type, { workflows: availableWorkflows, servers });
        setWidgets(prev => [...prev, w]);
        setEditingWidgetId(w.id);
    };

    const canUseTerminal = hasPermission('servers', 'READ');

    const removeWidget = (wid: string) => {
        setWidgets(prev => prev.filter(w => w.id !== wid));
        if (editingWidgetId === wid) setEditingWidgetId(null);
    };

    const updateWidget = (wid: string, updates: Partial<PageWidget>) =>
        setWidgets(prev => prev.map(w => w.id === wid ? { ...w, ...updates } : w));

    // Reorder a widget within its own sibling group (same parent) by swapping it with
    // the neighbour above/below. Deterministic alternative to the nested-Droppable drag,
    // which @hello-pangea/dnd can't hit-test reliably inside a section. Children are
    // never sections, so a plain index swap keeps the flat array's structure intact.
    const moveWidget = (wid: string, dir: 'prev' | 'next') => {
        setWidgets(prev => {
            const target = prev.find(w => w.id === wid);
            if (!target) return prev;
            const parent = target.parent_id || null;
            // Absolute indices of the siblings, in their current order.
            const siblingIdxs = prev.reduce<number[]>((acc, w, i) => {
                if ((w.parent_id || null) === parent) acc.push(i);
                return acc;
            }, []);
            const pos = siblingIdxs.findIndex(i => prev[i].id === wid);
            const swapPos = dir === 'prev' ? pos - 1 : pos + 1;
            if (swapPos < 0 || swapPos >= siblingIdxs.length) return prev; // at an edge
            const a = siblingIdxs[pos];
            const b = siblingIdxs[swapPos];
            const next = [...prev];
            [next[a], next[b]] = [next[b], next[a]];
            return next;
        });
    };

    // Floating action toolbar shown ABOVE a widget box (hover-reveal). Used for both
    // top-level widgets and section children so the placement is consistent; children
    // additionally get left/right reorder controls (top-level reorder via drag).
    const renderToolbar = (opts: {
        onEdit: () => void;
        onRemove: () => void;
        move?: { onPrev: () => void; onNext: () => void; disablePrev: boolean; disableNext: boolean };
    }) => (
        <div className="absolute -top-3 right-2 z-20 flex items-center gap-0.5 p-0.5 rounded-md bg-card border border-border shadow-md opacity-0 group-hover/tb:opacity-100 transition-opacity">
            {opts.move && (
                <>
                    <button
                        type="button"
                        title="Move left"
                        disabled={opts.move.disablePrev}
                        onClick={(e) => { e.stopPropagation(); opts.move!.onPrev(); }}
                        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        title="Move right"
                        disabled={opts.move.disableNext}
                        onClick={(e) => { e.stopPropagation(); opts.move!.onNext(); }}
                        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-px h-4 bg-border mx-0.5" />
                </>
            )}
            <button
                type="button"
                title="Settings"
                onClick={(e) => { e.stopPropagation(); opts.onEdit(); }}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
                <SettingsIcon className="w-3.5 h-3.5" />
            </button>
            <button
                type="button"
                title="Delete"
                onClick={(e) => { e.stopPropagation(); opts.onRemove(); }}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
        </div>
    );

    const handleDragStart = (start: { draggableId: string }) => {
        // Palette drag: detect SECTION-from-palette via draggableId convention so we can
        // disable nested section droppables (no section-in-section).
        if (start.draggableId.startsWith('palette-')) {
            const type = start.draggableId.replace(/^palette-/, '');
            setDraggingSectionId(type === 'SECTION' ? 'palette-section' : null);
            return;
        }
        const w = widgets.find(w => w.id === start.draggableId);
        setDraggingSectionId(w?.type === 'SECTION' ? w.id : null);
    };

    const handleDragEnd = (result: DropResult) => {
        setDraggingSectionId(null);

        // Drag-from-palette path: source is the sidebar palette, so we *create* a new
        // widget rather than reordering. draggableId is `palette-<TYPE>`.
        if (result.source.droppableId === 'palette') {
            const type = result.draggableId.replace(/^palette-/, '') as PageWidget['type'];
            const ctx = { workflows: availableWorkflows, servers };

            // Combine onto a SECTION card → drop the new widget into the section.
            if (result.combine) {
                const target = widgets.find(w => w.id === result.combine!.draggableId);
                if (!target || target.type !== 'SECTION') return;
                if (type === 'SECTION') return; // no section-in-section
                const w = createWidget(type, ctx);
                setWidgets(prev => insertWidgetAt(prev, w, target.id, Number.MAX_SAFE_INTEGER));
                setEditingWidgetId(w.id);
                return;
            }
            if (!result.destination) return;
            const dstId = result.destination.droppableId;
            const parentId = dstId.startsWith('section-') ? dstId.slice('section-'.length) : undefined;
            if (type === 'SECTION' && parentId) return; // no section-in-section
            const w = createWidget(type, ctx);
            setWidgets(prev => insertWidgetAt(prev, w, parentId, result.destination!.index));
            setEditingWidgetId(w.id);
            return;
        }

        // Combine path: dropping a widget directly onto a SECTION card moves it inside.
        // Needed because @hello-pangea/dnd can't reliably hit-test a nested Droppable
        // that lives inside a sibling Draggable of the same context.
        if (result.combine) {
            const sourceId = result.draggableId;
            const targetId = result.combine.draggableId;
            const source = widgets.find(w => w.id === sourceId);
            const target = widgets.find(w => w.id === targetId);
            if (!source || !target) return;
            if (target.type !== 'SECTION') return;
            if (source.id === target.id) return;
            if (source.type === 'SECTION') return; // no section-in-section
            if (source.parent_id === target.id) return; // already child here

            const updated = widgets.map(w => w.id === sourceId ? { ...w, parent_id: target.id } : w);
            const without = updated.filter(w => w.id !== sourceId);
            const movedWidget = updated.find(w => w.id === sourceId)!;

            const targetChildren = without.filter(w => w.parent_id === target.id);
            const insertAfterIdx = targetChildren.length > 0
                ? without.indexOf(targetChildren[targetChildren.length - 1])
                : without.indexOf(target);

            const reordered = [...without];
            reordered.splice(insertAfterIdx + 1, 0, movedWidget);
            setWidgets(reordered);
            return;
        }

        if (!result.destination) return;
        const srcId = result.source.droppableId;
        const dstId = result.destination.droppableId;
        const srcIdx = result.source.index;
        const dstIdx = result.destination.index;

        const isSectionDroppable = (id: string) => id.startsWith('section-');
        const getParentIdFromDroppable = (id: string) => isSectionDroppable(id) ? id.slice('section-'.length) : null;

        const srcParent = getParentIdFromDroppable(srcId);
        const dstParent = getParentIdFromDroppable(dstId);

        const sourceList = widgets.filter(w => (w.parent_id || null) === srcParent);
        const moved = sourceList[srcIdx];
        if (!moved) return;

        // Disallow section inside section
        if (moved.type === 'SECTION' && dstParent) return;

        const sameList = srcParent === dstParent;

        // Build new flat array
        const updated = widgets.map(w => w.id === moved.id ? { ...w, parent_id: dstParent || undefined } : w);

        // Compute final orders per parent
        const buildOrdered = () => {
            const topLevel = updated.filter(w => !w.parent_id);
            const childrenByParent: Record<string, typeof updated> = {};
            updated.forEach(w => {
                if (w.parent_id) {
                    if (!childrenByParent[w.parent_id]) childrenByParent[w.parent_id] = [];
                    childrenByParent[w.parent_id].push(w);
                }
            });

            // Apply DnD reordering to the affected lists
            const reorder = (list: typeof updated, parent: string | null) => {
                const filtered = list.filter(w => w.id !== moved.id);
                if (sameList) {
                    if ((parent || null) === srcParent) {
                        filtered.splice(dstIdx, 0, updated.find(w => w.id === moved.id)!);
                    }
                } else {
                    if ((parent || null) === dstParent) {
                        filtered.splice(dstIdx, 0, updated.find(w => w.id === moved.id)!);
                    }
                }
                return filtered;
            };

            const finalTop = reorder(topLevel, null);
            const finalChildren: Record<string, typeof updated> = {};
            Object.keys(childrenByParent).forEach(pid => {
                finalChildren[pid] = reorder(childrenByParent[pid], pid);
            });
            // Ensure dst section list exists when moving into empty section
            if (dstParent && !finalChildren[dstParent]) {
                finalChildren[dstParent] = reorder([], dstParent);
            }

            // Flatten: each top-level, followed by its children if section
            const flat: typeof updated = [];
            finalTop.forEach(w => {
                flat.push(w);
                if (w.type === 'SECTION' && finalChildren[w.id]) {
                    flat.push(...finalChildren[w.id]);
                }
            });
            return flat;
        };

        setWidgets(buildOrdered());
    };


    return (
        <div className="flex flex-col h-[calc(100vh-2rem)] bg-background rounded-md border border-border overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 bg-card border-b border-border shadow-sm">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/pages')} className="h-9 w-9 rounded-md">
                        <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-sm font-bold tracking-tight uppercase">Page Designer</h1>
                            <Badge variant="outline" className="text-[10px] font-bold px-1.5 h-4 bg-primary/10 border-primary/20 text-primary">BETA</Badge>
                        </div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest leading-none">
                            {title || 'Untitled Page'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex p-0.5 bg-muted/50 rounded-md border border-border mr-2">
                        {(['design', 'settings'] as const).map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all",
                                    activeTab === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}>
                                {tab === 'design' ? <Palette className="w-3 h-3" /> : <SettingsIcon className="w-3 h-3" />}
                                {tab}
                            </button>
                        ))}
                    </div>
                    <Button onClick={handleSave} disabled={isSaving}
                        className="premium-gradient text-white text-[10px] font-bold uppercase tracking-widest h-9 px-6 rounded-md shadow-premium">
                        <Save className="w-3.5 h-3.5 mr-2" />
                        {isSaving ? 'Saving...' : 'Save Page'}
                    </Button>
                </div>
            </div>

            <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="w-72 border-r border-border bg-card flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-border">
                        <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Add Widget</h2>
                        <p className="text-[10px] text-muted-foreground/60">Click to add at end, or drag onto the canvas.</p>
                    </div>
                    <Droppable
                        droppableId="palette"
                        isDropDisabled
                        renderClone={(provided, _snapshot, rubric) => {
                            // rubric.draggableId is `palette-<TYPE>` — look up the item to clone.
                            const type = rubric.draggableId.replace(/^palette-/, '');
                            const item = PALETTE_ITEMS.find(p => p.type === type);
                            if (!item) return <div />;
                            return (
                                <PaletteCard
                                    item={item}
                                    innerRef={provided.innerRef}
                                    draggableProps={provided.draggableProps}
                                    dragHandleProps={provided.dragHandleProps}
                                    isDragging
                                />
                            );
                        }}
                    >
                        {(droppableProvided) => (
                            <div
                                ref={droppableProvided.innerRef}
                                {...droppableProvided.droppableProps}
                                className="flex-1 overflow-y-auto p-3 space-y-2 pb-24"
                            >
                                {PALETTE_ITEMS
                                    .filter(item => !item.requiresTerminal || canUseTerminal)
                                    .map((item, idx) => (
                                        <React.Fragment key={item.type}>
                                            {item.groupHeading && (
                                                <div className="pt-3 mt-1 border-t border-border/50">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2 px-3">{item.groupHeading}</p>
                                                </div>
                                            )}
                                            <Draggable draggableId={`palette-${item.type}`} index={idx}>
                                                {(provided, snapshot) => (
                                                    <PaletteCard
                                                        item={item}
                                                        innerRef={provided.innerRef}
                                                        draggableProps={provided.draggableProps}
                                                        dragHandleProps={provided.dragHandleProps}
                                                        // Hide source while dragging — the renderClone portal takes over visually.
                                                        isPlaceholder={snapshot.isDragging}
                                                        onClick={() => addWidget(item.type)}
                                                    />
                                                )}
                                            </Draggable>
                                        </React.Fragment>
                                    ))}
                                {droppableProvided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </div>

                {/* Canvas */}
                <div className="flex-1 bg-background/50 overflow-y-auto p-10">
                    <div className="max-w-4xl mx-auto">
                        {activeTab === 'design' ? (
                            <div className="space-y-8">
                                <div className="text-center space-y-1">
                                    <h2 className="text-3xl font-black tracking-tighter">{title || 'Your Page'}</h2>
                                    <p className="text-muted-foreground text-sm">{description || 'Drag widgets to reorder. Click ⚙ to configure.'}</p>
                                </div>

                                <Droppable droppableId="canvas" isCombineEnabled>
                                    {(provided, dropSnapshot) => (
                                        <div
                                            {...provided.droppableProps}
                                            ref={provided.innerRef}
                                            className={cn(
                                                "flex flex-wrap gap-5 items-start min-h-[16rem] rounded-md transition-colors",
                                                widgets.length === 0 && "border-2 border-dashed border-border bg-card",
                                                widgets.length === 0 && dropSnapshot.isDraggingOver && "border-primary bg-primary/5"
                                            )}
                                        >
                                            {widgets.length === 0 && (
                                                <div className="w-full h-64 flex flex-col items-center justify-center gap-4 opacity-40">
                                                    <Monitor className="w-12 h-12 text-muted-foreground" />
                                                    <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                                                        {dropSnapshot.isDraggingOver ? 'Drop to add widget' : 'Canvas is empty — drag a widget here'}
                                                    </p>
                                                </div>
                                            )}
                                                    {widgets.filter(w => !w.parent_id).map((widget, idx) => (
                                                        <Draggable key={widget.id} draggableId={widget.id} index={idx}>
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    className={cn(
                                                                        "transition-all duration-200 rounded-md relative",
                                                                        widget.type !== 'SECTION' && "group/tb",
                                                                        editorTopWidthClass(widget.size),
                                                                        snapshot.isDragging && "opacity-80 scale-[1.02] z-50",
                                                                        snapshot.combineTargetFor && widget.type === 'SECTION' && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.01]"
                                                                    )}
                                                                >
                                                                    {widget.type !== 'SECTION' && renderToolbar({
                                                                        onEdit: () => setEditingWidgetId(widget.id),
                                                                        onRemove: () => removeWidget(widget.id),
                                                                    })}
                                                                    <UpdatedUntilTag widget={widget} />
                                                                    {widget.type === 'ENDPOINT' ? (
                                                                        <EndpointWidgetCard
                                                                            widget={widget}
                                                                            workflows={availableWorkflows}
                                                                            onEdit={() => setEditingWidgetId(widget.id)}
                                                                            onRemove={() => removeWidget(widget.id)}
                                                                            dragHandleProps={provided.dragHandleProps}
                                                                            hideActions
                                                                        />
                                                                    ) : widget.type === 'TERMINAL' ? (
                                                                        <TerminalWidgetCard
                                                                            widget={widget}
                                                                            onEdit={() => setEditingWidgetId(widget.id)}
                                                                            onRemove={() => removeWidget(widget.id)}
                                                                            dragHandleProps={provided.dragHandleProps}
                                                                            hideActions
                                                                        />
                                                                    ) : widget.type === 'LINK' ? (
                                                                        <LinkWidgetCard
                                                                            widget={widget}
                                                                            onEdit={() => setEditingWidgetId(widget.id)}
                                                                            onRemove={() => removeWidget(widget.id)}
                                                                            dragHandleProps={provided.dragHandleProps}
                                                                            hideActions
                                                                        />
                                                                    ) : widget.type === 'TEXT' || widget.type === 'IMAGE' || widget.type === 'IFRAME' || widget.type === 'STATUS' || widget.type === 'TABLE' || widget.type === 'CHART' || widget.type === 'METRIC' || widget.type === 'GAUGE' || widget.type === 'PROGRESS' || widget.type === 'STAT_GRID' || widget.type === 'SPARKLINE' ? (
                                                                        <ContentWidgetCard
                                                                            widget={widget}
                                                                            onEdit={() => setEditingWidgetId(widget.id)}
                                                                            onRemove={() => removeWidget(widget.id)}
                                                                            dragHandleProps={provided.dragHandleProps}
                                                                            hideActions
                                                                        />
                                                                    ) : (
                                                                        <SectionWidgetCard
                                                                            widget={widget}
                                                                            onEdit={() => setEditingWidgetId(widget.id)}
                                                                            onRemove={() => removeWidget(widget.id)}
                                                                            dragHandleProps={provided.dragHandleProps}
                                                                        >
                                                                            <Droppable droppableId={`section-${widget.id}`} type="DEFAULT" isDropDisabled={draggingSectionId !== null}>
                                                                                {(innerProvided, innerSnapshot) => (
                                                                                    <div
                                                                                        ref={innerProvided.innerRef}
                                                                                        {...innerProvided.droppableProps}
                                                                                        className={cn(
                                                                                            "flex flex-wrap gap-5 items-start p-6 rounded-md border-2 border-dashed transition-colors",
                                                                                            widgets.filter(w => w.parent_id === widget.id).length === 0 ? "min-h-[160px]" : "min-h-[120px]",
                                                                                            innerSnapshot.isDraggingOver ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border/40 bg-muted/10"
                                                                                        )}
                                                                                    >
                                                                                        {widgets.filter(w => w.parent_id === widget.id).map((child, cIdx) => (
                                                                                            <Draggable key={child.id} draggableId={child.id} index={cIdx}>
                                                                                                {(childProvided, childSnapshot) => (
                                                                                                    <div
                                                                                                        ref={childProvided.innerRef}
                                                                                                        {...childProvided.draggableProps}
                                                                                                        className={cn(
                                                                                                            "transition-all duration-200 relative group/tb",
                                                                                                            childWidthClass(child.size),
                                                                                                            childSnapshot.isDragging && "opacity-80 scale-[1.02] z-50"
                                                                                                        )}
                                                                                                    >
                                                                                                        <UpdatedUntilTag widget={child} />
                                                                                                        {renderToolbar({
                                                                                                            onEdit: () => setEditingWidgetId(child.id),
                                                                                                            onRemove: () => removeWidget(child.id),
                                                                                                            move: {
                                                                                                                onPrev: () => moveWidget(child.id, 'prev'),
                                                                                                                onNext: () => moveWidget(child.id, 'next'),
                                                                                                                disablePrev: cIdx === 0,
                                                                                                                disableNext: cIdx === widgets.filter(w => w.parent_id === widget.id).length - 1,
                                                                                                            },
                                                                                                        })}
                                                                                                        {child.type === 'ENDPOINT' ? (
                                                                                                            <EndpointWidgetCard
                                                                                                                widget={child}
                                                                                                                workflows={availableWorkflows}
                                                                                                                onEdit={() => setEditingWidgetId(child.id)}
                                                                                                                onRemove={() => removeWidget(child.id)}
                                                                                                                dragHandleProps={childProvided.dragHandleProps}
                                                                                                                hideActions
                                                                                                            />
                                                                                                        ) : child.type === 'TERMINAL' ? (
                                                                                                            <TerminalWidgetCard
                                                                                                                widget={child}
                                                                                                                onEdit={() => setEditingWidgetId(child.id)}
                                                                                                                onRemove={() => removeWidget(child.id)}
                                                                                                                dragHandleProps={childProvided.dragHandleProps}
                                                                                                                hideActions
                                                                                                            />
                                                                                                        ) : child.type === 'LINK' ? (
                                                                                                            <LinkWidgetCard
                                                                                                                widget={child}
                                                                                                                onEdit={() => setEditingWidgetId(child.id)}
                                                                                                                onRemove={() => removeWidget(child.id)}
                                                                                                                dragHandleProps={childProvided.dragHandleProps}
                                                                                                                hideActions
                                                                                                            />
                                                                                                        ) : child.type === 'TEXT' || child.type === 'IMAGE' || child.type === 'IFRAME' || child.type === 'STATUS' || child.type === 'TABLE' || child.type === 'CHART' || child.type === 'METRIC' || child.type === 'GAUGE' || child.type === 'PROGRESS' || child.type === 'STAT_GRID' || child.type === 'SPARKLINE' ? (
                                                                                                            <ContentWidgetCard
                                                                                                                widget={child}
                                                                                                                onEdit={() => setEditingWidgetId(child.id)}
                                                                                                                onRemove={() => removeWidget(child.id)}
                                                                                                                dragHandleProps={childProvided.dragHandleProps}
                                                                                                                hideActions
                                                                                                            />
                                                                                                        ) : null}
                                                                                                    </div>
                                                                                                )}
                                                                                            </Draggable>
                                                                                        ))}
                                                                                        {innerProvided.placeholder}
                                                                                        {widgets.filter(w => w.parent_id === widget.id).length === 0 && (
                                                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 w-full text-center py-4">
                                                                                                Drop widgets here
                                                                                            </p>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                            </Droppable>
                                                                        </SectionWidgetCard>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        ) : (
                            /* Settings Tab */
                            <div className="space-y-8">
                                <div className="bg-card border border-border rounded-md p-8 space-y-6">
                                    <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                                        <SettingsIcon className="w-4 h-4 text-primary" /> General
                                    </h3>
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-primary">Title</label>
                                            <Input value={title} onChange={e => setTitle(e.target.value)} className="h-9 bg-background rounded-md font-bold" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Slug</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs font-mono">/pages/</span>
                                                <Input value={slug}
                                                    onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                                    className="h-9 bg-background rounded-md pl-[70px] font-mono text-xs" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Description</label>
                                        <Input value={description} onChange={e => setDescription(e.target.value)} className="h-9 bg-background rounded-md" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Parent Page</label>
                                        <SearchableSelect
                                            options={[
                                                { label: '— None —', value: '' },
                                                ...(parentId && parentTitle && !availablePages.some(p => p.id === parentId)
                                                    ? [{ label: parentTitle, value: parentId }]
                                                    : []),
                                                ...availablePages.map(p => ({ label: p.title, value: p.id }))
                                            ]}
                                            value={parentId}
                                            onValueChange={(val) => {
                                                setParentId(val);
                                                const p = availablePages.find(p => p.id === val);
                                                setParentTitle(val ? (p?.title || parentTitle) : '');
                                                if (!val) setShowParentSidebar(false); // no parent → no sidebar
                                            }}
                                            onSearch={fetchPages}
                                            placeholder="— None —"
                                            isSearchable
                                            triggerClassName="h-9 bg-background border border-border rounded-md"
                                        />
                                        <p className="text-[10px] text-muted-foreground/70">Public pages with a parent show a link back to it.</p>
                                        {parentId && (
                                            <label className="mt-2 flex items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 cursor-pointer hover:border-primary/40 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={showParentSidebar}
                                                    onChange={e => setShowParentSidebar(e.target.checked)}
                                                    className="mt-0.5 h-4 w-4 accent-primary shrink-0"
                                                />
                                                <span className="flex flex-col">
                                                    <span className="text-xs font-bold">Show parent widgets as sidebar</span>
                                                    <span className="text-[10px] text-muted-foreground/70">On the public page, render the parent's widgets as a sticky left sidebar (read-only, opens the parent page when clicked).</span>
                                                </span>
                                            </label>
                                        )}
                                    </div>
                                    <div className="space-y-1.5 pt-2">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tags</label>
                                        <TagSelector selectedTags={selectedTags} onChange={setSelectedTags} />
                                    </div>
                                </div>

                                <div className="bg-card border border-border rounded-md p-8 space-y-6">
                                    <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                                        <Globe className="w-4 h-4 text-emerald-500" /> Public Visibility
                                    </h3>
                                    <div className="flex items-center justify-between p-4 rounded-md border border-border bg-background">
                                        <div className="flex items-center gap-4">
                                            <div className={cn("p-3 rounded-full", isPublic ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}>
                                                {isPublic ? <Globe className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                                            </div>
                                            <div>
                                                <p className="font-black text-sm uppercase">Anyone with the link</p>
                                                <p className="text-xs text-muted-foreground">Toggle to make this page publicly accessible</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setIsPublic(!isPublic)}
                                            className={cn("w-14 h-7 rounded-full transition-all relative", isPublic ? "bg-emerald-500" : "bg-muted")}>
                                            <div className={cn("absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-md", isPublic ? "right-1" : "left-1")} />
                                        </button>
                                    </div>

                                    {isPublic && (
                                        <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Public Link</label>
                                                <div className="flex gap-2">
                                                    <div className="flex-1 h-9 bg-background border border-border rounded-md px-4 flex items-center">
                                                        <span className="text-xs font-mono text-muted-foreground truncate">{window.location.origin}/public/pages/{slug}</span>
                                                    </div>
                                                    <Button variant="outline" className="h-9 px-4 rounded-md"
                                                        onClick={() => clipboardCopy(`${window.location.origin}/public/pages/${slug}`)}>
                                                        <Copy className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-2">
                                                    <Lock className="w-3 h-3" /> Password Protection
                                                </label>
                                                <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                                                    placeholder="Leave blank for open access..."
                                                    className="h-9 bg-background rounded-md" />
                                            </div>

                                            {password && (
                                                <div className="space-y-2 animate-in slide-in-from-top-1 duration-200">
                                                    <label className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                                        <RefreshCw className="w-3 h-3" /> Session Token TTL
                                                    </label>
                                                    <div className="flex gap-2 flex-wrap">
                                                        {[{ label: '5m', value: 5 }, { label: '15m', value: 15 }, { label: '30m', value: 30 }, { label: '1h', value: 60 }, { label: '8h', value: 480 }].map(opt => (
                                                            <button key={opt.value} onClick={() => setTokenTTL(opt.value)}
                                                                className={cn("h-8 px-3 rounded-md text-[10px] font-black border transition-all",
                                                                    tokenTTL === opt.value ? "bg-primary/10 border-primary text-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50")}>
                                                                {opt.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-3 pt-4 border-t border-border">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-2">
                                                    <Clock className="w-3 h-3" /> Link Expiration
                                                </label>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {[{ id: 'none', label: 'Forever' }, { id: '1h', label: '1 Hour' }, { id: '1d', label: '1 Day' }, { id: '1w', label: '1 Week' }].map(opt => (
                                                        <button key={opt.id} onClick={() => setExpirationOption(opt.id as any)}
                                                            className={cn("h-9 rounded-md text-[10px] font-bold transition-all border",
                                                                expirationOption === opt.id ? "bg-primary text-white border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50")}>
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </DragDropContext>

            {/* Widget Settings Modal */}
            {activeWidget && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setEditingWidgetId(null)}
                >
                    <div
                        className="w-full max-w-[920px] max-h-[90vh] bg-card border border-border rounded-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border shrink-0">
                            <p className="text-lg font-black tracking-tight">Widget Settings</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                {PALETTE_ITEMS.find(p => p.type === activeWidget.type)?.label || activeWidget.type}
                            </p>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
                            {/* LEFT — content & data (what the widget says / where it pulls from) */}
                            <div className="md:w-1/2 shrink-0 md:overflow-y-auto custom-scrollbar md:border-r border-border p-6 space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Widget Title</label>
                                    <Input value={activeWidget.title} onChange={e => updateWidget(activeWidget.id, { title: e.target.value })} className="h-9 text-sm font-bold bg-muted/30 border border-border/50 rounded-md" />
                                </div>

                                {activeWidget.type === 'SECTION' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Description / Subtitle</label>
                                        <textarea
                                            value={activeWidget.description || ''}
                                            onChange={e => updateWidget(activeWidget.id, { description: e.target.value })}
                                            className="w-full min-h-[80px] p-4 text-xs bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-none transition-all"
                                            placeholder="Add context or instructions for this section..."
                                        />
                                    </div>
                                )}

                                {activeWidget.type === 'LINK' && (
                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                                <Link2 className="w-3 h-3 text-indigo-500" /> Target URL
                                            </label>
                                            <Input value={activeWidget.url || ''} onChange={e => updateWidget(activeWidget.id, { url: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md font-mono text-indigo-400" placeholder="https://" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Button Label</label>
                                            <Input value={activeWidget.label || ''} onChange={e => updateWidget(activeWidget.id, { label: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" placeholder="e.g. Open Link" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Description</label>
                                            <textarea
                                                value={activeWidget.description || ''}
                                                onChange={e => updateWidget(activeWidget.id, { description: e.target.value })}
                                                className="w-full min-h-[80px] p-4 text-xs bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-none transition-all"
                                                placeholder="Add a short description for this link..."
                                            />
                                        </div>
                                    </div>
                                )}

                                {activeWidget.type === 'ENDPOINT' && (
                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2 px-1">
                                                <Zap className="w-3 h-3 text-primary" /> Target Workflow
                                            </label>
                                            <SearchableSelect
                                                options={[
                                                    ...(activeWidget.workflow_id && activeWidget.workflow_name && !availableWorkflows.some(w => w.id === activeWidget.workflow_id)
                                                        ? [{ label: activeWidget.workflow_name, value: activeWidget.workflow_id }]
                                                        : []),
                                                    ...availableWorkflows.map(wf => ({ label: wf.name, value: wf.id }))
                                                ]}
                                                value={activeWidget.workflow_id || ''}
                                                onValueChange={(val) => {
                                                    const wf = availableWorkflows.find(w => w.id === val);
                                                    updateWidget(activeWidget.id, {
                                                        workflow_id: val,
                                                        workflow_name: wf?.name || activeWidget.workflow_name,
                                                        label: wf?.name || activeWidget.label
                                                    });
                                                }}
                                                onSearch={fetchWorkflows}
                                                placeholder="Select workflow..."
                                                isSearchable
                                                triggerClassName="h-9 text-xs font-bold bg-muted/30 border border-border/50 rounded-md"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Button Label</label>
                                            <Input value={activeWidget.label || ''} onChange={e => updateWidget(activeWidget.id, { label: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" placeholder="e.g. Deploy" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Description</label>
                                            <textarea
                                                value={activeWidget.description || ''}
                                                onChange={e => updateWidget(activeWidget.id, { description: e.target.value })}
                                                className="w-full min-h-[80px] p-4 text-xs bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-none transition-all"
                                                placeholder="Explain what this endpoint does..."
                                            />
                                        </div>
                                    </div>
                                )}

                                {activeWidget.type === 'TERMINAL' && (
                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2 px-1">
                                                <ServerIcon className="w-3 h-3 text-emerald-500" /> Target Server
                                            </label>
                                            <SearchableSelect
                                                options={[
                                                    ...(activeWidget.server_id && activeWidget.server_name && !servers.some(s => s.id === activeWidget.server_id)
                                                        ? [{ label: activeWidget.server_name, value: activeWidget.server_id }]
                                                        : []),
                                                    ...servers.map(s => ({ label: `${s.name} (${s.host})`, value: s.id }))
                                                ]}
                                                value={activeWidget.server_id || ''}
                                                onValueChange={(val) => {
                                                    const srv = servers.find(s => s.id === val);
                                                    updateWidget(activeWidget.id, {
                                                        server_id: val,
                                                        server_name: srv?.name || activeWidget.server_name
                                                    });
                                                }}
                                                onSearch={fetchServers}
                                                placeholder="Select server..."
                                                isSearchable
                                                triggerClassName="h-9 text-xs font-bold bg-muted/30 border border-border/50 rounded-md"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Execute Command</label>
                                            <textarea
                                                value={activeWidget.command || ''}
                                                onChange={e => updateWidget(activeWidget.id, { command: e.target.value })}
                                                placeholder="e.g. top -b -n 1"
                                                className="w-full min-h-[80px] p-4 text-xs font-mono bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-y transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Run Interval</label>
                                            <div className="flex gap-2 flex-wrap items-center">
                                                {[{ label: 'Once', value: undefined }, { label: '5s', value: 5 }, { label: '10s', value: 10 }, { label: '30s', value: 30 }, { label: '1m', value: 60 }].map(opt => (
                                                    <button key={opt.label} onClick={() => updateWidget(activeWidget.id, { run_interval: opt.value })}
                                                        className={cn("h-9 px-4 rounded-md text-[10px] font-black transition-all border shrink-0",
                                                            activeWidget.run_interval === opt.value
                                                                ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
                                                                : "bg-muted/30 border-transparent text-muted-foreground hover:border-emerald-500/50")}>
                                                        {opt.label}
                                                    </button>
                                                ))}
                                                <div className="relative flex-1 min-w-[100px]">
                                                    <Input
                                                        type="number"
                                                        value={activeWidget.run_interval || ''}
                                                        onChange={e => {
                                                            const val = parseInt(e.target.value, 10);
                                                            updateWidget(activeWidget.id, { run_interval: isNaN(val) ? undefined : val });
                                                        }}
                                                        min="1"
                                                        placeholder="Custom..."
                                                        className="h-9 text-xs font-bold bg-muted/30 border border-border/50 rounded-md pl-3 pr-8 focus:border-emerald-500/50 focus:ring-emerald-500/20 transition-all shadow-sm"
                                                    />
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-muted-foreground">s</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeWidget.type === 'TEXT' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                            <FileText className="w-3 h-3 text-sky-500" /> Content
                                        </label>
                                        <textarea
                                            value={activeWidget.content || ''}
                                            onChange={e => updateWidget(activeWidget.id, { content: e.target.value })}
                                            className="w-full min-h-[160px] p-4 text-xs bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-y transition-all font-mono"
                                            placeholder="Enter text or markdown content..."
                                        />
                                    </div>
                                )}

                                {activeWidget.type === 'IMAGE' && (
                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                                <ImageIcon className="w-3 h-3 text-pink-500" /> Image URL
                                            </label>
                                            <Input value={activeWidget.image_url || ''} onChange={e => updateWidget(activeWidget.id, { image_url: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md font-mono text-pink-400" placeholder="https://example.com/image.png" />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Alt Text</label>
                                            <Input value={activeWidget.alt_text || ''} onChange={e => updateWidget(activeWidget.id, { alt_text: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" placeholder="Describe the image..." />
                                        </div>
                                    </div>
                                )}

                                {activeWidget.type === 'IFRAME' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                            <Frame className="w-3 h-3 text-violet-500" /> Embed URL
                                        </label>
                                        <Input value={activeWidget.iframe_url || ''} onChange={e => updateWidget(activeWidget.id, { iframe_url: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md font-mono text-violet-400" placeholder="https://grafana.example.com/d/..." />
                                    </div>
                                )}

                                {activeWidget.type === 'STATUS' && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                                    <Activity className="w-3 h-3 text-teal-500" /> Label
                                                </label>
                                                <Input value={activeWidget.status_label || ''} onChange={e => updateWidget(activeWidget.id, { status_label: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" placeholder="e.g. API Server" />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Status</label>
                                                <select value={activeWidget.status_value || 'ok'} onChange={e => updateWidget(activeWidget.id, { status_value: e.target.value as any })}
                                                    className="w-full h-9 bg-muted/30 border border-border/50 rounded-md text-xs px-4 outline-none font-bold appearance-none cursor-pointer">
                                                    <option value="ok" className="bg-popover text-foreground">OK</option>
                                                    <option value="warning" className="bg-popover text-foreground">Warning</option>
                                                    <option value="error" className="bg-popover text-foreground">Error</option>
                                                    <option value="info" className="bg-popover text-foreground">Info</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Description</label>
                                            <Input value={activeWidget.description || ''} onChange={e => updateWidget(activeWidget.id, { description: e.target.value })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" placeholder="Optional status description..." />
                                        </div>
                                    </div>
                                )}

                                {activeWidget.type === 'TABLE' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig
                                                    value={activeWidget.dataset}
                                                    onChange={(v) => updateWidget(activeWidget.id, { dataset: v })}
                                                    slots={{ showGroupBy: true, showSelects: true, showSort: true, showColumns: true, showLimit: true }}
                                                />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                                        <Table2 className="w-3 h-3 text-orange-500" /> Column Headers
                                                    </label>
                                                    <Input
                                                        value={(activeWidget.table_headers || []).join(', ')}
                                                        onChange={e => updateWidget(activeWidget.id, { table_headers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                        className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md"
                                                        placeholder="Column 1, Column 2, Column 3"
                                                    />
                                                    <p className="text-[10px] text-muted-foreground px-1">Separate column names with commas</p>
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Data Rows</label>
                                                    <textarea
                                                        value={(activeWidget.table_rows || []).map(row => row.join(', ')).join('\n')}
                                                        onChange={e => updateWidget(activeWidget.id, {
                                                            table_rows: e.target.value.split('\n').map(line => line.split(',').map(s => s.trim())).filter(row => row.some(cell => cell))
                                                        })}
                                                        className="w-full min-h-[120px] p-4 text-xs bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-y transition-all font-mono"
                                                        placeholder="Row 1 Col 1, Row 1 Col 2, Row 1 Col 3&#10;Row 2 Col 1, Row 2 Col 2, Row 2 Col 3"
                                                    />
                                                    <p className="text-[10px] text-muted-foreground px-1">One row per line, separate cells with commas</p>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {activeWidget.type === 'CHART' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig
                                                    value={activeWidget.dataset}
                                                    onChange={(v) => updateWidget(activeWidget.id, { dataset: v })}
                                                    slots={{ showGroupBy: true, showMetric: true, showFn: true, showLimit: true, showSort: true }}
                                                />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Static Data (JSON)</label>
                                                <textarea
                                                    value={activeWidget.chart_static_data || ''}
                                                    onChange={(e) => updateWidget(activeWidget.id, { chart_static_data: e.target.value })}
                                                    className="w-full min-h-[120px] p-3 text-[11px] font-mono bg-muted/30 border border-border/50 rounded-md focus:ring-2 ring-primary/10 outline-none resize-y"
                                                    placeholder='[{"key":"A","value":10},{"key":"B","value":20}]'
                                                />
                                                {(() => {
                                                    const raw = activeWidget.chart_static_data || '';
                                                    if (!raw.trim()) return <p className="text-[10px] text-muted-foreground px-1">Array of {"{key, value}"} objects</p>;
                                                    try {
                                                        const v = JSON.parse(raw);
                                                        if (!Array.isArray(v)) return <p className="text-[10px] text-amber-500 px-1">Expected an array</p>;
                                                        return <p className="text-[10px] text-emerald-500 px-1">✓ {v.length} entries</p>;
                                                    } catch {
                                                        return <p className="text-[10px] text-destructive px-1">Invalid JSON</p>;
                                                    }
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {(activeWidget.type === 'METRIC' || activeWidget.type === 'GAUGE' || activeWidget.type === 'PROGRESS' || activeWidget.type === 'SPARKLINE') && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Label</label>
                                            <Input
                                                value={activeWidget.metric_label || ''}
                                                onChange={(e) => updateWidget(activeWidget.id, { metric_label: e.target.value })}
                                                className="h-8 text-xs"
                                                placeholder={METRIC_PLACEHOLDERS[activeWidget.type].label}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Unit</label>
                                            <Input
                                                value={activeWidget.metric_unit || ''}
                                                onChange={(e) => updateWidget(activeWidget.id, { metric_unit: e.target.value })}
                                                className="h-8 text-xs"
                                                placeholder={METRIC_PLACEHOLDERS[activeWidget.type].unit}
                                            />
                                        </div>
                                    </div>
                                )}

                                {activeWidget.type === 'METRIC' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig
                                                    value={activeWidget.dataset}
                                                    onChange={(v) => updateWidget(activeWidget.id, { dataset: v })}
                                                    slots={{ showGroupBy: false, showMetric: true, showFn: true, showLimit: false, showSort: false }}
                                                />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Static Value</label>
                                                <Input
                                                    value={activeWidget.metric_static_value || ''}
                                                    onChange={(e) => updateWidget(activeWidget.id, { metric_static_value: e.target.value })}
                                                    className="h-8 text-xs font-mono"
                                                    placeholder="0"
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeWidget.type === 'GAUGE' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig value={activeWidget.dataset} onChange={(v) => updateWidget(activeWidget.id, { dataset: v })} slots={{ showGroupBy: false, showMetric: true, showFn: true, showLimit: false, showSort: false }} />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Static Value</label>
                                                <Input value={activeWidget.metric_static_value || ''} onChange={(e) => updateWidget(activeWidget.id, { metric_static_value: e.target.value })} className="h-8 text-xs font-mono" placeholder="65" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeWidget.type === 'PROGRESS' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig value={activeWidget.dataset} onChange={(v) => updateWidget(activeWidget.id, { dataset: v })} slots={{ showGroupBy: false, showMetric: true, showFn: true, showLimit: false, showSort: false }} />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Static Value</label>
                                                <Input value={activeWidget.metric_static_value || ''} onChange={(e) => updateWidget(activeWidget.id, { metric_static_value: e.target.value })} className="h-8 text-xs font-mono" placeholder="40" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeWidget.type === 'STAT_GRID' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig value={activeWidget.dataset} onChange={(v) => updateWidget(activeWidget.id, { dataset: v })} slots={{ showGroupBy: true, showMetric: true, showFn: true, showLimit: true, showSort: true }} />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Static Data (JSON [&#123;key,value&#125;])</label>
                                                <textarea value={activeWidget.chart_static_data || ''} onChange={(e) => updateWidget(activeWidget.id, { chart_static_data: e.target.value })} rows={4} className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md bg-background text-foreground outline-none" placeholder='[{"key":"OK","value":12}]' />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeWidget.type === 'SPARKLINE' && (
                                    <div className="space-y-6">
                                        <DataSourceToggle widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                        {activeWidget.data_source === 'dataset' ? (
                                            <>
                                                <DatasetSourceConfig value={activeWidget.dataset} onChange={(v) => updateWidget(activeWidget.id, { dataset: v })} slots={{ showGroupBy: true, showMetric: true, showFn: true, showLimit: true, showSort: true }} />
                                                <ReloadIntervalPicker widget={activeWidget} onChange={(v) => updateWidget(activeWidget.id, v)} />
                                            </>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Static Data (JSON [&#123;key,value&#125;])</label>
                                                <textarea value={activeWidget.chart_static_data || ''} onChange={(e) => updateWidget(activeWidget.id, { chart_static_data: e.target.value })} rows={4} className="w-full px-3 py-2 text-xs font-mono border border-border rounded-md bg-background text-foreground outline-none" placeholder='[{"key":"Mon","value":10}]' />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* RIGHT — appearance on the public page */}
                            <div className="md:w-1/2 min-w-0 flex flex-col md:overflow-hidden">
                                <div className="md:flex-1 md:overflow-y-auto custom-scrollbar p-6 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Width</label>
                                        <select value={activeWidget.size} onChange={e => updateWidget(activeWidget.id, { size: e.target.value as any })}
                                            className="w-full h-9 bg-muted/30 border border-border/50 rounded-md text-xs px-4 outline-none font-bold appearance-none cursor-pointer">
                                            {PAGE_WIDGET_SIZES.map(sz => (
                                                <option key={sz} value={sz} className="bg-popover text-foreground">{SIZE_LABELS[sz]}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Update badge — collapsed until ticked. Enabled state is
                                        `updated_until !== undefined`, so unticking drops every badge
                                        field from the saved layout. */}
                                    <div className="space-y-3 p-4 bg-muted/20 rounded-md border border-border/40">
                                        <label className="flex items-center gap-2.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={activeWidget.updated_until !== undefined}
                                                onChange={e => updateWidget(activeWidget.id, e.target.checked
                                                    ? { updated_until: '' }
                                                    : { updated_until: undefined, updated_label: undefined, updated_icon: undefined })}
                                                className="h-4 w-4 accent-amber-500 cursor-pointer"
                                            />
                                            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-2">
                                                <Sparkles className="w-3 h-3 text-amber-500" /> Mark update expired
                                            </span>
                                        </label>

                                        {activeWidget.updated_until !== undefined && (
                                            <div className="space-y-4 pt-1">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Expires on</label>
                                                    <Input
                                                        type="date"
                                                        value={activeWidget.updated_until}
                                                        onChange={e => updateWidget(activeWidget.id, { updated_until: e.target.value })}
                                                        // Click anywhere in the field opens the native picker; typing the
                                                        // segments by hand still works because the input keeps focus.
                                                        onClick={e => e.currentTarget.showPicker?.()}
                                                        className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md [color-scheme:dark] cursor-pointer"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Badge text</label>
                                                    <Input
                                                        value={activeWidget.updated_label || ''}
                                                        onChange={e => updateWidget(activeWidget.id, { updated_label: e.target.value || undefined })}
                                                        placeholder={DEFAULT_UPDATED_LABEL}
                                                        className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Badge icon</label>
                                                    <IconPicker
                                                        value={activeWidget.updated_icon}
                                                        onChange={(name) => updateWidget(activeWidget.id, { updated_icon: name })}
                                                        defaultTitle="Default (sparkles)"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Icon (shown on public page)</label>
                                        <IconPicker
                                            value={activeWidget.icon}
                                            onChange={(name) => updateWidget(activeWidget.id, { icon: name })}
                                            defaultTitle="Default (per type)"
                                        />
                                    </div>

                                    {activeWidget.type === 'SECTION' && (
                                        <div className="flex items-center justify-between p-5 bg-muted/20 rounded-md border border-border/40">
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Hide header</p>
                                                <p className="text-xs font-medium text-muted-foreground leading-none">Keep only the frame — hide title &amp; description on the public page</p>
                                            </div>
                                            <button onClick={() => updateWidget(activeWidget.id, { hide_header: !activeWidget.hide_header })}
                                                className={cn("w-12 h-6 rounded-full transition-all relative shrink-0 shadow-inner", activeWidget.hide_header ? "bg-primary" : "bg-muted-foreground/20")}>
                                                <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200", activeWidget.hide_header ? "right-0.5" : "left-0.5")} />
                                            </button>
                                        </div>
                                    )}

                                    {activeWidget.type === 'LINK' && (
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Style</label>
                                                <ButtonStylePicker
                                                    presets={BUTTON_STYLES}
                                                    value={activeWidget.style || ''}
                                                    onChange={(val) => updateWidget(activeWidget.id, { style: val })}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between p-5 bg-muted/20 rounded-md border border-border/40">
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Open in new tab</p>
                                                    <p className="text-xs font-medium text-muted-foreground leading-none">Launch link in a separate window</p>
                                                </div>
                                                <button onClick={() => updateWidget(activeWidget.id, { new_tab: !activeWidget.new_tab })}
                                                    className={cn("w-12 h-6 rounded-full transition-all relative shrink-0 shadow-inner", activeWidget.new_tab ? "bg-primary" : "bg-muted-foreground/20")}>
                                                    <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200", activeWidget.new_tab ? "right-0.5" : "left-0.5")} />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {activeWidget.type === 'ENDPOINT' && (
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Style</label>
                                                <ButtonStylePicker
                                                    presets={BUTTON_STYLES}
                                                    value={activeWidget.style || 'premium-gradient'}
                                                    onChange={(val) => updateWidget(activeWidget.id, { style: val })}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between p-5 bg-muted/20 rounded-md border border-border/40">
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Execution Trace</p>
                                                    <p className="text-xs font-medium text-muted-foreground leading-none">Show live logs after triggering</p>
                                                </div>
                                                <button onClick={() => updateWidget(activeWidget.id, { show_log: !activeWidget.show_log })}
                                                    className={cn("w-12 h-6 rounded-full transition-all relative shrink-0 shadow-inner", activeWidget.show_log ? "bg-primary" : "bg-muted-foreground/20")}>
                                                    <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200", activeWidget.show_log ? "right-0.5" : "left-0.5")} />
                                                </button>
                                            </div>
                                            <div className="flex items-center justify-between p-5 bg-muted/20 rounded-md border border-border/40">
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Allow Scheduling</p>
                                                    <p className="text-xs font-medium text-muted-foreground leading-none">Show a "Schedule" button on the public page (one-time or daily-recurring)</p>
                                                </div>
                                                <button onClick={() => updateWidget(activeWidget.id, { allow_schedule: !activeWidget.allow_schedule })}
                                                    className={cn("w-12 h-6 rounded-full transition-all relative shrink-0 shadow-inner", activeWidget.allow_schedule ? "bg-primary" : "bg-muted-foreground/20")}>
                                                    <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-200", activeWidget.allow_schedule ? "right-0.5" : "left-0.5")} />
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {activeWidget.type === 'IMAGE' && activeWidget.image_url && (
                                        <div className="rounded-md overflow-hidden border border-border/50 bg-muted/20">
                                            <img src={activeWidget.image_url} alt={activeWidget.alt_text || ''} className="w-full h-auto max-h-48 object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
                                        </div>
                                    )}

                                    {activeWidget.type === 'IFRAME' && (
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Height (px)</label>
                                            <Input type="number" value={activeWidget.iframe_height || 400} onChange={e => updateWidget(activeWidget.id, { iframe_height: parseInt(e.target.value) || 400 })} className="h-9 text-sm bg-muted/30 border border-border/50 rounded-md" min={100} max={2000} />
                                        </div>
                                    )}

                                    {activeWidget.type === 'CHART' && (
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1 flex items-center gap-2">
                                                <BarChart3 className="w-3 h-3 text-cyan-500" /> Chart Type
                                            </label>
                                            <div className="grid grid-cols-4 gap-1">
                                                {(['bar', 'line', 'pie', 'area'] as const).map(k => (
                                                    <button key={k} type="button"
                                                        onClick={() => updateWidget(activeWidget.id, { chart_kind: k })}
                                                        className={cn(
                                                            'h-8 rounded-md text-[10px] font-black uppercase tracking-widest transition-colors border',
                                                            (activeWidget.chart_kind || 'bar') === k
                                                                ? 'bg-cyan-500 text-white border-cyan-500'
                                                                : 'bg-background text-muted-foreground border-border hover:bg-muted'
                                                        )}>
                                                        {k}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {activeWidget.type === 'GAUGE' && (
                                        <>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Min</label>
                                                    <Input type="number" value={activeWidget.gauge_min ?? ''} onChange={(e) => updateWidget(activeWidget.id, { gauge_min: e.target.value === '' ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="0" />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Max</label>
                                                    <Input type="number" value={activeWidget.gauge_max ?? ''} onChange={(e) => updateWidget(activeWidget.id, { gauge_max: e.target.value === '' ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="100" />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Warn ≥</label>
                                                    <Input type="number" value={activeWidget.gauge_warn ?? ''} onChange={(e) => updateWidget(activeWidget.id, { gauge_warn: e.target.value === '' ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="70" />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Crit ≥</label>
                                                    <Input type="number" value={activeWidget.gauge_crit ?? ''} onChange={(e) => updateWidget(activeWidget.id, { gauge_crit: e.target.value === '' ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="90" />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {activeWidget.type === 'PROGRESS' && (
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Target</label>
                                            <Input type="number" value={activeWidget.progress_target ?? ''} onChange={(e) => updateWidget(activeWidget.id, { progress_target: e.target.value === '' ? undefined : Number(e.target.value) })} className="h-8 text-xs" placeholder="100" />
                                        </div>
                                    )}

                                    {(activeWidget.type === 'METRIC' || activeWidget.type === 'GAUGE' || activeWidget.type === 'PROGRESS' || activeWidget.type === 'STAT_GRID' || activeWidget.type === 'SPARKLINE') && (
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest px-1">Format</label>
                                            <select
                                                value={activeWidget.metric_format || 'number'}
                                                onChange={(e) => updateWidget(activeWidget.id, { metric_format: e.target.value as PageWidget['metric_format'] })}
                                                className="h-8 px-2 w-full text-xs font-bold border border-border rounded-md bg-background text-foreground outline-none cursor-pointer"
                                            >
                                                <option value="number">Number</option>
                                                <option value="percent">Percent (×100)</option>
                                                <option value="currency">Currency</option>
                                            </select>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-muted/10 border-t border-border/40 flex flex-row justify-center gap-2 shrink-0">
                            <Button onClick={() => setEditingWidgetId(null)} className="premium-gradient text-white text-[10px] font-black uppercase tracking-[0.2em] h-9 px-8 rounded-md shadow-premium">
                                Save Configuration
                            </Button>
                            <Button variant="outline" onClick={() => setEditingWidgetId(null)} className="h-9 px-6 text-[10px] font-black uppercase tracking-widest rounded-md">Dismiss Settings</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface EndpointWidgetCardProps {
    widget: PageWidget;
    workflows: Workflow[];
    onEdit: () => void;
    onRemove: () => void;
    dragHandleProps: any;
    hideActions?: boolean;
}

const EndpointWidgetCard: React.FC<EndpointWidgetCardProps> = ({ widget, workflows, onEdit, onRemove, dragHandleProps, hideActions }) => {
    const selectedWf = workflows.find(w => w.id === widget.workflow_id);
    return (
        <div className="group bg-card border border-border rounded-md overflow-hidden hover:border-primary/40 transition-all shadow-sm">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-card">
                <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
                    <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-black uppercase tracking-tight truncate">{widget.title || 'Endpoint'}</p>
                    <p className="text-[10px] text-muted-foreground font-medium truncate uppercase tracking-widest">{selectedWf?.name || widget.workflow_name || 'No workflow'}</p>
                </div>
                {!hideActions && (
                    <>
                        <button onClick={onEdit} className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border">
                            <SettingsIcon className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={onRemove} className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-border">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
            </div>
            <div className="p-6">
                {(() => {
                    const r = resolveButtonStyle(widget.style, 'premium-gradient');
                    return (
                        <div
                            className={cn("h-14 w-full rounded-md flex items-center justify-center text-white font-black tracking-[0.15em] text-[10px] shadow-sm", r.className)}
                            style={r.style}
                        >
                            <Zap className="w-4 h-4 mr-2" />
                            {widget.label || 'Execute'}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

interface TerminalWidgetCardProps {
    widget: PageWidget;
    onEdit: () => void;
    onRemove: () => void;
    dragHandleProps: any;
    hideActions?: boolean;
}

const TerminalWidgetCard: React.FC<TerminalWidgetCardProps> = ({ widget, onEdit, onRemove, dragHandleProps, hideActions }) => (
    <div className="group bg-[#0a0b0e] border border-white/10 rounded-md overflow-hidden hover:border-emerald-500/30 transition-all shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 bg-white/5 border-b border-white/5">
            <div className="flex items-center gap-3">
                <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 transition-colors">
                    <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex gap-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                </div>
                <Terminal className="w-3.5 h-3.5 text-emerald-400 ml-2" />
                <span className="text-xs font-mono font-bold text-emerald-400/80 uppercase truncate max-w-[120px]">{widget.title}</span>
            </div>
            {!hideActions && (
                <div className="flex gap-2">
                    <button onClick={onEdit} className="h-7 w-7 rounded-full flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-colors">
                        <SettingsIcon className="w-3 h-3" />
                    </button>
                    <button onClick={onRemove} className="h-7 w-7 rounded-full flex items-center justify-center text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
        <div className="px-6 py-4 min-h-[80px] font-mono text-xs text-zinc-400">
            <span className="text-zinc-600">$ </span>
            <span className="text-emerald-300">{widget.command || 'echo "Hello"'}</span>
            <span className="animate-pulse ml-1 text-emerald-400">▋</span>
        </div>
    </div>
);

interface LinkWidgetCardProps {
    widget: PageWidget;
    onEdit: () => void;
    onRemove: () => void;
    dragHandleProps: any;
    hideActions?: boolean;
}

const LinkWidgetCard: React.FC<LinkWidgetCardProps> = ({ widget, onEdit, onRemove, dragHandleProps, hideActions }) => (
    <div className="group bg-card border border-border rounded-md overflow-hidden hover:border-indigo-500/40 transition-all shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card">
            <div className="flex items-center gap-3">
                <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
                    <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-xs font-black uppercase tracking-tight truncate max-w-[120px]">{widget.title || 'Link'}</span>
                    <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">{widget.url || '---'}</span>
                </div>
            </div>
            {!hideActions && (
                <div className="flex gap-2 shrink-0">
                    <button onClick={onEdit} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <SettingsIcon className="w-3 h-3" />
                    </button>
                    <button onClick={onRemove} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
        <div className="p-4">
            {widget.description && (
                <p className="text-[10px] text-muted-foreground mb-3 px-2 line-clamp-2">{widget.description}</p>
            )}
            {(() => {
                const r = resolveButtonStyle(widget.style, 'bg-indigo-600');
                return (
                    <div
                        className={cn("h-9 w-full rounded-md flex items-center justify-center text-white font-black tracking-[0.1em] text-[10px] shadow-sm cursor-pointer", r.className)}
                        style={r.style}
                    >
                        <Link2 className="w-3.5 h-3.5 mr-2" />
                        {widget.label || 'Open Link'}
                    </div>
                );
            })()}
        </div>
    </div>
);

interface SectionWidgetCardProps {
    widget: PageWidget;
    onEdit: () => void;
    onRemove: () => void;
    dragHandleProps: any;
    children?: React.ReactNode;
}

const SectionWidgetCard: React.FC<SectionWidgetCardProps> = ({ widget, onEdit, onRemove, dragHandleProps, children }) => (
    <div className="group border border-border/40 rounded-md p-4 bg-card/30 relative">
        <div className="absolute right-3 top-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button onClick={onEdit} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <SettingsIcon className="w-3 h-3" />
            </button>
            <button onClick={onRemove} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-3 h-3" />
            </button>
        </div>
        <div className="flex items-center gap-2 mb-3 pb-3 border-b-2 border-border/40">
            <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors mr-1">
                <GripVertical className="w-4 h-4" />
            </div>
            {widget.hide_header
                ? <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Section · header hidden on public page</span>
                : <h3 className="text-lg font-black tracking-tight">{widget.title || 'Section Header'}</h3>}
        </div>
        {!widget.hide_header && widget.description && (
            <p className="text-xs text-muted-foreground mb-3 ml-7">{widget.description}</p>
        )}
        {children}
    </div>
);

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
    ok: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', dot: 'bg-emerald-500' },
    warning: { bg: 'bg-amber-500/10', text: 'text-amber-500', dot: 'bg-amber-500' },
    error: { bg: 'bg-rose-500/10', text: 'text-rose-500', dot: 'bg-rose-500' },
    info: { bg: 'bg-sky-500/10', text: 'text-sky-500', dot: 'bg-sky-500' },
};

const WIDGET_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    TEXT: { icon: <FileText className="w-3.5 h-3.5" />, color: 'sky', label: 'Text Block' },
    IMAGE: { icon: <ImageIcon className="w-3.5 h-3.5" />, color: 'pink', label: 'Image' },
    IFRAME: { icon: <Frame className="w-3.5 h-3.5" />, color: 'violet', label: 'Iframe' },
    STATUS: { icon: <Activity className="w-3.5 h-3.5" />, color: 'teal', label: 'Status' },
    TABLE: { icon: <Table2 className="w-3.5 h-3.5" />, color: 'orange', label: 'Table' },
    CHART: { icon: <BarChart3 className="w-3.5 h-3.5" />, color: 'cyan', label: 'Chart' },
    METRIC: { icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'emerald', label: 'Metric' },
};

interface ContentWidgetCardProps {
    widget: PageWidget;
    onEdit: () => void;
    onRemove: () => void;
    dragHandleProps: any;
    hideActions?: boolean;
}

const ContentWidgetCard: React.FC<ContentWidgetCardProps> = ({ widget, onEdit, onRemove, dragHandleProps, hideActions }) => {
    const meta = WIDGET_META[widget.type] || WIDGET_META.TEXT;
    const colorClasses = `bg-${meta.color}-500/10 text-${meta.color}-500 group-hover:bg-${meta.color}-500/20`;

    return (
        <div className="group bg-card border border-border rounded-md overflow-hidden hover:border-primary/40 transition-all shadow-sm">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-card">
                <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors">
                    <GripVertical className="w-4 h-4" />
                </div>
                <div className={cn("p-1.5 rounded-md transition-colors", colorClasses)}>
                    {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-black uppercase tracking-tight truncate">{widget.title || meta.label}</p>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">{meta.label}</p>
                </div>
                {!hideActions && (
                    <>
                        <button onClick={onEdit} className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border">
                            <SettingsIcon className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={onRemove} className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-border">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
            </div>
            <div className="p-5">
                {widget.type === 'TEXT' && (
                    <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{widget.content || 'No content yet...'}</p>
                )}
                {widget.type === 'IMAGE' && (
                    widget.image_url ? (
                        <img src={widget.image_url} alt={widget.alt_text || ''} className="w-full h-32 object-contain rounded-md bg-muted/20" onError={e => { e.currentTarget.src = ''; e.currentTarget.alt = 'Image failed to load'; }} />
                    ) : (
                        <div className="h-24 flex items-center justify-center rounded-md bg-muted/20 text-muted-foreground">
                            <ImageIcon className="w-8 h-8 opacity-30" />
                        </div>
                    )
                )}
                {widget.type === 'IFRAME' && (
                    <div className="h-20 flex items-center justify-center rounded-md bg-violet-500/5 border border-violet-500/20 text-violet-400">
                        <Frame className="w-5 h-5 mr-2 opacity-50" />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">{widget.iframe_url ? 'Embedded Content' : 'No URL set'}</span>
                    </div>
                )}
                {widget.type === 'STATUS' && (() => {
                    const sc = STATUS_COLORS[widget.status_value || 'ok'];
                    return (
                        <div className={cn("flex items-center gap-3 p-4 rounded-md", sc.bg)}>
                            <div className={cn("w-3 h-3 rounded-full animate-pulse", sc.dot)} />
                            <span className={cn("text-sm font-black uppercase", sc.text)}>{widget.status_label || 'Status'}</span>
                        </div>
                    );
                })()}
                {widget.type === 'TABLE' && widget.data_source === 'dataset' && (
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-2 py-3">
                        Dataset: {widget.dataset?.dataset_id ? '✓ configured' : 'not configured'}
                        {widget.dataset?.columns?.length ? ` · ${widget.dataset.columns.length} cols` : ''}
                    </div>
                )}
                {widget.type === 'TABLE' && widget.data_source !== 'dataset' && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[10px]">
                            <thead>
                                <tr className="border-b border-border">
                                    {(widget.table_headers || []).map((h, i) => (
                                        <th key={i} className="px-3 py-2 text-left font-black uppercase tracking-widest text-muted-foreground">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(widget.table_rows || []).slice(0, 2).map((row, ri) => (
                                    <tr key={ri} className="border-b border-border/30">
                                        {row.map((cell, ci) => (
                                            <td key={ci} className="px-3 py-1.5 text-muted-foreground">{cell}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {(widget.table_rows || []).length > 2 && (
                            <p className="text-[10px] text-muted-foreground/50 mt-1 px-3">+{(widget.table_rows || []).length - 2} more rows</p>
                        )}
                    </div>
                )}
                {widget.type === 'CHART' && (
                    <div className="h-20 flex items-center justify-center rounded-md bg-cyan-500/5 border border-cyan-500/20 text-cyan-500">
                        <BarChart3 className="w-5 h-5 mr-2 opacity-60" />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                            {(widget.chart_kind || 'bar').toUpperCase()} · {widget.data_source === 'dataset' ? (widget.dataset?.dataset_id ? 'Dataset' : 'No dataset') : 'Static'}
                        </span>
                    </div>
                )}
                {widget.type === 'METRIC' && (
                    <div className="flex items-center gap-3 p-3 rounded-md bg-emerald-500/5 border border-emerald-500/20">
                        <TrendingUp className="w-5 h-5 text-emerald-500 opacity-70" />
                        <div>
                            <p className="text-sm font-black text-emerald-600">
                                {widget.data_source === 'dataset' ? '— from dataset —' : (widget.metric_static_value || '0')}
                                {widget.metric_unit && <span className="text-[10px] text-muted-foreground ml-1">{widget.metric_unit}</span>}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{widget.metric_label || 'Metric'}</p>
                        </div>
                    </div>
                )}
                {widget.type === 'GAUGE' && (
                    <div className="flex items-center gap-3 p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
                        <Gauge className="w-5 h-5 text-amber-500 opacity-70" />
                        <div>
                            <p className="text-sm font-black text-amber-600">
                                {widget.data_source === 'dataset' ? '— from dataset —' : (widget.metric_static_value || '0')}
                                {widget.metric_unit && <span className="text-[10px] text-muted-foreground ml-1">{widget.metric_unit}</span>}
                            </p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{widget.metric_label || 'Gauge'} · 0–{widget.gauge_max ?? 100}</p>
                        </div>
                    </div>
                )}
                {widget.type === 'PROGRESS' && (
                    <div className="p-3 rounded-md bg-sky-500/5 border border-sky-500/20 space-y-2">
                        <div className="flex items-center gap-2 text-sky-600">
                            <Target className="w-4 h-4 opacity-70" />
                            <span className="text-xs font-black">
                                {widget.data_source === 'dataset' ? '— dataset —' : (widget.metric_static_value || '0')} / {widget.progress_target ?? 100}
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted-foreground/15 overflow-hidden">
                            <div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(100, ((Number(widget.metric_static_value) || 0) / (widget.progress_target || 100)) * 100)}%` }} />
                        </div>
                    </div>
                )}
                {widget.type === 'STAT_GRID' && (
                    <div className="h-20 flex items-center justify-center rounded-md bg-violet-500/5 border border-violet-500/20 text-violet-500">
                        <LayoutGrid className="w-5 h-5 mr-2 opacity-60" />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Stat grid · {widget.data_source === 'dataset' ? (widget.dataset?.dataset_id ? 'Dataset' : 'No dataset') : 'Static'}</span>
                    </div>
                )}
                {widget.type === 'SPARKLINE' && (
                    <div className="h-20 flex items-center justify-center rounded-md bg-cyan-500/5 border border-cyan-500/20 text-cyan-500">
                        <Activity className="w-5 h-5 mr-2 opacity-60" />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Trend · {widget.data_source === 'dataset' ? (widget.dataset?.dataset_id ? 'Dataset' : 'No dataset') : 'Static'}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PageDesignerPage;
