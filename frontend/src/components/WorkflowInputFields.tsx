import React, { useMemo } from 'react';
import { WorkflowInput, MultiInputItem } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Plus, Trash2 } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { DatasetRecordPicker } from './DatasetRecordPicker';
import { parseDatasetInputConfig } from '../lib/datasetInput';
import { DateTimeInput, getDateTimeMode } from './DateTimeInput';
import { parseMultiInputConfig } from '../lib/multiInput';

// Shared rendering for a workflow's input fields, used by both the run-flow
// WorkflowInputDialog and the public PublicScheduleDialog so both dialogs stay
// in lockstep (searchable selects, multi-input, templates, etc.). The parent
// owns the values/errors/file state; this component only renders + wires onChange.
//
// `richFallback` toggles the two field types that need run-only infra (real file
// upload + dataset record picker). The schedule flow posts plain JSON values with
// no upload/picker, so it passes richFallback=true → file & dataset render as a
// plain text field (value still provided, format matches an immediate run).

export const getSelectDisplayLabel = (opt: string) => {
    const idx = opt.indexOf('::');
    return idx >= 0 ? opt.substring(0, idx).trim() : opt;
};

export interface TemplateMap {
    _template_for: string;
    [optionValue: string]: string;
}

export const parseTemplateMap = (defaultValue: string): TemplateMap | null => {
    if (!defaultValue) return null;
    const trimmed = defaultValue.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && typeof parsed._template_for === 'string') {
            return parsed as TemplateMap;
        }
    } catch { /* not a template map */ }
    return null;
};

const toggleMultiSelectValue = (currentValue: string, option: string) => {
    let selected: string[] = [];
    try {
        selected = JSON.parse(currentValue || '[]');
    } catch (e) {
        selected = (currentValue || '').split(',').map(s => s.trim()).filter(Boolean);
    }
    if (selected.includes(option)) {
        selected = selected.filter(s => s !== option);
    } else {
        selected = [...selected, option];
    }
    return JSON.stringify(selected);
};

const updateMultiInputValue = (currentValue: string, rowIndex: number, field: string, value: string) => {
    let rows: any[] = [];
    try {
        rows = JSON.parse(currentValue || '[]');
    } catch (e) {
        rows = [{}];
    }
    if (!Array.isArray(rows)) rows = [{}];
    if (!rows[rowIndex]) rows[rowIndex] = {};
    rows[rowIndex][field] = value;
    return JSON.stringify(rows);
};

const addMultiInputRow = (currentValue: string) => {
    let rows: any[] = [];
    try {
        rows = JSON.parse(currentValue || '[]');
    } catch (e) {
        rows = [{}];
    }
    if (!Array.isArray(rows)) rows = [{}];
    rows.push({});
    return JSON.stringify(rows);
};

const removeMultiInputRow = (currentValue: string, rowIndex: number) => {
    let rows: any[] = [];
    try {
        rows = JSON.parse(currentValue || '[]');
    } catch (e) {
        return currentValue;
    }
    if (!Array.isArray(rows)) return currentValue;
    rows.splice(rowIndex, 1);
    return JSON.stringify(rows);
};

interface WorkflowInputFieldsProps {
    inputs: WorkflowInput[];
    values: Record<string, string>;
    setValues: (values: Record<string, string>) => void;
    errors?: Record<string, string>;
    setErrors?: (errors: Record<string, string>) => void;
    // File state — only required when richFallback is false (real upload flow).
    files?: Record<string, File>;
    setFiles?: (files: Record<string, File>) => void;
    folderFiles?: Record<string, File[]>;
    setFolderFiles?: (folderFiles: Record<string, File[]>) => void;
    multiInputFiles?: Record<string, Record<number, Record<string, File>>>;
    setMultiInputFiles?: (files: Record<string, Record<number, Record<string, File>>>) => void;
    // true → file & dataset render as a plain text field (schedule flow, no upload/picker).
    richFallback?: boolean;
    // true → show a red "*" after required labels (public schedule form wants an explicit marker;
    // the run dialog signals required via label color only, so it leaves this off).
    showRequiredMark?: boolean;
}

