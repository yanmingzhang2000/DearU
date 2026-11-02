// 单元测试：lyrics-sync.js 歌词同步工具
const { test } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_LYRICS, buildLyrics, findActiveLyricIndex } = require('../utils/lyrics-sync');

test('DEFAULT_LYRICS is sorted by timestamp ascending', () => {
  for (let i = 1; i < DEFAULT_LYRICS.length; i++) {
    assert.ok(DEFAULT_LYRICS[i].t >= DEFAULT_LYRICS[i - 1].t);
  }
});

test('buildLyrics replaces line 4 with 亲爱的{昵称}生日快乐', () => {
  const lyrics = buildLyrics('小笨蛋');
  assert.strictEqual(lyrics.length, 4);
  assert.strictEqual(lyrics[3].text, '亲爱的小笨蛋生日快乐');
  // 前三句保持标准版
  assert.strictEqual(lyrics[0].text, '祝你生日快乐');
  assert.strictEqual(lyrics[1].text, '祝你生日快乐');
  assert.strictEqual(lyrics[2].text, '祝你生日快乐');
});

test('buildLyrics falls back to 亲爱的你生日快乐 when nickname is empty', () => {
  assert.strictEqual(buildLyrics('')[3].text, '亲爱的你生日快乐');
  assert.strictEqual(buildLyrics('   ')[3].text, '亲爱的你生日快乐');
  assert.strictEqual(buildLyrics(null)[3].text, '亲爱的你生日快乐');
});

test('buildLyrics trims whitespace around nickname', () => {
  assert.strictEqual(buildLyrics(' 阿花 ')[3].text, '亲爱的阿花生日快乐');
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
