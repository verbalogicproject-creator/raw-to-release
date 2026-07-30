#!/usr/bin/env node
/** Compile every public contract with the pinned schema implementation. */
import Ajv2020 from 'ajv/dist/2020.js';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '..', 'method', 'contracts');
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const name of (await readdir(directory)).filter((item) => item.endsWith('.json')).sort()) {
  const schema = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
  try { ajv.addSchema(schema); }
  catch (error) { console.error(`${name}: ${error.message}`); process.exit(1); }
}
console.log('all method 2.0 schemas compile with pinned Ajv');
