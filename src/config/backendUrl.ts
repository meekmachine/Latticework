const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const normalizeBaseUrl = (value: string | undefined) => (value || '').trim().replace(/\/+$/, '');
const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

const explicitBackendBase = normalizeBaseUrl(env.VITE_API_BASE || env.VITE_BACKEND_URL || '');
const explicitCharacterAssetBase = normalizeBaseUrl(env.VITE_CHARACTER_ASSET_BASE_URL || '');

export const IS_LOCALHOST =
  typeof window !== 'undefined' && LOCALHOST_HOSTS.has(window.location.hostname);

export const BACKEND_CONFIG_ERROR =
  explicitBackendBase || IS_LOCALHOST
    ? null
    : 'VITE_API_BASE is required in production. Deploy the backend separately; Firebase Hosting no longer proxies /api.';

export const BACKEND_BASE_URL =
  explicitBackendBase ||
  (typeof window !== 'undefined' && IS_LOCALHOST ? normalizeBaseUrl(window.location.origin) : '');

export const CHARACTER_ASSET_BASE_URL =
  explicitCharacterAssetBase || (explicitBackendBase ? `${explicitBackendBase}/assets` : '');

export function requireBackendBaseUrl(): string {
  if (!BACKEND_BASE_URL) {
    throw new Error(BACKEND_CONFIG_ERROR || 'Backend base URL is not configured.');
  }
  return BACKEND_BASE_URL;
}

export function withBackendApi(path: string): string {
  return `${requireBackendBaseUrl()}${normalizePath(path)}`;
}

export function withBackendAsset(path: string): string {
  const normalized = normalizePath(path);

  if (explicitBackendBase) {
    return `${requireBackendBaseUrl()}${normalized}`;
  }

  return normalized;
}

export function withCharacterAsset(path: string): string {
  const normalized = normalizePath(path);

  if (CHARACTER_ASSET_BASE_URL) {
    return `${CHARACTER_ASSET_BASE_URL}${normalized}`;
  }

  return withBackendAsset(path);
}

export function withBackendWs(path: string): string {
  return `${requireBackendBaseUrl().replace(/^http/i, 'ws')}${normalizePath(path)}`;
}
