// Builds the unpacked extension into dist/.
//   node scripts/build.mjs           one-off build
//   node scripts/build.mjs --watch   rebuild on change
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  target: 'chrome128',
  sourcemap: 'linked',
  logLevel: 'info',
  legalComments: 'none',
  minify: !watch,
};

const contexts = await Promise.all([
  // Content scripts must be classic scripts: bundle as an IIFE.
  esbuild.context({ ...shared, entryPoints: { content: 'src/content/content.js' }, format: 'iife', outdir }),
  esbuild.context({
    ...shared,
    entryPoints: { background: 'src/background/service-worker.js', 'sidepanel/sidepanel': 'src/sidepanel/sidepanel.js' },
    format: 'esm',
    outdir,
  }),
]);

async function copyStatic() {
  await cp('static/manifest.json', `${outdir}/manifest.json`);
  await cp('icons', `${outdir}/icons`, { recursive: true });
  await cp('src/sidepanel/sidepanel.html', `${outdir}/sidepanel/sidepanel.html`);
  await cp('src/sidepanel/sidepanel.css', `${outdir}/sidepanel/sidepanel.css`);
}

if (watch) {
  await copyStatic();
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Watching for changes… (static files are copied at start only)');
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
  await copyStatic();
  console.log(`Built ${outdir}/ — load it at chrome://extensions → Load unpacked`);
}
