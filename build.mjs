import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const workspaceRoot = dirname(projectRoot);
const srcHtml = join(projectRoot, 'src', 'index.html');
const srcJs = join(projectRoot, 'src', 'app.js');
const distHtml = join(projectRoot, 'dist', 'text-transfer.html');
const docsHtml = join(projectRoot, 'docs', 'index.html');
const rootHtml = join(workspaceRoot, 'text-transfer.html');

const jsBuild = await build({
  entryPoints: [srcJs],
  bundle: true,
  format: 'iife',
  minify: false,
  write: false,
  target: ['es2020', 'safari15'],
});

const js = jsBuild.outputFiles[0].text.replace('</script>', '<\\/script>');
const html = readFileSync(srcHtml, 'utf8').replace('__APP_JS__', js);

mkdirSync(join(projectRoot, 'dist'), { recursive: true });
mkdirSync(join(projectRoot, 'docs'), { recursive: true });
writeFileSync(distHtml, html);
writeFileSync(docsHtml, html);
writeFileSync(rootHtml, html);
console.log(`Built ${distHtml}`);
console.log(`Published ${docsHtml}`);
console.log(`Copied ${rootHtml}`);
