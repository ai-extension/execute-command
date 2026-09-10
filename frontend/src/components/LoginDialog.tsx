import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Zap, Shield, Lock, User as UserIcon, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import AuthMethodChooser from './auth/AuthMethodChooser';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "./ui/dialog";

interface LoginDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

const LoginDialog: React.FC<LoginDialogProps> = ({ isOpen, onOpenChange, onSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const [googleClientId, setGoogleClientId] = useState('');
    const [facebookEnabled, setFacebookEnabled] = useState(false);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    // 'choose' lists the sign-in methods; 'credentials' reveals the username form.
    const [mode, setMode] = useState<'choose' | 'credentials'>('choose');
    const { login, showToast } = useAuth();

    // Only ask while the dialog is open: a public page renders this for visitors who
    // may never open it.
    useEffect(() => {
        if (!isOpen) return;

        const fetchSettings = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/settings/public`);
                if (!response.ok) return;
                const data = await response.json();
                setGoogleEnabled(!!data.google_auth_enabled);
                setGoogleClientId(data.google_client_id || '');
                setFacebookEnabled(!!data.facebook_auth_enabled);
            } catch (err) {
                console.error('Failed to fetch public settings', err);
            } finally {
                setSettingsLoaded(true);
            }
        };
        fetchSettings();
    }, [isOpen]);

    // Every visit to the dialog starts at the chooser, never mid-flow from last time.
    useEffect(() => {
        if (!isOpen) return;
        setMode('choose');
        setError('');
    }, [isOpen]);

    const hasSocialOption = (googleEnabled && !!googleClientId) || facebookEnabled;
    const activeMode = hasSocialOption ? mode : 'credentials';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password }),
            });

            if (response.ok) {
                const data = await response.json();
                login(data.token, data.user);
                onOpenChange(false);
                if (onSuccess) onSuccess();
            } else {
                const data = await response.json();
                setError(data.error || 'Login failed');
            }
        } catch (err) {
            setError('Failed to connect to server');
        } finally {
            setIsLoading(false);
        }
    };

    // The credential is a Google ID token; the backend verifies it and maps the
    // signing-in domain to a role.
    const handleGoogleCredential = async (credential?: string) => {
        if (!credential) {
            setError('Google did not return a credential');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id_token: credential }),
            });

            const data = await response.json();
            if (response.ok) {
                login(data.token, data.user);
                onOpenChange(false);
                if (onSuccess) onSuccess();
            } else {
                setError(data.error || 'Google login failed');
            }
        } catch (err) {
            setError('Failed to connect to server');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-[#0f0f0f]/95 border-white/10 backdrop-blur-3xl rounded-md p-0 overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)]">
                <div className="p-10">
                    <DialogHeader className="flex flex-col items-center mb-8 gap-4">
                        <div className="relative">
                            <div className="absolute inset-0 bg-primary/40 blur-2xl rounded-full scale-110 animate-pulse" />
                            <div className="relative premium-gradient p-3 rounded-md shadow-[0_0_30px_rgba(99,102,241,0.4)]">
                                <Zap className="w-6 h-6 text-white" />
                            </div>
                        </div>
                        <div className="text-center space-y-1">
                            <DialogTitle className="text-2xl font-black tracking-tighter text-white uppercase">
                                System Access
                            </DialogTitle>
                            <DialogDescription className="text-[10px] font-black text-primary tracking-[0.4em] uppercase opacity-70">
                                Administrative Login
                            </DialogDescription>
                        </div>
                    </DialogHeader>

                    {!settingsLoaded && (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
                        </div>
                    )}

                    {settingsLoaded && activeMode === 'choose' && (
                        <div key="chooser" className="auth-panel-in-left space-y-5">
                            <AuthMethodChooser
                                googleEnabled={googleEnabled}
                                googleClientId={googleClientId}
                                facebookEnabled={facebookEnabled}
                                onGoogleCredential={handleGoogleCredential}
                                onGoogleError={() => setError('Google login failed')}
                                onFacebook={() => showToast('Facebook login is not available yet — only Google sign-in is wired up.', 'info')}
                                onUseAccount={() => {
                                    setError('');
                                    setMode('credentials');
                                }}
                                disabled={isLoading}
                            />

                            {error && (
                                <div className="bg-destructive/5 border border-destructive/20 p-3 rounded-md flex items-center gap-3">
                                    <Shield className="w-3.5 h-3.5 text-destructive" />
                                    <p className="text-[10px] font-bold text-destructive leading-tight">{error}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {settingsLoaded && activeMode === 'credentials' && (
                    <div key="credentials" className="auth-panel-in-right">
                    {hasSocialOption && (
                        <button
                            type="button"
                            onClick={() => {
                                setError('');
                                setMode('choose');
                            }}
                            className="mb-5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50 hover:text-primary transition-colors group"
                        >
                            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
                            Other methods
                        </button>
                    )}
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2 group/input">
                            <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1">
                                Identity
                            </label>
                            <div className="relative group">
                                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 transition-all pointer-events-none z-10" />
                                <Input
                                    className="h-9 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30"
                                    placeholder="Username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1">
                                Access Key
                            </label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 transition-all pointer-events-none z-10" />
                                <Input
                                    type="password"
                                    className="h-9 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="bg-destructive/5 border border-destructive/20 p-3 rounded-md flex items-center gap-3 animate-in fade-in zoom-in-95 duration-500">
                                <Shield className="w-3.5 h-3.5 text-destructive" />
                                <p className="text-[10px] font-bold text-destructive leading-tight">{error}</p>
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={isLoading}
                            className="w-full h-9 premium-gradient shadow-[0_8px_24px_rgba(99,102,241,0.3)] text-xs font-black uppercase tracking-[0.2em] rounded-md gap-3 transition-all hover:brightness-110"
                        >
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    Unlock
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </Button>
                    </form>
                    </div>
                    )}

                </div>
            </DialogContent>
        </Dialog>
    );
};

export default LoginDialog;
