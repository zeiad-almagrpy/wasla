import { describe, expect, it } from 'vitest';
import { identityFor } from '../src/lib/auth';

describe('phone → Supabase identity', () => {
  it('native phone mode: local, intl and Arabic-digit numbers all map to the same E.164', () => {
    for (const raw of ['01012345678', '+20 101 234 5678', '201012345678', '٠١٠١٢٣٤٥٦٧٨', ' 0101-234-5678 ']) expect(identityFor(raw, 'phone')).toEqual({ phone: '+201012345678' });
  });
  it('rejects things that are not a phone number', () => { for (const raw of ['', '   ', '123', 'abc', '0101234']) expect(identityFor(raw, 'phone')).toBeNull(); });
  it('a typed email still works (accounts created before phone sign-in)', () => {
    expect(identityFor('Old.User@Gmail.com', 'phone')).toEqual({ email: 'old.user@gmail.com' });
    expect(identityFor('not@valid', 'phone')).toBeNull();
  });
  it('alias mode: number becomes an address on YOUR domain; refuses to guess without a domain', () => {
    expect(identityFor('01012345678', 'alias', 'phone.wesla.example')).toEqual({ email: '201012345678@phone.wesla.example' });
    expect(identityFor('01012345678', 'alias', '')).toBeNull();
  });
});
