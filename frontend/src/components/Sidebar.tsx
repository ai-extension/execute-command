import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Terminal, Settings, Box, ChevronsLeft, ChevronsRight, Zap, LogOut, Users, Shield, Server, Network, History, Globe, Calendar, Tag, Layout, ShieldCheck, Table2 } from 'lucide-react';
import { cn } from '../lib/utils';
import AppLogo from './AppLogo';
import { Button } from './ui/button';
import { useAuth } from '../context/AuthContext';

import NamespaceSwitcher from './NamespaceSwitcher';
import { useNamespace } from '../context/NamespaceContext';

interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (value: boolean) => void;
}

const Sidebar = ({ isCollapsed, setIsCollapsed }: SidebarProps) => {
    const { logout, user, hasPermission, settings } = useAuth();
    const { activeNamespace } = useNamespace();
    const navigate = useNavigate();

    const siteTitle = settings.site_title || "CSM APP";
    const siteLogo = settings.site_logo;

    const globalNavItems: { name: string; path: string; icon: React.ElementType; type: string }[] = [];

    // Main namespace items shown first.
    const namespaceNavItems = [
        { name: 'Dashboard', path: '/', icon: LayoutDashboard, type: 'dashboard' },
        { name: 'Workflows', path: '/workflows', icon: Zap, type: 'workflows' },
        { name: 'History', path: '/history', icon: History, type: 'history' },
        { name: 'Variables', path: '/variables', icon: Globe, type: 'variables' },
        { name: 'Datasets', path: '/datasets', icon: Table2, type: 'datasets' },
        { name: 'Tags', path: '/tags', icon: Tag, type: 'tags' },
        { name: 'Schedules', path: '/schedules', icon: Calendar, type: 'schedules' },
        { name: 'Pages', path: '/pages', icon: Layout, type: 'pages' },
    ].filter(item => hasPermission(item.type, 'READ', null, activeNamespace?.id));

    // Infrastructure items pinned to the bottom of the Operational group — visually
    // separated so workflow-facing entries aren't lost among server / network plumbing.
    const infrastructureNavItems = [
        { name: 'Servers', path: '/servers', icon: Server, type: 'servers' },
        { name: 'VPN Configs', path: '/vpns', icon: Network, type: 'vpns' },
    ].filter(item => hasPermission(item.type, 'READ', null, activeNamespace?.id));

    const identityItems = [
        { name: 'Users', path: '/users', icon: Users, type: 'users' },
        { name: 'Roles', path: '/roles', icon: Shield, type: 'roles' },
        { name: 'Audit Logs', path: '/audit-logs', icon: ShieldCheck, type: 'audit_logs' },
    ].filter(item => hasPermission(item.type, 'READ'));

    const systemItems = [
        { name: 'Settings', path: '/settings', icon: Settings, type: 'settings' },
    ].filter(item => hasPermission(item.type, 'READ'));

    const renderNavLink = (item: { name: string; path: string; icon: React.ElementType }, opts?: { indent?: boolean }) => (
        <NavLink
            key={item.name}
            to={item.path}
            title={isCollapsed ? item.name : ""}
            className={({ isActive }) =>
                cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md transition-all duration-300 group relative overflow-hidden",
                    isActive
                        ? "bg-primary text-white shadow-premium scale-[1.02]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground hover:translate-x-1",
                    isCollapsed && "justify-center px-0 h-11 w-11 mx-auto",
                    opts?.indent && !isCollapsed && "ml-2"
                )
            }
        >
            <item.icon className={cn("w-4 h-4 transition-transform duration-300 group-hover:scale-110 shrink-0")} />
            {!isCollapsed && (
                <span className="text-sm font-semibold tracking-tight animate-in fade-in slide-in-from-left-1 duration-300">{item.name}</span>
            )}
            {!isCollapsed && (
                <div className="absolute right-3 opacity-20 group-hover:opacity-100 transition-opacity">
                    <Zap className="w-3 h-3 fill-current" />
                </div>
            )}
        </NavLink>
    );

    return (
        <aside
            className={cn(
                "bg-[var(--sidebar-bg)] border-r border-border h-screen sticky top-0 shrink-0 z-40 flex flex-col transition-all duration-500 shadow-sidebar overflow-hidden",
                isCollapsed ? "w-20 p-3 items-center gap-6" : "w-72 p-4 gap-6"
            )}
        >
            <div className={cn("flex items-center gap-2.5 px-1 relative w-full mb-2", isCollapsed && "justify-center px-0")}>
                <AppLogo src={siteLogo} size="sm" className="shrink-0 transition-transform duration-300 hover:scale-105" />
                {!isCollapsed && (
                    <div className="flex flex-col animate-in fade-in slide-in-from-left-2 duration-500">
                        <span className="text-lg font-black tracking-tighter leading-none truncate max-w-[180px]">{siteTitle}</span>
                        <span className="text-[10px] font-bold text-primary tracking-[0.2em] uppercase mt-0.5 opacity-80">Execution Engine</span>
                    </div>
                )}
            </div>

            <NamespaceSwitcher isCollapsed={isCollapsed} />

            <div className="flex-1 flex flex-col gap-6 w-full overflow-y-auto py-4">

                {/* Namespace-scoped items */}
                {(namespaceNavItems.length > 0 || infrastructureNavItems.length > 0) && (
                    <div className="w-full">
                        {!isCollapsed && (
                            <div className="flex items-center gap-1.5 px-4 mb-2 mt-1">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/50">Operational</span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                        )}
                        <nav className="flex flex-col gap-1.5 w-full pl-0">
                            {namespaceNavItems.map((item) => renderNavLink(item, { indent: false }))}
                        </nav>
                        {infrastructureNavItems.length > 0 && (
                            <>
                                {namespaceNavItems.length > 0 && (
                                    <div className={cn("my-3", isCollapsed ? "mx-2 h-px bg-border/40" : "mx-4 h-px bg-border/40")} />
                                )}
                                <nav className="flex flex-col gap-1.5 w-full pl-0">
                                    {infrastructureNavItems.map((item) => renderNavLink(item, { indent: false }))}
                                </nav>
                            </>
                        )}
                    </div>
                )}

                {/* Global items */}
                {globalNavItems.length > 0 && (
                    <div className="w-full">
                        {!isCollapsed && (
                            <div className="flex items-center gap-1.5 px-4 mb-2">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Global</span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                        )}
                        <nav className="flex flex-col gap-1.5 w-full">
                            {globalNavItems.map((item) => renderNavLink(item))}
                        </nav>
                    </div>
                )}

                {/* Identity items */}
                {identityItems.length > 0 && (
                    <div className="w-full">
                        {!isCollapsed && (
                            <div className="flex items-center gap-1.5 px-4 mb-2">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">Identity</span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                        )}
                        <nav className="flex flex-col gap-1.5 w-full">
                            {identityItems.map((item) => renderNavLink(item))}
                        </nav>
                    </div>
                )}

                {/* System items */}
                {systemItems.length > 0 && (
                    <div className="w-full">
                        {!isCollapsed && (
                            <div className="flex items-center gap-1.5 px-4 mb-2">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">System</span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                        )}
                        <nav className="flex flex-col gap-1.5 w-full">
                            {systemItems.map((item) => renderNavLink(item))}
                        </nav>
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2 w-full mt-auto pt-4 border-t border-border">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className={cn(
                        "h-10 w-10 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-all duration-300 mx-auto",
                        !isCollapsed && "w-full gap-2 px-4 justify-start h-9"
                    )}
                >
                    {isCollapsed ? (
                        <ChevronsRight className="w-5 h-5" />
                    ) : (
                        <>
                            <ChevronsLeft className="w-5 h-5" />
                            <span className="text-xs font-black uppercase tracking-widest">Collapse Sidebar</span>
                        </>
                    )}
                </Button>
            </div>
        </aside>
    );
};

export default Sidebar;
