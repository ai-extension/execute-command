import { useState, useEffect } from 'react';
import { Tag as TagIcon, Search } from 'lucide-react';
import { Button } from './ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Tag } from '../types';
import { useAuth } from '../context/AuthContext';
import { useNamespace } from '../context/NamespaceContext';
import { API_BASE_URL } from '../lib/api';
import { cn } from '../lib/utils';

interface TagSelectorProps {
    selectedTags: Tag[];
    onChange: (tags: Tag[]) => void;
    className?: string;
}

export function TagSelector({ selectedTags, onChange, className }: TagSelectorProps) {
    const { apiFetch } = useAuth();
    const { activeNamespace } = useNamespace();
    const [availableTags, setAvailableTags] = useState<Tag[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!activeNamespace) return;
        if (!open) return;

        const controller = new AbortController();
        const timeout = setTimeout(async () => {
            setIsLoading(true);
            try {
                const params = new URLSearchParams({ limit: '50' });
                const q = searchQuery.trim();
                if (q) params.set('search', q);
                const response = await apiFetch(
                    `${API_BASE_URL}/namespaces/${activeNamespace.id}/tags?${params.toString()}`,
                    { signal: controller.signal }
                );
                const data = await response.json();
                setAvailableTags(data.items || (Array.isArray(data) ? data : []));
            } catch (error: any) {
                if (error?.name !== 'AbortError') {
                    console.error('Failed to fetch tags:', error);
                }
            } finally {
                setIsLoading(false);
            }
        }, searchQuery ? 250 : 0);

        return () => {
            clearTimeout(timeout);
            controller.abort();
        };
    }, [activeNamespace, apiFetch, open, searchQuery]);

    const toggleTag = (tag: Tag) => {
        const isSelected = selectedTags.some(t => t.id === tag.id);
        if (isSelected) {
            onChange(selectedTags.filter(t => t.id !== tag.id));
        } else {
            onChange([...selectedTags, tag]);
        }
    };

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) setSearchQuery('');
    };

    return (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    className={cn("justify-start h-auto min-h-[40px] px-3 py-2 w-full flex-wrap gap-2 text-left font-normal bg-muted/30 border-border rounded-md", className)}
                >
                    {selectedTags.length > 0 ? (
                        selectedTags.map(tag => (
                            <Badge
                                key={tag.id}
                                variant="outline"
                                className="h-6 text-[10px] font-black"
                                style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}
                            >
                                {tag.name}
                            </Badge>
                        ))
                    ) : (
                        <div className="flex items-center gap-2 text-muted-foreground opacity-70">
                            <TagIcon className="w-4 h-4" />
                            <span className="text-xs font-bold tracking-tight">Select Tags</span>
                        </div>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                className="bg-card border-border shadow-xl z-[400] p-1.5 min-w-[200px]"
                style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}
                align="start"
            >
                <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wider opacity-60">Tags</DropdownMenuLabel>
                <div className="px-1 pb-1.5">
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60" />
                        <Input
                            autoFocus
                            placeholder="Search tags..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className="pl-7 h-7 text-xs bg-muted border-none rounded-md focus-visible:ring-primary/20"
                        />
                    </div>
                </div>
                <DropdownMenuSeparator />
                {isLoading ? (
                    <div className="p-2 text-center text-xs text-muted-foreground">Loading...</div>
                ) : availableTags.length > 0 ? (
                    availableTags.map(tag => {
                        const isSelected = selectedTags.some(t => t.id === tag.id);
                        return (
                            <DropdownMenuCheckboxItem
                                key={tag.id}
                                checked={isSelected}
                                onCheckedChange={() => toggleTag(tag)}
                                onSelect={(e) => e.preventDefault()}
                                className="gap-2 cursor-pointer font-medium"
                            >
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                                {tag.name}
                            </DropdownMenuCheckboxItem>
                        );
                    })
                ) : (
                    <div className="p-2 text-center text-xs text-muted-foreground">
                        {searchQuery.trim() ? 'No matching tags' : 'No tags available'}
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
