import React, { useState, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { Plus, Search, ChevronRight, Network, Shield, Key, Edit2, Trash2, XCircle } from 'lucide-react';
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
import { ResourceFilters } from '../components/ResourceFilters';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import { SearchableSelect } from '../components/SearchableSelect';
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { useAuth } from '../context/AuthContext';
import { useNamespace } from '../context/NamespaceContext';
import { API_BASE_URL } from '../lib/api';
import { VpnConfig } from '../types';
import { Pagination } from '../components/Pagination';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUsers } from '../hooks/useUsers';

const VpnPage = () => {
    const { apiFetch } = useAuth();
    const { activeNamespace } = useNamespace();
    const [vpns, setVpns] = useState<VpnConfig[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = usePersistentState('vpn_search', '');
    const [authTypeFilter, setAuthTypeFilter] = usePersistentState<string>('vpn_authType', 'ALL');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingVpn, setEditingVpn] = useState<VpnConfig | null>(null);
    const [selectedCreatedBy, setSelectedCreatedBy] = usePersistentState<string | undefined>('vpn_createdBy', undefined);
    const { users: availableUsers, fetchUsers } = useUsers();

    // Delete VPN state
    const [deleteTarget, setDeleteTarget] = useState<VpnConfig | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [formData, setFormData] = useState<Partial<VpnConfig>>({
        name: '',
        description: '',
        vpn_type: 'SSH',
        host: '',
        port: 22,
        user: '',
        auth_type: 'PASSWORD',
        password: '',
        private_key: '',
        config_file: '',
        public_key: '',
        shared_key: ''
    });

    const [limit, setLimit] = useState(15);
    const [offset, setOffset] = useState(0);

    const fetchVpns = async (searchOverride?: string, filtersOverride?: { [key: string]: string }) => {
        if (!activeNamespace) return;
        setIsLoading(true);
        setError(null);
        try {
            const currentSearch = searchOverride !== undefined ? searchOverride : searchTerm;
            const currentAuthType = filtersOverride?.authType !== undefined ? filtersOverride.authType : authTypeFilter;
            const currentCreatedBy = filtersOverride?.createdBy !== undefined ? filtersOverride.createdBy : selectedCreatedBy;

            let url = `${API_BASE_URL}/namespaces/${activeNamespace.id}/vpns?limit=${limit}&offset=${offset}`;
            if (currentAuthType !== 'ALL') url += `&auth_type=${currentAuthType}`;
            if (currentCreatedBy) url += `&created_by=${currentCreatedBy}`;
            if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;

            const response = await apiFetch(url);
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Server error: ${response.status}`);
            }
            const data = await response.json();
            // Handle pagination wrapper if present, otherwise assume array
            const vpnItems = data.items || data || [];
            if (Array.isArray(vpnItems)) {
                setVpns(vpnItems);
                setTotal(data.total || vpnItems.length);
            } else {
                setVpns([]);
                setTotal(0);
                console.error('Unexpected vpns format:', data);
            }
        } catch (error) {
            console.error('Failed to fetch VPN configs:', error);
            setError(error instanceof Error ? error.message : 'Failed to retrieve VPN configurations');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchVpns();
    }, [activeNamespace, offset, limit, searchTerm, authTypeFilter, selectedCreatedBy]);

    const handleApplyFilter = (search: string, filters: { [key: string]: any }) => {
        setSearchTerm(search);
        if (filters.authType) setAuthTypeFilter(filters.authType);
        setSelectedCreatedBy(filters.createdBy);
        setOffset(0);
        fetchVpns(search, filters);
    };

    const handleOpenForm = (vpn?: VpnConfig) => {
        if (vpn) {
            setEditingVpn(vpn);
            // The API never returns credentials, and an empty field means "keep the
            // stored value", so the secret inputs always start blank on edit.
            setFormData({ ...vpn, password: '', private_key: '', config_file: '', shared_key: '' });
        } else {
            setEditingVpn(null);
            setFormData({
                name: '',
                description: '',
                vpn_type: 'SSH',
                host: '',
                port: 22,
                user: '',
                auth_type: 'PASSWORD',
                password: '',
                private_key: '',
                config_file: '',
                public_key: '',
                shared_key: ''
            });
        }
        setIsFormOpen(true);
    };

    const handleSaveVpn = async () => {
        try {
            const url = editingVpn
                ? `${API_BASE_URL}/vpns/${editingVpn.id}`
                : `${API_BASE_URL}/namespaces/${activeNamespace?.id}/vpns`;
            const method = editingVpn ? 'PUT' : 'POST';

            const response = await apiFetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                setIsFormOpen(false);
                fetchVpns();
            }
        } catch (error) {
            console.error('Failed to save VPN config:', error);
        }
    };

    const handleDeleteVpn = (vpn: VpnConfig) => {
        setDeleteTarget(vpn);
    };

    const confirmDeleteVpn = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            await apiFetch(`${API_BASE_URL}/vpns/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            fetchVpns();
        } catch (error) {
            console.error('Failed to delete VPN config:', error);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    };

    const filteredVpns = vpns.filter(v => {
        const matchesSearch = v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            v.host.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesAuth = authTypeFilter === 'ALL' || v.auth_type === authTypeFilter;
        return matchesSearch && matchesAuth;
    });

    const paginatedVpns = filteredVpns.slice(offset, offset + limit);

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Network className="w-3.5 h-3.5 text-primary" />
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                        <span className="text-primary">Infrastructure</span>
                        <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                        <span className="text-muted-foreground font-black">VPN Jump Hosts</span>
                    </div>
                </div>
                <Button
                    onClick={() => handleOpenForm()}
                    className="px-4 rounded-md premium-gradient font-black uppercase tracking-widest text-[10px] shadow-premium hover:shadow-indigo-500/25 transition-all gap-2"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add VPN
                </Button>
            </div>

            <ResourceFilters
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                onApply={handleApplyFilter}
                filters={{ authType: authTypeFilter, createdBy: selectedCreatedBy }}
                filterConfigs={[
                    {
                        key: 'vpnType',
                        placeholder: 'VPN TYPE',
                        options: [
                            { label: 'ALL TYPES', value: 'ALL' },
                            { label: 'SSH JUMP', value: 'SSH' },
                            { label: 'OPENVPN', value: 'OPENVPN' },
                            { label: 'WIREGUARD', value: 'WIREGUARD' }
                        ],
                        width: 'w-48',
                        isSearchable: true
                    },
                    {
                        key: 'authType',
                        placeholder: 'AUTH TYPE',
                        options: [
                            { label: 'ALL AUTH TYPES', value: 'ALL' },
                            { label: 'SSH PASSWORD', value: 'PASSWORD' },
                            { label: 'PUBLIC KEY', value: 'PUBLIC_KEY' }
                        ],
                        width: 'w-48',
                        isSearchable: true
                    },
                    {
                        key: 'createdBy',
                        placeholder: 'CREATED BY',
                        type: 'single',
                        isSearchable: true,
                        onSearch: (query) => fetchUsers(query),
                        options: [
                            { label: 'ALL CREATORS', value: '' },
                            ...availableUsers.map(u => ({ label: u.username.toUpperCase(), value: u.id }))
                        ],
                        width: 'w-48'
                    }
                ]}
                searchPlaceholder="Search by name, host or type..."
                isLoading={isLoading}
                onReset={() => {
                    setSearchTerm('');
                    setAuthTypeFilter('ALL');
                    setSelectedCreatedBy(undefined);
                }}
                primaryAction={null}
            />

            {/* Error State */}
            {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-8 text-center animate-in fade-in zoom-in-95 duration-300">
                    <div className="inline-flex p-4 rounded-md bg-destructive/10 text-destructive mb-4">
                        <XCircle className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-black uppercase tracking-tight text-destructive mb-2">VPN Synchronization Failed</h3>
                    <p className="text-sm font-medium text-muted-foreground mb-6 max-w-md mx-auto">
                        {error}
                    </p>
                    <Button
                        onClick={() => fetchVpns()}
                        variant="outline"
                        className="px-8 rounded-md border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive font-bold uppercase tracking-widest text-[10px]"
                    >
                        Retry Uplink
                    </Button>
                </div>
            )}

            {/* Table */}
            <div className="rounded-md border border-border bg-card shadow-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted hover:bg-muted/80 border-border">
                            <TableHead className="px-6 h-9 font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">VPN Configuration</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Protocol</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Authentication / Config</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Endpoint</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground">Created By</TableHead>
                            <TableHead className="font-black uppercase tracking-[0.15em] text-[10px] text-muted-foreground text-right px-6">Operations</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {vpns.length > 0 ? vpns.map((vpn) => (
                            <TableRow key={vpn.id} className="group border-border hover:bg-muted/40 transition-colors">
                                <TableCell className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div>
                                            <p className="text-sm font-black tracking-tight">{vpn.name}</p>
                                            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-tighter opacity-70">
                                                {vpn.description || 'No description provided'}
                                            </p>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 w-fit">
                                        <span className="text-[10px] font-black tracking-widest text-primary uppercase">{vpn.vpn_type}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {vpn.vpn_type === 'SSH' ? (
                                        <div className="flex items-center gap-2">
                                            {vpn.auth_type === 'PASSWORD' ? (
                                                <Shield className="w-3.5 h-3.5 text-amber-500" />
                                            ) : (
                                                <Key className="w-3.5 h-3.5 text-indigo-500" />
                                            )}
                                            <span className="text-xs font-bold uppercase tracking-widest">
                                                {vpn.auth_type} ({vpn.user})
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-3.5 h-3.5 text-emerald-500" />
                                            <span className="text-xs font-bold uppercase tracking-widest">
                                                {vpn.vpn_type === 'WIREGUARD' ? 'WG Config' : 'OVPN Config'} Ready
                                            </span>
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground tracking-tight">
                                    {vpn.host}:{vpn.port}
                                </TableCell>
                                <TableCell>
                                    {vpn.created_by_username ? (
                                        <div className="flex items-center gap-1.5">
                                            <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black text-primary uppercase shrink-0">
                                                {vpn.created_by_username[0]}
                                            </div>
                                            <span className="text-[10px] font-semibold text-muted-foreground">{vpn.created_by_username}</span>
                                        </div>
                                    ) : (
                                        <span className="text-[10px] text-muted-foreground/40 italic">—</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right px-6">
                                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleOpenForm(vpn)}
                                            className="h-8 w-8 rounded-md hover:bg-muted"
                                        >
                                            <Edit2 className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDeleteVpn(vpn)}
                                            className="h-8 w-8 rounded-md hover:bg-destructive/10 hover:text-destructive"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground/40 font-black uppercase tracking-[0.2em] text-[10px]">
                                    {isLoading ? 'Loading VPNs...' : 'No VPN Configurations Available'}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Pagination
                total={total}
                offset={offset}
                limit={limit}
                itemName="VPN Configs"
                onPageChange={setOffset}
            />

            {/* Add/Edit Dialog */}
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="sm:max-w-[425px] bg-card border-border rounded-md shadow-premium">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-black uppercase tracking-widest">{editingVpn ? 'Edit VPN Config' : 'Add New VPN Config'}</DialogTitle>
                        <DialogDescription className="text-xs font-medium opacity-60 uppercase tracking-tighter">
                            Configure SSH proxy connection details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="vpn_type" className="text-right text-[10px] font-black uppercase opacity-60">Protocol</Label>
                            <SearchableSelect
                                options={[
                                    { label: 'SSH JUMP HOST', value: 'SSH' },
                                    { label: 'OPENVPN (.ovpn)', value: 'OPENVPN' },
                                    { label: 'WIREGUARD (.conf)', value: 'WIREGUARD' }
                                ]}
                                value={formData.vpn_type || 'SSH'}
                                onValueChange={(val) => setFormData({ ...formData, vpn_type: val as any })}
                                triggerClassName="col-span-3 text-xs font-bold bg-background border-border"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right text-[10px] font-black uppercase opacity-60">Identity</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="col-span-3 text-xs font-bold bg-background border-border"
                                placeholder="Core VPN Node"
                            />
                        </div>

                        {formData.vpn_type === 'SSH' ? (
                            <>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="host" className="text-right text-[10px] font-black uppercase opacity-60">Endpoint</Label>
                                    <div className="col-span-3 flex gap-2">
                                        <Input
                                            id="host"
                                            value={formData.host}
                                            onChange={e => setFormData({ ...formData, host: e.target.value })}
                                            className="flex-1 text-xs font-bold bg-background border-border"
                                            placeholder="vpn.example.com"
                                        />
                                        <Input
                                            type="number"
                                            value={formData.port}
                                            onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })}
                                            className="w-20 text-xs font-bold bg-background border-border"
                                            placeholder="22"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="user" className="text-right text-[10px] font-black uppercase opacity-60">User</Label>
                                    <Input
                                        id="user"
                                        value={formData.user}
                                        onChange={e => setFormData({ ...formData, user: e.target.value })}
                                        className="col-span-3 text-xs font-bold bg-background border-border"
                                        placeholder="proxy_user"
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right text-[10px] font-black uppercase opacity-60">Auth Type</Label>
                                    <SearchableSelect
                                        options={[
                                            { label: 'SSH PASSWORD', value: 'PASSWORD' },
                                            { label: 'PUBLIC KEY (RSA/ED25519)', value: 'PUBLIC_KEY' }
                                        ]}
                                        value={(formData.auth_type || "") as string}
                                        onValueChange={(val) => setFormData({ ...formData, auth_type: val as 'PASSWORD' | 'PUBLIC_KEY' })}
                                        triggerClassName="col-span-3 text-xs font-bold bg-background border-border"
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right text-[10px] font-black uppercase opacity-60">
                                        {formData.auth_type === 'PASSWORD' ? 'Secret' : 'Priv Key'}
                                    </Label>
                                    {formData.auth_type === 'PASSWORD' ? (
                                        <Input
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                                            className="col-span-3 text-xs font-bold bg-background border-border"
                                            placeholder={editingVpn?.has_password ? '•••••••• (unchanged)' : '••••••••'}
                                        />
                                    ) : (
                                        <Textarea
                                            value={formData.private_key}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, private_key: e.target.value })}
                                            className="col-span-3 text-xs font-mono bg-background border-border resize-none h-24"
                                            placeholder={editingVpn?.has_private_key ? 'Stored — leave blank to keep it' : '-----BEGIN RSA PRIVATE KEY-----'}
                                        />
                                    )}
                                </div>
                            </>
                        ) : formData.vpn_type === 'OPENVPN' ? (
                            <>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="host" className="text-right text-[10px] font-black uppercase opacity-60">Endpoint</Label>
                                    <div className="col-span-3 flex gap-2">
                                        <Input
                                            id="host"
                                            value={formData.host}
                                            onChange={e => setFormData({ ...formData, host: e.target.value })}
                                            className="flex-1 text-xs font-bold bg-background border-border"
                                            placeholder="ovpn.example.com"
                                        />
                                        <Input
                                            type="number"
                                            value={formData.port}
                                            onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })}
                                            className="w-20 text-xs font-bold bg-background border-border"
                                            placeholder="1194"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="config" className="text-right text-[10px] font-black uppercase opacity-60">OVPN Config</Label>
                                    <Textarea
                                        id="config"
                                        value={formData.config_file}
                                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, config_file: e.target.value })}
                                        className="col-span-3 text-xs font-mono bg-background border-border resize-none h-32"
                                        placeholder={editingVpn?.has_config_file ? 'Stored — leave blank to keep it' : 'client\nremote ovpn.example.com 1194\n...'}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="host" className="text-right text-[10px] font-black uppercase opacity-60">Endpoint</Label>
                                    <div className="col-span-3 flex gap-2">
                                        <Input
                                            id="host"
                                            value={formData.host}
                                            onChange={e => setFormData({ ...formData, host: e.target.value })}
                                            className="flex-1 text-xs font-bold bg-background border-border"
                                            placeholder="wg.example.com"
                                        />
                                        <Input
                                            type="number"
                                            value={formData.port}
                                            onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })}
                                            className="w-20 text-xs font-bold bg-background border-border"
                                            placeholder="51820"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="pubkey" className="text-right text-[10px] font-black uppercase opacity-60">Public Key</Label>
                                    <Input
                                        id="pubkey"
                                        value={formData.public_key}
                                        onChange={e => setFormData({ ...formData, public_key: e.target.value })}
                                        className="col-span-3 text-xs font-bold bg-background border-border"
                                        placeholder="Server Public Key"
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="sharedkey" className="text-right text-[10px] font-black uppercase opacity-60">Shared Key</Label>
                                    <Input
                                        id="sharedkey"
                                        value={formData.shared_key}
                                        onChange={e => setFormData({ ...formData, shared_key: e.target.value })}
                                        className="col-span-3 text-xs font-bold bg-background border-border"
                                        placeholder={editingVpn?.has_shared_key ? 'Stored — leave blank to keep it' : 'Preshared Key (Optional)'}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="config" className="text-right text-[10px] font-black uppercase opacity-60">WG Config</Label>
                                    <Textarea
                                        id="config"
                                        value={formData.config_file}
                                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, config_file: e.target.value })}
                                        className="col-span-3 text-xs font-mono bg-background border-border resize-none h-32"
                                        placeholder={editingVpn?.has_config_file ? 'Stored — leave blank to keep it' : '[Interface]\nPrivateKey = ...\nAddress = 10.0.0.1/24'}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setIsFormOpen(false)}
                            className="text-[10px] font-black uppercase tracking-widest border-border"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSaveVpn}
                            className="premium-gradient shadow-premium text-[10px] font-black uppercase tracking-widest"
                        >
                            Commit Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDeleteVpn}
                title="Delete VPN Configuration"
                description={`Are you sure you want to delete the VPN config "${deleteTarget?.name}"?`}
                confirmText="Delete Config"
                variant="danger"
                isLoading={isDeleting}
            />
        </div>
    );
};

export default VpnPage;
