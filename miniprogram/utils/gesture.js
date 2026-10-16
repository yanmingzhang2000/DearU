// 手势计算工具
// 参考调研：LemonJournal 的旋转/缩放数学算法
// 用于 WXML 贴纸层的拖拽/旋转/缩放交互

/**
 * 计算两点间距离
 * @param {Object} p1 - {x, y}
 * @param {Object} p2 - {x, y}
 * @returns {number}
 */
function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算两点连线相对水平线的角度（弧度）
 * @param {Object} center - 中心点 {x, y}
 * @param {Object} point - 外点 {x, y}
 * @returns {number} 弧度值（-π ~ π）
 */
function angle(center, point) {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

/**
 * 弧度转角度
 * @param {number} radian
 * @returns {number}
 */
function radianToDegree(radian) {
  return radian * 180 / Math.PI;
}

/**
 * 角度转弧度
 * @param {number} degree
 * @returns {number}
 */
function degreeToRadian(degree) {
  return degree * Math.PI / 180;
}

/**
 * 两指捏合手势识别（缩放+旋转）
 * @param {Array} touches - 当前触摸点数组 [{pageX, pageY}, ...]
 * @param {Array} prevTouches - 上一帧触摸点数组
 * @returns {Object|null} { scale: 缩放比例变化率, rotate: 旋转角度增量（度） } 或 null
 */
function detectPinch(touches, prevTouches) {
  if (!touches || touches.length < 2 || !prevTouches || prevTouches.length < 2) {
    return null;
  }

  const t0 = { x: touches[0].pageX, y: touches[0].pageY };
  const t1 = { x: touches[1].pageX, y: touches[1].pageY };
  const p0 = { x: prevTouches[0].pageX, y: prevTouches[0].pageY };
  const p1 = { x: prevTouches[1].pageX, y: prevTouches[1].pageY };

  // 缩放：当前两指距离 / 上一帧两指距离
  const currDist = distance(t0, t1);
  const prevDist = distance(p0, p1);
  const scale = prevDist > 0 ? currDist / prevDist : 1.0;

  // 旋转：两指连线角度增量
  const currAngle = angle(t0, t1);
  const prevAngle = angle(p0, p1);
  let deltaAngle = radianToDegree(currAngle - prevAngle);

  // 归一化到 -180 ~ 180
  if (deltaAngle > 180) deltaAngle -= 360;
  if (deltaAngle < -180) deltaAngle += 360;

  return {
    scale: scale,
    rotate: deltaAngle
  };
}

/**
 * 单指拖拽增量计算
 * @param {Object} touch - 当前触摸点 {pageX, pageY}
 * @param {Object} prevTouch - 上一帧触摸点
 * @returns {Object} {dx, dy}
 */
function detectDrag(touch, prevTouch) {
  if (!touch || !prevTouch) {
    return { dx: 0, dy: 0 };
  }
  return {
    dx: touch.pageX - prevTouch.pageX,
    dy: touch.pageY - prevTouch.pageY
  };
}

/**
 * 判断点是否在矩形区域内（命中检测）
 * @param {Object} point - {x, y}
 * @param {Object} rect - {left, top, width, height}
 * @returns {boolean}
 */
function isPointInRect(point, rect) {
  return point.x >= rect.left &&
         point.x <= rect.left + rect.width &&
         point.y >= rect.top &&
         point.y <= rect.top + rect.height;
}

/**
 * 计算旋转后的边界框（AABB）
 * @param {number} x - 中心点 x
 * @param {number} y - 中心点 y
 * @param {number} width - 原始宽度
 * @param {number} height - 原始高度
 * @param {number} rotate - 旋转角度（度）
 * @returns {Object} {left, top, width, height} 包围盒
 */
function getRotatedBoundingBox(x, y, width, height, rotate) {
  const rad = degreeToRadian(rotate);
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = width * cos + height * sin;
  const h = width * sin + height * cos;
  return {
    left: x - w / 2,
    top: y - h / 2,
    width: w,
    height: h
  };
}

module.exports = {
  distance,
  angle,
  radianToDegree,
  degreeToRadian,
  detectPinch,
  detectDrag,
  isPointInRect,
  getRotatedBoundingBox
};
