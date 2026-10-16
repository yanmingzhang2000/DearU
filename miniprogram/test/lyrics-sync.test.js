// 单元测试：lyrics-sync.js 歌词同步工具
const { test } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_LYRICS, findActiveLyricIndex } = require('../utils/lyrics-sync');

test('DEFAULT_LYRICS is sorted by timestamp ascending', () => {
  for (let i = 1; i < DEFAULT_LYRICS.length; i++) {
    assert.ok(DEFAULT_LYRICS[i].t >= DEFAULT_LYRICS[i - 1].t);
  }
});

test('findActiveLyricIndex returns -1 before first lyric timestamp', () => {
  const lyrics = [{ t: 1.0, text: 'a' }, { t: 2.0, text: 'b' }];
  assert.strictEqual(findActiveLyricIndex(lyrics, 0.5), -1);
});

test('findActiveLyricIndex returns correct index at exact timestamp boundary', () => {
  const lyrics = [{ t: 0, text: 'a' }, { t: 2, text: 'b' }, { t: 4, text: 'c' }];
  assert.strictEqual(findActiveLyricIndex(lyrics, 0), 0);
  assert.strictEqual(findActiveLyricIndex(lyrics, 2), 1);
  assert.strictEqual(findActiveLyricIndex(lyrics, 4), 2);
});

test('findActiveLyricIndex returns correct index between timestamps', () => {
  const lyrics = [{ t: 0, text: 'a' }, { t: 2, text: 'b' }, { t: 4, text: 'c' }];
  assert.strictEqual(findActiveLyricIndex(lyrics, 1.5), 0);
  assert.strictEqual(findActiveLyricIndex(lyrics, 3.9), 1);
});

test('findActiveLyricIndex returns last index after final timestamp', () => {
  const lyrics = [{ t: 0, text: 'a' }, { t: 2, text: 'b' }];
  assert.strictEqual(findActiveLyricIndex(lyrics, 100), 1);
});

test('findActiveLyricIndex handles empty lyrics array', () => {
  assert.strictEqual(findActiveLyricIndex([], 5), -1);
});

test('findActiveLyricIndex works with DEFAULT_LYRICS at t=0', () => {
  assert.strictEqual(findActiveLyricIndex(DEFAULT_LYRICS, 0), 0);
});
