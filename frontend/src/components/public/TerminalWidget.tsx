import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, ChevronDown, Maximize2 } from 'lucide-react';
import { WidgetIcon } from '../../lib/widgetIcons';
import { cn } from '../../lib/utils';
import { PageWidget } from '../../types';
import { API_BASE_URL } from '../../lib/api';
import AnsiText from '../AnsiText';

interface TerminalWidgetProps {
    widget: PageWidget;
    slug: string;
    pageToken?: string | null;
}

const TerminalWidget: React.FC<TerminalWidgetProps> = ({ widget, slug, pageToken }) => {
    const [lines, setLines] = useState<string[]>(['Connecting...']);
    const [isLoading, setIsLoading] = useState(true);
    const [isLive, setIsLive] = useState(false);
    const [widgetState, setWidgetState] = useState<'normal' | 'minimized' | 'maximized'>('normal');
    const [isVisible, setIsVisible] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);


    useEffect(() => {
        if (!isVisible) return;

        const isRealtime = widget.reload_interval === 'realtime';

        if (isRealtime) {
            // Use WebSocket for realtime streaming mode
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let baseUrl = API_BASE_URL;
            if (baseUrl.startsWith('/')) {
                baseUrl = `${window.location.host}${baseUrl}`;
            } else {
                baseUrl = baseUrl.replace(/^http(s)?:\/\//, '');
            }

            // Connect with widget_id to trigger the backend streaming loop
            const token = localStorage.getItem('token');
            const wsUrl = `${protocol}//${baseUrl}/ws?token=${pageToken || ''}&slug=${slug || ''}&widget_id=${widget.id}&auth_token=${token || ''}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => setIsLive(true);
            ws.onclose = () => setIsLive(false);
            ws.onerror = () => setIsLive(false);

            ws.onmessage = (ev) => {
                try {
                    const data = JSON.parse(ev.data);
                    if (data.type === 'widget_stream_start') {
                        setLines([]); // Clear existing
                        setIsLoading(true);
                        setTimeout(() => setIsLoading(false), 200);
                    } else if (data.type === 'widget_output') {
                        const chunk: string = data.content || '';
                        setLines(prev => {
                            if (prev.length === 0) {
                                return chunk.split('\n');
                            }
                            // Append chunk to the last line, then split by newline to handle new lines in chunk
                            const lastLine = prev[prev.length - 1];
                            const combined = lastLine + chunk;
                            const newLines = combined.split('\n');

                            return [...prev.slice(0, prev.length - 1), ...newLines];
                        });
                    }
                } catch { }
            };

            return () => {
                ws.close();
                wsRef.current = null;
                setIsLive(false);
            };
        }
    }, [widget.reload_interval, isVisible, slug, pageToken, widget.id]);

    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [lines, widgetState]); // Changed dependency from output to lines

    if (!isVisible) return null;

    return (
        <div className={cn(
            "bg-[#0a0b0e] border border-white/10 rounded-md overflow-hidden shadow-2xl transition-all duration-300 group hover:border-emerald-500/30",
            widgetState === 'maximized' ? "fixed inset-8 z-[120] w-auto h-auto" : "w-full",
            widgetState === 'minimized' ? "h-[54px]" : ""
        )}>
            <div className="flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="flex gap-1 mr-2">
                        <button
                            onClick={() => setIsVisible(false)}
                            className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e] hover:bg-[#ff5f56]/80 transition-all flex items-center justify-center group/btn cursor-pointer"
                        >
                            <X className="w-1.5 h-1.5 text-black opacity-0 group-hover/btn:opacity-100" />
                        </button>
                        <button
                            onClick={() => setWidgetState(widgetState === 'minimized' ? 'normal' : 'minimized')}
                            className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123] hover:bg-[#ffbd2e]/80 transition-all flex items-center justify-center group/btn cursor-pointer"
                        >
                            <ChevronDown className="w-1.5 h-1.5 text-black opacity-0 group-hover/btn:opacity-100" />
                        </button>
                        <button
                            onClick={() => setWidgetState(widgetState === 'maximized' ? 'normal' : 'maximized')}
                            className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29] hover:bg-[#27c93f]/80 transition-all flex items-center justify-center group/btn cursor-pointer"
                        >
                            <Maximize2 className="w-1.5 h-1.5 text-black opacity-0 group-hover/btn:opacity-100" />
                        </button>
                    </div>
                    <WidgetIcon name={widget.icon} fallback={Terminal} className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-sm font-mono font-black text-zinc-100 uppercase tracking-[0.2em]">{widget.title}</span>
                </div>
            </div>
            {widgetState !== 'minimized' && (
                <>
                    <div ref={scrollRef} className={cn(
                        "p-8 font-mono text-sm leading-relaxed text-slate-200 overflow-y-auto overflow-x-auto whitespace-pre scrollbar-thin selection:bg-emerald-500/40 selection:text-white",
                        widgetState === 'maximized' ? "h-[calc(100vh-250px)]" : "min-h-[250px] max-h-[500px]"
                    )}>
                        {lines.map((l: string, i: number) => (
                            <div key={i} className="whitespace-pre-wrap min-h-[1.2rem]">
                                <AnsiText text={l} />
                            </div>
                        ))}
                    </div>
                    <div className="px-8 py-4 bg-black/40 border-t border-white/5 text-xs font-mono text-zinc-400 truncate opacity-60 group-hover:opacity-100 transition-opacity uppercase tracking-[0.1em]">
                        <span className="text-emerald-500 font-bold mr-2">$ exec</span> {widget.command}
                    </div>
                </>
            )}
        </div>
    );
};

export default TerminalWidget;
