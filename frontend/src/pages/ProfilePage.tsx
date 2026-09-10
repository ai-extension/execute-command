import React, { useState, useEffect } from 'react';
import {
    User,
    Shield,
    Lock,
    Mail,
    RefreshCw,
    Save,
    Smile,
    MessageSquare,
    AlertCircle,
    CheckCircle2,
    Key
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';
import { cn } from '../lib/utils';

const ProfilePage = () => {
    const { apiFetch, user, updateUser, refreshUser } = useAuth();
    const [isLoading, setIsLoading] = useState(false);

    // Profile & Password forms state
    const [profileData, setProfileData] = useState({
        username: user?.username || '',
        full_name: user?.full_name || '',
        nickname: user?.nickname || '',
        chat_account_id: user?.chat_account_id || '',
        email: user?.email || ''
    });
    const [passwordData, setPasswordData] = useState({ old_password: '', new_password: '', confirm_password: '' });
    const [profileStatus, setProfileStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });
    const [passwordStatus, setPasswordStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

    useEffect(() => {
        refreshUser();
    }, [refreshUser]);

    useEffect(() => {
        if (user) {
            setProfileData({
                username: user.username,
                full_name: user.full_name || '',
                nickname: user.nickname || '',
                chat_account_id: user.chat_account_id || '',
                email: user.email || ''
            });
        }
    }, [user]);

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setProfileStatus({ type: null, message: '' });
        setIsLoading(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/me/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_name: profileData.full_name,
                    nickname: profileData.nickname,
                    chat_account_id: profileData.chat_account_id,
                    email: profileData.email
                })
            });
            const data = await response.json();
            if (response.ok) {
                setProfileStatus({ type: 'success', message: 'Profile updated successfully' });
                // @ts-ignore - data should match User interface
                updateUser(data);
            } else {
                setProfileStatus({ type: 'error', message: data.error || 'Failed to update profile' });
            }
        } catch (err) {
            setProfileStatus({ type: 'error', message: 'An error occurred' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordStatus({ type: null, message: '' });

        if (passwordData.new_password !== passwordData.confirm_password) {
            setPasswordStatus({ type: 'error', message: 'New passwords do not match' });
            return;
        }

        setIsLoading(true);
        try {
            const response = await apiFetch(`${API_BASE_URL}/me/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_password: passwordData.old_password,
                    new_password: passwordData.new_password
                })
            });
            const data = await response.json();
            if (response.ok) {
                setPasswordStatus({ type: 'success', message: 'Password updated successfully' });
                setPasswordData({ old_password: '', new_password: '', confirm_password: '' });
            } else {
                setPasswordStatus({ type: 'error', message: data.error || 'Failed to update password' });
            }
        } catch (err) {
            setPasswordStatus({ type: 'error', message: 'An error occurred' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 mb-1">
                    <User className="w-4 h-4 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">User Identity</span>
                </div>
                <h1 className="text-3xl font-black tracking-tighter">Account Profile</h1>
                <p className="text-muted-foreground text-sm font-medium">Manage your authenticated system credentials and security.</p>
            </div>

            <div className="grid lg:grid-cols-2 gap-8 mt-8">
                {/* Profile Section */}
                <div className="space-y-6">
                    <Card className="bg-card border-border shadow-card overflow-hidden">
                        <CardHeader className="p-6 border-b border-border bg-muted/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-md">
                                    <User className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-black tracking-tight">Public Identity</CardTitle>
                                    <CardDescription className="text-[10px] font-medium uppercase tracking-wider opacity-60">Manage your authenticated system presence.</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <form onSubmit={handleUpdateProfile} className="space-y-6">
                                {profileStatus.type && (
                                    <div className={cn(
                                        "p-4 rounded-md flex items-center gap-3 animate-in fade-in zoom-in duration-300 border",
                                        profileStatus.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-destructive/10 border-destructive/20 text-destructive"
                                    )}>
                                        {profileStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                        <p className="text-xs font-black uppercase tracking-wide">{profileStatus.message}</p>
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">System Username (Immutable)</label>
                                        <div className="relative group opacity-60">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors" />
                                            <Input
                                                value={profileData.username}
                                                readOnly
                                                disabled
                                                className="pl-12 h-9 bg-muted/10 border-border cursor-not-allowed rounded-md font-bold text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Full Name</label>
                                        <div className="relative group">
                                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                            <Input
                                                value={profileData.full_name}
                                                onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                                                placeholder="Legal name or alias"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Nickname</label>
                                        <div className="relative group">
                                            <Smile className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                            <Input
                                                value={profileData.nickname}
                                                onChange={(e) => setProfileData({ ...profileData, nickname: e.target.value })}
                                                placeholder="Short name used by workflows"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Chat Account ID</label>
                                        <div className="relative group">
                                            <MessageSquare className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                            <Input
                                                value={profileData.chat_account_id}
                                                onChange={(e) => setProfileData({ ...profileData, chat_account_id: e.target.value })}
                                                placeholder="Slack / chat member ID"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Email Address</label>
                                        <div className="relative group">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                            <Input
                                                type="email"
                                                value={profileData.email}
                                                onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                                                placeholder="Contact coordinate"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                                required
                                            />
                                        </div>
                                    </div>
                                </div>

                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full premium-gradient h-9 font-black uppercase tracking-[0.2em] text-[10px] rounded-md shadow-premium gap-3 mt-4"
                                >
                                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Commit Identity Changes
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    <div className="p-6 rounded-md bg-primary/5 border border-primary/10 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                                <Shield className="w-6 h-6" />
                            </div>
                            <div className="space-y-0.5">
                                <h4 className="text-xs font-black uppercase tracking-widest text-primary">Verification Status</h4>
                                <p className="text-[10px] font-medium text-muted-foreground">Authenticated via primary system vault.</p>
                            </div>
                        </div>
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-none font-black text-[10px] px-3 py-1 uppercase tracking-widest">VERIFIED</Badge>
                    </div>
                </div>

                {/* Password Section */}
                <div className="space-y-6">
                    <Card className="bg-card border-border shadow-card overflow-hidden">
                        <CardHeader className="p-6 border-b border-border bg-muted/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-amber-500/10 rounded-md">
                                    <Key className="w-5 h-5 text-amber-500" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-black tracking-tight">Security Credentials</CardTitle>
                                    <CardDescription className="text-[10px] font-medium uppercase tracking-wider opacity-60">Update your access key for system entry.</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6">
                            <form onSubmit={handleUpdatePassword} className="space-y-6">
                                {passwordStatus.type && (
                                    <div className={cn(
                                        "p-4 rounded-md flex items-center gap-3 animate-in fade-in zoom-in duration-300 border",
                                        passwordStatus.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-destructive/10 border-destructive/20 text-destructive"
                                    )}>
                                        {passwordStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                        <p className="text-xs font-black uppercase tracking-wide">{passwordStatus.message}</p>
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Current Password</label>
                                        <div className="relative group">
                                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-amber-500 transition-colors" />
                                            <Input
                                                type="password"
                                                value={passwordData.old_password}
                                                onChange={(e) => setPasswordData({ ...passwordData, old_password: e.target.value })}
                                                placeholder="Verification required"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">New System Key</label>
                                        <div className="relative group">
                                            <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-amber-500 transition-colors" />
                                            <Input
                                                type="password"
                                                value={passwordData.new_password}
                                                onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                                                placeholder="New security string"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                                required
                                                minLength={6}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Synchronize Key</label>
                                        <div className="relative group">
                                            <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-amber-500 transition-colors" />
                                            <Input
                                                type="password"
                                                value={passwordData.confirm_password}
                                                onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                                                placeholder="Re-enter for precision"
                                                className="pl-12 h-9 bg-muted/20 border-border focus:bg-muted/40 transition-all rounded-md font-bold text-sm"
                                                required
                                            />
                                        </div>
                                    </div>
                                </div>

                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full bg-amber-500 hover:bg-amber-600 text-white h-9 font-black uppercase tracking-[0.2em] text-[10px] rounded-md shadow-lg shadow-amber-500/10 gap-3 mt-4 transition-all"
                                >
                                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                                    Authorize Key Re-deployment
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default ProfilePage;
