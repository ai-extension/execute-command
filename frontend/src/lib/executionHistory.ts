export interface ExecutionHistoryEntry {
    executionId: string;
    widgetId: string;
    workflowId?: string;
    inputs: Record<string, string>;
    status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | string;
    timestamp: number;
    /** Display name of whoever launched the run; absent for anonymous visitors. */
    executedBy?: string;
}

const MAX_ENTRIES_PER_WIDGET = 10;

const storageKey = (slug: string) => `page-exec-history:${slug}`;

export type HistoryMap = Record<string, ExecutionHistoryEntry[]>;

export const loadHistory = (slug: string): HistoryMap => {
    if (!slug) return {};
    try {
        const raw = localStorage.getItem(storageKey(slug));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

export const saveHistory = (slug: string, map: HistoryMap) => {
    if (!slug) return;
    try {
        localStorage.setItem(storageKey(slug), JSON.stringify(map));
    } catch {
        // quota / serialization errors ignored
    }
};

export const appendEntry = (map: HistoryMap, entry: ExecutionHistoryEntry): HistoryMap => {
    const list = map[entry.widgetId] || [];
    const filtered = list.filter(e => e.executionId !== entry.executionId);
    const next = [entry, ...filtered].slice(0, MAX_ENTRIES_PER_WIDGET);
    return { ...map, [entry.widgetId]: next };
};

export const updateEntryStatus = (
    map: HistoryMap,
    widgetId: string,
    executionId: string,
    status: ExecutionHistoryEntry['status'],
    executedBy?: string
): HistoryMap => {
    const list = map[widgetId];
    if (!list) return map;
    let changed = false;
    const next = list.map(e => {
        if (e.executionId !== executionId) return e;
        // History lives in this browser, so a run started elsewhere only learns its
        // runner when the server reports it back here.
        const nextExecutedBy = executedBy || e.executedBy;
        if (e.status === status && nextExecutedBy === e.executedBy) return e;
        changed = true;
        return { ...e, status, executedBy: nextExecutedBy };
    });
    if (!changed) return map;
    return { ...map, [widgetId]: next };
};

export const removeEntry = (map: HistoryMap, widgetId: string, executionId: string): HistoryMap => {
    const list = map[widgetId];
    if (!list) return map;
    const next = list.filter(e => e.executionId !== executionId);
    return { ...map, [widgetId]: next };
};
