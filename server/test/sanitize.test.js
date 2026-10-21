import test from 'node:test';
import assert from 'node:assert/strict';
import { hasInvisible, inertValue, revealText } from '../src/sanitize.js';

test('reveals invisible and control characters as [U+XXXX] and keeps newlines and tabs', () => {
  assert.equal(revealText('a​b\u0007c\nd\te\u{E0041}'), 'a[U+200B]b[U+0007]c\nd\te[U+E0041]');
  assert.equal(hasInvisible('plain'), false);
  assert.equal(hasInvisible('x﻿'), true);
  assert.equal(hasInvisible('emoji ️ ok'), false);
});

test('bounds length, depth, array size and key count', () => {
  assert.equal(revealText('x'.repeat(5000)).length, 2001);
  const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  assert.match(JSON.stringify(inertValue(deep)), /\[truncated\]/);
  assert.equal(inertValue(Array.from({ length: 500 }, (_, i) => i)).length, 100);
  assert.equal(Object.keys(inertValue(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i])))).length, 50);
});

test('server-provided markup stays text and a __proto__ key is just data', () => {
  const out = inertValue(JSON.parse('{"__proto__":{"polluted":true},"html":"<script>alert(1)</script>"}'));
  assert.equal(({}).polluted, undefined);
  assert.equal(out.html, '<script>alert(1)</script>');
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('line and paragraph separators, musical formatting characters and lone surrogates are revealed', () => {
  assert.equal(revealText('a b c'), 'a[U+2028]b[U+2029]c');
  assert.equal(revealText('\u{1D173}x\u{1D17A}'), '[U+1D173]x[U+1D17A]');
  assert.equal(revealText('a\uD800b\uDFFFc'), 'a[U+D800]b[U+DFFF]c');
  assert.equal(revealText('ok \u{1F600} pair'), 'ok \u{1F600} pair', 'a valid surrogate pair (emoji) is left alone');
  for (const s of [' ', ' ', '\u{1D175}', '\uD83D']) assert.equal(hasInvisible(s), true);
  assert.equal(JSON.stringify(inertValue({ 'k ': 'v\uD800' })), '{"k[U+2028]":"v[U+D800]"}');
});
