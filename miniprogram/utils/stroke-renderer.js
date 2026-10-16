// Canvas 奶油涂鸦层渲染工具
// 参考调研：小程序画板教程的增量绘制模式（touchmove → lineTo 不清屏）
// 笔刷算法：自研，沿捕获路径二次渲染波浪/锯齿/圆点花纹

const { BRUSH_TYPES } = require('./cake-editor');

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
   * 绘制一条笔画
   * @param {Object} stroke - 笔画图层对象 { brushType, points, color, width }
   */
  drawStroke(stroke) {
    if (!stroke.points || stroke.points.length === 0) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (stroke.brushType) {
      case BRUSH_TYPES.ROUND:
        this._drawRound(stroke.points, stroke.width);
        break;
      case BRUSH_TYPES.WAVE:
        this._drawWave(stroke.points, stroke.width);
        break;
      case BRUSH_TYPES.ZIGZAG:
        this._drawZigzag(stroke.points, stroke.width);
        break;
      default:
        this._drawRound(stroke.points, stroke.width);
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
  throttle
};
