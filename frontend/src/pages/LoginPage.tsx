import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { Zap, Shield, Lock, User as UserIcon, ArrowRight, Loader2, Mail } from 'lucide-react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { API_BASE_URL } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

const LoginPage = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [allowRegistration, setAllowRegistration] = useState(false);
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const [googleClientId, setGoogleClientId] = useState('');
    const [facebookEnabled, setFacebookEnabled] = useState(false);
    const { login, showToast } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/settings/public`);
                if (response.ok) {
                    const data = await response.json();
                    setAllowRegistration(data.allow_registration);
                    setGoogleEnabled(data.google_auth_enabled);
                    setGoogleClientId(data.google_client_id || '');
                    setFacebookEnabled(data.facebook_auth_enabled);
                }
            } catch (err) {
                console.error("Failed to fetch public settings", err);
            }
        };
        fetchSettings();
    }, []);

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
                navigate('/');
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

    const handleSocialLogin = (provider: string) => {
        showToast(`${provider} login is not available yet — only Google sign-in is wired up.`, 'info');
    };

    // The credential is a Google ID token; the backend verifies it and decides which
    // role the signing-in domain grants. Nothing here is trusted client-side.
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
                navigate('/');
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
        <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans">
            {/* Ambient Background Glows */}
            <div className="absolute top-[-10%] right-[-10%] w-[800px] h-[800px] bg-primary/20 blur-[150px] rounded-full animate-pulse duration-[10s]" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[800px] h-[800px] bg-indigo-600/10 blur-[150px] rounded-full animate-pulse duration-[8s] delay-700" />
            <div className="absolute top-[30%] left-[20%] w-[300px] h-[300px] bg-purple-500/5 blur-[100px] rounded-full" />

            <div className="w-full max-w-md px-6 relative z-10 animate-in fade-in slide-in-from-bottom-12 duration-1000">
                {/* Branding Section */}
                <div className="flex flex-col items-center mb-10 gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/40 blur-2xl rounded-full scale-110 animate-pulse" />
                        <div className="relative premium-gradient p-4 rounded-md shadow-[0_0_40px_rgba(99,102,241,0.4)] rotate-6 hover:rotate-0 transition-all duration-700 cursor-default group">
                            <Zap className="w-10 h-10 text-white group-hover:scale-110 transition-transform" />
                        </div>
                    </div>
                    <div className="text-center space-y-1">
                        <h1 className="text-4xl font-black tracking-tighter text-white drop-shadow-2xl">
                            CSM APP
                        </h1>
                        <div className="flex items-center justify-center gap-2">
                            <div className="h-[1px] w-8 bg-gradient-to-r from-transparent to-primary/50" />
                            <p className="text-[10px] font-black text-primary tracking-[0.4em] uppercase opacity-90">
                                Premium Control
                            </p>
                            <div className="h-[1px] w-8 bg-gradient-to-l from-transparent to-primary/50" />
                        </div>
                    </div>
                </div>

                {/* Login Card */}
                <Card className="bg-[#0f0f0f]/80 border-white/5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] rounded-md overflow-hidden backdrop-blur-3xl ring-1 ring-white/10 hover:ring-white/20 transition-all duration-500 group">
                    <CardContent className="p-10">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2 group/input">
                                <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1 transition-colors group-focus-within/input:text-primary/90">
                                    Identity
                                </label>
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-primary/10 rounded-md blur-md opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
                                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 group-focus-within:text-primary transition-all duration-300 pointer-events-none z-10" />
                                    <Input
                                        className="relative h-14 bg-white/[0.03] border-white/10 rounded-md pl-12 text-sm font-medium text-white focus-visible:ring-primary/40 focus-visible:border-primary/50 transition-all placeholder:text-muted-foreground/30 z-0"
                                        placeholder="Enter your username"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 group/input">
                                <label className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70 ml-1 transition-colors group-focus-within/input:text-primary/90">
                                    Access Key
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
                                disabled={isLoading}
                                className="w-full h-14 premium-gradient shadow-[0_8px_24px_rgba(99,102,241,0.3)] hover:shadow-[0_12px_32px_rgba(99,102,241,0.5)] active:scale-[0.98] transition-all text-xs font-black uppercase tracking-[0.2em] rounded-md gap-3 mt-4 hover:brightness-110 group"
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        Login
                                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </Button>
                        </form>

                        {/* Social Auth Section */}
                        {((googleEnabled && googleClientId) || facebookEnabled) && (
                            <div className="mt-10 space-y-6">
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-white/5"></span>
                                    </div>
                                    <div className="relative flex justify-center text-[10px] uppercase font-black tracking-[0.3em]">
                                        <span className="bg-[#0f0f0f] px-4 text-muted-foreground/30">Connect via</span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-center gap-8">
                                    {googleEnabled && googleClientId && (
                                        <GoogleOAuthProvider clientId={googleClientId}>
                                            <div className="[color-scheme:light]">
                                                <GoogleLogin
                                                    onSuccess={(response) => handleGoogleCredential(response.credential)}
                                                    onError={() => setError('Google login failed')}
                                                    theme="filled_black"
                                                    shape="pill"
                                                    text="continue_with"
                                                    width="280"
                                                />
                                            </div>
                                        </GoogleOAuthProvider>
                                    )}
                                    {facebookEnabled && (
                                        <button
                                            type="button"
                                            onClick={() => handleSocialLogin('Facebook')}
                                            className="group relative flex items-center justify-center w-16 h-16 rounded-md bg-[#1877F2]/5 border border-[#1877F2]/10 hover:bg-[#1877F2]/20 hover:border-[#1877F2]/30 hover:scale-110 transition-all duration-500 shadow-2xl overflow-hidden ring-1 ring-[#1877F2]/0 hover:ring-[#1877F2]/20"
                                            title="Login with Facebook"
                                        >
                                            <div className="absolute inset-x-0 bottom-0 h-1 bg-[#1877F2] opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <svg className="w-7 h-7 text-[#1877F2] z-10 transition-transform duration-500 group-hover:-rotate-12" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Footer Section */}
                        {allowRegistration && (
                            <div className="mt-10 text-center">
                                <p className="text-xs text-muted-foreground/40 font-bold uppercase tracking-widest">
                                    New here?{' '}
                                    <Link to="/register" className="text-primary hover:text-white transition-colors underline-offset-4 hover:underline">
                                        Access System
                                    </Link>
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Bottom Decorative Line */}
                <div className="mt-8 flex justify-center">
                    <div className="h-1 w-1 rounded-full bg-white/10 mx-1" />
                    <div className="h-1 w-1 rounded-full bg-white/20 mx-1 shadow-[0_0_8px_white]" />
                    <div className="h-1 w-1 rounded-full bg-white/10 mx-1" />
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
