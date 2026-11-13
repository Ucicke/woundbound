import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const semver = createRequire(join(dirname(process.execPath), 'node_modules/npm/package.json'))('semver');
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'];
const normalize = value => String(value || '').replace(/^git\+/, '').replace(/\/v\/[^/]+$/, '').replace(/\.git\/?$/, '').replace(/\/$/, '').replace(/https:\/\/[^/@]+@/, 'https://').toLowerCase();

function validate(selected, metadata, dependencies) {
  assert.match(selected.name, /^[a-z0-9][a-z0-9._-]*$/);
  assert.match(selected.version, /^\d+\.\d+\.\d+$/);
  assert.equal(dependencies[selected.name], selected.version, `${selected.name}: manifest pin`);
  assert.equal(metadata.name, selected.name, `${selected.name}: registry name`);
  assert.equal(metadata.version, selected.version, `${selected.name}: registry version`);
  const repo = normalize(typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url);
  assert.ok(repo && repo === normalize(selected.repository), `${selected.name}: repository`);
  assert.ok(normalize(selected.officialSource) === repo || selected.officialSource === `https://www.npmjs.com/package/${selected.name}/v/${selected.version}`, `${selected.name}: official source`);
  const actual = Object.fromEntries(lifecycle.filter(key => metadata.scripts?.[key]).map(key => [key, metadata.scripts[key]]));
  assert.deepEqual(actual, selected.lifecycleScripts, `${selected.name}: lifecycle scripts`);
  if (metadata.engines?.node) assert.ok(semver.satisfies(process.versions.node, metadata.engines.node), `${selected.name}: Node compatibility`);
  for (const [name, range] of Object.entries(metadata.peerDependencies || {})) {
    if (dependencies[name]) assert.ok(semver.satisfies(dependencies[name], range), `${selected.name}: peer ${name}`);
  }
}

const deps = { ...manifest.dependencies, ...manifest.devDependencies };
const selected = manifest.woundboundPackageEvidence;
if (process.argv.includes('--packages')) {
  for (const item of selected) {
    const response = await fetch(`https://registry.npmjs.org/${item.name}/${item.version}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`${item.name}@${item.version}: registry HTTP ${response.status}`);
    validate(item, await response.json(), deps);
    console.log(`Verified ${item.name}@${item.version}`);
  }
} else if (process.argv.includes('--self-test')) {
  const candidate = { name: 'example', version: '1.0.0', repository: 'https://github.com/example/example', officialSource: 'https://github.com/example/example', lifecycleScripts: {} };
  const metadata = { name: candidate.name, version: candidate.version, repository: { url: candidate.repository } };
  validate(candidate, metadata, { example: '1.0.0' });
  assert.throws(() => validate(candidate, { ...metadata, version: '9.0.0' }, { example: '1.0.0' }));
  assert.throws(() => validate(candidate, { ...metadata, scripts: { postinstall: 'unexpected' } }, { example: '1.0.0' }));
  assert.throws(() => validate(candidate, { ...metadata, engines: { node: '<1' } }, { example: '1.0.0' }));
  validate({ ...candidate, version: '2.0.0' }, { ...metadata, version: '2.0.0' }, { example: '2.0.0' });
  console.log('Package verifier fixtures passed');
} else if (process.argv.includes('--tracer')) {
  const game = await import('../src/main.ts');
  const state = game.createEncounter();
  for (let n = 0; n < 120; n++) game.stepEncounter(state, 50);
  const view = game.projectEncounter(state);
  assert.ok(view.events.length >= 2, 'multiple events must be visible');
  assert.ok(state.enemy.hp < state.enemy.maxHp, 'equipped item must deal damage');
  assert.ok(view.events.every(event => event.includes('Клинок') && event.includes('Крыса')), 'events must identify actual item and target');
  const inert = game.createEncounter(false);
  for (let n = 0; n < 120; n++) game.stepEncounter(inert, 50);
  assert.equal(inert.enemy.hp, inert.enemy.maxHp, 'unequipped hero must not attack');
  console.log('Real-model tracer passed');
} else {
  throw new Error('Use --self-test, --packages or --tracer');
}
