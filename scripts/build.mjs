import { copyFile, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
// An explicit list keeps backend code, tests, Git files, and secrets out of hosting.
const assets = [
  'index.html', 'styles.css', 'ui.js', 'placement.js', 'players.js', 'storage.js',
  'import-ui.js', 'lastwar-api.js', 'roster-cache.js', 'reorder-ui.js',
  'placement-messages.js', 'free-formation.js', 'tile-placement.js', 'grid-layout.js', 'lifebloom-zombie.png',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(assets.map(file => copyFile(new URL(file, root), new URL(file, output))));
console.log(`Prepared ${assets.length} BaseGrid assets for Cloudflare.`);
