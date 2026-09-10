import React, { useState, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { useNavigate } from 'react-router-dom';
import { Layout, Plus, Search, MoreVertical, Edit2, Trash2, Globe, Lock, ChevronRight, ExternalLink, Copy, AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { cn, copyToClipboard } from '../lib/utils';
import { Page, Tag } from '../types';
import { useNamespace } from '../context/NamespaceContext';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../lib/api';
import { Pagination } from '../components/Pagination';
import { ResourceFilters } from '../components/ResourceFilters';
import { ConfirmDialog } from '../components/ConfirmDialog';
import TemplateSelectionDialog from '../components/TemplateSelectionDialog';
import { PageTemplate } from '../lib/pageTemplates';
import { useUsers } from '../hooks/useUsers';

const PagesListPage = () => {
    const navigate = useNavigate();
    const { activeNamespace } = useNamespace();
    const { apiFetch, showToast } = useAuth();

    const [pages, setPages] = useState<Page[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = usePersistentState('pages_search', '');
    const [visibilityFilter, setVisibilityFilter] = usePersistentState<string>('pages_visibility', 'ALL');
    const [selectedTagIds, setSelectedTagIds] = usePersistentState<string[]>('pages_tags', []);
    const [availableTags, setAvailableTags] = useState<Tag[]>([]);
    const [selectedCreatedBy, setSelectedCreatedBy] = usePersistentState<string | undefined>('pages_createdBy', undefined);
    const { users: availableUsers, fetchUsers } = useUsers();

    const [limit, setLimit] = useState(15);
    const [offset, setOffset] = useState(0);

    // Template dialog state
    const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<Page | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchPages = async () => {
        if (!activeNamespace) return;
        setIsLoading(true);
        setError(null);
        try {
            let url = `${API_BASE_URL}/namespaces/${activeNamespace.id}/pages?limit=${limit}&offset=${offset}`;
            if (visibilityFilter === 'PUBLIC') {
                url += `&is_public=true`;
            } else if (visibilityFilter === 'PRIVATE') {
                url += `&is_public=false`;
            }
            if (selectedCreatedBy) url += `&created_by=${selectedCreatedBy}`;
            if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
            if (selectedTagIds.length > 0) {
                selectedTagIds.forEach(id => {
                    url += `&tag_ids=${id}`;
                });
            }

            const response = await apiFetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch pages: ${response.statusText}`);
            }
            const data = await response.json();
            setPages(data.items || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.error('Failed to fetch pages:', error);
            setError(error instanceof Error ? error.message : 'Failed to load pages');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchTags = async (search?: string) => {
        if (!activeNamespace) return;
        try {
            let url = `${API_BASE_URL}/namespaces/${activeNamespace.id}/tags?limit=15`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            const response = await apiFetch(url);
            const data = await response.json();
            setAvailableTags(data.items || (Array.isArray(data) ? data : []));
        } catch (error) {
            console.error('Failed to fetch tags:', error);
        }
    };

    useEffect(() => {
        if (activeNamespace) {
            fetchPages();
            fetchTags();
        }
    }, [activeNamespace, offset, limit, searchQuery, visibilityFilter, selectedCreatedBy, selectedTagIds]);

    const handleApplyFilter = (search: string, filters: { [key: string]: any }) => {
        setSearchQuery(search);
        setVisibilityFilter(filters.visibility || 'ALL');
        setSelectedTagIds(filters.tags || []);
        setSelectedCreatedBy(filters.createdBy);
        setOffset(0);
    };

    const handleCreatePage = () => {
        setIsTemplateDialogOpen(true);
    };

    // The public link is what gets pasted into chat or a ticket, so it is worth one click
    // from the list rather than opening the page first.
    const handleCopyPublicLink = async (slug: string) => {
        const url = `${window.location.origin}/public/pages/${slug}`;
        const copied = await copyToClipboard(url);
        showToast(copied ? 'Public link copied' : 'Could not copy the link', copied ? 'success' : 'error');
    };

    const handleCreateFromTemplate = async (title: string, slug: string, template: PageTemplate) => {
        if (!activeNamespace) return;
        setIsCreating(true);

        const newPage: Partial<Page> = {
            title,
            description: '',
            slug,
            is_public: false,
            layout: JSON.stringify(template.layout),
            workflows: []
        };

        try {
            const response = await apiFetch(`${API_BASE_URL}/namespaces/${activeNamespace.id}/pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newPage)
            });
            const data = await response.json();
            if (response.ok) {
                setIsTemplateDialogOpen(false);
                navigate(`/pages/${data.id}/edit`);
            }
        } catch (error) {
            console.error('Failed to create page:', error);
        } finally {
            setIsCreating(false);
        }
    };

    const handleDeletePage = (page: Page) => {
        setDeleteTarget(page);
    };

    const confirmDeletePage = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);

        try {
            const response = await apiFetch(`${API_BASE_URL}/pages/${deleteTarget.id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                setPages(pages.filter(p => p.id !== deleteTarget.id));
                setTotal(prev => prev - 1);
            }
        } catch (error) {
            console.error('Failed to delete page:', error);
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    };

    return (
        <div className="flex flex-col h-full space-y-5 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Layout className="w-3.5 h-3.5 text-primary" />
                    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em]">
                        <span className="text-primary">Automations</span>
                        <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                        <span className="text-muted-foreground font-black">Pages</span>
                    </div>
                </div>
                <Button
                    onClick={handleCreatePage}
                    className="h-8 px-4 rounded-md premium-gradient font-black uppercase tracking-widest text-[10px] shadow-premium hover:shadow-indigo-500/25 transition-all gap-2"
                >
                    <Plus className="w-3.5 h-3.5" />
                    New Page
                </Button>
            </div>

            <ResourceFilters
                searchTerm={searchQuery}
                onSearchChange={setSearchQuery}
                onApply={handleApplyFilter}
                filters={{ visibility: visibilityFilter, createdBy: selectedCreatedBy, tags: selectedTagIds }}
                filterConfigs={[
                    {
                        key: 'visibility',
                        placeholder: 'VISIBILITY',
                        options: [
                            { label: 'ALL VISIBILITY', value: 'ALL' },
                            { label: 'PUBLIC ONLY', value: 'PUBLIC' },
                            { label: 'PRIVATE ONLY', value: 'PRIVATE' }
                        ],
                        width: 'w-40',
                        isSearchable: true
                    },
                    {
                        key: 'createdBy',
                        placeholder: 'CREATED BY',
                        type: 'single',
                        isSearchable: true,
                        onSearch: (query: string) => fetchUsers(query),
                        options: [
                            { label: 'ALL CREATORS', value: '' },
                            ...availableUsers.map(u => ({ label: u.username.toUpperCase(), value: u.id }))
                        ],
                        width: 'w-48'
                    },
                    {
                        key: 'tags',
                        placeholder: 'TAGS',
                        type: 'multi',
                        isSearchable: true,
                        isNewLine: false,
                        onSearch: (query: string) => fetchTags(query),
                        options: availableTags.map(t => ({ label: t.name.toUpperCase(), value: t.id })),
                        width: 'w-48'
                    }
                ]}
                searchPlaceholder="Search pages by title or slug..."
                isLoading={isLoading}
                onReset={() => {
                    setSearchQuery('');
                    setVisibilityFilter('ALL');
                    setSelectedTagIds([]);
                    setSelectedCreatedBy(undefined);
                }}
                primaryAction={null}
            />

            {isLoading && pages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center italic text-muted-foreground opacity-50">
                    Loading your interfaces...
                </div>
            ) : error ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 p-12 border-2 border-dashed border-destructive/20 rounded-md bg-destructive/5 animate-in fade-in zoom-in-95 duration-500">
                    <div className="p-4 rounded-md bg-destructive/10 text-destructive">
                        <AlertTriangle className="w-10 h-10" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-xl font-black tracking-tight uppercase">Connection Interrupted</h3>
                        <p className="text-sm text-muted-foreground font-medium max-w-xs mx-auto">
                            {error}
                        </p>
                    </div>
                    <Button
                        onClick={() => fetchPages()}
                        variant="outline"
                        className="rounded-md px-8 h-9 font-bold uppercase tracking-widest text-xs border-destructive/20 hover:bg-destructive/10"
                    >
                        Retry Connection
                    </Button>
                </div>
            ) : pages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-50 border-2 border-dashed border-border rounded-md bg-card">
                    <Layout className="w-12 h-12 text-muted-foreground" />
                    <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">No pages found</p>
                    <Button onClick={handleCreatePage} variant="outline" className="rounded-md px-6">Create your first page</Button>
                </div>
            ) : (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {pages.map(page => (
                            <div key={page.id} className="group bg-card border border-border rounded-md p-5 hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-primary/5 relative overflow-hidden flex flex-col min-h-[220px]">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex flex-col gap-1">
                                        <h3
                                            onClick={() => navigate(`/pages/${page.id}/edit`)}
                                            className="text-lg font-bold hover:text-primary transition-colors line-clamp-1 cursor-pointer"
                                            title="Open page"
                                        >{page.title}</h3>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px] font-mono py-0 h-5 lowercase bg-muted/50">
                                                /{page.slug}
                                            </Badge>
                                            {page.is_public ? (
                                                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] font-bold uppercase py-0 h-5">
                                                    <Globe className="w-3 h-3 mr-1" /> Public
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] font-bold uppercase py-0 h-5">
                                                    <Lock className="w-3 h-3 mr-1" /> Private
                                                </Badge>
                                            )}
                                        </div>
                                        {page.tags && page.tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1.5 px-0.5">
                                                {page.tags.map(tag => (
                                                    <span
                                                        key={tag.id}
                                                        className="px-1.5 py-0.5 rounded text-[10px] font-bold border"
                                                        style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}
                                                    >
                                                        {tag.name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => navigate(`/pages/${page.id}/edit`)}>
                                            <Edit2 className="w-4 h-4 text-muted-foreground" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md hover:text-destructive" onClick={() => handleDeletePage(page)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                <p className="text-sm text-muted-foreground line-clamp-2 mb-6 flex-1">
                                    {page.description || 'No description provided.'}
                                </p>

                                <div className="mt-auto flex items-center justify-between pt-4 border-t border-border/50">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                            {page.workflows?.length || 0} Workflows
                                        </span>
                                        {page.created_by_username && (
                                            <div className="flex items-center gap-1.5 grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100 transition-all">
                                                <div className="h-4 w-4 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black text-primary uppercase">
                                                    {page.created_by_username[0]}
                                                </div>
                                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">{page.created_by_username}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            title="Copy public link"
                                            className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest rounded-md"
                                            onClick={() => handleCopyPublicLink(page.slug)}
                                        >
                                            <Copy className="w-3 h-3" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            title="Open public page"
                                            className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest rounded-md"
                                            onClick={() => window.open(`/public/pages/${page.slug}`, '_blank')}
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                        </Button>
                                        <Button
                                            className="px-4 h-8 text-[10px] font-bold uppercase tracking-widest rounded-md premium-gradient text-white"
                                            onClick={() => navigate(`/pages/${page.id}/edit`)}
                                        >
                                            Design <ChevronRight className="w-3 h-3 ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Pagination
                        total={total}
                        offset={offset}
                        limit={limit}
                        itemName="Pages"
                        onPageChange={setOffset}
                    />
                </div>
            )}

            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDeletePage}
                title="Delete Page"
                description={`Are you sure you want to delete "${deleteTarget?.title}"? All design data and components will be permanently removed.`}
                confirmText="Delete Page"
                variant="danger"
                isLoading={isDeleting}
            />

            <TemplateSelectionDialog
                isOpen={isTemplateDialogOpen}
                onClose={() => setIsTemplateDialogOpen(false)}
                onCreate={handleCreateFromTemplate}
                isCreating={isCreating}
            />
        </div>
    );
};

export default PagesListPage;
