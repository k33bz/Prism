// AWS Architecture Icons: sprite parsing, search, colorway resolution, the two MCP tools, and the
// real sprite embedded in Prism.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSprite, parseIconStore, searchIcons, resolveIcon, colorwayPair, iconSvg, iconSymbol, loadIcons } from '../utils/icons.js';
import { toolCtx } from './helper.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRISM_HTML = path.resolve(HERE, '..', '..', 'Prism.html');

// A gallery-shaped page: the sprite sits inside a template, symbols carry their metadata.
const SPRITE_HTML = '<script type="text/html" id="pg-aws"><div class="wrap">' +
  '<svg id="awd-sprite" data-prism-carry="aws-icons" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">' +
  '<symbol id="aws-grp-cloud" viewBox="0 0 32 32" data-n="Cloud" data-k="group" data-c="Groups"><path d="M1 1h30v30H1z" fill="#232F3E"/></symbol>' +
  '<symbol id="aws-grp-cloud-dark" viewBox="0 0 32 32" data-n="Cloud" data-k="group" data-c="Groups"><path d="M1 1h30v30H1z" fill="#FFFFFF"/></symbol>' +
  '<symbol id="aws-res-users-dark" viewBox="0 0 48 48" data-n="Users" data-k="resource" data-c="General Icons" data-s="General Icons"><circle cx="24" cy="24" r="9" fill="#FFF"/></symbol>' +
  '<symbol id="aws-res-users-light" viewBox="0 0 48 48" data-n="Users" data-k="resource" data-c="General Icons" data-s="General Icons"><circle cx="24" cy="24" r="9" fill="#232F3E"/></symbol>' +
  '<symbol id="aws-svc-directory-service" viewBox="0 0 48 48" data-n="AWS Directory Service" data-k="service" data-c="Security Identity" data-a="ad|active directory|managed microsoft ad"><rect width="48" height="48" fill="#DD344C"/></symbol>' +
  '<symbol id="aws-svc-lambda" viewBox="0 0 48 48" data-n="AWS Lambda" data-k="service" data-c="Compute"><rect width="48" height="48" fill="#ED7100"/></symbol>' +
  '<symbol id="aws-res-lambda-lambda-function" viewBox="0 0 48 48" data-n="Lambda Function" data-k="resource" data-c="Compute" data-s="AWS Lambda"><path d="M8 40L24 8l16 32z" fill="#ED7100"/></symbol>' +
  '</svg></div><\/script>';

test('parseSprite reads ids, viewBoxes, metadata and |-joined aliases', () => {
  const icons = parseSprite(SPRITE_HTML);
  assert.equal(icons.size, 7);
  const ds = icons.get('aws-svc-directory-service');
  assert.equal(ds.name, 'AWS Directory Service');
  assert.equal(ds.kind, 'service');
  assert.deepEqual(ds.aliases, ['ad', 'active directory', 'managed microsoft ad']);
  assert.equal(icons.get('aws-res-users-dark').viewBox, '0 0 48 48');
  assert.match(icons.get('aws-svc-lambda').svg, /^<rect /);
  assert.equal(parseSprite('<html>no sprite</html>'), null);
});

test('parseIconStore matches the sprite shape', () => {
  const icons = parseIconStore({ icons: { 'aws-svc-lambda': { name: 'AWS Lambda', kind: 'service', category: 'Compute', viewBox: '0 0 48 48', svg: '<rect/>' } } });
  assert.deepEqual(icons.get('aws-svc-lambda'), { id: 'aws-svc-lambda', name: 'AWS Lambda', kind: 'service', category: 'Compute', service: null, aliases: [], viewBox: '0 0 48 48', svg: '<rect/>' });
});

test('colorway pairs: x-dark + x-light, and x-dark + x', () => {
  const icons = parseSprite(SPRITE_HTML);
  assert.deepEqual(colorwayPair(icons, 'aws-res-users'), { base: 'aws-res-users', dark: 'aws-res-users-dark', light: 'aws-res-users-light' });
  assert.deepEqual(colorwayPair(icons, 'aws-grp-cloud-dark'), { base: 'aws-grp-cloud', dark: 'aws-grp-cloud-dark', light: 'aws-grp-cloud' });
  assert.equal(colorwayPair(icons, 'aws-svc-lambda'), null);
});

