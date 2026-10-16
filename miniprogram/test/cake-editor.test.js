// 单元测试：cake-editor.js 数据模型与历史栈
const { test } = require('node:test');
const assert = require('node:assert');
const cakeEditor = require('../utils/cake-editor');

test('createEmptyCake creates valid initial state', () => {
  const state = cakeEditor.createEmptyCake();
  assert.strictEqual(state.base, cakeEditor.BASE_TYPES.CREAM);
  assert.deepStrictEqual(state.layers, []);
});

test('createEmptyCake accepts custom base type', () => {
  const state = cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.MOUSSE);
  assert.strictEqual(state.base, cakeEditor.BASE_TYPES.MOUSSE);
});

test('addSticker appends a sticker layer with correct zIndex', () => {
  const state = cakeEditor.createEmptyCake();
  const layer1 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.STRAWBERRY, 10, 20);
  const layer2 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.CANDLE, 30, 40);

  assert.strictEqual(state.layers.length, 2);
  assert.strictEqual(layer1.zIndex, 0);
  assert.strictEqual(layer2.zIndex, 1);
  assert.strictEqual(layer1.stickerType, cakeEditor.STICKER_TYPES.STRAWBERRY);
  assert.strictEqual(layer1.x, 10);
  assert.strictEqual(layer1.y, 20);
  assert.strictEqual(layer1.scale, 1.0);
  assert.strictEqual(layer1.rotate, 0);
  assert.ok(layer1.id, 'layer should have a generated id');
});

test('addText appends a text layer with default color', () => {
  const state = cakeEditor.createEmptyCake();
  const layer = cakeEditor.addText(state, '生日快乐', 0, 0);
  assert.strictEqual(layer.type, cakeEditor.LAYER_TYPE.TEXT);
  assert.strictEqual(layer.text, '生日快乐');
  assert.strictEqual(layer.color, '#FF6B9D');
});

test('addStroke appends a stroke layer with points', () => {
  const state = cakeEditor.createEmptyCake();
  const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  const layer = cakeEditor.addStroke(state, points, cakeEditor.BRUSH_TYPES.WAVE);
  assert.strictEqual(layer.type, cakeEditor.LAYER_TYPE.STROKE);
  assert.strictEqual(layer.brushType, cakeEditor.BRUSH_TYPES.WAVE);
  assert.deepStrictEqual(layer.points, points);
});

test('updateLayer modifies existing layer in place', () => {
  const state = cakeEditor.createEmptyCake();
  const layer = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.BLUEBERRY, 0, 0);
  cakeEditor.updateLayer(state, layer.id, { x: 100, y: 200, scale: 1.5, rotate: 45 });

  const updated = state.layers.find(l => l.id === layer.id);
  assert.strictEqual(updated.x, 100);
  assert.strictEqual(updated.y, 200);
  assert.strictEqual(updated.scale, 1.5);
  assert.strictEqual(updated.rotate, 45);
});

test('updateLayer is a no-op for non-existent layer id', () => {
  const state = cakeEditor.createEmptyCake();
  cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.CANDLE, 0, 0);
  assert.doesNotThrow(() => {
    cakeEditor.updateLayer(state, 'nonexistent_id', { x: 999 });
  });
  assert.strictEqual(state.layers.length, 1);
});

test('removeLayer removes layer and reindexes zIndex', () => {
  const state = cakeEditor.createEmptyCake();
  const l1 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.STRAWBERRY, 0, 0);
  const l2 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.BLUEBERRY, 0, 0);
  const l3 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.CANDLE, 0, 0);

  cakeEditor.removeLayer(state, l2.id);

  assert.strictEqual(state.layers.length, 2);
  assert.strictEqual(state.layers[0].id, l1.id);
  assert.strictEqual(state.layers[0].zIndex, 0);
  assert.strictEqual(state.layers[1].id, l3.id);
  assert.strictEqual(state.layers[1].zIndex, 1); // 重新分配后应为 1，不是原来的 2
});

test('changeBase updates base type', () => {
  const state = cakeEditor.createEmptyCake();
  cakeEditor.changeBase(state, cakeEditor.BASE_TYPES.BASQUE);
  assert.strictEqual(state.base, cakeEditor.BASE_TYPES.BASQUE);
});

test('generateLayerId produces unique ids', () => {
  const state = cakeEditor.createEmptyCake();
  const l1 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.STRAWBERRY, 0, 0);
  const l2 = cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.STRAWBERRY, 0, 0);
  assert.notStrictEqual(l1.id, l2.id);
});

// ========== EditorHistory ==========

test('EditorHistory: push and undo restores previous state', () => {
  const history = new cakeEditor.EditorHistory();
  const state1 = cakeEditor.createEmptyCake();
  history.push(state1);

  const state2 = cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.MOUSSE);
  history.push(state2);

  assert.strictEqual(history.canUndo(), true);
  const restored = history.undo();
  assert.strictEqual(restored.base, cakeEditor.BASE_TYPES.CREAM);
});

test('EditorHistory: redo restores undone state', () => {
  const history = new cakeEditor.EditorHistory();
  history.push(cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.CREAM));
  history.push(cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.MOUSSE));

  history.undo();
  assert.strictEqual(history.canRedo(), true);
  const redone = history.redo();
  assert.strictEqual(redone.base, cakeEditor.BASE_TYPES.MOUSSE);
});

test('EditorHistory: canUndo/canRedo boundaries', () => {
  const history = new cakeEditor.EditorHistory();
  assert.strictEqual(history.canUndo(), false);
  assert.strictEqual(history.canRedo(), false);

  history.push(cakeEditor.createEmptyCake());
  assert.strictEqual(history.canUndo(), false); // 只有一个快照，不能再往前
  assert.strictEqual(history.canRedo(), false);

  history.push(cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.MILLE));
  assert.strictEqual(history.canUndo(), true);
  assert.strictEqual(history.canRedo(), false);
});

test('EditorHistory: push after undo truncates redo branch', () => {
  const history = new cakeEditor.EditorHistory();
  history.push(cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.CREAM));
  history.push(cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.MOUSSE));
  history.undo(); // 回到 CREAM，MOUSSE 变为可 redo

  assert.strictEqual(history.canRedo(), true);

  // 推入新状态，应该截断 MOUSSE 分支
  history.push(cakeEditor.createEmptyCake(cakeEditor.BASE_TYPES.BASQUE));
  assert.strictEqual(history.canRedo(), false);
});

test('EditorHistory: respects maxSize limit', () => {
  const history = new cakeEditor.EditorHistory(3);
  for (let i = 0; i < 5; i++) {
    history.push(cakeEditor.createEmptyCake());
  }
  assert.ok(history.stack.length <= 3);
});

test('EditorHistory: deep clones snapshots (mutation safety)', () => {
  const history = new cakeEditor.EditorHistory();
  const state = cakeEditor.createEmptyCake();
  cakeEditor.addSticker(state, cakeEditor.STICKER_TYPES.STRAWBERRY, 0, 0);
  history.push(state);

  // 修改原始 state 不应影响历史栈里的快照
  state.layers[0].x = 999;

  const snapshot = history.stack[history.pointer];
  assert.notStrictEqual(snapshot.layers[0].x, 999);
});
