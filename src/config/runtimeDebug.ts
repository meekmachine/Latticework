export function isRuntimeDebugEnabled() {
  const importMetaEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
  const processEnv =
    typeof process !== 'undefined'
      ? ((process as unknown as { env?: Record<string, string | undefined> }).env ?? {})
      : {};

  return (
    importMetaEnv.MODE === 'development' ||
    importMetaEnv.VITE_ENABLE_RUNTIME_DEBUG === 'true' ||
    processEnv.NODE_ENV === 'development' ||
    processEnv.VITE_ENABLE_RUNTIME_DEBUG === 'true'
  );
}
