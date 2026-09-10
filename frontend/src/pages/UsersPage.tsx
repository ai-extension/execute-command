import React, { useState, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { Users, UserPlus, Shield, Mail, MoreHorizontal, Search, ShieldCheck, ChevronRight, Key, Edit, Trash2 } from 'lucide-react';

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
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';
import { Pagination } from '../components/Pagination';
import { ResourceFilters } from '../components/ResourceFilters';
import { ConfirmDialog } from '../components/ConfirmDialog';

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

const UsersPage = () => {
    const { apiFetch, showToast } = useAuth();
    const [users, setUsers] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [roles, setRoles] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isRolesOpen, setIsRolesOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isResetOpen, setIsResetOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<any>(null);

    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [selectedRoleIDs, setSelectedRoleIDs] = useState<string[]>([]);
    const [newUserData, setNewUserData] = useState({ username: '', password: '', email: '' });
    const [editUserData, setEditUserData] = useState({ username: '', full_name: '', nickname: '', chat_account_id: '', email: '' });
    const [resetPasswordData, setResetPasswordData] = useState({ new_password: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchTerm, setSearchTerm] = usePersistentState('users_search', '');
    const [roleFilter, setRoleFilter] = usePersistentState<string>('users_roleFilter', 'ALL');

    const [limit, setLimit] = useState(15);
    const [offset, setOffset] = useState(0);

    const fetchUsers = async (searchOverride?: string, filtersOverride?: { [key: string]: string }) => {
        try {
            setIsLoading(true);
            const currentSearch = searchOverride !== undefined ? searchOverride : searchTerm;
            const currentRole = filtersOverride?.roleID !== undefined ? filtersOverride.roleID : roleFilter;

            let url = `${API_BASE_URL}/users?limit=${limit}&offset=${offset}`;
            if (currentRole !== 'ALL') url += `&role_id=${currentRole}`;
            if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;

            const response = await apiFetch(url);
            const data = await response.json();
            setUsers(data.items || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.error('Failed to fetch users:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchRoles = async (search?: string) => {
        try {
            let url = `${API_BASE_URL}/roles?limit=15`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            const response = await apiFetch(url);
            const dataRaw = await response.json();
            const data = dataRaw.items || dataRaw || [];
            setRoles(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to fetch roles:', error);
        }
    };

    useEffect(() => {
        fetchRoles();
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [offset, limit, searchTerm, roleFilter]);

    const handleApplyFilter = (search: string, filters: { [key: string]: string }) => {
        setSearchTerm(search);
        if (filters.roleID) setRoleFilter(filters.roleID);
        setOffset(0);
        fetchUsers(search, filters);
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newUserData)
            });
            if (response.ok) {
                await fetchUsers();
                setIsCreateOpen(false);
                setNewUserData({ username: '', password: '', email: '' });
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to create user', 'error');
            }
        } catch (error) {
            console.error('Failed to create user:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/users/${selectedUser.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(editUserData)
            });
            if (response.ok) {
                await fetchUsers();
                setIsEditOpen(false);
                setSelectedUser(null);
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to update user', 'error');
            }
        } catch (error) {
            console.error('Failed to update user:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/users/${selectedUser.id}/password`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(resetPasswordData)
            });
            if (response.ok) {
                setIsResetOpen(false);
                setResetPasswordData({ new_password: '' });
                setSelectedUser(null);
                showToast('Password reset successfully', 'success');
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to reset password', 'error');
            }
        } catch (error) {
            console.error('Failed to reset password:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/users/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                await fetchUsers();
                setDeleteTarget(null);
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to delete user', 'error');
            }
        } catch (error) {
            console.error('Failed to delete user:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const openRolesDialog = (user: any) => {
        setSelectedUser(user);
        setSelectedRoleIDs((user.roles || []).map((r: any) => r.id));
        setIsRolesOpen(true);
    };

    const openEditDialog = (user: any) => {
        setSelectedUser(user);
        setEditUserData({
            username: user.username,
            full_name: user.full_name || '',
            nickname: user.nickname || '',
            chat_account_id: user.chat_account_id || '',
            email: user.email || ''
        });
        setIsEditOpen(true);
    };

    const openResetDialog = (user: any) => {
        setSelectedUser(user);
        setResetPasswordData({ new_password: '' });
        setIsResetOpen(true);
    };

    const handleUpdateRoles = async () => {
        if (!selectedUser) return;
        setIsSubmitting(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/users/${selectedUser.id}/roles`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ role_ids: selectedRoleIDs })
            });
            if (response.ok) {
                await fetchUsers();
                setIsRolesOpen(false);
            }
        } catch (error) {
            console.error('Failed to update roles:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const toggleRole = (roleID: string) => {
        setSelectedRoleIDs(prev =>
            prev.includes(roleID)
                ? prev.filter(id => id !== roleID)
                : [...prev, roleID]
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Manage Roles Dialog */}
            <Dialog open={isRolesOpen} onOpenChange={setIsRolesOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl">Modify Authorization</DialogTitle>
                        <DialogDescription>
                            Assign security roles to <span className="text-primary font-black">{selectedUser?.username}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-6 space-y-4">
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Available Roles</p>
                        <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                            {roles.map((role) => (
                                <button
                                    key={role.id}
                                    onClick={() => toggleRole(role.id)}
                                    className={cn(
                                        "flex items-center justify-between p-4 rounded-md border transition-all duration-300 text-left group",
                                        selectedRoleIDs.includes(role.id)
                                            ? "bg-primary/10 border-primary shadow-sm"
                                            : "bg-muted/30 border-border hover:border-primary/30"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-10 h-10 rounded-md flex items-center justify-center transition-colors",
                                            selectedRoleIDs.includes(role.id) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/20"
                                        )}>
                                            <Shield className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm tracking-tight">{role.name}</p>
                                            <p className="text-[10px] font-medium opacity-60 mt-0.5">{role.description || 'No description'}</p>
                                        </div>
                                    </div>
                                    <div className={cn(
                                        "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                        selectedRoleIDs.includes(role.id) ? "bg-primary border-primary" : "border-border group-hover:border-primary/50"
                                    )}>
                                        {selectedRoleIDs.includes(role.id) && <ShieldCheck className="w-3 h-3 text-white" />}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={handleUpdateRoles}
                            disabled={isSubmitting}
                            className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                        >
                            {isSubmitting ? "Applying Changes..." : "Enforce Authorization"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Breadcrumb & Actions */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-primary" />
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                        <span className="text-primary">Identity & Access</span>
                        <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                        <span className="text-muted-foreground font-black">User Directory</span>
                    </div>
                </div>

                <Button
                    onClick={() => setIsCreateOpen(true)}
                    className="px-4 rounded-md premium-gradient font-black uppercase tracking-widest text-[10px] h-9 shadow-premium hover:shadow-indigo-500/25 transition-all gap-2"
                >
                    <UserPlus className="w-3.5 h-3.5" />
                    New User
                </Button>
            </div>

            {/* Create User Dialog */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl">Create New Identity</DialogTitle>
                        <DialogDescription>
                            Establish a new system user with secure credentials.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateUser} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="username" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Username</Label>
                            <Input
                                id="username"
                                placeholder="e.g. jdoe"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={newUserData.username}
                                onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="jdoe@example.com"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={newUserData.email}
                                onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={newUserData.password}
                                onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                                required
                            />
                        </div>
                        <DialogFooter className="pt-4">
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                            >
                                {isSubmitting ? "Provisioning..." : "Create Identity"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl">Edit Identity</DialogTitle>
                        <DialogDescription>
                            Update core identification for <span className="text-primary font-black">{selectedUser?.username}</span>.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleUpdateUser} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="edit-username" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Username</Label>
                            <Input
                                id="edit-username"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={editUserData.username}
                                onChange={(e) => setEditUserData({ ...editUserData, username: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-fullname" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Full Name</Label>
                            <Input
                                id="edit-fullname"
                                placeholder="John Doe"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={editUserData.full_name}
                                onChange={(e) => setEditUserData({ ...editUserData, full_name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-nickname" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Nickname</Label>
                            <Input
                                id="edit-nickname"
                                placeholder="Johnny"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={editUserData.nickname}
                                onChange={(e) => setEditUserData({ ...editUserData, nickname: e.target.value })}
                                maxLength={100}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-chat-account-id" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Chat Account ID</Label>
                            <Input
                                id="edit-chat-account-id"
                                placeholder="U01ABCDEF"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={editUserData.chat_account_id}
                                onChange={(e) => setEditUserData({ ...editUserData, chat_account_id: e.target.value })}
                                maxLength={100}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="edit-email" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">Email Address</Label>
                            <Input
                                id="edit-email"
                                type="email"
                                placeholder="jdoe@example.com"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={editUserData.email}
                                onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                            />
                        </div>
                        <DialogFooter className="pt-4">
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                            >
                                {isSubmitting ? "Updating..." : "Save Changes"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Reset Password Dialog */}
            <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl">Reset Password</DialogTitle>
                        <DialogDescription>
                            Set a new administrative password for <span className="text-primary font-black">{selectedUser?.username}</span>.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleResetPassword} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="reset-password" className="text-[10px] font-black uppercase tracking-widest opacity-60 ml-1">New Password</Label>
                            <Input
                                id="reset-password"
                                type="password"
                                placeholder="Minimum 6 characters"
                                className="h-9 bg-muted/30 border-border rounded-md font-semibold"
                                value={resetPasswordData.new_password}
                                onChange={(e) => setResetPasswordData({ ...resetPasswordData, new_password: e.target.value })}
                                required
                            />
                        </div>
                        <DialogFooter className="pt-4">
                            <Button
                                type="submit"
                                disabled={isSubmitting || resetPasswordData.new_password.length < 6}
                                className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 w-full shadow-premium rounded-md"
                            >
                                {isSubmitting ? "Resetting..." : "Reset Password"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <ResourceFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                onApply={handleApplyFilter}
                filters={{ roleID: roleFilter }}
                filterConfigs={[
                    {
                        key: 'roleID',
                        placeholder: 'ALL ROLES',
                        options: [
                            { label: 'ALL ROLES', value: 'ALL' },
                            ...roles.map(r => ({ label: r.name.toUpperCase(), value: r.id }))
                        ],
                        width: 'w-48',
                        isSearchable: true,
                        onSearch: (query) => fetchRoles(query)
                    }
                ]}
                searchPlaceholder="Filter search by user identity or access level..."
                isLoading={isLoading}
                onReset={() => {
                    setSearchTerm('');
                    setRoleFilter('ALL');
                }}
            />

            <Card className="rounded-md border border-border bg-card shadow-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted hover:bg-muted/80 border-border">
                            <TableHead className="w-[300px] h-9 font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground px-6">Identity</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Authorization Roles</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Last Activity</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Status</TableHead>
                            <TableHead className="text-right h-9 px-6 font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.length > 0 ? users.map((u) => (
                            <TableRow key={u.id} className="group border-border hover:bg-muted/30 transition-all duration-200">
                                <TableCell className="px-6 py-4">
                                    <div className="flex items-center gap-4">
                                        <div>
                                            <p className="text-sm font-black tracking-tight flex items-center gap-2">
                                                <span
                                                    onClick={() => openEditDialog(u)}
                                                    className="cursor-pointer hover:opacity-70 transition-opacity"
                                                    title="Edit user"
                                                >{u.full_name || u.username}</span>
                                                {u.username === 'admin' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />}
                                            </p>
                                            <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 mt-0.5">
                                                <Mail className="w-3 h-3 opacity-50" /> {u.email || (u.username + '@system')}
                                            </p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(u.roles || []).map((role: any) => (
                                            <Badge key={role.id} variant="secondary" className="bg-primary/5 text-primary border-primary/20 font-black text-[10px] px-2.5 py-1 rounded-md">
                                                {role.name.toUpperCase()}
                                            </Badge>
                                        ))}
                                        {(!u.roles || u.roles.length === 0) && <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest italic">Default User</span>}
                                    </div>
                                </TableCell>
                                <TableCell className="text-xs font-bold text-muted-foreground/60 italic">
                                    {u.updated_at ? new Date(u.updated_at).toLocaleDateString() : 'Never'}
                                </TableCell>
                                <TableCell>
                                    <Badge className="bg-emerald-500/10 text-emerald-500 border-none font-black text-[10px] px-2.5 py-1 rounded-md shadow-none">
                                        ACTIVE
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right px-6">
                                    <div className="flex justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all duration-300">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="w-9 rounded-md hover:bg-amber-500/10 hover:text-amber-600 transition-colors"
                                            onClick={() => openEditDialog(u)}
                                            title="Edit User"
                                        >
                                            <Edit className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="w-9 rounded-md hover:bg-primary/10 hover:text-primary transition-colors"
                                            onClick={() => openRolesDialog(u)}
                                            title="Manage Roles"
                                        >
                                            <Shield className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="w-9 rounded-md hover:bg-indigo-500/10 hover:text-indigo-600 transition-colors"
                                            onClick={() => openResetDialog(u)}
                                            title="Reset Password"
                                        >
                                            <Key className="w-4 h-4" />
                                        </Button>
                                        {u.username !== 'admin' && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="w-9 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                                                onClick={() => setDeleteTarget(u)}
                                                title="Delete User"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-48 text-center">
                                    <div className="flex flex-col items-center gap-3 opacity-30">
                                        <Users className="w-12 h-12" />
                                        <p className="text-xs font-black uppercase tracking-widest">{isLoading ? "Synchronizing user registry..." : "No users found matching your criteria"}</p>
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
                    itemName="Users"
                    onPageChange={setOffset}
                />

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Delete Identity"
                description={`Are you sure you want to permanently revoke access for "${deleteTarget?.username}"? This action moves the user to the archive.`}
                confirmText="Revoke Access"
                variant="danger"
                isLoading={isSubmitting}
            />
        </div >
    );
};

export default UsersPage;
