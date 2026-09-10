import React, { useState, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { Database, Plus, Search, MoreHorizontal, Trash2, Edit3, Globe, Code, ChevronRight, Copy, Check } from 'lucide-react';

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { cn, copyToClipboard as clipboardCopy } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { useAuth } from '../context/AuthContext';
import { useNamespace } from '../context/NamespaceContext';
import { API_BASE_URL } from '../lib/api';
import { GlobalVariable } from '../types';
import { Pagination } from '../components/Pagination';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUsers } from '../hooks/useUsers';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

import { ResourceFilters } from '../components/ResourceFilters';

const GlobalVariablesPage = () => {
    const { apiFetch } = useAuth();
    const { activeNamespace } = useNamespace();
    const [variables, setVariables] = useState<GlobalVariable[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [selectedVar, setSelectedVar] = useState<GlobalVariable | null>(null);
    const [searchTerm, setSearchTerm] = usePersistentState('gv_search', '');
    const [selectedCreatedBy, setSelectedCreatedBy] = usePersistentState<string | undefined>('gv_createdBy', undefined);
    const { users: availableUsers, fetchUsers } = useUsers();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const copyToClipboard = async (text: string, id: string) => {
        const success = await clipboardCopy(text);
        if (success) {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        }
    };

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<GlobalVariable | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const [total, setTotal] = useState(0);
    const [limit, setLimit] = useState(15);
    const [offset, setOffset] = useState(0);

    const [formData, setFormData] = useState({
        key: '',
        value: '',
        description: '',
        is_secret: false
    });

    const fetchVariables = async () => {
        if (!activeNamespace) return;
        setIsLoading(true);
        try {
            let url = `${API_BASE_URL}/namespaces/${activeNamespace.id}/global-variables?limit=${limit}&offset=${offset}`;
            if (searchTerm) url += `&search=${encodeURIComponent(searchTerm)}`;
            if (selectedCreatedBy) url += `&created_by=${selectedCreatedBy}`;
            const response = await apiFetch(url);
            const data = await response.json();
            setVariables(data.items || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.error('Failed to fetch global variables:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchVariables();
    }, [activeNamespace, offset, limit, selectedCreatedBy]);

    const handleApplyFilter = (search: string, filters: { [key: string]: any }) => {
        setSearchTerm(search);
        setSelectedCreatedBy(filters.createdBy);
        setOffset(0);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeNamespace) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/namespaces/${activeNamespace.id}/global-variables`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (response.ok) {
                await fetchVariables();
                setIsCreateOpen(false);
                setFormData({ key: '', value: '', description: '', is_secret: false });
            }
        } catch (error) {
            console.error('Failed to create global variable:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedVar) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/global-variables/${selectedVar.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (response.ok) {
                await fetchVariables();
                setIsEditOpen(false);
                setSelectedVar(null);
                setFormData({ key: '', value: '', description: '', is_secret: false });
            }
        } catch (error) {
            console.error('Failed to update global variable:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = (gv: GlobalVariable) => {
        setDeleteTarget(gv);
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/global-variables/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                await fetchVariables();
            }
        } catch (error) {
            console.error('Failed to delete global variable:', error);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    };

    const openEditDialog = (gv: GlobalVariable) => {
        setSelectedVar(gv);
        setFormData({
            key: gv.key,
            // A secret value never comes back from the API; blank means "keep it".
            value: gv.is_secret ? '' : gv.value,
            description: gv.description,
            is_secret: !!gv.is_secret
        });
        setIsEditOpen(true);
    };

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-primary" />
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                        <span className="text-primary">Settings</span>
                        <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                        <span className="text-muted-foreground font-black">Global Variables</span>
                    </div>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={(open) => {
                    setIsCreateOpen(open);
                    if (!open) setFormData({ key: '', value: '', description: '', is_secret: false });
                }}>
                    <DialogTrigger asChild>
                        <Button className="h-8 premium-gradient font-black uppercase tracking-widest text-[10px] px-4 shadow-premium rounded-md gap-2">
                            <Plus className="w-3.5 h-3.5" /> Add Global Variable
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black tracking-tight">Create Variable</DialogTitle>
                            <DialogDescription className="text-xs font-medium text-muted-foreground">
                                Define a new key-value pair for this namespace.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Key Name</Label>
                                <Input
                                    placeholder="e.g. API_ENDPOINT"
                                    className="h-9 bg-muted/30 border-border rounded-md font-bold uppercase tracking-tight focus:bg-background transition-all"
                                    value={formData.key}
                                    onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Value</Label>
                                <Textarea
                                    placeholder={formData.is_secret ? 'Stored — leave blank to keep it' : 'Enter variable value... supports multi-line'}
                                    className="min-h-[100px] bg-muted/30 border-border rounded-md font-medium resize-y"
                                    value={formData.value}
                                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="flex items-start justify-between gap-4 p-3 rounded-md border border-border bg-muted/10">
                                <div className="space-y-1">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white">Secret value</h4>
                                    <p className="text-[10px] font-medium opacity-60 max-w-sm">Stored encrypted and never sent back to the browser. Workflows still resolve it normally.</p>
                                </div>
                                <Switch
                                    checked={formData.is_secret}
                                    onCheckedChange={(checked) => setFormData({ ...formData, is_secret: checked })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Description</Label>
                                <Textarea
                                    placeholder="What is this variable used for?"
                                    className="min-h-[100px] bg-muted/30 border-border rounded-md font-medium resize-none"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>
                            <DialogFooter className="pt-4">
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                                >
                                    {isSubmitting ? "Creating..." : "Save Variable"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <ResourceFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                onApply={handleApplyFilter}
                filters={{ createdBy: selectedCreatedBy }}
                filterConfigs={[
                    {
                        key: 'createdBy',
                        placeholder: 'CREATED BY',
                        type: 'single',
                        isSearchable: true,
                        onSearch: (query: string) => fetchUsers(query),
                        options: [
                            { label: 'ALL CREATORS', value: '' },
                            ...availableUsers.map(u => ({ label: u.username.toUpperCase(), value: u.id }))
                        ],
                        width: 'w-48'
                    }
                ]}
                searchPlaceholder="Search by key or description..."
                isLoading={isLoading}
                onReset={() => {
                    setSearchTerm('');
                    setSelectedCreatedBy(undefined);
                }}
                primaryAction={null}
            />

            <Card className="rounded-md border border-border bg-card shadow-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted hover:bg-muted/80 border-border">
                            <TableHead className="w-[300px] h-9 font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground px-6">Variable Key</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Resolved Value</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Reference Code</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Created By</TableHead>
                            <TableHead className="text-right h-9 px-6 font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && variables.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-48 text-center bg-transparent">
                                    <div className="flex flex-col items-center justify-center gap-3">
                                        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Loading global registry...</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : variables.length > 0 ? variables.map((v) => (
                            <TableRow key={v.id} className="group border-border hover:bg-muted/30 transition-all duration-200">
                                <TableCell className="px-6 py-4">
                                    <div className="flex items-center gap-4">
                                        <div>
                                            <p
                                                onClick={() => openEditDialog(v)}
                                                className="text-sm font-black tracking-tight text-primary uppercase cursor-pointer hover:opacity-70 transition-opacity"
                                                title="Edit variable"
                                            >{v.key}</p>
                                            <p className="text-xs text-muted-foreground font-medium line-clamp-1 opacity-70 mt-0.5">
                                                {v.description || 'No description provided'}
                                            </p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2 max-w-[300px]">
                                        <code className="px-3 py-1.5 rounded-md bg-muted text-xs font-bold text-slate-300 border border-border/50 truncate">
                                            {v.is_secret ? (v.has_value ? '•••••••• (secret)' : '(empty)') : v.value}
                                        </code>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2 group/copy">
                                        <div className="flex items-center gap-1.5">
                                            <Code className="w-3.5 h-3.5 text-indigo-400 opacity-60" />
                                            <span className="text-[10px] font-black text-indigo-400 tracking-wider">
                                                {"{{"}global.{v.key}{"}}"}
                                            </span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 rounded-md hover:bg-indigo-500/10 hover:text-indigo-500 transition-all opacity-0 group-hover/copy:opacity-100"
                                            onClick={() => copyToClipboard(`{{global.${v.key}}}`, v.id)}
                                            title="Copy reference"
                                        >
                                            {copiedId === v.id ? (
                                                <Check className="w-3 h-3 text-emerald-500" />
                                            ) : (
                                                <Copy className="w-3 h-3" />
                                            )}
                                        </Button>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {v.created_by_username ? (
                                        <div className="flex items-center gap-1.5">
                                            <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black text-primary uppercase shrink-0">
                                                {v.created_by_username[0]}
                                            </div>
                                            <span className="text-[10px] font-semibold text-muted-foreground">{v.created_by_username}</span>
                                        </div>
                                    ) : (
                                        <span className="text-[10px] text-muted-foreground/40 italic">—</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right px-6">
                                    <div className="flex justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all duration-300">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="rounded-md hover:bg-indigo-500/10 hover:text-indigo-500 transition-colors"
                                            onClick={() => openEditDialog(v)}
                                        >
                                            <Edit3 className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                                            onClick={() => handleDelete(v)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-48 text-center bg-transparent">
                                    <div className="flex flex-col items-center justify-center gap-4 opacity-40">
                                        <Database className="w-10 h-10" />
                                        <div className="space-y-1">
                                            <p className="text-xs font-black uppercase tracking-[0.2em]">No global variables found</p>
                                            <p className="text-[10px] font-bold opacity-60">Create namespace-wide variables to use across flows.</p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-2 rounded-full border-dashed"
                                            onClick={() => setIsCreateOpen(true)}
                                        >
                                            Initialize Registry
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </Card>

                <Pagination
                    total={total}
                    offset={offset}
                    limit={limit}
                    itemName="Global Variables"
                    onPageChange={setOffset}
                />

            {/* Edit Dialog */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tight">Edit Variable</DialogTitle>
                        <DialogDescription className="text-xs font-medium text-muted-foreground">
                            Update the global configuration for <span className="text-primary font-bold uppercase">{selectedVar?.key}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleUpdate} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Key Name</Label>
                            <Input
                                className="h-9 bg-muted/10 border-border rounded-md font-bold uppercase tracking-tight opacity-60"
                                value={formData.key}
                                disabled
                            />
                            <p className="text-[10px] font-bold text-amber-500/80 px-1 italic">* Variable keys cannot be modified after creation to prevent flow breakage.</p>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">New Value</Label>
                            <Textarea
                                placeholder={formData.is_secret ? 'Stored — leave blank to keep it' : 'Value...'}
                                className="min-h-[100px] bg-muted/30 border-border rounded-md font-medium resize-y"
                                value={formData.value}
                                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                                required={!formData.is_secret}
                            />
                        </div>
                        <div className="flex items-start justify-between gap-4 p-3 rounded-md border border-border bg-muted/10">
                            <div className="space-y-1">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-white">Secret value</h4>
                                <p className="text-[10px] font-medium opacity-60 max-w-sm">Stored encrypted and never sent back to the browser. Turning this off re-exposes the stored value.</p>
                            </div>
                            <Switch
                                checked={formData.is_secret}
                                onCheckedChange={(checked) => setFormData({ ...formData, is_secret: checked })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Description</Label>
                            <Textarea
                                placeholder="Description..."
                                className="min-h-[100px] bg-muted/30 border-border rounded-md font-medium resize-none"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>
                        <DialogFooter className="pt-4">
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                            >
                                {isSubmitting ? "Updating..." : "Update variable"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Delete Global Variable"
                description={`Are you sure you want to delete the variable "${deleteTarget?.key}"?`}
                confirmText="Delete Variable"
                variant="danger"
                isLoading={isDeleting}
            />
        </div>
    );
};

export default GlobalVariablesPage;
