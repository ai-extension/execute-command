import { MultiInputItem } from '../types';
import { generateUUID } from './utils';

// A multi-input's field definitions live in its `default_value`, either as a JSON array
// of MultiInputItem (current format) or as a legacy comma-separated list of keys. Both
// the row renderer and the run-dialog validation read them, so the parsing lives here.
// Read-only: unlike the designer's editor this never backfills missing ids in place.
export const parseMultiInputConfig = (defaultValue: string): MultiInputItem[] => {
    try {
        const parsed = JSON.parse(defaultValue || '[]');
        if (!Array.isArray(parsed)) throw new Error('not an array');
        return parsed as MultiInputItem[];
    } catch {
        return (defaultValue || '').split(',').map(k => ({
            id: generateUUID(),
            key: k.trim(),
            label: k.trim(),
            type: 'input' as const,
        })).filter(c => c.key);
    }
};
