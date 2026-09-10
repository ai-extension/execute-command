import React, { useState, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { Shield, ShieldAlert, Plus, Lock, Settings, Trash2, ArrowRight, Check, Search, ChevronRight } from 'lucide-react';

import { API_BASE_URL } from '../lib/api';
import { Pagination } from '../components/Pagination';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useAuth } from '../context/AuthContext';
import { ResourceFilters } from '../components/ResourceFilters';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

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
import { Input } from "../components/ui/input";

const RolesPage = () => {
    const { apiFetch, showToast } = useAuth();
    const navigate = useNavigate();
    const [roles, setRoles] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newRoleData, setNewRoleData] = useState({ name: '', description: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<any>(null);
    const [searchTerm, setSearchTerm] = usePersistentState('roles_search', '');

    const [total, setTotal] = useState(0);
    const [limit, setLimit] = useState(15);
    const [offset, setOffset] = useState(0);

    const fetchRoles = async (searchOverride?: string) => {
        setIsLoading(true);
        try {
            const currentSearch = searchOverride !== undefined ? searchOverride : searchTerm;
            let url = `${API_BASE_URL}/roles?limit=${limit}&offset=${offset}`;
            if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;
            const response = await apiFetch(url);
            const data = await response.json();
            setRoles(data.items || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.error('Failed to fetch roles:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRoles();
    }, [offset, limit]);

    const handleApplyFilter = (search: string) => {
        setSearchTerm(search);
        setOffset(0);
        fetchRoles(search);
    };

    const handleCreateRole = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/roles`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newRoleData)
            });
            if (response.ok) {
                await fetchRoles();
                setIsCreateOpen(false);
                setNewRoleData({ name: '', description: '' });
            }
        } catch (error) {
            console.error('Failed to create role:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/roles/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                await fetchRoles();
                setDeleteTarget(null);
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to delete role', 'error');
            }
        } catch (error) {
            console.error('Failed to delete role:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-primary" />
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                        <span className="text-primary">Authorization</span>
                        <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                        <span className="text-muted-foreground font-black">Access Roles</span>
                    </div>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="premium-gradient font-black uppercase tracking-widest text-[10px] px-4 shadow-premium rounded-md gap-2">
                            <Plus className="w-4 h-4" /> Create Role
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle className="text-2xl">Define New Role</DialogTitle>
                            <DialogDescription>
                                Create a new authorization group with a descriptive title.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreateRole} className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Role Name</Label>
                                <Input
                                    id="name"
                                    placeholder="e.g. Developer"
                                    className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                    value={newRoleData.name}
                                    onChange={(e) => setNewRoleData({ ...newRoleData, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Description</Label>
                                <Input
                                    id="description"
                                    placeholder="Brief explanation of this role's purpose"
                                    className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                    value={newRoleData.description}
                                    onChange={(e) => setNewRoleData({ ...newRoleData, description: e.target.value })}
                                />
                            </div>
                            <DialogFooter className="pt-4">
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                                >
                                    {isSubmitting ? "Defining..." : "Save Role"}
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
                searchPlaceholder="Search roles by name or description..."
                isLoading={isLoading}
                onReset={() => {
                    setSearchTerm('');
                    setOffset(0);
                }}
                primaryAction={null}
            />

            <div className="space-y-6 flex flex-col">
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 flex-1">
                    {isLoading ? (
                        <div className="col-span-full py-20 flex flex-col items-center justify-center gap-4 opacity-50">
                            <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Retrieving Secure Roles...</p>
                        </div>
                    ) : roles.length > 0 ? roles.map((role) => (
                        <Card key={role.id} className="bg-card border-border hover:border-primary/30 transition-all duration-500 group shadow-card hover:shadow-premium overflow-hidden relative">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-primary/10 transition-colors" />
                            <CardHeader className="p-6 relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="p-2 rounded-md bg-primary/10 text-primary border border-primary/5 transition-transform group-hover:scale-110 group-hover:rotate-3">
                                        <Shield className="w-5 h-5" />
                                    </div>
                                    <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-border">
                                        {(role.permissions || []).length} PERMISSIONS
                                    </Badge>
                                </div>
                                <CardTitle
                                    onClick={() => navigate(`/roles/${role.id}/permissions`)}
                                    className="text-xl font-black tracking-tight hover:text-primary transition-colors cursor-pointer"
                                    title="Manage permissions"
                                >{role.name}</CardTitle>
                                <CardDescription className="text-xs font-medium leading-relaxed mt-2 italic opacity-70">
                                    {role.description || 'Global access controls for system entities.'}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 pt-0 relative z-10">
                                <div className="flex flex-wrap gap-1.5 mt-4 min-h-[60px]">
                                    {(role.permissions || []).slice(0, 5).map((p: any) => (
                                        <Badge key={p.id} className="bg-muted text-muted-foreground font-black text-[10px] uppercase tracking-tighter px-2 rounded-md">
                                            {p.name}
                                        </Badge>
                                    ))}
                                    {(role.permissions || []).length > 5 && (
                                        <span className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest align-middle pt-1 ml-1">
                                            + {(role.permissions || []).length - 5} more
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-2 mt-6 pt-6 border-t border-border/50">
                                    <Button
                                        variant="outline"
                                        className="flex-1 h-9 rounded-md border-border bg-background text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-muted transition-all"
                                        onClick={() => navigate(`/roles/${role.id}/permissions`)}
                                    >
                                        <Settings className="w-3 h-3 mr-2" /> Permissions
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
                                        onClick={() => setDeleteTarget(role)}
                                        title="Delete Role"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )) : (
                        <div className="col-span-full py-20 bg-card border border-dashed border-border rounded-md flex flex-col items-center gap-4 text-center">
                            <div className="p-4 rounded-full bg-muted/50 border border-border">
                                <ShieldAlert className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground">No roles configured</p>
                                <p className="text-xs text-muted-foreground/60 font-medium mt-1">Start by defining access levels for your team.</p>
                            </div>
                        </div>
                    )}
                </div>

                {total > 0 && (
                    <div className="mt-8 border-t border-border pt-6">
                        <Pagination
                            total={total}
                            offset={offset}
                            limit={limit}
                            itemName="Roles"
                            onPageChange={setOffset}
                        />
                    </div>
                )}
            </div>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Delete Role"
                description={`Are you sure you want to delete the role "${deleteTarget?.name}"? Users holding this role will lose the permissions it grants.`}
                confirmText="Delete Role"
                variant="danger"
                isLoading={isSubmitting}
            />
        </div>
    );
};

export default RolesPage;
