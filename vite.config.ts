import { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodeModules = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
].flat();

export default defineConfig({
  resolve: {
    conditions: ['node', 'default'],
  },
  build: {
    sourcemap: false,
    target: 'esnext',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: [
        ...nodeModules,
        'bufferutil',
        'utf-8-validate',
      ],
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
      defaultIsModuleExports: true,
    },
  },
  plugins: [nodeResolve()],
});
