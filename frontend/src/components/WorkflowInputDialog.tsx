import React, { useState, useEffect } from 'react';
import { WorkflowInput } from '../types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Zap } from 'lucide-react';
import { generateUUID } from '../lib/utils';
import { WorkflowInputFields, parseTemplateMap } from './WorkflowInputFields';
import { DATE_TIME_PLACEHOLDER, DateTimeMode, getDateTimeMode, isValidDateTimeValue } from './DateTimeInput';
import { parseMultiInputConfig } from '../lib/multiInput';

interface WorkflowInputDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    inputs: WorkflowInput[];
    onConfirm: (values: Record<string, string>) => void;
    onCancel: () => void;
    isStarting?: boolean;
    confirmLabel?: string;
    uploadUrl?: string;
    headers?: Record<string, string>;
    storageKey?: string;
    title?: string;
    description?: string;
}

const DRAFT_PREFIX = 'wf_input_draft:';

const loadDraft = (key: string | undefined, inputs: WorkflowInput[]): Record<string, string> | null => {
    if (!key) return null;
    try {
        const raw = localStorage.getItem(DRAFT_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const allowedKeys = new Set(inputs.filter(i => i.type !== 'file').map(i => i.key));
        const cleaned: Record<string, string> = {};
        for (const k of Object.keys(parsed)) {
            if (allowedKeys.has(k) && typeof parsed[k] === 'string') {
                cleaned[k] = parsed[k];
            }
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

const WorkflowInputDialog: React.FC<WorkflowInputDialogProps> = ({
    isOpen,
    onOpenChange,
    inputs,
    onConfirm,
    onCancel,
    isStarting = false,
    confirmLabel = "Initialize Pipeline",
    uploadUrl = '/api/workflows/upload-input',
    headers = {},
    storageKey,
    title = 'Workflow Inputs',
    description = 'Provide values for this workflow run.',
}) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const [files, setFiles] = useState<Record<string, File>>({});
    const [folderFiles, setFolderFiles] = useState<Record<string, File[]>>({});
    const [multiInputFiles, setMultiInputFiles] = useState<Record<string, Record<number, Record<string, File>>>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isUploading, setIsUploading] = useState(false);
    const isLoading = isStarting || isUploading;

    useEffect(() => {
        if (isOpen) {
            const initialValues: Record<string, string> = {};
            inputs.forEach(input => {
                if (input.type === 'multi-input' || input.type === 'multi-select') {
                    // For multi-input/multi-select, default_value is often misused as schema/options, so we start fresh
                    if (input.type === 'multi-input') {
                        initialValues[input.key] = input.collapse_initially ? '[]' : '[{}]';
                    } else {
                        initialValues[input.key] = '[]';
                    }
                } else if (input.type === 'dataset-multi-select') {
                    initialValues[input.key] = '[]';
                } else if (input.type === 'dataset-select') {
                    initialValues[input.key] = '';
                } else if (input.type === 'input' || input.type === 'number' || input.type === 'textarea' || input.type === 'date' || input.type === 'time') {
                    const tm = parseTemplateMap(input.default_value);
                    initialValues[input.key] = tm ? '' : (input.default_value || '');
                } else {
                    initialValues[input.key] = ''; // Select/File starts empty
                }
            });

            const draft = loadDraft(storageKey, inputs);
            if (draft) {
                for (const k of Object.keys(draft)) {
                    initialValues[k] = draft[k];
                }
            }

            setValues(initialValues);
            setFiles({});
            setFolderFiles({});
            setMultiInputFiles({});
            setErrors({});
        }
    }, [isOpen, inputs, storageKey]);

    useEffect(() => {
        if (isOpen && storageKey && inputs.length > 0) {
            saveDraft(storageKey, values, inputs);
        }
    }, [values, isOpen, storageKey, inputs]);

    const validate = () => {
        const newErrors: Record<string, string> = {};
        const safeRegex = /^[\p{L}0-9_\-\. \/\\:\[\]{}"',@#%!+=?;&|\(\)\$\n\r\*]*$/u;
        const allowedCharsDesc = 'Letters, 0-9, _, -, ., /, \\, :, [, ], {, }, ", \', @, #, %, !, +, =, ?, ;, &, |, (, ), $, *, Newline and Space';

        inputs.forEach(input => {
            const val = values[input.key];
            const isValueEmpty = val === undefined || val === null || String(val).trim() === '' || val === '[]';

            if (input.type === 'select') {
                const options = (input.default_value || '').split(',').map(o => o.trim()).filter(Boolean);
                if (isValueEmpty) {
                    if (input.required) {
                        newErrors[input.key] = 'Please select an option';
                    }
                } else if (!options.includes(val)) {
                    newErrors[input.key] = 'Invalid option';
                }
            } else if (input.type === 'multi-select') {
                if (input.required && isValueEmpty) {
                    newErrors[input.key] = 'Please select at least one option';
                }
            } else if (input.type === 'multi-input') {
                let rows: any[] = [];
                try {
                    rows = JSON.parse(val || '[]');
                } catch (e) {
                    newErrors[input.key] = 'Invalid format';
                    return;
                }
                if (!Array.isArray(rows)) {
                    newErrors[input.key] = 'Must be an array';
                    return;
                }
                const hasData = rows.some(r => r && Object.values(r).some(v => String(v ?? '').trim() !== ''));
                if (input.required && !hasData) {
                    newErrors[input.key] = 'Please add at least one row';
                    return;
                }
                // A row field declared as date/time is format-checked like a top-level
                // date/time input; every other field keeps the character check.
                const dateTimeFields = new Map<string, DateTimeMode>(
                    parseMultiInputConfig(input.default_value)
                        .filter(f => f.type === 'date' || f.type === 'time')
                        .map(f => [f.key, getDateTimeMode(f.type, f.include_time)])
                );
                for (const row of rows) {
                    for (const k in row) {
                        const rowVal = String(row[k] ?? '');
                        const mode = dateTimeFields.get(k);
                        if (mode) {
                            if (rowVal.trim() !== '' && !isValidDateTimeValue(mode, rowVal)) {
                                newErrors[input.key] = `${k} must be ${DATE_TIME_PLACEHOLDER[mode]}`;
                                return;
                            }
                            continue;
                        }
                        if (!safeRegex.test(rowVal)) {
                            newErrors[input.key] = `Invalid characters in ${k}. Allowed: Letters, 0-9, _, -, ., /, \, :, [, ], {, }, ", ', @, #, %, !, +, =, ?, ;, &, |, Newline and Space`;
                            return;
                        }
                    }
                }
            } else if (input.type === 'file') {
                const hasValue = input.allow_folder
                    ? (folderFiles[input.key]?.length ?? 0) > 0
                    : !!files[input.key];
                if (input.required && !hasValue) {
                    newErrors[input.key] = 'This field is required';
                }
            } else if (input.type === 'date' || input.type === 'time') {
                // Same rule as the backend: an input value is never re-rendered as a
                // template, so only a literal date/time is accepted here.
                const mode = getDateTimeMode(input.type, input.include_time);
                if (isValueEmpty) {
                    if (input.required) {
                        newErrors[input.key] = 'This field is required';
                    }
                } else if (!isValidDateTimeValue(mode, val)) {
                    newErrors[input.key] = `Must be ${DATE_TIME_PLACEHOLDER[mode]}`;
                }
            } else if (input.type === 'dataset-select') {
                if (input.required && isValueEmpty) {
                    newErrors[input.key] = 'Please pick a record';
                }
            } else if (input.type === 'dataset-multi-select') {
                let rows: any[] = [];
                try { rows = JSON.parse(val || '[]'); } catch { rows = []; }
                if (input.required && (!Array.isArray(rows) || rows.length === 0)) {
                    newErrors[input.key] = 'Please pick at least one record';
                }
            } else {
                if (input.required && isValueEmpty) {
                    newErrors[input.key] = 'This field is required';
                } else if (!isValueEmpty) {
                    if (input.type === 'number') {
                        if (isNaN(Number(val))) {
                            newErrors[input.key] = 'Must be a number';
                        }
                    } else {
                        if (!safeRegex.test(val)) {
                            newErrors[input.key] = `Invalid characters. Allowed: ${allowedCharsDesc}`;
                        }
                    }
                }
            }
        });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (validate()) {
            setIsUploading(true);
            const finalValues = { ...values };
            const sessionId = generateUUID();
            let hasError = false;

            for (const input of inputs) {
                if (input.type === 'file' && files[input.key]) {
                    try {
                        const formData = new FormData();
                        formData.append('file', files[input.key]);
                        formData.append('session_id', sessionId);

                        let token = localStorage.getItem('token');
                        if (!token) token = sessionStorage.getItem('token');

                        const finalHeaders = { ...headers };
                        if (token && !finalHeaders['Authorization']) {
                            finalHeaders['Authorization'] = `Bearer ${token}`;
                        }

                        const res = await fetch(uploadUrl, {
                            method: 'POST',
                            headers: finalHeaders,
                            body: formData
                        });

                        if (!res.ok) throw new Error('Upload failed');
                        const data = await res.json();
                        // Store as JSON object with metadata
                        finalValues[input.key] = JSON.stringify({
                            path: data.path,
                            name: files[input.key].name,
                            size: files[input.key].size,
                            mime: files[input.key].type
                        });
                    } catch (err) {
                        setErrors(prev => ({ ...prev, [input.key]: 'Failed to upload file' }));
                        hasError = true;
                    }
                }
            }

            // Handle folder inputs (type=file + allow_folder): upload each file
            // preserving its relative path so the backend rebuilds the tree.
            for (const input of inputs) {
                if (input.type === 'file' && input.allow_folder && folderFiles[input.key]?.length) {
                    try {
                        const list = folderFiles[input.key];
                        let rootPath = '';
                        let totalSize = 0;

                        for (const file of list) {
                            const relativePath = (file as any).webkitRelativePath || file.name;
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('session_id', sessionId);
                            formData.append('relative_path', relativePath);

                            let token = localStorage.getItem('token');
                            if (!token) token = sessionStorage.getItem('token');

                            const finalHeaders = { ...headers };
                            if (token && !finalHeaders['Authorization']) {
                                finalHeaders['Authorization'] = `Bearer ${token}`;
                            }

                            const res = await fetch(uploadUrl, {
                                method: 'POST',
                                headers: finalHeaders,
                                body: formData
                            });

                            if (!res.ok) throw new Error('Upload failed');
                            const data = await res.json();
                            if (data.root_path) rootPath = data.root_path;
                            totalSize += file.size;
                        }

                        const folderName = (list[0] as any).webkitRelativePath?.split('/')[0] || 'folder';
                        // Store the folder root path; templates resolve {{ input.key }} to the remote folder.
                        finalValues[input.key] = JSON.stringify({
                            path: rootPath,
                            name: folderName,
                            size: totalSize,
                            is_folder: true,
                            file_count: list.length
                        });
                    } catch (err) {
                        setErrors(prev => ({ ...prev, [input.key]: 'Failed to upload folder' }));
                        hasError = true;
                    }
                }
            }

            // Handle Multi-Input nested files
            for (const input of inputs) {
                if (input.type === 'multi-input' && multiInputFiles[input.key]) {
                    const rows = JSON.parse(finalValues[input.key] || '[]');
                    for (const rowIndex in multiInputFiles[input.key]) {
                        const idx = parseInt(rowIndex);
                        for (const fieldKey in multiInputFiles[input.key][idx]) {
                            const file = multiInputFiles[input.key][idx][fieldKey];
                            if (file) {
                                try {
                                    const formData = new FormData();
                                    formData.append('file', file);
                                    formData.append('session_id', sessionId);

                                    let token = localStorage.getItem('token');
                                    if (!token) token = sessionStorage.getItem('token');

                                    const finalHeaders = { ...headers };
                                    if (token && !finalHeaders['Authorization']) {
                                        finalHeaders['Authorization'] = `Bearer ${token}`;
                                    }

                                    const res = await fetch(uploadUrl, {
                                        method: 'POST',
                                        headers: finalHeaders,
                                        body: formData
                                    });

                                    if (!res.ok) throw new Error('Upload failed');
                                    const data = await res.json();
                                    // Store as object (not stringified) so it stays an object in the JSON array
                                    rows[idx][fieldKey] = {
                                        path: data.path,
                                        name: file.name,
                                        size: file.size,
                                        mime: file.type
                                    };
                                } catch (err) {
                                    setErrors(prev => ({ ...prev, [input.key]: 'Failed to upload nested file' }));
                                    hasError = true;
                                }
                            }
                        }
                    }
                    finalValues[input.key] = JSON.stringify(rows);
                }
            }

            setIsUploading(false);
            if (!hasError) {
                onConfirm(finalValues);
            }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl w-[95vw] max-h-[85vh] p-0 overflow-hidden flex flex-col">
                <DialogHeader className="px-6 pt-6 pb-2 flex-shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-primary" />
                        {title}
                    </DialogTitle>
                    <DialogDescription>
                        {description}
                    </DialogDescription>
                </DialogHeader>
                <form
                    key={isOpen ? 'open' : 'closed'}
                    onSubmit={handleSubmit}
                    className="flex-1 px-6 py-4 space-y-4 overflow-y-auto custom-scrollbar"
                >
                    <WorkflowInputFields
                        inputs={inputs}
                        values={values}
                        setValues={setValues}
                        errors={errors}
                        setErrors={setErrors}
                        files={files}
                        setFiles={setFiles}
                        folderFiles={folderFiles}
                        setFolderFiles={setFolderFiles}
                        multiInputFiles={multiInputFiles}
                        setMultiInputFiles={setMultiInputFiles}
                    />
                </form>

                <DialogFooter className="px-6 py-4 border-t border-border/50 flex-shrink-0">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onCancel}
                        className="h-9 text-[10px] font-bold uppercase tracking-widest px-6"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={isLoading}
                        onClick={() => handleSubmit()}
                        className="h-9 text-[10px] font-bold uppercase tracking-widest px-6 premium-gradient gap-2"
                    >
                        {isLoading ? (
                            <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        ) : (
                            <Zap className="w-3 h-3" />
                        )}
                        {isUploading ? 'Uploading...' : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default WorkflowInputDialog;
