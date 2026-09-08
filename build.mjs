import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const js = await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  write: false,
  legalComments: 'none',
});
const css = readFileSync('src/ui/styles.css', 'utf8');
const tpl = readFileSync('src/index.html', 'utf8');
const out = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>'));
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', out);
console.log('built dist/index.html', (out.length / 1024).toFixed(1), 'KB');
