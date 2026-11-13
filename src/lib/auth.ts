import { isEmail, toIntlPhone } from './utils';

/**
 * How a phone number becomes a Supabase identity.
 *  - 'phone' (default): native Supabase phone + password. Enable Phone provider and TURN OFF phone confirmations.
 *  - 'alias': fallback if the dashboard insists on an SMS provider: the number becomes `<number>@<VITE_AUTH_EMAIL_DOMAIN>`.
 *    The domain MUST be one you own (never gmail.com etc: whoever owns that mailbox could take the account over by "reset password").
 */
export type AuthMode = 'phone' | 'alias';
export const AUTH_MODE: AuthMode = import.meta.env.VITE_AUTH_MODE === 'alias' ? 'alias' : 'phone';
export const ALIAS_DOMAIN = ((import.meta.env.VITE_AUTH_EMAIL_DOMAIN as string | undefined) || '').trim().toLowerCase();
export const SUPPORT_WHATSAPP = toIntlPhone((import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) || '');

export type Identity = { email: string } | { phone: string };

/** What the person typed at sign-in -> the credential Supabase expects. A typed email still works (accounts made before phone login). */
export function identityFor(input: string, mode: AuthMode = AUTH_MODE, domain: string = ALIAS_DOMAIN): Identity | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.includes('@')) return isEmail(raw.toLowerCase()) ? { email: raw.toLowerCase() } : null;
  const intl = toIntlPhone(raw);
  if (!intl) return null;
  if (mode === 'alias') return domain ? { email: `${intl}@${domain}` } : null;
  return { phone: `+${intl}` };
}
