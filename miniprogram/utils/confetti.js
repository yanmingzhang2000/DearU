// 彩带粒子特效工具
// 参考调研：WX-Confetti（小程序移植版 canvas-confetti），本模块自研一个最小实现
// 避免引入外部组件依赖，核心粒子系统算法参考调研标注的思路（位置/速度/重力/旋转/衰减）

/**
 * 彩带粒子系统
 */
class ConfettiRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width - 画布宽度（px）
   * @param {number} height - 画布高度（px）
   */
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.particles = [];
    this.colors = ['#FF6B9D', '#FFC75F', '#845EC2', '#4D96FF', '#6BCB77', '#FF8E72'];
  }

  /**
   * 从顶部喷发一批彩带粒子
   * @param {number} count - 粒子数量，默认 80
   */
  burst(count = 80) {
    for (let i = 0; i < count; i++) {
      this.particles.push(this._createParticle());
    }
  }

  _createParticle() {
    return {
      x: Math.random() * this.width,
      y: -20 - Math.random() * 100,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 3,
      size: 6 + Math.random() * 6,
      color: this.colors[Math.floor(Math.random() * this.colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
      opacity: 1,
      gravity: 0.15 + Math.random() * 0.1
    };
  }

  /**
   * 更新并绘制一帧
   * @param {number} deltaTime - 帧间隔（ms），用于速度缩放（当前实现按固定步长近似）
   */
  update() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.particles = this.particles.filter((p) => p.y < this.height + 50 && p.opacity > 0.02);

    this.particles.forEach((p) => {
      p.vy += p.gravity * 0.1;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      // 接近底部时逐渐淡出
      if (p.y > this.height * 0.7) {
        p.opacity -= 0.02;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  /**
   * 是否还有存活粒子（用于决定动画循环是否继续）
   */
  hasParticles() {
    return this.particles.length > 0;
  }

  clear() {
    this.particles = [];
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}

module.exports = { ConfettiRenderer };
