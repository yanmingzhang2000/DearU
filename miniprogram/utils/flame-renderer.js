// 蜡烛火焰渲染工具
// 自研实现：正弦抖动 + 渐变上色模拟火焰摇晃效果（调研确认无专用小程序库，10行级别可实现）

/**
 * 单根蜡烛的火焰渲染器
 */
class FlameRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.startTime = Date.now();
  }

  /**
   * 绘制一根蜡烛（底座 + 火焰）
   * @param {number} x - 蜡烛中心 x
   * @param {number} y - 蜡烛底部 y
   * @param {Object} options - { width, height, lit } lit=false 时只画烟不画火
   */
  drawCandle(x, y, options = {}) {
    const width = options.width || 16;
    const height = options.height || 60;
    const lit = options.lit !== false;
    const ctx = this.ctx;

    // 蜡烛主体
    ctx.save();
    ctx.fillStyle = '#FFF4E0';
    ctx.fillRect(x - width / 2, y - height, width, height);
    ctx.strokeStyle = '#F0D9B5';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - width / 2, y - height, width, height);
    ctx.restore();

    if (lit) {
      this._drawFlame(x, y - height);
    } else {
      this._drawSmoke(x, y - height);
    }
  }

  /**
   * 绘制摇晃的火焰
   * @param {number} x - 火焰基部 x（蜡烛顶部中心）
   * @param {number} y - 火焰基部 y
   */
  _drawFlame(x, y) {
    const ctx = this.ctx;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const sway = Math.sin(elapsed * 4) * 2; // 摇晃幅度 2px，频率 4Hz
    const flicker = 0.85 + Math.sin(elapsed * 9) * 0.15; // 大小闪烁

    const flameHeight = 24 * flicker;
    const flameWidth = 10 * flicker;

    ctx.save();
    ctx.translate(x + sway, y);

    // 外层火焰（橙色，椭圆形：顶端尖，底部圆）
    const outerGradient = ctx.createLinearGradient(0, 0, 0, -flameHeight);
    outerGradient.addColorStop(0, '#FF6B35');
    outerGradient.addColorStop(1, '#FFC95C');
    ctx.fillStyle = outerGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-flameWidth / 2, -flameHeight * 0.5, 0, -flameHeight);
    ctx.quadraticCurveTo(flameWidth / 2, -flameHeight * 0.5, 0, 0);
    ctx.fill();

    // 内层火焰（黄白色，更小）
    const innerGradient = ctx.createLinearGradient(0, 0, 0, -flameHeight * 0.6);
    innerGradient.addColorStop(0, '#FFE9A8');
    innerGradient.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = innerGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-flameWidth / 4, -flameHeight * 0.35, 0, -flameHeight * 0.6);
    ctx.quadraticCurveTo(flameWidth / 4, -flameHeight * 0.35, 0, 0);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 熄灭后的一缕烟（可选的视觉收尾）
   */
  _drawSmoke(x, y) {
    const ctx = this.ctx;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const drift = Math.sin(elapsed * 2) * 4;

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + drift, y - 15, x - drift, y - 30);
    ctx.stroke();
    ctx.restore();
  }
}

module.exports = { FlameRenderer };
