/**
 * Bundled snippets stay grouped by category for UI discovery, but their JSON is
 * loaded lazily only when selected. localStorage is reserved for user-authored
 * snippets and legacy compatibility filtering.
 */

type SnippetModule = { default?: unknown } | unknown;
type SnippetModuleLoader = () => Promise<SnippetModule>;
type SnippetStorageLike = Pick<Storage, 'getItem' | 'removeItem'>;
type SnippetData = Record<string, unknown>;

export type SnippetCategoryKey =
  | 'emotionAnimationsList'
  | 'speakingAnimationsList'
  | 'visemeAnimationsList'
  | 'eyeHeadTrackingAnimationsList';

interface SnippetCategory {
  listKey: SnippetCategoryKey;
  modules: Record<string, SnippetModuleLoader>;
}

interface BundledSnippetEntry {
  name: string;
  load: SnippetModuleLoader;
}

interface BundledSnippetCategory extends SnippetCategory {
  entries: BundledSnippetEntry[];
}

type BundledSnippetManifest = Partial<Record<SnippetCategoryKey, string[]>>;

export interface ResolvedSnippetEntry {
  name: string;
  data: SnippetData;
  source: 'bundled' | 'localStorage';
  storageKey: string;
}

const BUNDLED_SNIPPET_VERSION_KEY = 'bundledAnimationSnippetsVersion';
const BUNDLED_SNIPPET_MANIFEST_KEY = 'bundledAnimationSnippetsManifest';

// Keep these lazy so bundled snippet JSON is only loaded when selected.
const emotionSnippets = import.meta.glob('./snippets/emotion/*.json') as Record<string, SnippetModuleLoader>;
const speakingSnippets = import.meta.glob('./snippets/speaking/*.json') as Record<string, SnippetModuleLoader>;
const visemeSnippets = import.meta.glob('./snippets/visemes/*.json') as Record<string, SnippetModuleLoader>;
const eyeHeadTrackingSnippets = import.meta.glob('./snippets/eyeHeadTracking/*.json') as Record<string, SnippetModuleLoader>;

const CATEGORIES: SnippetCategory[] = [
  { listKey: 'emotionAnimationsList', modules: emotionSnippets },
  { listKey: 'speakingAnimationsList', modules: speakingSnippets },
  { listKey: 'visemeAnimationsList', modules: visemeSnippets },
  { listKey: 'eyeHeadTrackingAnimationsList', modules: eyeHeadTrackingSnippets },
];

function extractName(filePath: string): string {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace('.json', '');
}

function normalizeSnippetData(moduleData: SnippetModule): SnippetData | null {
  const snippetData = (moduleData as { default?: unknown }).default ?? moduleData;
  if (!snippetData || typeof snippetData !== 'object' || Array.isArray(snippetData)) {
    return null;
  }
  return snippetData as SnippetData;
}

function buildBundledCatalog(): BundledSnippetCategory[] {
  return CATEGORIES.map((category) => {
    const entries = Object.entries(category.modules)
      .map(([filePath, load]) => ({
        name: extractName(filePath),
        load,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      ...category,
      entries,
    };
  });
}

const BUNDLED_SNIPPET_CATALOG = buildBundledCatalog();

function getStorage(storage?: SnippetStorageLike): SnippetStorageLike | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function parseManifest(raw: string | null): BundledSnippetManifest {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return CATEGORIES.reduce<BundledSnippetManifest>((manifest, category) => {
      const names = parsed[category.listKey];
      manifest[category.listKey] = Array.isArray(names)
        ? names.filter((value): value is string => typeof value === 'string')
        : [];
      return manifest;
    }, {});
  } catch {
    return {};
  }
}

function getLegacyManagedNames(listKey: SnippetCategoryKey, storage?: SnippetStorageLike): string[] {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return [];
  const manifest = parseManifest(resolvedStorage.getItem(BUNDLED_SNIPPET_MANIFEST_KEY));
  return manifest[listKey] ?? [];
}

function getCategory(listKey: SnippetCategoryKey): BundledSnippetCategory {
  const category = BUNDLED_SNIPPET_CATALOG.find((item) => item.listKey === listKey);
  if (!category) {
    throw new Error(`Unknown snippet category: ${listKey}`);
  }
  return category;
}

export function getBundledSnippetNames(listKey: SnippetCategoryKey): string[] {
  return getCategory(listKey).entries.map((entry) => entry.name);
}

async function getBundledSnippet(listKey: SnippetCategoryKey, name: string): Promise<SnippetData | null> {
  const entry = getCategory(listKey).entries.find((item) => item.name === name);
  if (!entry) return null;

  const moduleData = await entry.load();
  return normalizeSnippetData(moduleData);
}

export function getStoredSnippetNames(listKey: SnippetCategoryKey, storage?: SnippetStorageLike): string[] {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return [];

  const legacyManaged = new Set(getLegacyManagedNames(listKey, resolvedStorage));
  return parseStringArray(resolvedStorage.getItem(listKey))
    .filter((name) => !legacyManaged.has(name));
}

export function getAvailableSnippetNames(listKey: SnippetCategoryKey, storage?: SnippetStorageLike): string[] {
  const names = [...getBundledSnippetNames(listKey)];
  const seen = new Set(names);

  for (const storedName of getStoredSnippetNames(listKey, storage)) {
    if (seen.has(storedName)) continue;
    seen.add(storedName);
    names.push(storedName);
  }

  return names;
}

export async function resolveSnippetEntry(
  listKey: SnippetCategoryKey,
  name: string,
  storage?: SnippetStorageLike,
): Promise<ResolvedSnippetEntry | null> {
  const storageKey = `${listKey}/${name}`;
  const resolvedStorage = getStorage(storage);
  const legacyManaged = new Set(getLegacyManagedNames(listKey, resolvedStorage ?? undefined));
  const storedData = legacyManaged.has(name)
    ? null
    : resolvedStorage?.getItem(storageKey);

  if (storedData) {
    try {
      const parsed = JSON.parse(storedData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          name: typeof (parsed as { name?: unknown }).name === 'string'
            ? (parsed as { name: string }).name
            : name,
          data: parsed as SnippetData,
          source: 'localStorage',
          storageKey,
        };
      }
    } catch {}
  }

  const bundledSnippet = await getBundledSnippet(listKey, name);
  if (!bundledSnippet) return null;

  return {
    name: typeof bundledSnippet.name === 'string' ? bundledSnippet.name : name,
    data: bundledSnippet,
    source: 'bundled',
    storageKey,
  };
}

/**
 * Legacy compatibility shim. Bundled snippets are no longer mirrored into
 * localStorage during startup.
 */
export function preloadAllSnippets(): void {}

/**
 * Removes legacy bundled snippet cache markers from older app versions without
 * touching user-authored snippets.
 */
export function clearPreloadedSnippets(storage?: SnippetStorageLike): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  const manifest = parseManifest(resolvedStorage.getItem(BUNDLED_SNIPPET_MANIFEST_KEY));
  for (const [listKey, managedNames] of Object.entries(manifest) as Array<[SnippetCategoryKey, string[]]>) {
    for (const name of managedNames) {
      resolvedStorage.removeItem(`${listKey}/${name}`);
    }
  }

  resolvedStorage.removeItem(BUNDLED_SNIPPET_MANIFEST_KEY);
  resolvedStorage.removeItem(BUNDLED_SNIPPET_VERSION_KEY);
}
