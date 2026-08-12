import type { PageWidget } from '../types';

// "Updated" badge shown on public page widgets. A defined `updated_until` (even '') means
// the author enabled the badge in the designer; the badge only renders while the reference
// date — the server's calendar date, see Page.server_time — is on or before it.

export const DEFAULT_UPDATED_LABEL = 'Updated';

export const isUpdatedBadgeVisible = (widget: PageWidget, today: string): boolean =>
    !!widget.updated_until && today <= widget.updated_until;

// Local calendar date as YYYY-MM-DD. Only used when a page response carried no
// server_time, so the badge still behaves sanely on an older API.
export const localDate = (): string => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
