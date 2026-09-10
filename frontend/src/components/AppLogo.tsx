import React, { useId } from 'react';
import { cn } from '../lib/utils';

type AppLogoSize = 'sm' | 'md' | 'lg';

interface AppLogoProps {
    /** Uploaded site logo, if the workspace configured one. */
    src?: string;
    size?: AppLogoSize;
    className?: string;
}

const markSize: Record<AppLogoSize, string> = {
    sm: 'w-7 h-7',
    md: 'w-10 h-10',
    lg: 'w-14 h-14'
};

/**
 * The app's brand mark, drawn straight onto the page. It used to sit inside a solid
 * violet tile, which flattened the icon and tinted every uploaded logo placed on it, so
 * there is no plate and no accent colour here — a custom logo keeps its own colours.
 */
export const AppLogo: React.FC<AppLogoProps> = ({ src, size = 'md', className }) => {
    // Two logos on one screen would otherwise share a gradient id and one would lose it.
    const gradientId = `app-logo-gradient-${useId()}`;

    if (src) {
        return <img src={src} alt="Logo" className={cn('object-contain', markSize[size], className)} />;
    }

    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(markSize[size], className)}
        >
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#9ca3af" />
                </linearGradient>
            </defs>
            <path d="M13 2 L4.6 13.2 a1 1 0 0 0 .8 1.6 h5.2 l-0.6 7.2 8.4-11.2 a1 1 0 0 0-.8-1.6 h-5.2 z" />
        </svg>
    );
};

export default AppLogo;
