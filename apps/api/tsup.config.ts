import { defineConfig } from 'tsup';

// Bundle the API with the workspace packages (which ship TypeScript source) into dist/.
export default defineConfig({
  // The seed ships too, so a server can load the catalog: node dist/seed.js
  entry: { server: 'src/server.ts', seed: 'src/scripts/seed.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  noExternal: [/^@farmgo\//],
  banner: {
    // Some CommonJS dependencies call require(); provide it inside the ESM bundle.
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
