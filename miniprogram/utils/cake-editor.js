// 蛋糕编辑器数据模型与状态管理
// 基于调研：LemonJournal 的图层数据结构 + wxa-comp-canvas-drag 的状态快照思路
// 架构：WXML 贴纸层（view + transform）+ Canvas 涂鸦层，导出时合成

// 图层类型枚举
const LAYER_TYPE = {
  BASE: 'base',        // 底胚（唯一，z-index=0）
  STICKER: 'sticker',  // 装饰贴纸（草莓/蓝莓/蜡烛等）
  TEXT: 'text',        // 文字祝福
  STROKE: 'stroke'     // 奶油涂鸦笔画（每条路径一个图层）
};

// 底胚款式（4款）
const STYLES = {
  CREAM: 'cream',
  MILLE: 'mille',
  MOUSSE: 'mousse',
  BASQUE: 'basque'
};

// 口味（5款 + basque 原味）
const FLAVORS = {
  VANILLA: 'vanilla',
  STRAWBERRY: 'strawberry',
  MATCHA: 'matcha',
  CHOCOLATE: 'chocolate',
  MANGO: 'mango',
  ORIGINAL: 'original'  // 仅 basque 使用
};

// 装饰类型
const STICKER_TYPES = {
  STRAWBERRY: 'strawberry',
  BLUEBERRY: 'blueberry',
  CANDLE: 'candle'
};

// 笔刷类型（奶油挤花）
const BRUSH_TYPES = {
  ROUND: 'round',      // 圆点
  WAVE: 'wave',        // 波浪
  ZIGZAG: 'zigzag'     // 锯齿
};

// ========== P0 交互修复：落点与边界 ==========

// 贴纸/文字图层的盒尺寸（rpx），与 .sticker-layer CSS 保持一致
const STICKER_BOX_RPX = 120;

// 顶面区域落点序列（相对画布中心，rpx）：
// 连续添加时循环取点，避免全部堆在画布正中。y 为负 = 画布上半部（顶面所在）。
const SPAWN_OFFSETS = [
  { x: 0, y: -140 },
  { x: -105, y: -115 },
  { x: 105, y: -115 },
  { x: -55, y: -65 },
  { x: 55, y: -65 },
  { x: 0, y: -205 },
  { x: -160, y: -70 },
  { x: 160, y: -70 }
];

// 文字祝福默认落点：正面居中（顶面下方）
const TEXT_SPAWN = { x: 0, y: 60 };

/**
 * 计算新图层的落点（P0-2 智能落点）
 * - 贴纸：按序号循环取顶面区域内的基准点；巴斯克顶面更扁，y 方向压缩
 * - 文字：固定落在正面居中
 * @param {string} style - 底胚款式
 * @param {number} sequenceIndex - 本次会话内的添加序号
 * @param {string} kind - 'sticker' | 'text'
 * @returns {{x: number, y: number}} rpx 偏移（相对画布中心）
 */
function getSpawnPoint(style, sequenceIndex, kind = 'sticker') {
  if (kind === 'text') {
    return { x: TEXT_SPAWN.x, y: TEXT_SPAWN.y };
  }
  const yScale = style === STYLES.BASQUE ? 0.6 : 1;
  const len = SPAWN_OFFSETS.length;
  const idx = ((sequenceIndex || 0) % len + len) % len;
  const p = SPAWN_OFFSETS[idx];
  return { x: p.x, y: Math.round(p.y * yScale) };
}

/**
 * 把图层中心约束在画布内（P0-3 边界约束）
 * 边距按当前缩放后的盒子半径留白，贴纸不会被拖出画布消失。
 * @param {Object} layer - 图层对象（原地修改 x/y）
 * @param {{halfWidth: number, halfHeight: number}} bounds - 画布半宽/半高（rpx）
 * @returns {Object} 同一 layer
 */
function clampLayerPosition(layer, bounds) {
  if (!layer || !bounds) return layer;
  const margin = (STICKER_BOX_RPX * (layer.scale || 1)) / 2;
  const maxX = Math.max(0, bounds.halfWidth - margin);
  const maxY = Math.max(0, bounds.halfHeight - margin);
  layer.x = Math.max(-maxX, Math.min(maxX, layer.x));
  layer.y = Math.max(-maxY, Math.min(maxY, layer.y));
  return layer;
}

/**
 * 创建空白蛋糕状态
 * @param {string} style - 底胚款式，默认奶油
 * @param {string} flavor - 口味，默认香草
 * @returns {Object} 初始 cake_state
 */
function createEmptyCake(style = STYLES.CREAM, flavor = FLAVORS.VANILLA) {
  return {
    style: style,
    flavor: flavor,
    layers: []  // 图层数组，按 z-index 排序（append 自动递增）
  };
}

/**
 * 添加贴纸图层
 * @param {Object} cakeState - 当前蛋糕状态
 * @param {string} stickerType - 装饰类型（strawberry/blueberry/candle）
 * @param {number} x - 中心点 x（rpx）
 * @param {number} y - 中心点 y（rpx）
 * @returns {Object} 新图层对象
 */
function addSticker(cakeState, stickerType, x, y) {
  const layer = {
    id: generateLayerId(),
    type: LAYER_TYPE.STICKER,
    stickerType: stickerType,
    x: x,
    y: y,
    scale: 1.0,
    rotate: 0,  // 角度
    zIndex: cakeState.layers.length
  };
  cakeState.layers.push(layer);
  return layer;
}

