import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, CheckCircle, XCircle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { TAGGABLE_RESOURCES, NAMESPACE_SCOPED_RESOURCES } from '../config/permissions';
import { API_BASE_URL } from '../lib/api';

function getCookie(name: string) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
}

interface User {
    id: string;
    username: string;
    full_name: string;
    nickname: string;
    chat_account_id: string;
    email: string;
    is_super_admin?: boolean;
    roles: any[];
}

interface UserSettings {
    site_title?: string;
    site_logo?: string;
    allow_registration?: string;
    google_auth_enabled?: string;
    facebook_auth_enabled?: string;
    [key: string]: string | undefined;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (token: string, user: User) => void;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    settings: UserSettings;
    refreshSettings: () => Promise<void>;
    apiFetch: (url: string, init?: RequestInit & { skipToast?: boolean }) => Promise<Response>;
    hasPermission: (type: string, action: string, resourceId?: string | null, namespaceId?: string | null, tagIds?: string[]) => boolean;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    updateUser: (newUser: User) => void;
    refreshUser: () => Promise<void>;
}

interface ToastMessage {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(() => {
        const savedUser = localStorage.getItem('auth_user');
        return savedUser ? JSON.parse(savedUser) : null;
    });
    const [token, setToken] = useState<string | null>(() => {
        // Check cookie first (most up-to-date), then fallback to localStorage
        return getCookie('auth_token') || localStorage.getItem('auth_token');
    });
    const [settings, setSettings] = useState<UserSettings>(() => {
        const savedSettings = localStorage.getItem('auth_settings');
        return savedSettings ? JSON.parse(savedSettings) : {};
    });

    const refreshSettings = useCallback(async () => {
        try {
            // Use current cookie state to determine which endpoint to call
            const hasAuth = !!getCookie('auth_token');
            const endpoint = hasAuth ? `${API_BASE_URL}/settings` : `${API_BASE_URL}/settings/public`;

            const response = await fetch(endpoint, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                let mapped: UserSettings = {};
                if (Array.isArray(data)) {
                    data.forEach((s: any) => { mapped[s.key] = s.value; });
                } else {
                    mapped = data;
                }
                setSettings(mapped);
                localStorage.setItem('auth_settings', JSON.stringify(mapped));
            }
        } catch (err) {
            console.error("Failed to fetch settings", err);
        }
    }, []); // Settings fetch shouldn't strictly depend on token state if it uses getCookie internally

    const logout = useCallback(async () => {
        // Call backend to clear the HttpOnly cookie
        try {
            await fetch(`${API_BASE_URL}/logout`, { method: 'POST' });
        } catch (e) {
            console.error("Logout request failed", e);
        }

        setToken(null);
        setUser(null);
        localStorage.removeItem('auth_user');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_settings');
    }, []);

    const login = useCallback((newToken: string, newUser: User) => {
        // newToken is the real JWT from the API response. Store it directly.
        const finalToken = newToken || getCookie('auth_token');
        setToken(finalToken);
        setUser(newUser);
        localStorage.setItem('auth_user', JSON.stringify(newUser));
        if (finalToken) {
            localStorage.setItem('auth_token', finalToken);
        }
    }, []);

    const updateUser = useCallback((newUser: User) => {
        setUser(newUser);
        localStorage.setItem('auth_user', JSON.stringify(newUser));
    }, []);

