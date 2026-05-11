/**
 * Enable Node's built-in source-maps support so `Error.stack` reports original `.ts` (or any
 * pre-compile) paths instead of the bundled `.js` filename + line we'd otherwise see in the
 * Argus UI. Internally this calls `process.setSourceMapsEnabled(true)`, which has been stable
 * since Node 16.6 — a single setting flipped process-wide.
 *
 * Equivalent to launching the app with `node --enable-source-maps`. The SDK opts in only when
 * the user asks for it because source-map resolution adds non-trivial CPU overhead on every
 * thrown error (parsing the .map file the first time it's needed for a given file).
 */
export function enableSourceMaps(): void {
  if (typeof process.setSourceMapsEnabled === 'function') {
    process.setSourceMapsEnabled(true);
  }
}

/**
 * Returns whether source-maps are currently enabled. Useful for tests; not part of the public API.
 * Falls back to `false` when the runtime predates the API.
 */
export function isSourceMapsEnabled(): boolean {
  if (typeof process.sourceMapsEnabled === 'boolean') {
    return process.sourceMapsEnabled;
  }
  return false;
}
