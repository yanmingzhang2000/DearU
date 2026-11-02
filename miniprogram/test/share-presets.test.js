// 单元测试：utils/share-presets.js
// 对应 亲爱的你-产品规格与版本路线图.md §3.5/§3.6 分享卡片规格
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SHARE_TITLE_PRESETS, DEFAULT_SHARE_IMAGE, resolveShareImage } = require('../utils/share-presets');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function assetExists(relativePath) {
  // relativePath 形如 '/assets/cakes/cream_vanilla_thumb.png'，去掉开头的 /assets 再拼真实目录
  const relative = relativePath.replace(/^\/assets\//, '');
  return fs.existsSync(path.join(ASSETS_DIR, relative));
}

test('内置文案恰好 3 条，且不含 emoji（规格 §3.6：标题保持干净文字，不塞 emoji）', () => {
  assert.strictEqual(SHARE_TITLE_PRESETS.length, 3);
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  SHARE_TITLE_PRESETS.forEach((title) => {
    assert.ok(!emojiPattern.test(title), `文案不应含 emoji: ${title}`);
  });
});

test('默认封面图文件真实存在', () => {
  assert.ok(assetExists(DEFAULT_SHARE_IMAGE), `默认封面图不存在: ${DEFAULT_SHARE_IMAGE}`);
});

test('style/flavor 均为空时返回默认封面', () => {
  assert.strictEqual(resolveShareImage(undefined, undefined), DEFAULT_SHARE_IMAGE);
  assert.strictEqual(resolveShareImage(null, null), DEFAULT_SHARE_IMAGE);
  assert.strictEqual(resolveShareImage('', ''), DEFAULT_SHARE_IMAGE);
});

test('style 有值但 flavor 为空时返回默认封面（basque 除外）', () => {
  assert.strictEqual(resolveShareImage('cream', undefined), DEFAULT_SHARE_IMAGE);
  assert.strictEqual(resolveShareImage('mille', null), DEFAULT_SHARE_IMAGE);
});

test('basque 底胚无论 flavor 是什么都返回 basque_original_thumb', () => {
  assert.strictEqual(resolveShareImage('basque', undefined), '/assets/cakes/basque_original_thumb.png');
  assert.strictEqual(resolveShareImage('basque', 'vanilla'), '/assets/cakes/basque_original_thumb.png');
  assert.strictEqual(resolveShareImage('basque', 'original'), '/assets/cakes/basque_original_thumb.png');
});

test('cream/mille/mousse 三款底胚 × 5 种口味的所有组合均能解析到真实存在的素材文件', () => {
  const styles = ['cream', 'mille', 'mousse'];
  const flavors = ['vanilla', 'strawberry', 'matcha', 'chocolate', 'mango'];

  styles.forEach((style) => {
    flavors.forEach((flavor) => {
      const resolved = resolveShareImage(style, flavor);
      assert.strictEqual(resolved, `/assets/cakes/${style}_${flavor}_thumb.png`);
      assert.ok(assetExists(resolved), `素材文件不存在: ${resolved}`);
    });
  });
});

test('未知的 style/flavor 组合拼接出的路径不存在时，调用方应自行判断（本函数不做素材存在性校验）', () => {
  // 这条测试记录当前设计边界：resolveShareImage 本身不检查文件是否存在，
  // 只负责按命名规则拼路径；若未来新增 style 没有配齐全部口味素材，需要同步更新本模块或素材目录，
  // 上面的"全组合存在性"测试会在那种情况下失败并提醒维护者。
  const resolved = resolveShareImage('nonexistent-style', 'nonexistent-flavor');
  assert.strictEqual(resolved, '/assets/cakes/nonexistent-style_nonexistent-flavor_thumb.png');
});
