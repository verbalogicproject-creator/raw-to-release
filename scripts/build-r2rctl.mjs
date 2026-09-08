#!/usr/bin/env node
/** Deterministically transpile the CLI into the dependency-free consumer bundle. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'src/r2rctl.mjs');
const target = resolve(root, 'plugins/raw-to-release/skills/raw-to-release/bin/r2rctl.mjs');
const source = await readFile(sourcePath, 'utf8');
const result = ts.transpileModule(source, {
  fileName: 'r2rctl.ts',
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    removeComments: false,
    newLine: ts.NewLineKind.LineFeed,
  },
  reportDiagnostics: true,
});
const diagnostics = result.diagnostics || [];
if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  for (const diagnostic of diagnostics) console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  process.exit(1);
}
const banner = '#!/usr/bin/env node\n';
const compiled = `${banner}${result.outputText.replace(/^#!.*\n/, '').replaceAll('\r\n', '\n')}`;
if (process.argv.includes('--check')) {
  // Normalise the read side too: the generated side is already LF-normalised on
  // line 27, and comparing a normalised string against a raw one is what made this
  // fail on Windows checkouts. .gitattributes stops the conversion; this makes the
  // check independent of it.
  try { if ((await readFile(target, 'utf8')).replaceAll('\r\n', '\n') === compiled) process.exit(0); } catch { /* missing is drift */ }
  console.error('r2rctl bundle is not reproducible; run npm run build'); process.exit(1);
}
await mkdir(resolve(target, '..'), { recursive: true });
await writeFile(target, compiled, { mode: 0o755 });