export const WorkflowInputFields: React.FC<WorkflowInputFieldsProps> = ({
    inputs,
    values,
    setValues,
    errors,
    setErrors,
    files,
    setFiles,
    folderFiles,
    setFolderFiles,
    multiInputFiles,
    setMultiInputFiles,
    richFallback = false,
    showRequiredMark = false,
}) => {
    const err = errors ?? {};
    const setErr = setErrors ?? (() => {});
    const filesState = files ?? {};
    const setFilesState = setFiles ?? (() => {});
    const folderFilesState = folderFiles ?? {};
    const setFolderFilesState = setFolderFiles ?? (() => {});
    const multiInputFilesState = multiInputFiles ?? {};
    const setMultiInputFilesState = setMultiInputFiles ?? (() => {});

    const templateMaps = useMemo(() => {
        const maps: Record<string, TemplateMap> = {};
        for (const input of inputs) {
            const tm = parseTemplateMap(input.default_value);
            if (tm) maps[input.key] = tm;
        }
        return maps;
    }, [inputs]);

    const templateTargetKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const tm of Object.values(templateMaps)) {
            keys.add(tm._template_for);
        }
        return keys;
    }, [templateMaps]);

    const applyTemplates = (newValues: Record<string, string>, changedKey: string) => {
        if (!templateTargetKeys.has(changedKey)) return newValues;
        const selectedValue = newValues[changedKey] || '';
        const updated = { ...newValues };
        for (const [inputKey, tm] of Object.entries(templateMaps)) {
            if (tm._template_for !== changedKey) continue;
            const matchKey = Object.keys(tm).find(k => k !== '_template_for' && selectedValue.startsWith(k));
            if (matchKey) {
                updated[inputKey] = tm[matchKey];
            } else {
                updated[inputKey] = '';
            }
        }
        return updated;
    };

    const clearError = (key: string) => {
        if (err[key]) setErr({ ...err, [key]: '' });
    };
    const setVal = (key: string, val: string) => {
        setValues({ ...values, [key]: val });
        clearError(key);
    };

    return (
        <>
            {inputs.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((input) => (
                <div key={input.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <Label className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${err[input.key] ? 'text-destructive' : (input.required ? 'text-primary' : 'text-muted-foreground')}`}>
                            {input.label || input.key}
                            {showRequiredMark && input.required && <span className="text-rose-500 ml-0.5">*</span>}
                        </Label>
                        {err[input.key] && (
                            <span className="text-[10px] font-medium text-destructive">
                                {err[input.key]}
                            </span>
                        )}
                    </div>

                    <div className="relative">
                        {input.type === 'select' ? (
                            <SearchableSelect
                                options={(input.default_value || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => ({ label: o, value: o }))}
                                value={values[input.key] || ''}
                                onValueChange={(val: string) => {
                                    const nv = applyTemplates({ ...values, [input.key]: val }, input.key);
                                    setValues(nv);
                                    clearError(input.key);
                                }}
                                placeholder="Select an option..."
                                searchPlaceholder="Search options..."
                                isSearchable
                                triggerClassName={`h-9 rounded-md ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                            />
                        ) : input.type === 'multi-select' ? (
                            <div className="flex flex-wrap gap-2 p-3 bg-background border border-border rounded-md shadow-sm">
                                {(input.default_value || '').split(',').map((opt) => opt.trim()).filter(Boolean).map((opt) => {
                                    let selected: string[] = [];
                                    try { selected = JSON.parse(values[input.key] || '[]'); } catch (e) { }
                                    const isSelected = selected.includes(opt);
                                    return (
                                        <Button
                                            key={opt}
                                            type="button"
                                            variant={isSelected ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setValues({ ...values, [input.key]: toggleMultiSelectValue(values[input.key], opt) })}
                                            className={`h-7 px-3 text-[10px] font-bold rounded-md transition-all ${isSelected ? 'premium-gradient shadow-sm border-0 text-white' : 'hover:bg-indigo-500/10 hover:text-indigo-500 hover:border-indigo-500/30'}`}
                                        >
                                            {getSelectDisplayLabel(opt)}
                                        </Button>
                                    );
                                })}
                            </div>
                        ) : input.type === 'multi-input' ? (
                            <div className="space-y-3">
                                {(() => {
                                    let rows: any[] = [];
                                    try { rows = JSON.parse(values[input.key] || '[]'); } catch (e) { rows = []; }
                                    if (!Array.isArray(rows)) rows = [];

                                    const config: MultiInputItem[] = parseMultiInputConfig(input.default_value);

                                    return (
                                        <>
                                            <div className="flex flex-col gap-2">
                                                {rows.map((row, rowIndex) => (
                                                    <div key={rowIndex} className="group/row relative flex flex-wrap gap-3 p-3 bg-background border border-border rounded-md shadow-sm transition-all hover:border-indigo-500/30">
                                                        {config.map((field) => (
                                                            <div key={field.key} className="flex flex-col gap-1 min-w-[200px] flex-1">
                                                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate" title={field.label || field.key}>
                                                                    {field.label || field.key}
                                                                </span>
                                                                {field.type === 'select' ? (
                                                                    <SearchableSelect
                                                                        options={(field.options || '').split(',').map((o: string) => o.trim()).filter(Boolean).map((o: string) => ({ label: o, value: o }))}
                                                                        value={row[field.key] || ''}
                                                                        onValueChange={(val: string) => setValues({ ...values, [input.key]: updateMultiInputValue(values[input.key], rowIndex, field.key, val) })}
                                                                        placeholder="Select..."
                                                                        searchPlaceholder="Search..."
                                                                        isSearchable
                                                                        triggerClassName="h-8 rounded-md bg-muted/30"
                                                                    />
                                                                ) : (field.type === 'date' || field.type === 'time') ? (
                                                                    <DateTimeInput
                                                                        mode={getDateTimeMode(field.type, field.include_time)}
                                                                        value={row[field.key] || ''}
                                                                        onChange={(val) => setValues({ ...values, [input.key]: updateMultiInputValue(values[input.key], rowIndex, field.key, val) })}
                                                                        className="h-8 bg-muted/30"
                                                                    />
                                                                ) : (field.type === 'file' && !richFallback) ? (
                                                                    <Input
                                                                        type="file"
                                                                        className="h-8 bg-muted/30 border-border rounded-md text-[10px] font-medium file:bg-indigo-500/10 file:text-indigo-500 file:text-[10px] file:font-bold file:h-full file:py-0 file:px-2 file:mr-2 file:border-0 file:rounded-sm cursor-pointer"
                                                                        onChange={(e) => {
                                                                            const file = e.target.files?.[0];
                                                                            const newMultiFiles = { ...multiInputFilesState };
                                                                            if (!newMultiFiles[input.key]) newMultiFiles[input.key] = {};
                                                                            if (!newMultiFiles[input.key][rowIndex]) newMultiFiles[input.key][rowIndex] = {};

                                                                            if (file) {
                                                                                newMultiFiles[input.key][rowIndex][field.key] = file;
                                                                            } else {
                                                                                delete newMultiFiles[input.key][rowIndex][field.key];
                                                                            }
                                                                            setMultiInputFilesState(newMultiFiles);
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <Input
                                                                        type={field.type === 'number' ? 'number' : 'text'}
                                                                        className="h-8 bg-muted/30 border-border rounded-md text-xs font-medium focus-visible:ring-1 focus-visible:ring-indigo-500 focus-visible:border-indigo-500"
                                                                        value={row[field.key] || ''}
                                                                        onChange={(e) => setValues({ ...values, [input.key]: updateMultiInputValue(values[input.key], rowIndex, field.key, e.target.value) })}
                                                                        placeholder={field.type === 'file' ? `(${field.label || field.key}) enter value` : `Enter ${field.label || field.key}...`}
                                                                    />
                                                                )}
                                                            </div>
                                                        ))}
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => {
                                                                setValues({ ...values, [input.key]: removeMultiInputRow(values[input.key], rowIndex) });

                                                                // Sync multiInputFiles state to shift indices
                                                                const newMultiFiles = { ...multiInputFilesState };
                                                                if (newMultiFiles[input.key]) {
                                                                    const oldRowFiles = { ...newMultiFiles[input.key] };
                                                                    const updatedRowFiles: Record<number, Record<string, File>> = {};

                                                                    Object.keys(oldRowFiles).forEach(idxKey => {
                                                                        const idx = parseInt(idxKey);
                                                                        if (idx < rowIndex) {
                                                                            updatedRowFiles[idx] = oldRowFiles[idx];
                                                                        } else if (idx > rowIndex) {
                                                                            updatedRowFiles[idx - 1] = oldRowFiles[idx];
                                                                        }
                                                                    });
                                                                    newMultiFiles[input.key] = updatedRowFiles;
                                                                    setMultiInputFilesState(newMultiFiles);
                                                                }
                                                            }}
                                                            className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity shadow-lg"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setValues({ ...values, [input.key]: addMultiInputRow(values[input.key]) })}
                                                className="w-full h-8 border-dashed border-indigo-500/40 text-indigo-500 hover:text-indigo-600 bg-indigo-500/5 hover:bg-indigo-500/10 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all"
                                            >
                                                <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Entry
                                            </Button>
                                        </>
                                    );
                                })()}
                            </div>
                        ) : templateMaps[input.key] ? (
                            <Textarea
                                value={values[input.key] || ''}
                                onChange={(e) => setVal(input.key, e.target.value)}
                                rows={5}
                                className={`px-3 py-2 bg-background focus:border-indigo-500 text-[11px] font-semibold rounded-lg transition-all resize-y ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                                placeholder={`Select ${templateMaps[input.key]._template_for} to auto-fill template...`}
                            />
                        ) : (input.type === 'date' || input.type === 'time') ? (
                            <DateTimeInput
                                mode={getDateTimeMode(input.type, input.include_time)}
                                value={values[input.key] || ''}
                                onChange={(val) => setVal(input.key, val)}
                                hasError={!!err[input.key]}
                            />
                        ) : input.type === 'textarea' ? (
                            <Textarea
                                value={values[input.key] || ''}
                                onChange={(e) => setVal(input.key, e.target.value)}
                                className={`min-h-[120px] px-3 py-2 bg-background focus:border-indigo-500 text-xs font-semibold rounded-md transition-all resize-y ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                                placeholder={`Enter value for ${input.label || input.key}...`}
                            />
                        ) : (input.type === 'dataset-select' || input.type === 'dataset-multi-select') ? (
                            richFallback ? (
                                <Input
                                    type="text"
                                    value={values[input.key] || ''}
                                    onChange={(e) => setVal(input.key, e.target.value)}
                                    className={`h-9 px-3 bg-background focus:border-indigo-500 text-xs font-semibold rounded-md transition-all ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                                    placeholder={`(${input.type}) enter value`}
                                />
                            ) : (() => {
                                const cfg = parseDatasetInputConfig(input.default_value);
                                return (
                                    <DatasetRecordPicker
                                        datasetId={cfg.dataset_id}
                                        baseFilter={cfg.filter}
                                        displayTemplate={cfg.display}
                                        multi={input.type === 'dataset-multi-select'}
                                        value={values[input.key] || ''}
                                        onChange={(v) => setVal(input.key, v)}
                                        hasError={!!err[input.key]}
                                    />
                                );
                            })()
                        ) : input.type === 'file' ? (
                            richFallback ? (
                                <Input
                                    type="text"
                                    value={values[input.key] || ''}
                                    onChange={(e) => setVal(input.key, e.target.value)}
                                    className={`h-9 px-3 bg-background focus:border-indigo-500 text-xs font-semibold rounded-md transition-all ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                                    placeholder="(file) enter value"
                                />
                            ) : (
                                <div className="relative">
                                    <Input
                                        type="file"
                                        {...(input.allow_folder ? ({ webkitdirectory: '', directory: '', multiple: true } as any) : {})}
                                        onChange={(e) => {
                                            if (input.allow_folder) {
                                                const list = Array.from(e.target.files || []);
                                                if (list.length) {
                                                    setFolderFilesState({ ...folderFilesState, [input.key]: list });
                                                } else {
                                                    const nf = { ...folderFilesState };
                                                    delete nf[input.key];
                                                    setFolderFilesState(nf);
                                                }
                                            } else {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    setFilesState({ ...filesState, [input.key]: file });
                                                } else {
                                                    const nf = { ...filesState };
                                                    delete nf[input.key];
                                                    setFilesState(nf);
                                                }
                                            }
                                            clearError(input.key);
                                        }}
                                        className={`h-9 px-3 cursor-pointer file:cursor-pointer file:mr-3 file:py-0 file:h-full file:px-3 file:rounded-md file:border-0 file:text-[10px] file:font-bold file:bg-indigo-500/10 file:text-indigo-500 hover:file:bg-indigo-500/20 bg-background focus:border-indigo-500 text-xs font-semibold rounded-md transition-all ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                                    />
                                    {input.allow_folder && folderFilesState[input.key]?.length ? (
                                        <p className="mt-1 text-[10px] text-muted-foreground">
                                            {folderFilesState[input.key].length} file(s) selected from “{(folderFilesState[input.key][0] as any).webkitRelativePath?.split('/')[0] || 'folder'}”
                                        </p>
                                    ) : null}
                                </div>
                            )
                        ) : (
                            <Input
                                type={input.type === 'number' ? 'number' : 'text'}
                                value={values[input.key] || ''}
                                onChange={(e) => setVal(input.key, e.target.value)}
                                className={`h-9 px-3 bg-background focus:border-indigo-500 text-xs font-semibold rounded-md transition-all ${err[input.key] ? 'border-destructive' : 'border-border'}`}
                                placeholder={`Enter value for ${input.label || input.key}...`}
                            />
                        )}
                    </div>
                </div>
            ))}
        </>
    );
};
