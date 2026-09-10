import React, { useState, useEffect } from 'react';
import {
    Settings,
    Layers,
    User,
    Plus,
    Trash2,
    Edit2,
    Save,
    X,
    AlertCircle,
    CheckCircle2,
    Shield,
    Globe,
    Lock,
    Eye,
    EyeOff,
    Upload,
    Image as ImageIcon
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { useAuth } from '../context/AuthContext';
import { useNamespace } from '../context/NamespaceContext';
import { API_BASE_URL } from '../lib/api';
import DomainRoleMappingCard from '../components/settings/DomainRoleMappingCard';
import { cn } from '../lib/utils';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";

const SettingsPage = () => {
    const { apiFetch, user, refreshSettings, showToast } = useAuth();
    const { refreshNamespaces, namespaces } = useNamespace();
    const [activeTab, setActiveTab] = useState<'namespaces' | 'general' | 'auth'>('general');
    const [isLoading, setIsLoading] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [selectedNamespace, setSelectedNamespace] = useState<any>(null);
    const [formData, setFormData] = useState({ name: '', description: '' });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // System Settings state
    const [systemSettings, setSystemSettings] = useState<Record<string, string>>({
        allow_registration: 'false'
    });
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<any>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

    const toggleSecret = (key: string) => {
        setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
    };

    useEffect(() => {
        fetchSystemSettings();
    }, []);

    const fetchSystemSettings = async () => {
        setIsSettingsLoading(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/settings`);
            if (response.ok) {
                const data = await response.json();
                setSystemSettings(data);
            }
        } catch (err) {
            console.error('Failed to fetch settings:', err);
        } finally {
            setIsSettingsLoading(false);
        }
    };

    const updateSetting = async (key: string, value: string) => {
        setSuccess('');
        setError('');
        try {
            const response = await apiFetch(`${API_BASE_URL}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });
            if (response.ok) {
                setSystemSettings(prev => ({ ...prev, [key]: value }));
                await refreshSettings();
                setSuccess('Setting updated successfully');
                setTimeout(() => setSuccess(''), 3000);
            } else {
                setError('Failed to update setting');
            }
        } catch (err) {
            setError('An error occurred');
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/namespaces`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (response.ok) {
                await refreshNamespaces();
                setIsCreateOpen(false);
                setFormData({ name: '', description: '' });
            } else {
                const data = await response.json();
                setError(data.error || 'Failed to create namespace');
            }
        } catch (err) {
            setError('An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/namespaces/${selectedNamespace.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            if (response.ok) {
                await refreshNamespaces();
                setIsEditOpen(false);
            } else {
                const data = await response.json();
                setError(data.error || 'Failed to update namespace');
            }
        } catch (err) {
            setError('An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = (ns: any) => {
        setDeleteTarget(ns);
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);

        try {
            const response = await apiFetch(`${API_BASE_URL}/namespaces/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                await refreshNamespaces();
            } else {
                const data = await response.json();
                showToast(data.error || 'Failed to delete namespace', 'error');
            }
        } catch (err) {
            showToast('An error occurred', 'error');
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    };

    const openEdit = (ns: any) => {
        setSelectedNamespace(ns);
        setFormData({ name: ns.name, description: ns.description });
        setIsEditOpen(true);
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 512 * 1024) { // 512KB limit for Base64 storage
            setError('Logo file too large. Please use an image under 512KB.');
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            updateSetting('site_logo', base64String);
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 mb-1">
                    <Settings className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Application Control</span>
                </div>
                <h1 className="text-3xl font-black tracking-tighter">System Settings</h1>
                <p className="text-muted-foreground text-sm font-medium">Manage namespaces, security policies, and application behavior.</p>
            </div>

            {/* Notification Area */}
            {(error || success) && (
                <div className={cn(
                    "p-4 rounded-md border flex items-center gap-3 animate-in fade-in zoom-in duration-300",
                    error ? "bg-destructive/10 border-destructive/20 text-destructive" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                )}>
                    {error ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                    <p className="text-xs font-black uppercase tracking-wider">{error || success}</p>
                </div>
            )}

            {/* Tabs Navigation */}
            <div className="flex items-center p-1 bg-muted/30 rounded-md border border-border w-fit">
                <button
                    onClick={() => setActiveTab('general')}
                    className={cn(
                        "flex items-center gap-2 px-6 py-2.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                        activeTab === 'general' ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Globe className="w-3.5 h-3.5" /> General
                </button>
                <button
                    onClick={() => setActiveTab('auth')}
                    className={cn(
                        "flex items-center gap-2 px-6 py-2.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                        activeTab === 'auth' ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Shield className="w-3.5 h-3.5" /> Identity & Access
                </button>
                <button
                    onClick={() => setActiveTab('namespaces')}
                    className={cn(
                        "flex items-center gap-2 px-6 py-2.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                        activeTab === 'namespaces' ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Layers className="w-3.5 h-3.5" /> Logical Namespaces
                </button>
            </div>

            {/* Content Area */}
            <div className="grid gap-6">
                {activeTab === 'general' && (
                    <div className="grid gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <Card className="bg-card border-border shadow-card overflow-hidden">
                            <CardHeader className="border-b border-border bg-muted/10 p-6">
                                <CardTitle className="text-xl font-black tracking-tight">System Identity</CardTitle>
                                <CardDescription className="text-xs font-medium opacity-70">Customize the look and feel of your execution engine.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Site Title */}
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary/60">Application Title</Label>
                                            <p className="text-[10px] font-medium text-muted-foreground/60">This name appears in the sidebar and browser tab.</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                value={systemSettings.site_title || ''}
                                                onChange={(e) => setSystemSettings(prev => ({ ...prev, site_title: e.target.value }))}
                                                placeholder="CSM APP"
                                                className="h-9 bg-muted/20 border-border/50 text-sm font-bold"
                                            />
                                            <Button
                                                onClick={() => updateSetting('site_title', systemSettings.site_title || '')}
                                                className="premium-gradient px-6 font-black uppercase tracking-widest text-[10px] h-9"
                                                disabled={isSettingsLoading}
                                            >
                                                Apply
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Site Logo */}
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary/60">System Logo</Label>
                                            <p className="text-[10px] font-medium text-muted-foreground/60">Upload a square image (SVG, PNG, or JPG).</p>
                                        </div>
                                        <div className="flex items-center gap-6 p-4 bg-muted/20 border border-border/50 rounded-md">
                                            <div className="w-16 h-16 rounded-md premium-gradient p-[1px] shadow-premium shrink-0">
                                                <div className="w-full h-full rounded-md bg-card flex items-center justify-center overflow-hidden">
                                                    {systemSettings.site_logo ? (
                                                        <img src={systemSettings.site_logo} alt="Preview" className="w-10 h-10 object-contain" />
                                                    ) : (
                                                        <ImageIcon className="w-6 h-6 text-muted-foreground/20" />
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-2 flex-1">
                                                <input
                                                    type="file"
                                                    id="logo-upload"
                                                    className="hidden"
                                                    accept="image/*"
                                                    onChange={handleLogoUpload}
                                                />
                                                <Button
                                                    variant="outline"
                                                    onClick={() => document.getElementById('logo-upload')?.click()}
                                                    className="h-9 border-border/50 font-black uppercase tracking-widest text-[10px] gap-2"
                                                    disabled={isSettingsLoading}
                                                >
                                                    <Upload className="w-3.5 h-3.5" /> Upload Image
                                                </Button>
                                                {systemSettings.site_logo && (
                                                    <Button
                                                        variant="ghost"
                                                        onClick={() => updateSetting('site_logo', '')}
                                                        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/5 font-black uppercase tracking-widest text-[10px]"
                                                        disabled={isSettingsLoading}
                                                    >
                                                        Remove Logo
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-border">
                                    <div className="p-4 bg-primary/5 border border-primary/10 rounded-md flex items-start gap-4">
                                        <div className="p-2 rounded-md bg-primary/10">
                                            <Globe className="w-4 h-4 text-primary" />
                                        </div>
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-black uppercase tracking-widest text-primary">Deployment Note</h4>
                                            <p className="text-[10px] font-medium text-muted-foreground opacity-80 max-w-2xl">
                                                These changes are applied globally across all namespaces and clusters. Users may need to refresh their session to see large asset updates.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="bg-card border-border shadow-card overflow-hidden">
                            <CardHeader className="border-b border-border bg-muted/10 p-6">
                                <CardTitle className="text-xl font-black tracking-tight">Log Retention</CardTitle>
                                <CardDescription className="text-xs font-medium opacity-70">Automatically clear old logs after a number of days. Leave empty or 0 to keep them forever.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Execution log retention */}
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary/60">Execution Log Retention (days)</Label>
                                            <p className="text-[10px] font-medium text-muted-foreground/60">Delete execution logs (records and log files) older than this. Empty or 0 = never clear.</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                min="0"
                                                value={systemSettings.execution_log_retention_days || ''}
                                                onChange={(e) => setSystemSettings(prev => ({ ...prev, execution_log_retention_days: e.target.value }))}
                                                placeholder="0"
                                                className="h-9 bg-muted/20 border-border/50 text-sm font-bold"
                                            />
                                            <Button
                                                onClick={() => updateSetting('execution_log_retention_days', systemSettings.execution_log_retention_days || '')}
                                                className="premium-gradient px-6 font-black uppercase tracking-widest text-[10px] h-9"
                                                disabled={isSettingsLoading}
                                            >
                                                Apply
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Audit log retention */}
                                    <div className="space-y-4">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary/60">Audit Log Retention (days)</Label>
                                            <p className="text-[10px] font-medium text-muted-foreground/60">Delete audit logs older than this. Empty or 0 = never clear.</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                type="number"
                                                min="0"
                                                value={systemSettings.audit_log_retention_days || ''}
                                                onChange={(e) => setSystemSettings(prev => ({ ...prev, audit_log_retention_days: e.target.value }))}
                                                placeholder="0"
                                                className="h-9 bg-muted/20 border-border/50 text-sm font-bold"
                                            />
                                            <Button
                                                onClick={() => updateSetting('audit_log_retention_days', systemSettings.audit_log_retention_days || '')}
                                                className="premium-gradient px-6 font-black uppercase tracking-widest text-[10px] h-9"
                                                disabled={isSettingsLoading}
                                            >
                                                Apply
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-border">
                                    <div className="p-4 bg-destructive/5 border border-destructive/10 rounded-md flex items-start gap-4">
                                        <div className="p-2 rounded-md bg-destructive/10">
                                            <Trash2 className="w-4 h-4 text-destructive" />
                                        </div>
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-black uppercase tracking-widest text-destructive">Irreversible</h4>
                                            <p className="text-[10px] font-medium text-muted-foreground opacity-80 max-w-2xl">
                                                Cleanup runs once a day (and on server start). Deleted logs and their files cannot be recovered.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {activeTab === 'auth' && (
                    <div className="grid gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <Card className="bg-card border-border shadow-card overflow-hidden">
                            <CardHeader className="border-b border-border bg-muted/10 p-6">
                                <CardTitle className="text-xl font-black tracking-tight">Identity & Access</CardTitle>
                                <CardDescription className="text-xs font-medium opacity-70">Configure how users join and access the platform.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                <div className="flex items-center justify-between p-4 bg-muted/20 border border-border/50 rounded-md">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Label htmlFor="allow-registration" className="text-sm font-black tracking-tight cursor-pointer">Allow Public Registration</Label>
                                            <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-primary/20 text-primary">Security Policy</Badge>
                                        </div>
                                        <p className="text-[10px] font-medium opacity-60">When enabled, anyone can create an account via the login page.</p>
                                    </div>
                                    <Switch
                                        id="allow-registration"
                                        checked={systemSettings.allow_registration === 'true'}
                                        onCheckedChange={(checked) => updateSetting('allow_registration', checked ? 'true' : 'false')}
                                        disabled={isSettingsLoading}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Google OAuth Provider */}
                                    <div className="p-5 bg-muted/20 border border-border/50 rounded-md space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="p-2 rounded-md bg-white/5 border border-white/10">
                                                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                                                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                                                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                                    </svg>
                                                </div>
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-white">Google OAuth</h4>
                                            </div>
                                            <Switch
                                                checked={systemSettings.google_auth_enabled === 'true'}
                                                onCheckedChange={(checked) => updateSetting('google_auth_enabled', checked ? 'true' : 'false')}
                                                disabled={isSettingsLoading}
                                            />
                                        </div>

                                        <div className="space-y-3 pt-2">
                                            <div className="space-y-1.5">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Client ID</Label>
                                                <Input
                                                    value={systemSettings.google_client_id || ''}
                                                    onChange={(e) => setSystemSettings(prev => ({ ...prev, google_client_id: e.target.value }))}
                                                    onBlur={(e) => updateSetting('google_client_id', e.target.value)}
                                                    placeholder="Enter Google Client ID"
                                                    className="h-9 bg-background/50 border-border/50 text-xs font-medium"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Client Secret</Label>
                                                <div className="relative">
                                                    <Input
                                                        type={showSecrets['google'] ? "text" : "password"}
                                                        value={systemSettings.google_client_secret || ''}
                                                        onChange={(e) => setSystemSettings(prev => ({ ...prev, google_client_secret: e.target.value }))}
                                                        onBlur={(e) => updateSetting('google_client_secret', e.target.value)}
                                                        placeholder="Enter Google Client Secret"
                                                        className="h-9 bg-background/50 border-border/50 text-xs font-medium pr-10"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSecret('google')}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        {showSecrets['google'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Facebook OAuth Provider */}
                                    <div className="p-5 bg-muted/20 border border-border/50 rounded-md space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
                                                    <svg className="w-4 h-4 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                                    </svg>
                                                </div>
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-white">Facebook OAuth</h4>
                                            </div>
                                            <Switch
                                                checked={systemSettings.facebook_auth_enabled === 'true'}
                                                onCheckedChange={(checked) => updateSetting('facebook_auth_enabled', checked ? 'true' : 'false')}
                                                disabled={isSettingsLoading}
                                            />
                                        </div>

                                        <div className="space-y-3 pt-2">
                                            <div className="space-y-1.5">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">App ID</Label>
                                                <Input
                                                    value={systemSettings.facebook_client_id || ''}
                                                    onChange={(e) => setSystemSettings(prev => ({ ...prev, facebook_client_id: e.target.value }))}
                                                    onBlur={(e) => updateSetting('facebook_client_id', e.target.value)}
                                                    placeholder="Enter Facebook App ID"
                                                    className="h-9 bg-background/50 border-border/50 text-xs font-medium"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">App Secret</Label>
                                                <div className="relative">
                                                    <Input
                                                        type={showSecrets['facebook'] ? "text" : "password"}
                                                        value={systemSettings.facebook_client_secret || ''}
                                                        onChange={(e) => setSystemSettings(prev => ({ ...prev, facebook_client_secret: e.target.value }))}
                                                        onBlur={(e) => updateSetting('facebook_client_secret', e.target.value)}
                                                        placeholder="Enter Facebook App Secret"
                                                        className="h-9 bg-background/50 border-border/50 text-xs font-medium pr-10"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSecret('facebook')}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                                    >
                                                        {showSecrets['facebook'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4 pt-6 border-t border-border">
                                    <div className="flex items-center justify-between p-4 bg-muted/20 border border-border/50 rounded-md">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <Label htmlFor="token-expiration" className="text-sm font-black tracking-tight cursor-pointer">Token Expiration (Hours)</Label>
                                                <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-primary/20 text-primary">Session Policy</Badge>
                                            </div>
                                            <p className="text-[10px] font-medium opacity-60">Duration in hours before a user session expires. Default is 24h.</p>
                                        </div>
                                        <div className="flex gap-2 min-w-[120px]">
                                            <Input
                                                id="token-expiration"
                                                type="number"
                                                value={systemSettings.token_expiration || '24'}
                                                onChange={(e) => setSystemSettings(prev => ({ ...prev, token_expiration: e.target.value }))}
                                                className="h-9 bg-background/50 border-border/50 text-xs font-medium"
                                                min="1"
                                            />
                                            <Button
                                                onClick={() => updateSetting('token_expiration', systemSettings.token_expiration || '24')}
                                                className="premium-gradient px-3 font-black uppercase tracking-widest text-[10px] h-9"
                                                disabled={isSettingsLoading}
                                            >
                                                Save
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <DomainRoleMappingCard />
                    </div>
                )}

                {activeTab === 'namespaces' && (
                    <Card className="bg-card border-border shadow-card overflow-hidden">
                        <CardHeader className="border-b border-border bg-muted/10 p-6">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <CardTitle className="text-xl font-black tracking-tight">Namespace Repository</CardTitle>
                                    <CardDescription className="text-xs font-medium opacity-70">Define isolated environments for your workflows and resources.</CardDescription>
                                </div>
                                <Button
                                    onClick={() => {
                                        setFormData({ name: '', description: '' });
                                        setError('');
                                        setIsCreateOpen(true);
                                    }}
                                    className="premium-gradient font-black uppercase tracking-widest text-[10px] h-9 px-4 shadow-premium rounded-md gap-2"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Provision Namespace
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-border">
                                {namespaces.map((ns) => (
                                    <div key={ns.id} className="p-6 flex items-center justify-between group hover:bg-muted/10 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={cn(
                                                "w-12 h-12 rounded-md flex items-center justify-center border transition-all duration-300 group-hover:scale-110",
                                                ns.name === "Default" ? "bg-primary/10 border-primary/20 text-primary" : "bg-muted border-border text-muted-foreground"
                                            )}>
                                                <Layers className="w-6 h-6" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-black text-sm tracking-tight">{ns.name}</h3>
                                                    {ns.name === "Default" && (
                                                        <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-primary/20 text-primary bg-primary/5">
                                                            CORE_SYSTEM
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="text-[10px] font-medium opacity-60 max-w-md">{ns.description || 'No description provided for this partition.'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-9 px-3 rounded-md text-[10px] font-black uppercase tracking-widest gap-2"
                                                onClick={() => openEdit(ns)}
                                            >
                                                <Edit2 className="w-3 h-3 text-muted-foreground" /> Edit
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className={cn(
                                                    "h-9 px-3 rounded-md text-[10px] font-black uppercase tracking-widest gap-2",
                                                    (ns.name === "Default" || namespaces.length <= 1) ? "opacity-30 cursor-not-allowed" : "text-destructive hover:bg-destructive/10"
                                                )}
                                                disabled={ns.name === "Default" || namespaces.length <= 1}
                                                onClick={() => handleDelete(ns)}
                                            >
                                                <Trash2 className="w-3 h-3" /> Terminate
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Create/Edit Dialogs */}
            <Dialog open={isCreateOpen || isEditOpen} onOpenChange={(open) => {
                if (!open) {
                    setIsCreateOpen(false);
                    setIsEditOpen(false);
                }
            }}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tighter">
                            {isCreateOpen ? 'Initialize Namespace' : 'Configure Namespace'}
                        </DialogTitle>
                        <DialogDescription className="text-xs font-medium">
                            {isCreateOpen ? 'Deploy a new isolated partition for your operations.' : 'Modify the configuration for this operational partition.'}
                        </DialogDescription>
                    </DialogHeader>
                    {error && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-3 text-destructive animate-in fade-in zoom-in duration-300">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <p className="text-[10px] font-black uppercase tracking-wide">{error}</p>
                        </div>
                    )}
                    <form onSubmit={isCreateOpen ? handleCreate : handleUpdate} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Namespace Name</label>
                            <Input
                                placeholder="e.g. Production Cluster"
                                className="h-9 bg-muted/30 border-border rounded-md font-bold text-sm"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">Contextual Description</label>
                            <Input
                                placeholder="Strategic purpose of this namespace..."
                                className="h-9 bg-muted/30 border-border rounded-md font-bold text-sm"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>
                        <DialogFooter className="pt-4 gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-9 flex-1 font-black uppercase tracking-widest text-[10px] rounded-md"
                                onClick={() => {
                                    setIsCreateOpen(false);
                                    setIsEditOpen(false);
                                }}
                            >
                                ABORT_OPERATION
                            </Button>
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="premium-gradient h-9 flex-1 font-black uppercase tracking-widest text-[10px] rounded-md shadow-premium"
                            >
                                {isLoading ? 'PROCESSING...' : isCreateOpen ? 'INITIATE_DEPLOY' : 'SAVE_CONFIG'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Terminate Namespace"
                description={`Are you sure you want to delete the namespace "${deleteTarget?.name}"? All associated data, flows, and records will be permanently lost.`}
                confirmText="Confirm Termination"
                variant="danger"
                isLoading={isDeleting}
            />
        </div>
    );
};

export default SettingsPage;