/**
 * 添加文字图层
 * @param {Object} cakeState
 * @param {string} text - 祝福文字
 * @param {number} x
 * @param {number} y
 * @param {string} color - 颜色值，默认 #FF6B9D
 * @returns {Object} 新图层对象
 */
function addText(cakeState, text, x, y, color = '#FF6B9D') {
  const layer = {
    id: generateLayerId(),
    type: LAYER_TYPE.TEXT,
    text: text,
    x: x,
    y: y,
    scale: 1.0,
    rotate: 0,
    color: color,
    zIndex: cakeState.layers.length
  };
  cakeState.layers.push(layer);
  return layer;
}

/**
 * 添加笔画图层（奶油涂鸦）
 * @param {Object} cakeState
 * @param {Array} points - 路径点数组 [{x, y, timestamp?}, ...]
 * @param {string} brushType - 笔刷类型（round/wave/zigzag）
 * @param {string} color - 颜色，默认 #FFE5EC
 * @param {number} width - 笔触宽度（px），默认 20
 * @returns {Object} 新图层对象
 */
function addStroke(cakeState, points, brushType = BRUSH_TYPES.ROUND, color = '#FFE5EC', width = 20) {
  const layer = {
    id: generateLayerId(),
    type: LAYER_TYPE.STROKE,
    brushType: brushType,
    points: points,
    color: color,
    width: width,
    zIndex: cakeState.layers.length
  };
  cakeState.layers.push(layer);
  return layer;
}

/**
 * 更新图层属性（位置/缩放/旋转）
 * @param {Object} cakeState
 * @param {string} layerId
 * @param {Object} changes - { x?, y?, scale?, rotate? }
 */
function updateLayer(cakeState, layerId, changes) {
  const layer = cakeState.layers.find(l => l.id === layerId);
  if (!layer) return;
  Object.assign(layer, changes);
}

/**
 * 删除图层
 * @param {Object} cakeState
 * @param {string} layerId
 */
function removeLayer(cakeState, layerId) {
  const index = cakeState.layers.findIndex(l => l.id === layerId);
  if (index !== -1) {
    cakeState.layers.splice(index, 1);
    // 重新分配 zIndex
    cakeState.layers.forEach((layer, i) => {
      layer.zIndex = i;
    });
  }
}

/**
 * 切换底胚款式
 * @param {Object} cakeState
 * @param {string} style
 */
function changeStyle(cakeState, style) {
  cakeState.style = style;
  if (style === STYLES.BASQUE) {
    cakeState.flavor = FLAVORS.ORIGINAL;
  } else if (cakeState.flavor === FLAVORS.ORIGINAL) {
    cakeState.flavor = FLAVORS.VANILLA;
  }
}

/**
 * 切换口味（basque 款式下锁定原味，不允许切换）
 * @param {Object} cakeState
 * @param {string} flavor
 */
function changeFlavor(cakeState, flavor) {
  if (cakeState.style === STYLES.BASQUE) return;
  cakeState.flavor = flavor;
}

/**
 * 生成唯一图层 ID
 * @returns {string}
 */
function generateLayerId() {
  return 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 历史栈管理（撤销/重做）
 * 基于 wxa-comp-canvas-drag 的状态快照思路
 */
class EditorHistory {
  constructor(maxSize = 30) {
    this.stack = [];     // 历史快照栈
    this.pointer = -1;   // 当前指针
    this.maxSize = maxSize;
  }

  /**
   * 推入新快照（深拷贝）
   * @param {Object} cakeState
   */
  push(cakeState) {
    // 如果当前不在栈顶，截断后续历史
    if (this.pointer < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.pointer + 1);
    }
    // 推入新快照
    this.stack.push(JSON.parse(JSON.stringify(cakeState)));
    // 限制栈大小
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.pointer++;
    }
  }

  /**
   * 撤销
   * @returns {Object|null} 上一个状态快照（深拷贝）
   */
  undo() {
    if (this.pointer > 0) {
      this.pointer--;
      return JSON.parse(JSON.stringify(this.stack[this.pointer]));
    }
    return null;
  }

  /**
   * 重做
   * @returns {Object|null} 下一个状态快照（深拷贝）
   */
  redo() {
    if (this.pointer < this.stack.length - 1) {
      this.pointer++;
      return JSON.parse(JSON.stringify(this.stack[this.pointer]));
    }
    return null;
  }

  /**
   * 检查是否可撤销
   */
  canUndo() {
    return this.pointer > 0;
  }

  /**
   * 检查是否可重做
   */
  canRedo() {
    return this.pointer < this.stack.length - 1;
  }

  /**
   * 清空历史
   */
  clear() {
    this.stack = [];
    this.pointer = -1;
  }
}

module.exports = {
  LAYER_TYPE,
  STYLES,
  FLAVORS,
  STICKER_TYPES,
  BRUSH_TYPES,
  createEmptyCake,
  addSticker,
  addText,
  addStroke,
  updateLayer,
  removeLayer,
  changeStyle,
  changeFlavor,
  getSpawnPoint,
  clampLayerPosition,
  STICKER_BOX_RPX,
  EditorHistory
};
