import React, { useRef, useState } from 'react';
import { Input } from './ui/input';
import { cn } from '../lib/utils';
import { Calendar, Clock } from 'lucide-react';

// Date / time input used by workflow inputs of type `date` (optionally with time)
// and `time`. The visible field is plain text so any value can be typed or pasted
// as one string (a native date field only takes digits per segment); the browser's
// own picker is opened from a hidden native control — by the icon, or by the click
// that focuses the field. Clicks while the field already has focus only move the
// caret, so an in-progress edit is never interrupted.
//
// showPicker() is what opens that hidden control, so where it is missing or refuses to
// run the field falls back to the plain native control (which carries its own picker
// indicator) instead of leaving the icon dead.
//
// Value format (what the workflow receives, matches the backend validation):
//   date            → YYYY-MM-DD
//   date + time     → YYYY-MM-DDTHH:MM
//   time            → HH:MM

export type DateTimeMode = 'date' | 'datetime' | 'time';

const NATIVE_TYPE: Record<DateTimeMode, string> = {
    date: 'date',
    datetime: 'datetime-local',
    time: 'time',
};

export const DATE_TIME_PLACEHOLDER: Record<DateTimeMode, string> = {
    date: 'YYYY-MM-DD',
    datetime: 'YYYY-MM-DDTHH:MM',
    time: 'HH:MM',
};

const PATTERN: Record<DateTimeMode, RegExp> = {
    date: /^\d{4}-\d{2}-\d{2}$/,
    // A hand-typed or API value may use a space separator and/or seconds; the picker
    // never produces those, but they must not be treated as corrupt either.
    datetime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/,
    time: /^\d{2}:\d{2}(:\d{2})?$/,
};

export const getDateTimeMode = (type: string, includeTime?: boolean): DateTimeMode =>
    type === 'time' ? 'time' : (includeTime ? 'datetime' : 'date');

// True when the value is a well-formed real date/time for that mode. Empty values are
// left to the caller (required-check).
export const isValidDateTimeValue = (mode: DateTimeMode, value: string): boolean => {
    const val = (value || '').trim();
    if (!PATTERN[mode].test(val)) return false;
    if (mode === 'time') {
        const [h, m, s] = val.split(':').map(Number);
        return h <= 23 && m <= 59 && (s === undefined || s <= 59);
    }
    const [datePart, timePart] = val.split(/[T ]/);
    const [y, mo, d] = datePart.split('-').map(Number);
    // setUTCFullYear (not the Date constructor) so years 0-99 are not remapped to 1900-1999,
    // which would reject a value the backend accepts.
    const dt = new Date(0);
    dt.setUTCFullYear(y, mo - 1, d);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
    if (mode === 'datetime') {
        const [h, mi, s] = (timePart || '').split(':').map(Number);
        return h <= 23 && mi <= 59 && (s === undefined || s <= 59);
    }
    return true;
};

// Convert a value between the `date` and `datetime` formats so toggling "include time"
// in the designer keeps the day the user already picked instead of discarding it.
export const convertDateTimeValue = (value: string, to: DateTimeMode): string => {
    const val = (value || '').trim();
    if (!val) return '';
    const [datePart, timePart] = val.split(/[T ]/);
    if (to === 'datetime') {
        if (!isValidDateTimeValue('date', datePart)) return '';
        return `${datePart}T${timePart && /^\d{2}:\d{2}/.test(timePart) ? timePart.slice(0, 5) : '00:00'}`;
    }
    if (to === 'date') {
        return isValidDateTimeValue('date', datePart) ? datePart : '';
    }
    return val;
};

// The native picker only accepts its own strict format: a valid value carrying seconds
// or a space separator is narrowed down to it, anything else leaves the picker unset.
const toNativeValue = (mode: DateTimeMode, value: string): string => {
    const val = (value || '').trim();
    if (!isValidDateTimeValue(mode, val)) return '';
    if (mode === 'datetime') return val.replace(' ', 'T').slice(0, 16);
    if (mode === 'time') return val.slice(0, 5);
    return val;
};

