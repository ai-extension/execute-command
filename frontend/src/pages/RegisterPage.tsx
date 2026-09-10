import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, Lock, User as UserIcon, ArrowRight, Loader2, Mail, CheckCircle2 } from 'lucide-react';
import { API_BASE_URL } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import AppLogo from '../components/AppLogo';

const RegisterPage = () => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [allowRegistration, setAllowRegistration] = useState(true);
    const [siteTitle, setSiteTitle] = useState('');
    const [siteLogo, setSiteLogo] = useState('');

    const navigate = useNavigate();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/settings/public`);
                if (response.ok) {
                    const data = await response.json();
                    if (!data.allow_registration) {
                        setAllowRegistration(false);
                        setError("Registration is currently disabled by the administrator.");
                    }
                    setSiteTitle(data.site_title || '');
                    setSiteLogo(data.site_logo || '');
                }
            } catch (err) {
                console.error("Failed to fetch public settings", err);
            }
        };
        fetchSettings();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password }),
            });

            if (response.ok) {
                setSuccess(true);
                setTimeout(() => navigate('/login'), 3000);
            } else {
                const data = await response.json();
                setError(data.error || 'Registration failed');
            }
        } catch (err) {
            setError('Failed to connect to server');
        } finally {
            setIsLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans">
                {/* Ambient Background Glows */}
                <div className="absolute top-[-10%] right-[-10%] w-[800px] h-[800px] bg-emerald-500/10 blur-[150px] rounded-full animate-pulse duration-[10s]" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[800px] h-[800px] bg-primary/20 blur-[150px] rounded-full animate-pulse duration-[8s] delay-700" />

                <div className="w-full max-w-md px-6 relative z-10 animate-in fade-in zoom-in-95 duration-700">
                    <Card className="bg-[#0f0f0f]/80 border-white/5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] rounded-md overflow-hidden backdrop-blur-3xl ring-2 ring-emerald-500/20 text-center p-10 space-y-6">
                        <div className="flex justify-center relative">
                            <div className="absolute inset-0 bg-emerald-500/40 blur-2xl rounded-full scale-110 animate-pulse" />
                            <div className="relative bg-emerald-500/20 p-5 rounded-md border border-emerald-500/30">
                                <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-3xl font-black text-white tracking-tight">Deploy Complete!</h2>
                            <p className="text-muted-foreground/60 text-sm font-medium leading-relaxed">
                                Your node cluster has been provisioned.<br />Redirecting to control plane...
                            </p>
                        </div>
                        <div className="pt-4">
                            <Button
                                onClick={() => navigate('/login')}
                                className="w-full h-14 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_8px_24px_rgba(16,185,129,0.3)] hover:shadow-[0_12px_32px_rgba(16,185,129,0.5)] active:scale-[0.98] transition-all text-xs font-black uppercase tracking-[0.2em] rounded-md gap-3"
                            >
                                Enter Workspace
                                <ArrowRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans">
            {/* Ambient Background Glows */}
            <div className="absolute top-[-10%] right-[-10%] w-[800px] h-[800px] bg-primary/20 blur-[150px] rounded-full animate-pulse duration-[10s]" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[800px] h-[800px] bg-indigo-600/10 blur-[150px] rounded-full animate-pulse duration-[8s] delay-700" />
            <div className="absolute top-[30%] left-[20%] w-[300px] h-[300px] bg-purple-500/5 blur-[100px] rounded-full" />

            <div className="w-full max-w-md px-6 relative z-10 animate-in fade-in slide-in-from-bottom-12 duration-1000">
                {/* Branding Section */}
                <div className="flex flex-col items-center mb-10 gap-4">
                    <AppLogo src={siteLogo} size="lg" className="transition-transform duration-500 hover:scale-105" />
                    <div className="text-center space-y-1">
                        <h1 className="text-4xl font-black tracking-tighter text-white drop-shadow-2xl">
                            {siteTitle || 'CSM APP'}
                        </h1>
                        <div className="flex items-center justify-center gap-2">
                            <div className="h-[1px] w-8 bg-gradient-to-r from-transparent to-primary/50" />
                            <p className="text-[10px] font-black text-primary tracking-[0.4em] uppercase opacity-90">
                                Join Control Plane
                            </p>
                            <div className="h-[1px] w-8 bg-gradient-to-l from-transparent to-primary/50" />
                        </div>
                    </div>
                </div>

                {/* Register Card */}
                <Card className="bg-[#0f0f0f]/80 border-white/5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] rounded-md overflow-hidden backdrop-blur-3xl ring-1 ring-white/10 hover:ring-white/20 transition-all duration-500 group">
                    <CardContent className="p-10 pb-8">
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="space-y-2 group/input">
                                <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1 transition-colors group-focus-within/input:text-primary/90">
                                    Username
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-primary/10 rounded-md blur-md opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 group-focus-within:text-primary transition-all duration-300 pointer-events-none z-10" />
                                    <Input
                                        className="relative h-14 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30 z-0"
                                        placeholder="johndoe"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required
                                        disabled={!allowRegistration}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 group/input">
                                <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1 transition-colors group-focus-within/input:text-primary/90">
                                    Email Address
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-primary/10 rounded-md blur-md opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 group-focus-within:text-primary transition-all duration-300 pointer-events-none z-10" />
                                    <Input
                                        type="email"
                                        className="relative h-14 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30 z-0"
                                        placeholder="john@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        disabled={!allowRegistration}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 group/input">
                                <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1 transition-colors group-focus-within/input:text-primary/90">
                                    Password
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-primary/10 rounded-md blur-md opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 group-focus-within:text-primary transition-all duration-300 pointer-events-none z-10" />
                                    <Input
                                        type="password"
                                        className="relative h-14 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30 text-2xl z-0"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        disabled={!allowRegistration}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 group/input">
                                <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1 transition-colors group-focus-within/input:text-primary/90">
                                    Confirm Key
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-primary/10 rounded-md blur-md opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                                    <Shield className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 group-focus-within:text-primary transition-all duration-300 pointer-events-none z-10" />
                                    <Input
                                        type="password"
                                        className="relative h-14 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30 text-2xl z-0"
                                        placeholder="••••••••"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                        disabled={!allowRegistration}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="bg-destructive/5 border border-destructive/20 p-4 rounded-md flex items-center gap-3 animate-in fade-in zoom-in-95 duration-500 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                                    <div className="p-1.5 rounded-full bg-destructive/10">
                                        <Shield className="w-3.5 h-3.5 text-destructive" />
                                    </div>
                                    <p className="text-xs font-bold text-destructive leading-tight">{error}</p>
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={isLoading || !allowRegistration}
                                className="w-full h-14 premium-gradient shadow-[0_8px_24px_rgba(99,102,241,0.3)] hover:shadow-[0_12px_32px_rgba(99,102,241,0.5)] active:scale-[0.98] transition-all text-xs font-black uppercase tracking-[0.2em] rounded-md gap-3 mt-4 hover:brightness-110 group"
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        Create Account
                                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </Button>
                        </form>

                        {/* Footer Section */}
                        <div className="mt-10 text-center">
                            <p className="text-xs text-muted-foreground/40 font-bold uppercase tracking-widest">
                                Already have an account?{' '}
                                <Link to="/login" className="text-primary hover:text-white transition-colors underline-offset-4 hover:underline">
                                    Sign In
                                </Link>
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Bottom Decorative Decor */}
                <div className="mt-8 flex justify-center">
                    <div className="h-1 w-1 rounded-full bg-white/10 mx-1" />
                    <div className="h-1 w-1 rounded-full bg-white/20 mx-1 shadow-[0_0_8px_white]" />
                    <div className="h-1 w-1 rounded-full bg-white/10 mx-1" />
                </div>
            </div>
        </div>
    );
};

export default RegisterPage;
