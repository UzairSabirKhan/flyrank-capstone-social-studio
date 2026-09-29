import { describe, it, expect } from 'vitest';
import { assertPublicUrl, UnsafeUrlError } from '../src/lib/ssrf';

describe('assertPublicUrl', () => {
  it.each([
    'http://127.0.0.1/',
    'http://localhost/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://2130706433/', // decimal form of 127.0.0.1
    'file:///etc/passwd',
    'ftp://example.com/',
    'not a url',
  ])('rejects %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