    const refreshUser = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/me`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            if (response.ok) {
                const userData = await response.json();
                setUser(userData);
                localStorage.setItem('auth_user', JSON.stringify(userData));
            }
        } catch (err) {
            console.error("Failed to refresh user", err);
        }
    }, []);

    const [isLoading, setIsLoading] = useState(true);

    // Initial auth check on mount
    useEffect(() => {
        let isMounted = true;
        const verifyAuth = async () => {
            const hasCookie = !!getCookie('auth_token');
            const hasCachedToken = !!localStorage.getItem('auth_token');
            const hasCachedUser = !!user || !!localStorage.getItem('auth_user');

            // If we have either a cookie, a cached token, or a cached user, try to verify
            if (hasCookie || hasCachedToken || hasCachedUser) {
                // If we have a cached user but no cookie/token in state, we still try to fetch /me
                // because the cookie might be HttpOnly (invisible to JS)
                try {
                    const response = await fetch(`${API_BASE_URL}/me`, {
                        headers: { 'Accept': 'application/json' },
                        credentials: 'include'
                    });
                    if (response.ok) {
                        const userData = await response.json();
                        if (isMounted) {
                            setUser(userData);
                            const currentToken = getCookie('auth_token') || localStorage.getItem('auth_token');
                            setToken(currentToken);
                            localStorage.setItem('auth_user', JSON.stringify(userData));
                        }
                    } else if (response.status === 401 && isMounted) {
                        // Only log out if the token is explicitly rejected
                        await logout();
                    }
                    // On other errors (503, 502, etc.) or if we already had a user, 
                    // we keep the current session state to allow offline/reconnect usage
                } catch (err) {
                    // Network error (backend offline/restarting) - keep session alive
                    console.warn("Auth verification failed (network error), keeping session:", err);
                    if (isMounted && !user) {
                        // If no user object in memory, restore from localStorage as fallback
                        const savedUser = localStorage.getItem('auth_user');
                        if (savedUser) setUser(JSON.parse(savedUser));
                    }
                }
            } else if (isMounted) {
                // No session indicators at all, ensure clean state
                setUser(null);
                setToken(null);
                localStorage.removeItem('auth_user');
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_settings');
            }

            if (isMounted) {
                setIsLoading(false);
            }
        };

        verifyAuth();
        return () => { isMounted = false; };
    }, [logout]);

    const settingsInitialized = useRef(false);
    useEffect(() => {
        // Fetch settings on mount or when token changes
        // But skip if we already have settings in localStorage and it's just the initial mount
        const hasSettings = Object.keys(settings).length > 0;

        if (!hasSettings || settingsInitialized.current) {
            refreshSettings();
        }

        settingsInitialized.current = true;
    }, [token, refreshSettings]);

    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 5000);
    }, []);

    const removeToast = (id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };


    const apiFetch = useCallback(async (url: string, init?: RequestInit & { skipToast?: boolean }): Promise<Response> => {
        const headers = new Headers(init?.headers);
        const currentToken = getCookie('auth_token') || token;

        if (currentToken && currentToken !== "cookie_managed" && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${currentToken}`);
        }

        const fetchInit: RequestInit = {
            ...init,
            headers,
            credentials: 'include', // Ensure cookies are sent (especially auth_token)
        };

        const response = await fetch(url, fetchInit);

        if (!response.ok) {
            if (response.status === 401) {
                setToken(null);
                setUser(null);
                setSettings({});
                localStorage.removeItem('auth_user');
                localStorage.removeItem('auth_settings');
                return response;
            }

            // Only show toast if skipToast is NOT explicitly set to true
            const shouldSkipToast = init && (init as any).skipToast === true;
            if (!shouldSkipToast) {
                const data = await response.clone().json().catch(() => ({}));
                showToast(data.error || data.message || `Error: ${response.status} ${response.statusText}`, 'error');
            }
        }

        return response;
    }, [token, showToast]);

    const hasPermission = useCallback((type: string, action: string, resourceId: string | null = null, namespaceId: string | null = null, tagIds: string[] = []): boolean => {
        if (!user || !user.username) return false;
        // Superadmin is carried by the is_super_admin flag on the account — not by username
        // and not by role name (mirrors the backend's domain.IsSuperAdmin).
        if (user.is_super_admin) return true;

        const allPerms = user.roles?.flatMap(role => role.permissions || []) || [];

        // 1. Item Level: Direct permission on this specific resource ID
        if (resourceId) {
            const hasItemPerm = allPerms.some((rp: any) => {
                const perm = rp.permission;
                return perm && perm.type === type && perm.action === action && rp.resource_id === resourceId;
            });
            if (hasItemPerm) return true;
        }

        // 2. Resource Level (Global): Permission on the resource type without a specific ID
        const hasGlobalPerm = allPerms.some((rp: any) => {
            const perm = rp.permission;
            return perm && perm.type === type && perm.action === action && !rp.resource_id;
        });
        if (hasGlobalPerm) return true;

        // If generic check (no resourceId), and we haven't found a global match, 
        // we still return true if ANY matching permission exists.
        // If namespaceId is provided, we prioritize matches within that namespace.
        if (!resourceId) {
            const hasAnyMatch = allPerms.some((rp: any) => {
                const perm = rp.permission;
                if (!perm) return false;

                // 1. Direct type/action match (Global or any specific item)
                if (perm.type === type && perm.action === action) return true;

                // 2. Hierarchical match via Namespace
                if (perm.type === 'namespaces' && perm.action === `RESOURCE_${action}`) {
                    // Global namespace permission or specifically for the active namespace
                    if (!rp.resource_id || (namespaceId && rp.resource_id === namespaceId)) {
                        if (NAMESPACE_SCOPED_RESOURCES.includes(type)) {
                            return true;
                        }
                    }
                }

                // 3. Hierarchical match via Tag
                if (perm.type === 'tags' && perm.action === `RESOURCE_${action}`) {
                    // Only allow tag permissions to reveal menu items for resources that actually support tags
                    // Prevent tag permissions from exposing global resources like servers, vpns, users, etc.
                    // TAGGABLE_RESOURCES is configured in src/config/permissions.ts
                    if (TAGGABLE_RESOURCES.includes(type)) {
                        return true;
                    }
                }

                return false;
            });
            if (hasAnyMatch) return true;
        }

        // 3. Tag Level: Permission via RESOURCE_* on associated tags
        if (tagIds.length > 0) {
            const hasTagPerm = allPerms.some((rp: any) => {
                const perm = rp.permission;
                return perm && perm.type === 'tags' && perm.action === `RESOURCE_${action}` && rp.resource_id && tagIds.includes(rp.resource_id);
            });
            if (hasTagPerm) return true;
        }

        // 4. Namespace Level: Permission via RESOURCE_* on the parent namespace
        if (namespaceId) {
            const hasNamespacePerm = allPerms.some((rp: any) => {
                const perm = rp.permission;
                return perm && perm.type === 'namespaces' && perm.action === `RESOURCE_${action}` && rp.resource_id === namespaceId;
            });
            if (hasNamespacePerm && NAMESPACE_SCOPED_RESOURCES.includes(type)) return true;
        }

        return false;
    }, [user]);

    return (
        <AuthContext.Provider value={{ user, token, login, logout, isLoading, isAuthenticated: !!token && !isLoading, settings, refreshSettings, apiFetch, hasPermission, showToast, updateUser, refreshUser }}>
            {children}
            {/* Custom Toast Container */}
            <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none w-full max-w-sm">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className={cn(
                            "pointer-events-auto flex items-start gap-4 p-4 rounded-md border shadow-2xl animate-in slide-in-from-right-full duration-500 text-white",
                            t.type === 'error' ? "bg-red-500 border-red-600" :
                                t.type === 'success' ? "bg-emerald-500 border-emerald-600" :
                                    "bg-indigo-500 border-indigo-600"
                        )}
                    >
                        <div className="mt-0.5">
                            {t.type === 'error' ? <XCircle className="h-5 w-5" /> :
                                t.type === 'success' ? <CheckCircle className="h-5 w-5" /> :
                                    <Info className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 space-y-1">
                            <p className="text-xs font-black uppercase tracking-widest opacity-60">
                                {t.type === 'error' ? 'System Error' : t.type === 'success' ? 'Success' : 'Notification'}
                            </p>
                            <p className="text-sm font-bold leading-relaxed">{t.message}</p>
                        </div>
                        <button
                            onClick={() => removeToast(t.id)}
                            className="text-white/60 hover:text-white transition-colors p-1"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};
