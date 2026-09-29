import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  return (
    s === '::1' ||
    s === '::' ||
    s.startsWith('::ffff:') ||
    s.startsWith('fc') ||
    s.startsWith('fd') ||
    s.startsWith('fe80')
  );
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs are allowed');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError('Host could not be resolved');
  }

  for (const { address } of addresses) {
    const isPrivate = isIP(address) === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) throw new UnsafeUrlError('URL points to a non-public address');
  }
  return url;
}
