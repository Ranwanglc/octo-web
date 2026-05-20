// Production stub for vitest — prevents test framework from leaking into bundle
// Why: packages/dmworkbase/src/Utils/__tests__/*.test.ts live inside src/ and
// get pulled into the Vite build graph. Their `import { describe } from 'vitest'`
// and bare `describe()` calls would crash at runtime without this stub.

/* eslint-disable @typescript-eslint/no-explicit-any */
const noop: any = (...args: any[]) => {
  // If called like describe('name', fn), just call fn to avoid blocking
  const fn = args.find(a => typeof a === 'function')
  if (fn) try { fn() } catch { /* swallow test errors in prod */ }
}

const noopProxy: any = new Proxy(noop, {
  get: () => noop,
  apply: (_t, _this, args) => {
    const fn = args.find((a: any) => typeof a === 'function')
    if (fn) try { fn() } catch { /* swallow */ }
  },
})

export const vi = noopProxy
export const expect = () => noopProxy
export const describe = noop
export const it = noop
export const test = noop
export const beforeEach = noop
export const afterEach = noop
export const beforeAll = noop
export const afterAll = noop
export const suite = noop
export const bench = noop
export const assert = noopProxy

// Also set as globals in case test files use bare describe() without import
if (typeof globalThis !== 'undefined') {
  const g = globalThis as any
  if (!g.describe) g.describe = noop
  if (!g.it) g.it = noop
  if (!g.test) g.test = noop
  if (!g.expect) g.expect = () => noopProxy
  if (!g.beforeEach) g.beforeEach = noop
  if (!g.afterEach) g.afterEach = noop
  if (!g.beforeAll) g.beforeAll = noop
  if (!g.afterAll) g.afterAll = noop
  if (!g.vi) g.vi = noopProxy
}

export default {}
