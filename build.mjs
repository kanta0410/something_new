import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

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

// PWA: public/ をコピー。service worker にビルドハッシュを焼き込む（更新のたびにキャッシュが入れ替わる）。
const buildId = createHash('sha1').update(out).digest('hex').slice(0, 10);
for (const f of readdirSync('public')) {
  if (f === 'sw.js') writeFileSync('dist/sw.js', readFileSync('public/sw.js', 'utf8').replace('__BUILD__', buildId));
  else copyFileSync(`public/${f}`, `dist/${f}`);
}
writeFileSync('dist/.nojekyll', '');
console.log('pwa assets copied, build', buildId);

// Artifact 用: ホストが <!doctype html><html><head>…</head><body> を付けるので、ラッパーを剥がした断片も出力する。
const fragment = out
  .replace(/<!doctype[^>]*>/i, '')
  .replace(/<html[^>]*>/i, '')
  .replace(/<\/html>/i, '')
  .replace(/<head>|<\/head>/gi, '')
  .replace(/<body[^>]*>|<\/body>/gi, '')
  .replace(/<meta[^>]*charset[^>]*>/i, '')
  .replace(/<meta[^>]*viewport[^>]*>/i, '')
  .replace(/<meta[^>]*theme-color[^>]*>/i, '')
  .replace(/<link[^>]*(manifest|apple-touch-icon|icon)[^>]*>/gi, '')
  .replace(/<script id="sw">[\s\S]*?<\/script>/i, '')
  .trim();
writeFileSync('dist/artifact.html', fragment);
console.log('built dist/artifact.html', (fragment.length / 1024).toFixed(1), 'KB');
