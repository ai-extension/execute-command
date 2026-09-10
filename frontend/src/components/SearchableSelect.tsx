import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

export interface SelectOption {
    label: string;
    value: string;
    searchTerms?: string;
}

interface SearchableSelectProps {
    options: SelectOption[];
    value: string | string[];
    onValueChange: (value: any) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    isSearchable?: boolean;
    onSearch?: (query: string) => void;
    type?: 'single' | 'multi';
    className?: string;
    triggerClassName?: string;
    width?: string;
    disabled?: boolean;
}

export const SearchableSelect = ({
    options,
    value,
    onValueChange,
    placeholder = "Select option...",
    searchPlaceholder = "Filter...",
    isSearchable = false,
    onSearch,
    type = 'single',
    className,
    triggerClassName,
    width = "w-full",
    disabled = false
}: SearchableSelectProps) => {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchTimeoutRef = useRef<any>(null);

    const handleSearch = (query: string) => {
        setSearchQuery(query);
        if (onSearch) {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = setTimeout(() => {
                onSearch(query);
            }, 300);
        }
    };

    const getFilteredOptions = () => {
        if (!isSearchable || !searchQuery) return options;
        const query = searchQuery.toLowerCase().trim();
        return options.filter(opt =>
            opt.label.toLowerCase().includes(query) ||
            opt.value.toLowerCase().includes(query) ||
            (opt.searchTerms && opt.searchTerms.toLowerCase().includes(query))
        );
    };

    const toggleMultiValue = (val: string) => {
        const currentValues = Array.isArray(value) ? [...value] : [];
        const index = currentValues.indexOf(val);
        if (index > -1) {
            currentValues.splice(index, 1);
        } else {
            currentValues.push(val);
        }
        onValueChange(currentValues);
    };

    const getSelectedLabel = () => {
        if (type === 'multi') {
            const vals = Array.isArray(value) ? value : [];
            if (vals.length === 0) return placeholder;
            if (vals.length <= 2) {
                return options
                    .filter(opt => vals.includes(opt.value))
                    .map(opt => opt.label)
                    .join(', ');
            }
            return `${vals.length} selected`;
        }

        const selected = options.find(opt => opt.value === value);
        return selected ? selected.label : placeholder;
    };

    const filteredOptions = getFilteredOptions();

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        "justify-between bg-background border-border font-medium px-3 h-9",
                        width,
                        triggerClassName
                    )}
                >
                    <span className="truncate mr-2 uppercase tracking-tight text-[10px]">
                        {getSelectedLabel()}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
                <DropdownMenuContent
                    className={cn(
                        "z-[400] bg-popover text-popover-foreground backdrop-blur-md border-border/60 shadow-xl rounded-md p-1.5",
                        "min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[400px] w-auto",
                        className
                    )}
                    align="start"
                >
                    {isSearchable && (
                        <div className="px-1.5 pb-1.5">
                            <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                                <Input
                                    placeholder={searchPlaceholder}
                                    autoFocus
                                    value={searchQuery}
                                    onChange={(e) => handleSearch(e.target.value)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    className="pl-7 h-7 text-[10px] bg-muted border-none rounded-md focus-visible:ring-primary/20"
                                />
                            </div>
                        </div>
                    )}

                    <DropdownMenuSeparator className="bg-border/50" />

                    <div className="py-0.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option) => {
                                const isActive = type === 'multi'
                                    ? Array.isArray(value) && value.includes(option.value)
                                    : value === option.value;

                                return (
                                    <DropdownMenuItem
                                        key={option.value}
                                        onSelect={(e) => {
                                            if (type === 'multi') {
                                                e.preventDefault();
                                                toggleMultiValue(option.value);
                                            } else {
                                                onValueChange(option.value);
                                                setOpen(false);
                                            }
                                        }}
                                        className={cn(
                                            "px-2.5 py-2 rounded-md cursor-pointer flex items-center justify-between mb-0.5 last:mb-0 font-bold text-[10px] uppercase tracking-wide transition-all duration-150",
                                            isActive
                                                ? "bg-primary/15 text-primary"
                                                : "text-popover-foreground/70 hover:bg-muted hover:text-popover-foreground"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "w-1.5 h-1.5 rounded-full transition-all duration-300",
                                                isActive ? "bg-primary shadow-[0_0_6px_rgba(99,102,241,0.6)] scale-125" : "bg-muted-foreground/30"
                                            )} />
                                            <span>{option.label}</span>
                                        </div>
                                        {isActive && (
                                            <Check className="w-3 h-3 shrink-0" />
                                        )}
                                    </DropdownMenuItem>
                                );
                            })
                        ) : (
                            <div className="py-6 px-2 text-center">
                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                                    No matching results
                                </p>
                            </div>
                        )}
                    </div>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenu>
    );
};
