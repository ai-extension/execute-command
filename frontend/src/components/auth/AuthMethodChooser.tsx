import React from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { ArrowRight, KeyRound } from 'lucide-react';

interface AuthMethodChooserProps {
    googleEnabled: boolean;
    googleClientId: string;
    facebookEnabled: boolean;
    onGoogleCredential: (credential?: string) => void;
    onGoogleError: () => void;
    onFacebook: () => void;
    onUseAccount: () => void;
    disabled?: boolean;
}

const rowClass =
    'w-full flex items-center gap-4 p-4 rounded-md bg-white/[0.03] border border-white/10 text-left ' +
    'hover:bg-white/[0.06] hover:border-primary/40 active:scale-[0.99] transition-all duration-300 group ' +
    'disabled:opacity-50 disabled:pointer-events-none';

/**
 * The sign-in methods a visitor can pick from. Google renders its own button because
 * Google Identity Services will not accept a click synthesised from custom markup.
 */
export const AuthMethodChooser: React.FC<AuthMethodChooserProps> = ({
    googleEnabled,
    googleClientId,
    facebookEnabled,
    onGoogleCredential,
    onGoogleError,
    onFacebook,
    onUseAccount,
    disabled
}) => (
    <div className="space-y-3">
        {googleEnabled && googleClientId && (
            <div className="rounded-md bg-white/[0.03] border border-white/10 p-2 flex justify-center transition-all duration-300 hover:border-primary/40">
                <GoogleOAuthProvider clientId={googleClientId}>
                    <div className="[color-scheme:light]">
                        <GoogleLogin
                            onSuccess={(response) => onGoogleCredential(response.credential)}
                            onError={onGoogleError}
                            theme="filled_black"
                            shape="pill"
                            text="continue_with"
                            width="300"
                        />
                    </div>
                </GoogleOAuthProvider>
            </div>
        )}

        {facebookEnabled && (
            <button type="button" onClick={onFacebook} disabled={disabled} className={rowClass}>
                <span className="flex items-center justify-center w-10 h-10 rounded-md bg-[#1877F2]/10 border border-[#1877F2]/20 shrink-0 transition-transform duration-300 group-hover:scale-110">
                    <svg className="w-5 h-5 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                </span>
                <span className="flex-1 text-sm font-bold text-white/90">Continue with Facebook</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </button>
        )}

        <button type="button" onClick={onUseAccount} disabled={disabled} className={rowClass}>
            <span className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 border border-primary/20 shrink-0 transition-transform duration-300 group-hover:scale-110">
                <KeyRound className="w-5 h-5 text-primary" />
            </span>
            <span className="flex-1 text-sm font-bold text-white/90">Continue with account</span>
            <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all" />
        </button>
    </div>
);

export default AuthMethodChooser;
