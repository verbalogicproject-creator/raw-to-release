#!/usr/bin/env node
/** Offline, deterministic package and shipped-bundle inspection. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const bundlePath = resolve(root, 'plugins/raw-to-release/skills/raw-to-release/bin/r2rctl.mjs');
const bundle = await readFile(bundlePath, 'utf8');
const forbidden = [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, /(?:api[_-]?key|password|secret)\s*[=:]\s*["'][^"']+/i, /\/Users\//, /\/home\/[A-Za-z0-9._-]+\//, /node_modules\//];
for (const pattern of forbidden) if (pattern.test(bundle)) { console.error(`bundle contains forbidden material: ${pattern}`); process.exit(1); }
if (/from\s+["'](?!node:)/.test(bundle)) { console.error('bundle contains a runtime package import'); process.exit(1); }
const packages = Object.entries(lock.packages || {}).filter(([path]) => path).map(([path, value]) => ({
  name: path.replace(/^node_modules\//, ''), version: value.version, license: value.license || 'UNKNOWN', development: Boolean(value.dev),
})).sort((a, b) => a.name.localeCompare(b.name));
if (packages.some((item) => item.license === 'UNKNOWN')) { console.error('dependency license is unknown'); process.exit(1); }
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: { component: {
    type: 'application', name: lock.name, version: lock.version,
    copyright: 'Copyright 2026 Eyal Nof',
    licenses: [{ license: { id: lock.packages[''].license } }],
  } },
  components: packages.map((item) => ({ type: 'library', name: item.name, version: item.version, scope: item.development ? 'optional' : 'required', licenses: [{ license: { id: item.license } }] })),
};
const licenses = `# Build dependency licenses\n\nThe installed plugin has zero runtime package dependencies.\n\n| Package | Version | License | Use |\n| --- | --- | --- | --- |\n${packages.map((item) => `| ${item.name} | ${item.version} | ${item.license} | build/test only |`).join('\n')}\n`;
if (!process.argv.includes('--check')) {
  await writeFile(resolve(root, 'docs', 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
  await writeFile(resolve(root, 'docs', 'third-party-licenses.md'), licenses);
} else {
  const expectedSbom = `${JSON.stringify(sbom, null, 2)}\n`;
  if (await readFile(resolve(root, 'docs', 'sbom.cdx.json'), 'utf8') !== expectedSbom || await readFile(resolve(root, 'docs', 'third-party-licenses.md'), 'utf8') !== licenses) {
    console.error('SBOM or license inventory is stale; run npm run check:supply-chain'); process.exit(1);
  }
}
const hash = createHash('sha256').update(bundle).digest('hex');
console.log(`supply-chain inspection passed; bundle sha256=${hash}; runtime dependencies=0`);