interface DateTimeInputProps {
    mode: DateTimeMode;
    value: string;
    onChange: (value: string) => void;
    hasError?: boolean;
    className?: string;
    disabled?: boolean;
}

export const DateTimeInput: React.FC<DateTimeInputProps> = ({
    mode,
    value,
    onChange,
    hasError = false,
    className,
    disabled = false,
}) => {
    const nativeRef = useRef<HTMLInputElement>(null);
    // Set while the field is being focused so only that first click opens the picker.
    const justFocused = useRef(false);
    // Browsers without showPicker() cannot open a hidden control at all, so they start on
    // the native field; a showPicker() that throws switches to it at that point.
    const [pickerUnavailable, setPickerUnavailable] = useState(
        typeof HTMLInputElement === 'undefined' || typeof HTMLInputElement.prototype.showPicker !== 'function'
    );
    const Icon = mode === 'time' ? Clock : Calendar;
    const pickLabel = `Pick ${mode === 'time' ? 'a time' : mode === 'datetime' ? 'a date and time' : 'a date'}`;

    const fieldCls = cn(
        'h-9 pl-3 bg-background focus:border-indigo-500 text-xs font-semibold rounded-md transition-all',
        hasError ? 'border-destructive' : 'border-border',
        className
    );

    const openPicker = () => {
        const el = nativeRef.current;
        if (!el || disabled) return;
        try {
            (el as HTMLInputElement & { showPicker: () => void }).showPicker();
        } catch {
            setPickerUnavailable(true);
        }
    };

    if (pickerUnavailable) {
        // Native control: its own indicator opens the picker, and the value it produces is
        // always one of the accepted formats. Free-form typing is lost here, so a value it
        // cannot render is kept editable as text rather than silently dropped.
        const nativeValue = toNativeValue(mode, value);
        if (!(value || '').trim() || nativeValue) {
            return (
                <Input
                    type={NATIVE_TYPE[mode]}
                    value={nativeValue}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className={cn(fieldCls, 'pr-3')}
                />
            );
        }
    }

    return (
        <div className="relative">
            <Input
                type="text"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                placeholder={DATE_TIME_PLACEHOLDER[mode]}
                // Open the picker on the click that focuses the field; once focused, a
                // click just moves the caret so typing is never cut off (the icon
                // re-opens the picker on demand).
                onClick={() => {
                    if (!justFocused.current) return;
                    justFocused.current = false;
                    openPicker();
                }}
                onFocus={() => { justFocused.current = true; }}
                onBlur={() => { justFocused.current = false; }}
                className={cn(fieldCls, 'pr-9')}
            />
            <button
                type="button"
                // Don't take focus from the text field: after picking (or dismissing) the
                // picker the caret must still be in the field, otherwise keystrokes would
                // land on this button and be lost.
                onMouseDown={(e) => e.preventDefault()}
                onClick={openPicker}
                disabled={disabled}
                title={pickLabel}
                aria-label={pickLabel}
                className="absolute right-0 top-0 h-full w-9 flex items-center justify-center text-muted-foreground hover:text-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Icon className="w-3.5 h-3.5" />
            </button>
            {/* Hidden native control: only used to render the browser picker. It sits under
                the icon (not display:none) because a hidden input cannot open a picker. */}
            <input
                ref={nativeRef}
                type={NATIVE_TYPE[mode]}
                tabIndex={-1}
                aria-hidden="true"
                value={toNativeValue(mode, value)}
                // Fires only on a real interaction with the picker, so an empty value means
                // the user cleared it there — pass it through instead of keeping a stale value.
                onChange={(e) => onChange(e.target.value)}
                className="absolute right-0 top-0 h-full w-9 opacity-0 pointer-events-none"
            />
        </div>
    );
};
