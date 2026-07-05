import { defineConfig } from 'vitest/config';

// Deliberately no `plugins: [react()]` here (unlike vite.config.ts) -- vitest 3.x's own internal
// `vite` peer resolves to a different installed vite version than this package's direct `vite`
// dependency (both satisfy their respective semver ranges independently under pnpm), which makes
// `@vitejs/plugin-react`'s `Plugin` type (built against the direct `vite`) structurally
// incompatible with vitest/config's `PluginOption` type (built against its own internal `vite`) --
// a real, if noisy, type-level version-skew artifact, not a functional problem. Test files don't
// need react-refresh/HMR; vitest's own esbuild-based transform already handles JSX in .tsx test
// files per this package's tsconfig `jsx: "react-jsx"` setting, so no plugin is needed here at all.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
