import React, { useState, useEffect } from 'react';
import { XCircle } from 'lucide-react';

import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useNamespace } from '../context/NamespaceContext';
import { API_BASE_URL } from '../lib/api';
import { Server, VpnConfig } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUsers } from '../hooks/useUsers';

// Extracted Components
import { ServerHeader } from '../components/servers/ServerHeader';
import { ServerTable } from '../components/servers/ServerTable';
import { ServerFormDialog } from '../components/servers/ServerFormDialog';
import { ServerTerminalDialog } from '../components/servers/ServerTerminalDialog';

const ServerPage = () => {
    const { apiFetch } = useAuth();
    const { activeNamespace } = useNamespace();
    const [servers, setServers] = useState<Server[]>([]);
    const [total, setTotal] = useState(0);
    const [vpns, setVpns] = useState<VpnConfig[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<Server | null>(null);
    const [formData, setFormData] = useState<Partial<Server>>({
        name: '',
        description: '',
        host: '',
        port: 22,
        user: '',
        auth_type: 'PASSWORD',
        password: '',
        private_key: '',
    });
    const [authTypeFilter, setAuthTypeFilter] = useState<string>('ALL');
    const [vpnFilter, setVpnFilter] = useState<string>('ALL');
    const [selectedUser, setSelectedUser] = useState<string | undefined>(undefined);
    const { users: availableUsers, fetchUsers } = useUsers();

    const [limit, setLimit] = useState(15);
    const [offset, setOffset] = useState(0);

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const [terminalOpen, setTerminalOpen] = useState(false);
    const [activeTerminalServer, setActiveTerminalServer] = useState<Server | null>(null);
    const [terminalSessionID, setTerminalSessionID] = useState<string | null>(null);
    const [isMaximized, setIsMaximized] = useState(false);

    const [metrics, setMetrics] = useState<{ [key: string]: any }>({});

    const fetchServers = async (searchOverride?: string, filtersOverride?: { [key: string]: string }) => {
        if (!activeNamespace) return;
        setIsLoading(true);
        setError(null);
        try {
            const currentSearch = searchOverride !== undefined ? searchOverride : searchTerm;
            const currentAuthType = filtersOverride?.authType !== undefined ? filtersOverride.authType : authTypeFilter;
            const currentVpn = filtersOverride?.vpn !== undefined ? filtersOverride.vpn : vpnFilter;
            const currentUser = filtersOverride?.user !== undefined ? filtersOverride.user : selectedUser;

            let url = `${API_BASE_URL}/namespaces/${activeNamespace.id}/servers?limit=${limit}&offset=${offset}`;
            if (currentAuthType !== 'ALL') url += `&auth_type=${currentAuthType}`;
            if (currentVpn !== 'ALL' && currentVpn !== 'NONE') {
                url += `&vpn_id=${currentVpn}`;
            }
            if (currentUser) url += `&user=${currentUser}`;
            if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;

            const response = await apiFetch(url);
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Server error: ${response.status}`);
            }
            const data = await response.json();
            setServers(data.items || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.error('Failed to fetch servers:', error);
            setError(error instanceof Error ? error.message : 'Failed to connect to the fleet orchestrator');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSingleServerMetrics = async (serverId: string) => {
        try {
            const response = await apiFetch(`${API_BASE_URL}/servers/${serverId}/metrics`, { skipToast: true });
            if (!response.ok) {
                setMetrics(prev => ({
                    ...prev,
                    [serverId]: { error: 'OFFLINE' }
                }));
                return;
            }
            const data = await response.json();
            setMetrics(prev => ({
                ...prev,
                [serverId]: data
            }));
        } catch (error: any) {
            console.error(`Failed to fetch metrics for ${serverId}:`, error);
            setMetrics(prev => ({
                ...prev,
                [serverId]: { error: 'OFFLINE' }
            }));
        }
    };

    const fetchMetrics = async () => {
        if (servers.length === 0) return;
        // Fetch all in parallel for better performance
        await Promise.all(servers.map(server => fetchSingleServerMetrics(server.id)));
    };

    const fetchVpns = async (search?: string) => {
        if (!activeNamespace) return;
        try {
            let url = `${API_BASE_URL}/namespaces/${activeNamespace.id}/vpns?limit=15`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            const response = await apiFetch(url);
            if (!response.ok) return;
            const data = await response.json();
            const vpnItems = data.items || data || [];
            if (Array.isArray(vpnItems)) setVpns(vpnItems);
        } catch (error) {
            console.error('Failed to fetch vpns:', error);
        }
    };

    useEffect(() => {
        fetchVpns();
    }, [activeNamespace]);

    useEffect(() => {
        fetchServers();
    }, [activeNamespace, offset, limit, searchTerm, authTypeFilter, vpnFilter, selectedUser]);

    useEffect(() => {
        if (servers.length > 0) {
            fetchMetrics();
            const interval = setInterval(fetchMetrics, 10000);
            return () => clearInterval(interval);
        }
    }, [servers]);

    const handleApplyFilter = (search: string, filters: { [key: string]: any }) => {
        setSearchTerm(search);
        if (filters.authType) setAuthTypeFilter(filters.authType);
        if (filters.vpn) setVpnFilter(filters.vpn);
        setSelectedUser(filters.user);
        setOffset(0);
        fetchServers(search, filters);
    };

    const handleOpenForm = (server?: Server) => {
        if (server) {
            setEditingServer(server);
            // The API never returns credentials, and an empty field means "keep the
            // stored value", so the secret inputs always start blank on edit.
            setFormData({ ...server, vpn_id: server.vpn_id || 'none', password: '', private_key: '' });
        } else {
            setEditingServer(null);
            setFormData({
                name: '',
                description: '',
                host: '',
                port: 22,
                user: '',
                auth_type: 'PASSWORD',
                password: '',
                private_key: '',
                vpn_id: 'none'
            });
        }
        setIsFormOpen(true);
    };

    const handleSaveServer = async () => {
        try {
            const url = editingServer
                ? `${API_BASE_URL}/servers/${editingServer.id}`
                : `${API_BASE_URL}/namespaces/${activeNamespace?.id}/servers`;
            const method = editingServer ? 'PUT' : 'POST';

            const payload = { ...formData };
            if (payload.vpn_id === 'none' || payload.vpn_id === '') {
                payload.vpn_id = undefined;
            }

            const response = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                setIsFormOpen(false);
                fetchServers();
            }
        } catch (error) {
            console.error('Failed to save server:', error);
        }
    };

    const handleDeleteServer = (server: Server) => {
        setDeleteTarget(server);
    };

    const confirmDeleteServer = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            await apiFetch(`${API_BASE_URL}/servers/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            fetchServers();
        } catch (error) {
            console.error('Failed to delete server:', error);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    };

    const handleOpenTerminal = async (server: Server) => {
        setActiveTerminalServer(server);
        setTerminalOpen(true);
        setTerminalSessionID(null);
        setIsMaximized(false);

        try {
            const response = await apiFetch(`${API_BASE_URL}/servers/${server.id}/terminal`, {
                method: 'POST'
            });
            const data = await response.json();
            if (response.ok) {
                setTerminalSessionID(data.session_id);
            }
        } catch (error) {
            console.error('Failed to start terminal session:', error);
        }
    };

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <ServerHeader
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                authTypeFilter={authTypeFilter}
                vpnFilter={vpnFilter}
                vpns={vpns}
                isLoading={isLoading}
                onApplyFilter={handleApplyFilter}
                onNewServer={() => handleOpenForm()}
                onFetchVpns={fetchVpns}
                selectedUser={selectedUser}
                availableUsers={availableUsers}
                onFetchUsers={fetchUsers}
                onReset={() => {
                    setSearchTerm('');
                    setAuthTypeFilter('ALL');
                    setVpnFilter('ALL');
                    setSelectedUser(undefined);
                }}
            />

            {error ? (
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-8 text-center animate-in fade-in zoom-in-95 duration-300">
                    <div className="inline-flex p-4 rounded-md bg-destructive/10 text-destructive mb-4">
                        <XCircle className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-black uppercase tracking-tight text-destructive mb-2">Fleet Synchronization Failed</h3>
                    <p className="text-[10px] font-bold text-muted-foreground/40 leading-tight">Your servers are isolated and managed through the CSM App secure networking layer.</p>
                    <p className="text-sm font-medium text-muted-foreground mb-6 max-w-md mx-auto">{error}</p>
                    <Button
                        onClick={() => fetchServers()}
                        variant="outline"
                        className="px-8 rounded-md border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive font-bold uppercase tracking-widest text-[10px]"
                    >
                        Retry Uplink
                    </Button>
                </div>
            ) : (
                <ServerTable
                    servers={servers}
                    isLoading={isLoading}
                    metrics={metrics}
                    total={total}
                    offset={offset}
                    limit={limit}
                    onPageChange={setOffset}
                    onEdit={handleOpenForm}
                    onDelete={handleDeleteServer}
                    onOpenTerminal={handleOpenTerminal}
                />
            )}

            <ServerFormDialog
                isOpen={isFormOpen}
                onOpenChange={setIsFormOpen}
                editingServer={editingServer}
                formData={formData}
                setFormData={setFormData}
                onSave={handleSaveServer}
                vpns={vpns}
            />

            <ServerTerminalDialog
                isOpen={terminalOpen}
                onOpenChange={setTerminalOpen}
                server={activeTerminalServer}
                sessionID={terminalSessionID}
                isMaximized={isMaximized}
                setIsMaximized={setIsMaximized}
            />

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete Server"
                description={`Are you sure you want to delete "${deleteTarget?.name}"? All associated data will be purged.`}
                confirmText="Purge Host"
                variant="danger"
                onConfirm={confirmDeleteServer}
                isLoading={isDeleting}
            />
        </div>
    );
};

export default ServerPage;
