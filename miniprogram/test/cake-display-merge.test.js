// 单元测试：cake-display-merge.js 前端显示侧合并
// v1.1-转盘仪式与协作合并规格.md 第 5 节
const { test } = require('node:test');
const assert = require('node:assert');
const { mergeForDisplay } = require('../utils/cake-display-merge');

function layer(id, overrides) {
  return Object.assign({ id, type: 'sticker', stickerType: 'strawberry', x: 0, y: 0, scale: 1, rotate: 0, zIndex: 0 }, overrides);
}

test('无拖拽时完全信任远端（含 style/flavor/layers/zIndex）', () => {
  const local = { style: 'cream', flavor: 'vanilla', layers: [layer('l1')] };
  const remote = { style: 'mousse', flavor: 'matcha', layers: [layer('l1', { x: 50 })] };

  const result = mergeForDisplay(local, remote, null);
  assert.strictEqual(result.style, 'mousse');
  assert.strictEqual(result.flavor, 'matcha');
  assert.strictEqual(result.layers[0].x, 50);
});

test('正在拖拽的图层保留本地版本，不被远端覆盖', () => {
  const local = { style: 'cream', flavor: 'vanilla', layers: [layer('l1', { x: 999, y: 999 })] };
  const remote = { style: 'cream', flavor: 'vanilla', layers: [layer('l1', { x: 10, y: 10 })] };

  const result = mergeForDisplay(local, remote, 'l1');
  assert.strictEqual(result.layers[0].x, 999); // 本地手指正按着的版本
  assert.strictEqual(result.layers[0].y, 999);
});

test('非拖拽图层即便 draggingLayerId 指向别的图层，仍采用远端版本', () => {
  const local = {
    style: 'cream', flavor: 'vanilla',
    layers: [layer('l1', { x: 999 }), layer('l2', { x: 1 })]
  };
  const remote = {
    style: 'cream', flavor: 'vanilla',
    layers: [layer('l1', { x: 10 }), layer('l2', { x: 20 })]
  };

  const result = mergeForDisplay(local, remote, 'l1');
  const l1 = result.layers.find((l) => l.id === 'l1');
  const l2 = result.layers.find((l) => l.id === 'l2');
  assert.strictEqual(l1.x, 999); // 拖拽保护
  assert.strictEqual(l2.x, 20); // 信任远端
});

test('本地刚画、尚未保存成功的图层（远端还没有）应被保留', () => {
  const local = { style: 'cream', flavor: 'vanilla', layers: [layer('l1'), layer('l_local_new')] };
  const remote = { style: 'cream', flavor: 'vanilla', layers: [layer('l1')] };

  const result = mergeForDisplay(local, remote, null);
  const ids = result.layers.map((l) => l.id).sort();
  assert.deepStrictEqual(ids, ['l1', 'l_local_new']);
});

test('本地有、远端没有的图层会被保留（这个函数不负责感知服务端删除，只负责保护未保存的本地新增，见规格第 5 节）', () => {
  // 注意：这个行为本身是规格第 4.3 节"已知取舍"的前端对应面——真正的删除感知依赖下一次
  // GET 轮询把 remoteCake.layers 里不再包含该图层这件事传导过来；只要本地在这之间没有
  // 把它当成"新画的"一直攒着不放，下一轮 remote 数据到达时它自然会消失（因为 remote 没有它，
  // 且它此时不再处于 local 独有的"未保存新增"语境——但本函数本身的单次调用确实会保留它，
  // 这是预期行为，不是 bug）。
  const local = { style: 'cream', flavor: 'vanilla', layers: [layer('l1'), layer('l2')] };
  const remote = { style: 'cream', flavor: 'vanilla', layers: [layer('l1')] };

  const result = mergeForDisplay(local, remote, null);
  const ids = result.layers.map((l) => l.id).sort();
  assert.deepStrictEqual(ids, ['l1', 'l2']);
});

test('draggingLayerId 不出现在返回对象的任何字段里（不会被误提交给服务端）', () => {
  const local = { style: 'cream', flavor: 'vanilla', layers: [layer('l1')] };
  const remote = { style: 'cream', flavor: 'vanilla', layers: [layer('l1')] };

  const result = mergeForDisplay(local, remote, 'l1');
  assert.strictEqual(JSON.stringify(result).includes('draggingLayerId'), false);
  assert.strictEqual('draggingLayerId' in result, false);
});

test('空图层数组场景不抛异常', () => {
  const local = { style: 'cream', flavor: 'vanilla', layers: [] };
  const remote = { style: 'mousse', flavor: 'matcha', layers: [] };

  assert.doesNotThrow(() => {
    const result = mergeForDisplay(local, remote, null);
    assert.deepStrictEqual(result.layers, []);
  });
});