test('searchIcons: every word matches, pairs collapse, services rank first, aliases with spaces work', () => {
  const icons = parseSprite(SPRITE_HTML);
  const users = searchIcons(icons, { query: 'users' });
  assert.equal(users.total, 1);
  assert.equal(users.items[0].id, 'aws-res-users');
  assert.deepEqual(users.items[0].colorways, { dark: 'aws-res-users-dark', light: 'aws-res-users-light' });
  const lambda = searchIcons(icons, { query: 'lambda' });
  assert.deepEqual(lambda.items.map((x) => x.id), ['aws-svc-lambda', 'aws-res-lambda-lambda-function']);
  assert.equal(searchIcons(icons, { query: 'managed microsoft ad' }).items[0].id, 'aws-svc-directory-service');
  assert.equal(searchIcons(icons, { query: 'lambda', kind: 'resource' }).items[0].id, 'aws-res-lambda-lambda-function');
  assert.equal(searchIcons(icons, { query: 'lambda nosuchword' }).total, 0);
  const page = searchIcons(icons, { limit: 2, offset: 2 });
  assert.equal(page.total, 5);   // 7 symbols, two colorway pairs collapsed
  assert.equal(page.count, 2);
});

test('resolveIcon: base id picks the colorway, explicit variants stay explicit', () => {
  const icons = parseSprite(SPRITE_HTML);
  assert.equal(resolveIcon(icons, 'aws-res-users').id, 'aws-res-users-light');
  assert.equal(resolveIcon(icons, 'aws-res-users', 'dark').id, 'aws-res-users-dark');
  assert.equal(resolveIcon(icons, 'aws-res-users-dark', 'light').id, 'aws-res-users-dark');
  assert.equal(resolveIcon(icons, 'aws-grp-cloud', 'dark').id, 'aws-grp-cloud-dark');
  assert.equal(resolveIcon(icons, 'aws-grp-cloud').id, 'aws-grp-cloud');
  assert.equal(resolveIcon(icons, 'aws-svc-nope'), null);
});

test('iconSvg / iconSymbol wrap the artwork without altering it', () => {
  const icons = parseSprite(SPRITE_HTML);
  const ic = icons.get('aws-svc-lambda');
  assert.equal(iconSvg(ic, 64), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="64" height="64" role="img" aria-label="AWS Lambda"><rect width="48" height="48" fill="#ED7100"/></svg>');
  assert.equal(iconSymbol(ic), '<symbol id="aws-svc-lambda" viewBox="0 0 48 48"><rect width="48" height="48" fill="#ED7100"/></symbol>');
});

function iconCtx() {
  const ctx = toolCtx();
  ctx.store._icons = { source: '(fixture sprite)', icons: parseSprite(SPRITE_HTML) };
  return ctx;
}

test('search_aws_icons tool: query, kind, paging, bad kind', () => {
  const ctx = iconCtx();
  const r = ctx.call('search_aws_icons', { query: 'users' });
  assert.equal(r.source, '(fixture sprite)');
  assert.equal(r.items[0].id, 'aws-res-users');
  assert.equal(ctx.call('search_aws_icons', { kind: 'service' }).total, 2);
  assert.equal(ctx.call('search_aws_icons', { limit: 1 }).count, 1);
  const bad = ctx.callSafe('search_aws_icons', { kind: 'widget' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'invalid_argument');
});

test('get_aws_icon tool: svg, symbol, colorway, not_found with suggestions', () => {
  const ctx = iconCtx();
  const svg = ctx.call('get_aws_icon', { id: 'aws-res-users', size: 32 });
  assert.equal(svg.id, 'aws-res-users-light');
  assert.equal(svg.format, 'svg');
  assert.match(svg.markup, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 48 48" width="32" height="32"/);
  assert.deepEqual(svg.colorways, { dark: 'aws-res-users-dark', light: 'aws-res-users-light' });
  assert.equal(ctx.call('get_aws_icon', { id: 'aws-res-users', colorway: 'dark' }).id, 'aws-res-users-dark');
  const sym = ctx.call('get_aws_icon', { id: 'aws-svc-lambda', format: 'symbol' });
  assert.match(sym.markup, /^<symbol id="aws-svc-lambda" viewBox="0 0 48 48">/);
  const miss = ctx.callSafe('get_aws_icon', { id: 'aws-svc-lambda-thing' });
  assert.equal(miss.ok, false);
  assert.equal(miss.error.code, 'not_found');
  assert.ok(miss.error.data.suggestions.includes('aws-svc-lambda'));
});

test('icon tools report unavailable when the catalog ships no icons', () => {
  const ctx = toolCtx();
  ctx.store._icons = null;
  const r = ctx.callSafe('search_aws_icons', { query: 'lambda' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'unavailable');
});

test('the real Prism.html embeds the full icon sprite', { skip: !fs.existsSync(PRISM_HTML) }, () => {
  const pack = loadIcons(PRISM_HTML);
  assert.ok(pack, 'Prism.html has an #awd-sprite');
  assert.ok(pack.icons.size >= 800, `expected the full package, got ${pack.icons.size}`);
  for (const id of ['aws-svc-lambda', 'aws-svc-dynamodb', 'aws-res-users-dark', 'aws-grp-region']) assert.ok(pack.icons.has(id), id);
  assert.ok(searchIcons(pack.icons, { query: 'managed microsoft ad' }).total >= 1);
});
