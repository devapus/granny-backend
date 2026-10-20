/**
 * Normalize default imports from packages that ship dual CJS/ESM builds.
 * Vercel's TypeScript checker sometimes types those defaults as a non-callable module namespace.
 */
export function asCallable<T extends (...args: never[]) => unknown>(mod: unknown, label: string): T {
  if (typeof mod === 'function') return mod as T;
  if (mod && typeof mod === 'object' && 'default' in mod) {
    const inner = (mod as { default: unknown }).default;
    if (typeof inner === 'function') return inner as T;
  }
  throw new Error(`${label} export is not callable`);
}
