// Canvas 奶油涂鸦层渲染工具
// 参考调研：小程序画板教程的增量绘制模式（touchmove → lineTo 不清屏）
// 笔刷算法：自研，沿捕获路径二次渲染波浪/锯齿/圆点花纹

const { BRUSH_TYPES } = require('./cake-editor');

// ========== P1 曲线平滑（导出为纯函数，供单测） ==========

/**
 * 等距重采样：按弧长每 step px 取一点。
 * 解决手指抖动造成的点距不均——波浪/锯齿按"点序号"叠加花纹，
 * 点距不均匀时花纹会被拉扯扭曲；等距化后花纹稳定。
 * @param {Array<{x:number,y:number}>} points - 原始路径
 * @param {number} step - 采样间距（px）
 * @returns {Array} 等距路径（保留首尾点）
 */
function resampleUniform(points, step = 4) {
  if (!points || points.length < 2) return (points || []).slice();
  const out = [points[0]];
  let acc = 0;
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;
    let traveled = 0;
    while (acc + (segLen - traveled) >= step) {
      traveled += step - acc;
      const t = traveled / segLen;
      out.push({ x: prev.x + dx * t, y: prev.y + dy * t });
      acc = 0;
    }
    acc += segLen - traveled;
    prev = cur;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.abs(last.x - tail.x) > 0.01 || Math.abs(last.y - tail.y) > 0.01) {
    out.push({ x: last.x, y: last.y });
  }
  return out;
}

/**
 * 滑动平均去抖（首尾点固定，避免笔画端点内缩）
 * @param {Array} points
 * @param {number} window - 半窗大小
 * @returns {Array}
 */
function averageSmooth(points, window = 2) {
  if (!points || points.length < 3 || window < 1) return points;
  const n = points.length;
  return points.map((p, i) => {
    if (i === 0 || i === n - 1) return { x: p.x, y: p.y };
    let sx = 0, sy = 0, count = 0;
    for (let k = Math.max(0, i - window); k <= Math.min(n - 1, i + window); k++) {
      sx += points[k].x;
      sy += points[k].y;
      count++;
    }
    return { x: sx / count, y: sy / count };
  });
}

/**
 * 路径平滑：等距重采样 + 滑动平均。
 * 原始点保留在图层里作为数据源，渲染时统一走这里，实时预览与落笔结果一致。
 * @param {Array} points - 原始路径
 * @param {Object} [opts] - {step, window}
 * @returns {Array} 平滑后的路径
 */
function smoothPath(points, opts = {}) {
  const step = opts.step == null ? 4 : opts.step;
  const window = opts.window == null ? 2 : opts.window;
  return averageSmooth(resampleUniform(points, step), window);
}

/**
 * 奶油涂鸦渲染器
 * 用于在 Canvas 2D 上绘制笔画路径
 */
class StrokeRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D 上下文
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * 绘制一条笔画（P1-1：内部统一先平滑，实时预览与落笔结果一致）
   * @param {Object} stroke - 笔画图层对象 { brushType, points, color, width }
   */
  drawStroke(stroke) {
    if (!stroke.points || stroke.points.length === 0) return;

    const points = smoothPath(stroke.points);
    if (points.length === 0) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (stroke.brushType) {
      case BRUSH_TYPES.ROUND:
        this._drawRound(points, stroke.width);
        break;
      case BRUSH_TYPES.WAVE:
        this._drawWave(points, stroke.width);
        break;
      case BRUSH_TYPES.ZIGZAG:
        this._drawZigzag(points, stroke.width);
        break;
      default:
        this._drawRound(points, stroke.width);
    }

    ctx.restore();
  }

  /**
   * 圆点笔刷：沿路径按间距 stamp 圆点
   * @param {Array} points - [{x, y}, ...]
   * @param {number} width - 圆点直径
   */
  _drawRound(points, width) {
    const ctx = this.ctx;
    const spacing = width * 0.3; // 间距控制密度
    let accDist = 0;

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        ctx.arc(points[i].x, points[i].y, width / 2, 0, Math.PI * 2);
      } else {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        accDist += dist;
        if (accDist >= spacing) {
          ctx.moveTo(points[i].x + width / 2, points[i].y);
          ctx.arc(points[i].x, points[i].y, width / 2, 0, Math.PI * 2);
          accDist = 0;
        }
      }
    }
    ctx.fill();
  }

  /**
   * 波浪笔刷：路径法线方向叠加正弦偏移
   * @param {Array} points
   * @param {number} width
   */
  _drawWave(points, width) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    const freq = 0.2;  // 频率（每像素弧度）
    const amp = width * 0.4;  // 振幅

    const offsetPoints = [];
    for (let i = 0; i < points.length; i++) {
      let nx = 0, ny = 0;
      if (i === 0 && points.length > 1) {
        // 起点：用第一段方向
        const dx = points[1].x - points[0].x;
        const dy = points[1].y - points[0].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          nx = -dy / len;
          ny = dx / len;
        }
      } else if (i === points.length - 1) {
        // 终点：用最后一段方向
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          nx = -dy / len;
          ny = dx / len;
        }
      } else {
        // 中间点：平均法线
        const dx1 = points[i].x - points[i - 1].x;
        const dy1 = points[i].y - points[i - 1].y;
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const dx2 = points[i + 1].x - points[i].x;
        const dy2 = points[i + 1].y - points[i].y;
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (len1 > 0 && len2 > 0) {
          nx = (-dy1 / len1 - dy2 / len2) / 2;
          ny = (dx1 / len1 + dx2 / len2) / 2;
          const norm = Math.sqrt(nx * nx + ny * ny);
          if (norm > 0) {
            nx /= norm;
            ny /= norm;
          }
        }
      }

      // 正弦偏移
      const offset = Math.sin(i * freq) * amp;
      offsetPoints.push({
        x: points[i].x + nx * offset,
        y: points[i].y + ny * offset
      });
    }

    // 绘制偏移后的路径
    ctx.beginPath();
    ctx.moveTo(offsetPoints[0].x, offsetPoints[0].y);
    for (let i = 1; i < offsetPoints.length; i++) {
      ctx.lineTo(offsetPoints[i].x, offsetPoints[i].y);
    }
    ctx.stroke();
  }

  /**
   * 锯齿笔刷：路径法线方向交替±偏移
   * @param {Array} points
   * @param {number} width
   */
  _drawZigzag(points, width) {
    if (points.length < 2) return;
    const ctx = this.ctx;
    const segmentLen = width * 0.8;  // 锯齿段长度
    const amp = width * 0.5;  // 振幅

    const zigzagPoints = [];
    let accDist = 0;
    let sign = 1;

    for (let i = 0; i < points.length; i++) {
      let nx = 0, ny = 0;
      if (i === 0 && points.length > 1) {
        const dx = points[1].x - points[0].x;
        const dy = points[1].y - points[0].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          nx = -dy / len;
          ny = dx / len;
        }
      } else if (i === points.length - 1) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          nx = -dy / len;
          ny = dx / len;
        }
      } else {
        const dx1 = points[i].x - points[i - 1].x;
        const dy1 = points[i].y - points[i - 1].y;
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const dx2 = points[i + 1].x - points[i].x;
        const dy2 = points[i + 1].y - points[i].y;
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (len1 > 0 && len2 > 0) {
          nx = (-dy1 / len1 - dy2 / len2) / 2;
          ny = (dx1 / len1 + dx2 / len2) / 2;
          const norm = Math.sqrt(nx * nx + ny * ny);
          if (norm > 0) {
            nx /= norm;
            ny /= norm;
          }
        }
      }

      if (i > 0) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        accDist += dist;
        if (accDist >= segmentLen) {
          sign = -sign;
          accDist = 0;
        }
      }

      zigzagPoints.push({
        x: points[i].x + nx * amp * sign,
        y: points[i].y + ny * amp * sign
      });
    }

    // 绘制锯齿路径
    ctx.beginPath();
    ctx.moveTo(zigzagPoints[0].x, zigzagPoints[0].y);
    for (let i = 1; i < zigzagPoints.length; i++) {
      ctx.lineTo(zigzagPoints[i].x, zigzagPoints[i].y);
    }
    ctx.stroke();
  }

  /**
   * 清空画布
   * @param {number} width - 画布宽度（px）
   * @param {number} height - 画布高度（px）
   */
  clear(width, height) {
    this.ctx.clearRect(0, 0, width, height);
  }
}

/**
 * 路径捕获辅助函数：throttle touchmove 事件防止过密
 * @param {Function} fn - 回调函数
 * @param {number} interval - 最小间隔（ms），默认 16（约 60fps）
 * @returns {Function}
 */
function throttle(fn, interval = 16) {
  let lastTime = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastTime >= interval) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}

module.exports = {
  StrokeRenderer,
  throttle,
  smoothPath,
  resampleUniform,
  averageSmooth
};
