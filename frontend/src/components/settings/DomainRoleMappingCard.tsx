import React, { useEffect, useState } from 'react';
import { AlertCircle, Edit2, Globe, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE_URL } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

interface Role {
    id: string;
    name: string;
}

interface DomainRoleMapping {
    id: string;
    domain: string;
    role_id: string;
    role?: Role;
    auto_provision: boolean;
    sync_on_login: boolean;
    allow_non_workspace: boolean;
    enabled: boolean;
}

interface MappingForm {
    domain: string;
    role_id: string;
    auto_provision: boolean;
    sync_on_login: boolean;
    allow_non_workspace: boolean;
    enabled: boolean;
}

const emptyForm: MappingForm = {
    domain: '',
    role_id: '',
    auto_provision: true,
    sync_on_login: false,
    allow_non_workspace: false,
    enabled: true,
};

const DomainRoleMappingCard = () => {
    const { apiFetch, showToast } = useAuth();
    const [mappings, setMappings] = useState<DomainRoleMapping[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingID, setEditingID] = useState<string | null>(null);
    const [form, setForm] = useState<MappingForm>(emptyForm);
    const [formError, setFormError] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<DomainRoleMapping | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const fetchMappings = async () => {
        try {
            const response = await apiFetch(`${API_BASE_URL}/domain-role-mappings`);
            if (!response.ok) return;
            const data = await response.json();
            setMappings(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to fetch domain role mappings', err);
        }
    };

    const fetchRoles = async () => {
        try {
            const response = await apiFetch(`${API_BASE_URL}/roles?limit=200`);
            if (!response.ok) return;
            const raw = await response.json();
            const data = raw.items || raw || [];
            setRoles(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to fetch roles', err);
        }
    };

    useEffect(() => {
        fetchMappings();
        fetchRoles();
    }, []);

    const openCreate = () => {
        setEditingID(null);
        setForm({ ...emptyForm, role_id: roles[0]?.id || '' });
        setFormError('');
        setIsDialogOpen(true);
    };

    const openEdit = (mapping: DomainRoleMapping) => {
        setEditingID(mapping.id);
        setForm({
            domain: mapping.domain,
            role_id: mapping.role_id,
            auto_provision: mapping.auto_provision,
            sync_on_login: mapping.sync_on_login,
            allow_non_workspace: mapping.allow_non_workspace,
            enabled: mapping.enabled,
        });
        setFormError('');
        setIsDialogOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (!form.role_id) {
            setFormError('Select a role to grant');
            return;
        }

        setIsSaving(true);
        try {
            const response = await apiFetch(
                editingID
                    ? `${API_BASE_URL}/domain-role-mappings/${editingID}`
                    : `${API_BASE_URL}/domain-role-mappings`,
                {
                    method: editingID ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(form),
                    skipToast: true,
                }
            );

            const data = await response.json();
            if (!response.ok) {
                setFormError(data.error || 'Failed to save mapping');
                return;
            }

            setIsDialogOpen(false);
            showToast(editingID ? 'Mapping updated' : 'Mapping created', 'success');
            fetchMappings();
        } catch (err) {
            setFormError('Failed to connect to server');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            const response = await apiFetch(`${API_BASE_URL}/domain-role-mappings/${deleteTarget.id}`, {
                method: 'DELETE',
            });
            if (!response.ok) return;
            showToast(`Mapping for ${deleteTarget.domain} removed`, 'success');
            fetchMappings();
        } catch (err) {
            console.error('Failed to delete mapping', err);
        } finally {
            setDeleteTarget(null);
        }
    };

    return (
        <Card className="bg-card border-border shadow-card overflow-hidden">
            <CardHeader className="border-b border-border bg-muted/10 p-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-xl font-black tracking-tight">Domain → Role Mapping</CardTitle>
                        <CardDescription className="text-xs font-medium opacity-70">
                            Grant a default role to Google Workspace accounts by their company domain. A domain without a mapping cannot sign in.
                        </CardDescription>
                    </div>
                    <Button
                        onClick={openCreate}
                        className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 px-4 shadow-premium rounded-md gap-2"
                    >
                        <Plus className="w-3.5 h-3.5" /> Add Domain
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {mappings.length === 0 ? (
                    <div className="p-6 flex items-center gap-3 text-muted-foreground">
                        <ShieldAlert className="w-5 h-5 shrink-0 text-amber-500" />
                        <p className="text-xs font-medium">
                            No domain mapped — every Google sign-in is rejected until a domain is added here.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-border">
                        {mappings.map((mapping) => (
                            <div key={mapping.id} className="p-6 flex items-center justify-between group hover:bg-muted/10 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        'w-12 h-12 rounded-md flex items-center justify-center border transition-all duration-300 group-hover:scale-110',
                                        mapping.enabled ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-muted border-border text-muted-foreground'
                                    )}>
                                        <Globe className="w-6 h-6" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-black text-sm tracking-tight">{mapping.domain}</h3>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">→</span>
                                            <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-primary/20 text-primary bg-primary/5">
                                                {mapping.role?.name || 'UNKNOWN ROLE'}
                                            </Badge>
                                            {!mapping.enabled && (
                                                <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-border text-muted-foreground">
                                                    DISABLED
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest opacity-60">
                                            <span>{mapping.auto_provision ? 'AUTO-PROVISION ON' : 'EXISTING USERS ONLY'}</span>
                                            <span>{mapping.sync_on_login ? 'SYNC ROLE ON LOGIN' : 'ROLE SET ONCE'}</span>
                                            {mapping.allow_non_workspace && (
                                                <span className="text-amber-500">NON-WORKSPACE ALLOWED</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 px-3 rounded-md text-[10px] font-black uppercase tracking-widest gap-2"
                                        onClick={() => openEdit(mapping)}
                                    >
                                        <Edit2 className="w-3 h-3 text-muted-foreground" /> Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 px-3 rounded-md text-[10px] font-black uppercase tracking-widest gap-2 text-destructive hover:bg-destructive/10"
                                        onClick={() => setDeleteTarget(mapping)}
                                    >
                                        <Trash2 className="w-3 h-3" /> Remove
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={isDialogOpen} onOpenChange={(open) => !open && setIsDialogOpen(false)}>
                <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tighter">
                            {editingID ? 'Configure Domain' : 'Map a Domain'}
                        </DialogTitle>
                        <DialogDescription className="text-xs font-medium">
                            Accounts signing in with Google from this domain receive the selected role.
                        </DialogDescription>
                    </DialogHeader>

                    {formError && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-3 text-destructive">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <p className="text-[10px] font-black uppercase tracking-wide">{formError}</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Company Domain</label>
                            <Input
                                placeholder="e.g. example.com"
                                className="h-9 bg-muted/30 border-border rounded-md font-bold text-sm"
                                value={form.domain}
                                onChange={(e) => setForm((prev) => ({ ...prev, domain: e.target.value }))}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Granted Role</label>
                            <select
                                value={form.role_id}
                                onChange={(e) => setForm((prev) => ({ ...prev, role_id: e.target.value }))}
                                className="w-full px-3 h-9 text-[10px] font-bold uppercase tracking-wider bg-muted/30 border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
                                required
                            >
                                <option value="" className="text-black">SELECT A ROLE</option>
                                {roles.map((role) => (
                                    <option key={role.id} value={role.id} className="text-black">
                                        {role.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-3 pt-2">
                            <ToggleRow
                                label="Auto-provision accounts"
                                hint="Create the account on first sign-in. Off means only existing users may sign in."
                                checked={form.auto_provision}
                                onChange={(v) => setForm((prev) => ({ ...prev, auto_provision: v }))}
                            />
                            <ToggleRow
                                label="Sync role on every login"
                                hint="Re-applies the mapped role each sign-in, overwriting roles set by hand."
                                checked={form.sync_on_login}
                                onChange={(v) => setForm((prev) => ({ ...prev, sync_on_login: v }))}
                            />
                            <ToggleRow
                                label="Allow non-Workspace accounts"
                                hint="Accepts personal Google accounts using a company address. They are not managed by the company and keep access after off-boarding."
                                checked={form.allow_non_workspace}
                                onChange={(v) => setForm((prev) => ({ ...prev, allow_non_workspace: v }))}
                                warning
                            />
                            <ToggleRow
                                label="Enabled"
                                hint="Disable to block this domain without deleting the mapping."
                                checked={form.enabled}
                                onChange={(v) => setForm((prev) => ({ ...prev, enabled: v }))}
                            />
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-[10px] font-black uppercase tracking-widest"
                                onClick={() => setIsDialogOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={isSaving}
                                className="premium-gradient text-[10px] font-black uppercase tracking-widest"
                            >
                                {editingID ? 'Save Changes' : 'Create Mapping'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tighter">Remove Mapping</DialogTitle>
                        <DialogDescription className="text-xs font-medium">
                            Google accounts from <span className="text-primary font-black">{deleteTarget?.domain}</span> will no longer be able to sign in. Existing users keep their roles.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            className="text-[10px] font-black uppercase tracking-widest"
                            onClick={() => setDeleteTarget(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="bg-destructive hover:bg-destructive/90 text-[10px] font-black uppercase tracking-widest"
                            onClick={handleDelete}
                        >
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

interface ToggleRowProps {
    label: string;
    hint: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    warning?: boolean;
}

const ToggleRow = ({ label, hint, checked, onChange, warning }: ToggleRowProps) => (
    <div className="flex items-start justify-between gap-4 p-3 rounded-md border border-border bg-muted/10">
        <div className="space-y-1">
            <h4 className={cn(
                'text-[10px] font-black uppercase tracking-widest',
                warning && checked ? 'text-amber-500' : 'text-white'
            )}>
                {label}
            </h4>
            <p className="text-[10px] font-medium opacity-60 max-w-sm">{hint}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} />
    </div>
);

export default DomainRoleMappingCard;
