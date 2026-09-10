import React, { useEffect, useRef, useState } from 'react';
import { Terminal, Plus, Trash2, Database, Check, Copy, Zap, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { cn, generateUUID } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { WorkflowInput, WorkflowVariable, MultiInputItem, Dataset } from '../../types';
import { SearchableSelect } from '../SearchableSelect';
import { FilterBuilder } from '../FilterBuilder';
import { useAuth } from '../../context/AuthContext';
import { useNamespace } from '../../context/NamespaceContext';
import { API_BASE_URL } from '../../lib/api';
import { DatasetInputConfig, parseDatasetInputConfig, serializeDatasetInputConfig } from '../../lib/datasetInput';
import { DateTimeInput, DATE_TIME_PLACEHOLDER, convertDateTimeValue, getDateTimeMode } from '../DateTimeInput';

const parseDsColumns = (raw?: string): string[] => {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((c: any) => c && c.name).map((c: any) => c.name) : [];
    } catch { return []; }
};

const DatasetInputConfigEditor: React.FC<{
    defaultValue: string;
    onChange: (value: string) => void;
}> = ({ defaultValue, onChange }) => {
    const { apiFetch } = useAuth();
    const { activeNamespace } = useNamespace();
    const [datasets, setDatasets] = useState<Dataset[]>([]);
    // Datasets already resolved by reference, so the list fetch + the resolver
    // below don't refetch or clobber each other.
    const fetchedDatasetIdsRef = useRef<Set<string>>(new Set());

    const cfg: DatasetInputConfig = parseDatasetInputConfig(defaultValue);

    useEffect(() => {
        if (!activeNamespace) return;
        apiFetch(`${API_BASE_URL}/namespaces/${activeNamespace.id}/datasets?limit=200`)
            .then(r => r.json())
            .then(d => {
                const items: Dataset[] = d.items || [];
                // Merge instead of replace so a dataset resolved by reference is kept.
                setDatasets(prev => {
                    const m = new Map(prev.map(x => [x.id, x]));
                    items.forEach(x => m.set(x.id, x));
                    return Array.from(m.values());
                });
            })
            .catch(() => { });
    }, [activeNamespace?.id]);

    // The list fetch only loads the first 200 datasets, so an input configured with a
    // dataset outside that page renders blank (picker shows placeholder, no columns).
    // Resolve the referenced dataset by id and merge it in.
    useEffect(() => {
        const did = cfg.dataset_id;
        if (!did) return;
        if (fetchedDatasetIdsRef.current.has(did) || datasets.some(d => d.id === did)) return;
        fetchedDatasetIdsRef.current.add(did);
        apiFetch(`${API_BASE_URL}/datasets/${did}`)
            .then(res => (res.ok ? res.json() : null))
            .then((ds: Dataset | null) => {
                if (!ds) return;
                setDatasets(prev => {
                    const m = new Map(prev.map(x => [x.id, x]));
                    m.set(ds.id, ds);
                    return Array.from(m.values());
                });
            })
            .catch(() => { });
    }, [cfg.dataset_id, datasets]);
    const update = (patch: Partial<DatasetInputConfig>) =>
        onChange(serializeDatasetInputConfig({ ...cfg, ...patch }));

    const selectedDs = datasets.find(d => d.id === cfg.dataset_id);
    const cols = parseDsColumns(selectedDs?.columns);

    return (
        <div className="space-y-2 pt-2 border-t border-border/30 mt-2">
            <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-cyan-500/80">Dataset</label>
                <SearchableSelect
                    options={datasets.map(d => ({ label: `${d.name} (${d.key})`, value: d.id, searchTerms: `${d.name} ${d.key}` }))}
                    value={cfg.dataset_id}
                    onValueChange={(val) => update({ dataset_id: val || '' })}
                    isSearchable
                    placeholder="— Select dataset —"
                    searchPlaceholder="Search datasets..."
                    triggerClassName="h-8 px-2 w-full text-xs font-semibold border-border rounded-md bg-background text-foreground"
                />
            </div>

            {cfg.dataset_id && (
                <>
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-cyan-500/80">Base Filter</label>
                        <FilterBuilder
                            value={cfg.filter}
                            onChange={(v) => update({ filter: v })}
                            columns={[...cols, '_id']}
                        />
                        <p className="text-[9px] text-muted-foreground/50 font-mono">Applied automatically at runtime · supports {"{{ input.x }}"}</p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-cyan-500/80">Display Template</label>
                        <Input
                            value={cfg.display}
                            onChange={(e) => update({ display: e.target.value })}
                            placeholder={cols.length > 0 ? `{{item.${cols[0]}}}` : '{{item.name}} - {{item.email}}'}
                            className="h-8 text-xs font-mono border-border bg-background"
                        />
                        <p className="text-[9px] text-muted-foreground/50 font-mono">
                            How each record is shown in the picker. Use {"{{item.<field>}}"}{cols.length > 0 && ` · fields: ${cols.join(', ')}`}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};

const MultiInputConfigEditor: React.FC<{
    defaultValue: string;
    onChange: (value: string) => void;
}> = ({ defaultValue, onChange }) => {
    let items: MultiInputItem[] = [];
    try {
        items = JSON.parse(defaultValue);
        if (!Array.isArray(items)) throw new Error();
        // Ensure all existing items have a stable id
        let changed = false;
        items = items.map(item => {
            if (!item.id) {
                changed = true;
                return { ...item, id: generateUUID() };
            }
            return item;
        });
        if (changed) {
            setTimeout(() => onChange(JSON.stringify(items)), 0);
        }
    } catch (e) {
        // Fallback for old comma-separated keys
        items = (defaultValue || '').split(',').map(k => ({
            id: generateUUID(),
            key: k.trim(),
            label: k.trim(),
            type: 'input' as const
        })).filter(i => i.key);
    }

    const updateItems = (newItems: MultiInputItem[]) => {
        onChange(JSON.stringify(newItems));
    };

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const newItems = Array.from(items);
        const [removed] = newItems.splice(result.source.index, 1);
        newItems.splice(result.destination.index, 0, removed);
        updateItems(newItems);
    };

    return (
        <div className="space-y-4 pt-4 border-t border-border/30 mt-2">
            <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Field Definitions</span>
                <span className="text-[10px] text-muted-foreground italic">Add keys that will correspond to each row item</span>
            </div>
            
            <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="multi-input-fields">
                    {(provided) => (
                        <div 
                            className="space-y-3"
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                        >
                            {items.map((item, i) => (
                                <Draggable key={item.id || `field-${i}`} draggableId={item.id || `field-${i}`} index={i}>
                                    {(provided, snapshot) => (
                                        <div 
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            className={cn(
                                                "group/item bg-muted/30 hover:bg-muted/50 border border-border/50 rounded-md p-4 transition-all duration-200 relative",
                                                snapshot.isDragging && "shadow-lg border-primary/20 bg-muted/70 z-50"
                                            )}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div 
                                                    {...provided.dragHandleProps}
                                                    className="mt-6 text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
                                                >
                                                    <GripVertical className="w-4 h-4" />
                                                </div>
                                                <div className="flex-1 grid grid-cols-12 gap-4 items-start">
                                                    <div className="col-span-4 space-y-1.5">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Variable Key</label>
                                                        <Input
                                                            value={item.key}
                                                            onChange={(e) => {
                                                                const ni = [...items];
                                                                ni[i].key = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                                                                updateItems(ni);
                                                            }}
                                                            placeholder="key"
                                                            className="h-8 text-xs font-mono bg-background border-border/50 focus:border-primary/50"
                                                        />
                                                    </div>
                                                    <div className="col-span-4 space-y-1.5">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Display Label</label>
                                                        <Input
                                                            value={item.label}
                                                            onChange={(e) => {
                                                                const ni = [...items];
                                                                ni[i].label = e.target.value;
                                                                updateItems(ni);
                                                            }}
                                                            placeholder="label"
                                                            className="h-8 text-xs bg-background border-border/50 focus:border-primary/50"
                                                        />
                                                    </div>
                                                    <div className="col-span-4 space-y-1.5">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Field Type</label>
                                                        <select
                                                            value={item.type}
                                                            onChange={(e) => {
                                                                const ni = [...items];
                                                                ni[i].type = e.target.value as any;
                                                                updateItems(ni);
                                                            }}
                                                            className="h-8 px-2 w-full text-xs font-semibold border border-border/50 rounded-md bg-background text-foreground outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                                                        >
                                                            <option value="input">Input</option>
                                                            <option value="number">Number</option>
                                                            <option value="select">Select</option>
                                                            <option value="date">Date</option>
                                                            <option value="time">Time</option>
                                                            <option value="file">File Upload</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>

                                            {item.type === 'date' && (
                                                <div className="border-t border-border/20 animate-in fade-in slide-in-from-top-1 duration-200 mt-3 pt-3 ml-7 flex items-center justify-between">
                                                    <div className="space-y-0.5">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-primary/70">Include time</label>
                                                        <p className="text-[10px] text-muted-foreground">Also pick a time (value becomes YYYY-MM-DDTHH:MM)</p>
                                                    </div>
                                                    <Switch
                                                        checked={item.include_time || false}
                                                        onCheckedChange={(val) => {
                                                            const ni = [...items];
                                                            ni[i].include_time = val;
                                                            updateItems(ni);
                                                        }}
                                                    />
                                                </div>
                                            )}

                                            {item.type === 'select' && (
                                                <div className=" border-t border-border/20 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200 mt-3 pt-3 ml-7">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-primary/70">Options (comma-separated)</label>
                                                    <Textarea
                                                        value={item.options || ''}
                                                        onChange={(e) => {
                                                            const ni = [...items];
                                                            ni[i].options = e.target.value;
                                                            updateItems(ni);
                                                        }}
                                                        placeholder="opt1, opt2, opt3"
                                                        className="min-h-[40px] text-xs bg-background border-border/50 focus:border-primary/50 resize-y"
                                                    />
                                                </div>
                                            )}

                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    const ni = items.filter((_, idx) => idx !== i);
                                                    updateItems(ni);
                                                }}
                                                className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-destructive text-white shadow-lg opacity-0 group-hover/item:opacity-100 transition-all duration-200 hover:scale-110 active:scale-95 z-10"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>

            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    updateItems([...items, { id: generateUUID(), key: '', label: '', type: 'input' }]);
                }}
                className="w-full h-9 border-dashed border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 text-[10px] font-black uppercase tracking-[0.2em] rounded-md transition-all duration-200"
            >
                <Plus className="w-3.5 h-3.5 mr-2" /> Add Structure Field
            </Button>
        </div>
    );
};

interface VariablesTabProps {
    inputs: Partial<WorkflowInput>[];
    setInputs: (inputs: Partial<WorkflowInput>[]) => void;
    variables: Partial<WorkflowVariable>[];
    setVariables: (variables: Partial<WorkflowVariable>[]) => void;
    copyToClipboard: (text: string, key: string) => void;
    copiedKey: string | null;
    handleDragEnd: (result: DropResult) => void;
}

// Kept next to the authoring UI so the cheat sheet stays in step with the scopes the
// executor actually injects (backend getInterpolationContext).
const TEMPLATE_SCOPES: [string, string][] = [
    ['{{ input.key }}', 'Runtime input, filled per run'],
    ['{{ variable.key }}', 'Static workflow variable'],
    ['{{ global.KEY }}', 'Global variable of this namespace'],
    ['{{ flow.group.step.action_key }}', 'Output of an earlier step · flow.group.status for its state'],
    ['{{ item }} / {{ index }}', 'Current element and 0-based position, inside a loop only'],
    ['{{ user.nickname }}', 'Runner identity · also username, full_name, email, chat_account_id, id · empty on a schedule run'],
];

export const VariablesTab: React.FC<VariablesTabProps> = ({
    inputs, setInputs, variables, setVariables, copyToClipboard, copiedKey, handleDragEnd
}) => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-2 duration-300">
            {/* Runtime Inputs Section */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-500">
                            <Terminal className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-bold text-foreground uppercase tracking-tight">Runtime Variable Definitions (Inputs)</h2>
                    </div>
                    <Button
                        onClick={() => setInputs([...inputs, { id: generateUUID(), key: '', label: '', type: 'input', default_value: '', required: true }])}
                        className="h-8 text-[10px] font-bold uppercase tracking-widest px-4"
                        variant="outline"
                    >
                        <Plus className="w-3 h-3 mr-2" /> Add Input
                    </Button>
                </div>

                <div className="bg-card rounded-md border border-border p-6 shadow-sm overflow-hidden">
                    {inputs.length === 0 ? (
                        <div className="py-6 text-center opacity-40 select-none">
                            <Terminal className="w-8 h-8 mx-auto mb-3" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No runtime variables defined</p>
                            <p className="text-[10px] mt-1 font-medium italic">Use runtime variables in your steps via {"{{input.key}}"}</p>
                        </div>
                    ) : (
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId="workflow-inputs" type="INPUT">
                                {(provided) => (
                                    <div 
                                        className="space-y-4"
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                    >
                                        {inputs.map((input, idx) => (
                                            <Draggable 
                                                key={input.id || `input-${idx}`} 
                                                draggableId={input.id || `input-${idx}`} 
                                                index={idx}
                                            >
                                                {(provided, snapshot) => (
                                                    <div 
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        className={cn(
                                                            "p-5 rounded-md border transition-all duration-300 relative group",
                                                            snapshot.isDragging 
                                                                ? "bg-muted/80 border-primary/30 shadow-xl z-50 scale-[1.01]" 
                                                                : "bg-background/50 border-border/50"
                                                        )}
                                                    >
                                                        {/* Drag Handle */}
                                                        <div
                                                            {...provided.dragHandleProps}
                                                            className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-primary transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
                                                        >
                                                            <GripVertical className="w-3.5 h-3.5" />
                                                        </div>

                                                        <div className="grid grid-cols-12 gap-5 items-start pl-4">

                                                            {/* Left side: Label & Key */}
                                                            <div className="col-span-5">
                                                                <div className="space-y-0">
                                                                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Display Label</label>
                                                                    <Input
                                                                        value={input.label}
                                                                        onChange={(e) => {
                                                                            const ni = [...inputs];
                                                                            ni[idx].label = e.target.value;
                                                                            setInputs(ni);
                                                                        }}
                                                                        placeholder="What should the user see?"
                                                                        className="h-8 text-xs border-border bg-background"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-black uppercase tracking-widest text-primary">Variable Key</label>

                                                                    <div className="relative">
                                                                        <Input
                                                                            value={input.key}
                                                                            onChange={(e) => {
                                                                                const ni = [...inputs];
                                                                                ni[idx].key = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                                                                                setInputs(ni);
                                                                            }}
                                                                            placeholder="key"
                                                                            className="h-8 text-xs font-mono border-border bg-background pr-8"
                                                                        />
                                                                        {input.key && (
                                                                            <button
                                                                                onClick={() => copyToClipboard(`{{input.${input.key}}}`, `input-${idx}`)}
                                                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors"
                                                                                title="Copy as {{input.key}}"
                                                                            >
                                                                                {copiedKey === `input-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Right side: Type & Default Value */}
                                                            <div className="col-span-6">
                                                                <div className="space-y-1.5">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</label>
                                                                        <div className="flex items-center gap-2">
                                                                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Required</label>
                                                                            <Switch
                                                                                checked={input.required ?? true}
                                                                                onCheckedChange={(val) => {
                                                                                    const ni = [...inputs];
                                                                                    ni[idx].required = val;
                                                                                    setInputs(ni);
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <select
                                                                        value={input.type || 'input'}
                                                                        onChange={(e) => { const ni = [...inputs]; ni[idx].type = e.target.value as WorkflowInput['type']; setInputs(ni); }}
                                                                        className="h-8 px-2 w-full text-xs font-semibold border border-border rounded-md bg-background text-foreground outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                                                                    >
                                                                        <option value="input">Input</option>
                                                                        <option value="textarea">Textarea</option>
                                                                        <option value="number">Number</option>
                                                                        <option value="select">Select</option>
                                                                        <option value="multi-select">Multi-Select</option>
                                                                        <option value="multi-input">Multi-Input</option>
                                                                        <option value="date">Date</option>
                                                                        <option value="time">Time</option>
                                                                        <option value="file">File Upload</option>
                                                                        <option value="dataset-select">Dataset Record</option>
                                                                        <option value="dataset-multi-select">Dataset Records (Multi)</option>
                                                                    </select>
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                                                        {input.type === 'select' || input.type === 'multi-select' ? 'Options (comma-separated)'
                                                                            : input.type === 'multi-input' ? 'Configure Fields for Rows'
                                                                                : input.type === 'file' ? ''
                                                                                : input.type === 'date' || input.type === 'time' ? `Default Value (${DATE_TIME_PLACEHOLDER[getDateTimeMode(input.type, input.include_time)]})`
                                                                                    : input.type === 'dataset-select' || input.type === 'dataset-multi-select' ? 'Dataset Configuration'
                                                                                        : 'Default Value'}
                                                                    </label>
                                                                     {input.type === 'file' ? (
                                                                         <div className="space-y-2">
                                                                             <div className="h-8 flex items-center px-3 border border-dashed border-border/50 rounded-md bg-muted/10">
                                                                                 <span className="text-[10px] text-muted-foreground italic">No default value for files</span>
                                                                             </div>
                                                                             <div className="flex items-center justify-between bg-muted/20 p-2 rounded-md border border-border/50">
                                                                                 <div className="space-y-0.5">
                                                                                     <label className="text-[10px] font-black uppercase tracking-widest text-primary">Allow folder upload</label>
                                                                                     <p className="text-[10px] text-muted-foreground">Let users pick an entire folder (structure preserved)</p>
                                                                                 </div>
                                                                                 <Switch
                                                                                     checked={input.allow_folder || false}
                                                                                     onCheckedChange={(val) => {
                                                                                         const ni = [...inputs];
                                                                                         ni[idx].allow_folder = val;
                                                                                         setInputs(ni);
                                                                                     }}
                                                                                 />
                                                                             </div>
                                                                         </div>
                                                                     ) : input.type === 'dataset-select' || input.type === 'dataset-multi-select' ? (
                                                                        <DatasetInputConfigEditor
                                                                            defaultValue={input.default_value || ''}
                                                                            onChange={(newValue) => {
                                                                                const ni = [...inputs];
                                                                                ni[idx].default_value = newValue;
                                                                                setInputs(ni);
                                                                            }}
                                                                        />
                                                                     ) : input.type === 'multi-input' ? (
                                                                        <div className="space-y-4">
                                                                            <div className="flex items-center justify-between bg-muted/20 p-2 rounded-md border border-border/50">
                                                                                <div className="space-y-0.5">
                                                                                    <label className="text-[10px] font-black uppercase tracking-widest text-primary">Collapse initially</label>
                                                                                    <p className="text-[10px] text-muted-foreground">Start with 0 rows instead of 1</p>
                                                                                </div>
                                                                                <Switch 
                                                                                    checked={input.collapse_initially || false} 
                                                                                    onCheckedChange={(val) => {
                                                                                        const ni = [...inputs];
                                                                                        ni[idx].collapse_initially = val;
                                                                                        setInputs(ni);
                                                                                    }} 
                                                                                />
                                                                            </div>
                                                                            <MultiInputConfigEditor
                                                                                defaultValue={input.default_value || ''}
                                                                                onChange={(newValue) => {
                                                                                    const ni = [...inputs];
                                                                                    ni[idx].default_value = newValue;
                                                                                    setInputs(ni);
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ) : input.type === 'date' || input.type === 'time' ? (
                                                                        <div className="space-y-2">
                                                                            <DateTimeInput
                                                                                mode={getDateTimeMode(input.type, input.include_time)}
                                                                                value={input.default_value || ''}
                                                                                onChange={(val) => {
                                                                                    const ni = [...inputs];
                                                                                    ni[idx].default_value = val;
                                                                                    setInputs(ni);
                                                                                }}
                                                                                className="h-8 text-xs"
                                                                            />
                                                                            {input.type === 'date' && (
                                                                                <div className="flex items-center justify-between bg-muted/20 p-2 rounded-md border border-border/50">
                                                                                    <div className="space-y-0.5">
                                                                                        <label className="text-[10px] font-black uppercase tracking-widest text-primary">Include time</label>
                                                                                        <p className="text-[10px] text-muted-foreground">Also pick a time (value becomes YYYY-MM-DDTHH:MM)</p>
                                                                                    </div>
                                                                                    <Switch
                                                                                        checked={input.include_time || false}
                                                                                        onCheckedChange={(val) => {
                                                                                            const ni = [...inputs];
                                                                                            ni[idx].include_time = val;
                                                                                            // Keep the day already picked: convert the default to the new
                                                                                            // format instead of shipping a value the run dialog rejects.
                                                                                            ni[idx].default_value = convertDateTimeValue(ni[idx].default_value || '', val ? 'datetime' : 'date');
                                                                                            setInputs(ni);
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    ) : input.type === 'input' ? (
                                                                        <Textarea
                                                                            value={input.default_value}
                                                                            onChange={(e) => {
                                                                                const ni = [...inputs];
                                                                                ni[idx].default_value = e.target.value;
                                                                                setInputs(ni);
                                                                            }}
                                                                            placeholder="Default text... supports multi-line"
                                                                            className="min-h-[60px] text-xs border-border bg-background resize-y"
                                                                        />
                                                                    ) : input.type === 'textarea' ? (
                                                                        <Textarea
                                                                            value={input.default_value}
                                                                            onChange={(e) => {
                                                                                const ni = [...inputs];
                                                                                ni[idx].default_value = e.target.value;
                                                                                setInputs(ni);
                                                                            }}
                                                                            placeholder="Default long text..."
                                                                            className="min-h-[120px] text-xs border-border bg-background resize-y"
                                                                        />
                                                                    ) : input.type === 'number' ? (
                                                                        <Input
                                                                            type="number"
                                                                            value={input.default_value}
                                                                            onChange={(e) => {
                                                                                const ni = [...inputs];
                                                                                ni[idx].default_value = e.target.value;
                                                                                setInputs(ni);
                                                                            }}
                                                                            placeholder="0"
                                                                            className="h-8 text-xs border-border bg-background"
                                                                        />
                                                                    ) : (
                                                                        <Textarea
                                                                            value={input.default_value}
                                                                            onChange={(e) => {
                                                                                const ni = [...inputs];
                                                                                ni[idx].default_value = e.target.value;
                                                                                setInputs(ni);
                                                                            }}
                                                                            placeholder={
                                                                                (input.type === 'select' || input.type === 'multi-select') ? 'option1, option2, option3'
                                                                                    : 'Default value...'
                                                                            }
                                                                            className="min-h-[60px] text-xs border-border bg-background resize-y"
                                                                        />
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Delete Button */}
                                                            <div className="col-span-1 flex justify-end items-center h-[120px]">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                                                    onClick={() => {
                                                                        const ni = inputs.filter((_, i) => i !== idx);
                                                                        setInputs(ni);
                                                                    }}
                                                                    title="Delete input"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>
                    )}
                </div>
            </div>

            {/* Static Variables Section */}
            <div className="space-y-6 pt-6 border-t border-border/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                            <Database className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-bold text-foreground uppercase tracking-tight">Static Variables</h2>
                    </div>
                    <Button
                        onClick={() => setVariables([...variables, { id: generateUUID(), key: '', value: '' }])}
                        className="h-8 text-[10px] font-bold uppercase tracking-widest px-4"
                        variant="outline"
                    >
                        <Plus className="w-3 h-3 mr-2" /> Add Variable
                    </Button>
                </div>

                <div className="bg-card rounded-md border border-border p-6 shadow-sm">
                    {variables.length === 0 ? (
                        <div className="py-6 text-center opacity-40 select-none">
                            <Database className="w-8 h-8 mx-auto mb-3" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No static variables defined</p>
                            <p className="text-[10px] mt-1 font-medium italic">Reference via {'{{'}{"variable.key"}{'}}'} in steps</p>
                        </div>
                    ) : (
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId="STATIC_VARIABLES" type="VARIABLE">
                                {(provided) => (
                                    <div
                                        {...provided.droppableProps}
                                        ref={provided.innerRef}
                                        className="space-y-3"
                                    >
                                        {variables.map((variable, idx) => (
                                            <Draggable key={variable.id || `var-${idx}`} draggableId={variable.id || `var-${idx}`} index={idx}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        className={cn(
                                                            "p-4 bg-background/50 rounded-md border border-border/50 animate-in fade-in slide-in-from-bottom-1 duration-300 relative group",
                                                            snapshot.isDragging && "shadow-xl border-emerald-500/30 bg-emerald-500/5 z-50"
                                                        )}
                                                    >
                                                        {/* Drag Handle */}
                                                        <div
                                                            {...provided.dragHandleProps}
                                                            className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/30 hover:text-emerald-500 transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
                                                        >
                                                            <GripVertical className="w-3.5 h-3.5" />
                                                        </div>

                                                        <div className="grid grid-cols-12 gap-4 items-start pl-4">
                                                            <div className="col-span-4 space-y-1.5">
                                                                <label className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Variable Key</label>
                                                                <div className="relative">
                                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground/60 font-mono select-none">$</span>
                                                                    <Input
                                                                        value={variable.key}
                                                                        onChange={(e) => {
                                                                            const nv = [...variables];
                                                                            nv[idx].key = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                                                                            setVariables(nv);
                                                                        }}
                                                                        placeholder="e.g. host"
                                                                        className="h-8 text-xs font-mono border-border bg-background pl-5 pr-8"
                                                                    />
                                                                    {variable.key && (
                                                                        <button
                                                                            onClick={() => copyToClipboard(`{{variable.${variable.key}}}`, `var-${idx}`)}
                                                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-emerald-500 transition-colors"
                                                                            title="Copy as {{variable.key}}"
                                                                        >
                                                                            {copiedKey === `var-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="col-span-7 space-y-1.5">
                                                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Value</label>
                                                                <Textarea
                                                                    value={variable.value}
                                                                    onChange={(e) => {
                                                                        const nv = [...variables];
                                                                        nv[idx].value = e.target.value;
                                                                        setVariables(nv);
                                                                    }}
                                                                    placeholder="Static value..."
                                                                    className="min-h-[32px] h-8 text-xs border-border bg-background font-mono resize-y py-1"
                                                                />
                                                            </div>
                                                            <div className="col-span-1 flex justify-end items-start pt-5">
                                                                <Button
                                                                    variant="ghost"
                                                                                                        size="icon"
                                                                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                                                                                                        onClick={() => {
                                                                                                            const nv = variables.filter((_, i) => i !== idx);
                                                                                                            setVariables(nv);
                                                                                                        }}
                                                                                                        title="Delete variable"
                                                                                                    >
                                                                                                        <Trash2 className="w-4 h-4" />
                                                                                                    </Button>
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                </Draggable>
                                                                            ))}
                                                                            {provided.placeholder}
                                                                        </div>
                                )}
                            </Droppable>
                        </DragDropContext>
                    )}
                </div>

                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-md p-4 flex items-start gap-3">
                    <div className="p-1 rounded-full bg-emerald-500/20 text-emerald-500 shrink-0 mt-0.5">
                        <Zap className="w-3 h-3" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-tight">Static Variables vs Runtime Inputs</p>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                            <strong>Static Variables</strong> are saved with the workflow and automatically injected at runtime using <code className="bg-emerald-500/10 px-1 rounded text-emerald-600">{"{{variable.key}}"}</code>.<br />
                            <strong>Runtime Inputs</strong> prompt the user for values on each run and are used via <code className="bg-primary/10 px-1 rounded text-primary">{"{{input.key}}"}</code>.
                        </p>
                    </div>
                </div>

                <details className="bg-muted/20 border border-border rounded-md p-4 text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer font-bold uppercase tracking-tight text-foreground/80">Every scope you can use in a template</summary>
                    <div className="mt-3 grid gap-1 font-mono leading-relaxed">
                        {TEMPLATE_SCOPES.map(([expr, note]) => (
                            <div key={expr} className="flex flex-wrap gap-x-2">
                                <code className="bg-primary/10 px-1 rounded text-primary">{expr}</code>
                                <span className="font-sans opacity-70">{note}</span>
                            </div>
                        ))}
                    </div>
                    <p className="mt-3 font-sans opacity-70 leading-relaxed">
                        Filters: <code className="bg-muted/60 px-1 rounded">json</code> <code className="bg-muted/60 px-1 rounded">shellquote</code> <code className="bg-muted/60 px-1 rounded">filter_by</code> <code className="bg-muted/60 px-1 rounded">pluck</code> <code className="bg-muted/60 px-1 rounded">attr</code> <code className="bg-muted/60 px-1 rounded">find</code> <code className="bg-muted/60 px-1 rounded">get</code> — e.g. {"{{ flow.g1.step.rows | pluck:'email' | json }}"}. Always pass untrusted text through <code className="bg-muted/60 px-1 rounded">| shellquote</code> inside a command.
                    </p>
                </details>
            </div>
        </div>
    );
};
