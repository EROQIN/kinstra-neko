import { defineConfig } from 'tsdown'

// host 半边打进 lib/index.js（ESM）；浏览器半边（DSH client 插件）打进 lib/client.js，
// 必须包 DSH 的 ModuleLoader banner/footer，格式 cjs（与 dsh-superagent 一致）。
export default defineConfig([
  {
    entry: { index: 'src/host.ts' },
    outDir: 'lib',
    format: 'esm',
    fixedExtension: false,
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    deps: { neverBundle: [/^@deepseek-ai\//, 'zod'] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "kinstra-neko", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
