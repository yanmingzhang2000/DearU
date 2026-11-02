const cakeEditor = require('../../utils/cake-editor');
const strokeRenderer = require('../../utils/stroke-renderer');
const gesture = require('../../utils/gesture');

Component({
  properties: {
    // 初始蛋糕状态（从后端加载或新建）
    initialState: {
      type: Object,
      value: null
    },
    // 是否只读模式（庆祝阶段展示用，贴纸/涂鸦/底胚口味全部不可编辑）
    readonly: {
      type: Boolean,
      value: false
    },
    // v1.1：底胚/口味区是否可编辑（规格第 4.1 节字段级权限）。
    // 涵盖两种禁用场景：(a) cake_editing 阶段房主侧（仅寿星可改）(b) decorating 阶段双方（已锁定）。
    // 与 readonly 不同：canEditBaseFlavor 为假时贴纸/涂鸦/文字仍可编辑，只锁底胚口味区。
    canEditBaseFlavor: {
      type: Boolean,
      value: true
    },
    // decorating 阶段专用文案标记（"已锁定"），仅影响禁用态提示文案，不影响禁用判断本身
    lockBaseFlavor: {
      type: Boolean,
      value: false
    }
  },

  data: {
    cakeState: null,
    styles: [
      { value: cakeEditor.STYLES.CREAM, label: '奶油' },
      { value: cakeEditor.STYLES.MILLE, label: '千层' },
      { value: cakeEditor.STYLES.MOUSSE, label: '慕斯' },
      { value: cakeEditor.STYLES.BASQUE, label: '巴斯克' }
    ],
    flavors: [
      { value: cakeEditor.FLAVORS.VANILLA, label: '香草' },
      { value: cakeEditor.FLAVORS.STRAWBERRY, label: '草莓' },
      { value: cakeEditor.FLAVORS.MATCHA, label: '抹茶' },
      { value: cakeEditor.FLAVORS.CHOCOLATE, label: '巧克力' },
      { value: cakeEditor.FLAVORS.MANGO, label: '芒果' }
    ],
    flavorLocked: false,
    brushTypes: [
      { value: cakeEditor.BRUSH_TYPES.ROUND, label: '圆点', icon: '●' },
      { value: cakeEditor.BRUSH_TYPES.WAVE, label: '波浪', icon: '〰️' },
      { value: cakeEditor.BRUSH_TYPES.ZIGZAG, label: '锯齿', icon: '⚡' }
    ],
    currentBrush: cakeEditor.BRUSH_TYPES.ROUND,
    // P1-3：涂鸦/文字共用调色板（口味联动的6色 + 口味同源色）
    strokePalette: [
      { value: '#FF7EA0', label: '草莓粉' },
      { value: '#E4576E', label: '樱桃红' },
      { value: '#F0DBA4', label: '香草黄' },
      { value: '#9CC98B', label: '抹茶绿' },
      { value: '#8B5A3C', label: '巧克力' },
      { value: '#FFB347', label: '芒果橙' }
    ],
    currentStrokeColor: '#FF7EA0',
    // P1-4：两档粗细
    strokeWidths: [
      { value: 12, label: '细' },
      { value: 24, label: '粗' }
    ],
    currentStrokeWidth: 24,
    stickerLayers: [],  // 贴纸和文字图层
    selectedLayerId: '',
    canUndo: false,
    canRedo: false,
    
    // 手势状态（内部）
    _touchStartPos: null,
    _prevTouches: null
  },

  lifetimes: {
    attached() {
      // 初始化蛋糕状态（兼容旧 base 单键数据）
      const initial = this.properties.initialState;
      let state;
      if (initial && (initial.style || initial.base)) {
        state = initial;
        if (!state.style && state.base) {
          state.style = state.base;
          state.flavor = state.base === cakeEditor.STYLES.BASQUE
            ? cakeEditor.FLAVORS.ORIGINAL
            : cakeEditor.FLAVORS.VANILLA;
          delete state.base;
        }
      } else {
        state = cakeEditor.createEmptyCake();
      }
      this.cakeState = state;
      this.history = new cakeEditor.EditorHistory();
      this.history.push(state);
      this._spawnIndex = 0; // P0-2：会话内的落点序号，连续添加自动避堆
      
      // 获取屏幕信息，计算 px 到 rpx 转换比例
      const sysInfo = wx.getSystemInfoSync();
      this.pxToRpxRatio = 750 / sysInfo.windowWidth;
      
      this.setData({
        cakeState: state,
        flavorLocked: state.style === cakeEditor.STYLES.BASQUE,
        stickerLayers: this._getStickerLayers(state),
        canUndo: this.history.canUndo(),
        canRedo: this.history.canRedo()
      });

      // 初始化 Canvas
      this._initCanvas();
    }
  },

  methods: {
    /**
     * 初始化 Canvas 2D 上下文
     */
    _initCanvas() {
      const query = this.createSelectorQuery();
      query.select('#stroke-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0]) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          
          const dpr = wx.getSystemInfoSync().pixelRatio;
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          ctx.scale(dpr, dpr);

          this.canvas = canvas;
          this.canvasCtx = ctx;
          this.renderer = new strokeRenderer.StrokeRenderer(ctx);
          this.canvasWidth = res[0].width;
          this.canvasHeight = res[0].height;

          // P0-3：画布边界（rpx 半宽/半高），拖拽与落点统一用它做约束
          this.containerBounds = {
            halfWidth: (res[0].width * this.pxToRpxRatio) / 2,
            halfHeight: (res[0].height * this.pxToRpxRatio) / 2
          };

          // 渲染现有笔画
          this._redrawStrokes();
        });
    },

    /**
     * 提取贴纸和文字图层（非笔画）
     */
    _getStickerLayers(state) {
      return state.layers.filter(layer => 
        layer.type === cakeEditor.LAYER_TYPE.STICKER || 
        layer.type === cakeEditor.LAYER_TYPE.TEXT
      );
    },

    /**
     * 重绘所有笔画图层
     */
    _redrawStrokes() {
      if (!this.canvasCtx || !this.renderer) return;
      this.renderer.clear(this.canvasWidth, this.canvasHeight);
      this._renderSavedStrokes();
    },

    /**
     * 仅绘制已保存的笔画（不清屏），供实时预览复用
     */
    _renderSavedStrokes() {
      if (!this.canvasCtx || !this.renderer || !this.cakeState) return;
      const strokes = this.cakeState.layers.filter(l => l.type === cakeEditor.LAYER_TYPE.STROKE);
      strokes.forEach(stroke => {
        this.renderer.drawStroke(stroke);
      });
    },

    /**
     * 推入历史栈并更新 UI
     */
    _pushHistory() {
      this.history.push(this.cakeState);
      this.setData({
        canUndo: this.history.canUndo(),
        canRedo: this.history.canRedo()
      });
      this._notifyChange();
    },

    /**
     * 通知父组件状态变化
     */
    _notifyChange() {
      this.triggerEvent('change', { cakeState: this.cakeState });
    },

    // ========== 底胚切换 ==========
    onStyleChange(e) {
      if (this.properties.readonly || !this.properties.canEditBaseFlavor) return;
      const style = e.currentTarget.dataset.style;
      cakeEditor.changeStyle(this.cakeState, style);
      this.setData({
        cakeState: this.cakeState,
        flavorLocked: style === cakeEditor.STYLES.BASQUE
      });
      this._pushHistory();
    },

    onFlavorChange(e) {
      if (this.properties.readonly || !this.properties.canEditBaseFlavor || this.data.flavorLocked) return;
      const flavor = e.currentTarget.dataset.flavor;
      cakeEditor.changeFlavor(this.cakeState, flavor);
      this.setData({ cakeState: this.cakeState });
      this._pushHistory();
    },

    // ========== 笔刷切换 ==========
    onBrushChange(e) {
      if (this.properties.readonly) return;
      const brush = e.currentTarget.dataset.brush;
      this.setData({ currentBrush: brush });
    },

    // P1-3/P1-4：颜色与粗细选择（涂鸦与文字祝福共用）
    onColorChange(e) {
      if (this.properties.readonly) return;
      this.setData({ currentStrokeColor: e.currentTarget.dataset.color });
    },

    onWidthChange(e) {
      if (this.properties.readonly) return;
      this.setData({ currentStrokeWidth: Number(e.currentTarget.dataset.width) });
    },

    // ========== Canvas 涂鸦 ==========
    // P0-5：点空白 = 取消选中；只有拖动超过阈值才起笔，轻点不会画出小点
    onCanvasTouchStart(e) {
      if (this.properties.readonly || !this.canvasCtx) return;
      const touch = e.touches[0];
      this._strokeStart = { x: touch.x, y: touch.y };
      this._strokeMoved = false;
      this._currentLivePath = null; // P1-2：实例变量承载实时路径，避免高频 setData
    },

    onCanvasTouchMove: strokeRenderer.throttle(function(e) {
      if (this.properties.readonly || !this.canvasCtx || !this._strokeStart) return;
      const touch = e.touches[0];

      if (!this._strokeMoved) {
        // 未超过起笔阈值前只监听位移，不入路径
        const dx = touch.x - this._strokeStart.x;
        const dy = touch.y - this._strokeStart.y;
        if (dx * dx + dy * dy < 8 * 8) return;
        this._strokeMoved = true;
        this._currentLivePath = [this._strokeStart, { x: touch.x, y: touch.y }];
        this._redrawWithLiveStroke();
        return;
      }

      this._currentLivePath.push({ x: touch.x, y: touch.y });
      this._redrawWithLiveStroke();
    }, 32),

    // P1-2：整笔重绘预览——清屏 → 已保存笔画 → 当前笔画（用当前笔刷/颜色/粗细）
    // 实时预览与 touchend 落笔走同一条 drawStroke 路径，所见即所得
    _redrawWithLiveStroke() {
      if (!this.canvasCtx || !this.renderer) return;
      const ctx = this.canvasCtx;
      ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      this._renderSavedStrokes();
      if (this._currentLivePath && this._currentLivePath.length >= 2) {
        this.renderer.drawStroke({
          brushType: this.data.currentBrush,
          points: this._currentLivePath,
          color: this.data.currentStrokeColor,
          width: this.data.currentStrokeWidth
        });
      }
    },

    onCanvasTouchEnd() {
      const moved = this._strokeMoved;
      const livePath = this._currentLivePath;
      this._strokeStart = null;
      this._strokeMoved = false;
      this._currentLivePath = null;

      if (!moved) {
        // 点空白：取消选中，不产生涂鸦
        this.setData({ selectedLayerId: '' });
        this._redrawStrokes();
        return;
      }

      if (!livePath || livePath.length < 2) {
        this._redrawStrokes();
        return;
      }

      // 保存笔画到图层（P1-3/P1-4：颜色与粗细取自当前选择，而非硬编码）
      cakeEditor.addStroke(
        this.cakeState,
        livePath,
        this.data.currentBrush,
        this.data.currentStrokeColor,
        this.data.currentStrokeWidth
      );

      // 重绘所有笔画（应用笔刷效果，与预览一致）
      this._redrawStrokes();

      this.setData({
        stickerLayers: this._getStickerLayers(this.cakeState)
      });
      this._pushHistory();
    },

    // ========== 贴纸拖拽 ==========
    onStickerTouchStart(e) {
      if (this.properties.readonly) return;
      const layerId = e.currentTarget.dataset.layerId;
      const touch = e.touches[0];
      this.setData({
        selectedLayerId: layerId,
        _touchStartPos: { x: touch.pageX, y: touch.pageY },
        _prevTouches: e.touches
      });
      // 通知父组件"手指正按着哪个图层"，供轮询到达时的显示侧合并使用（规格第 5 节）
      this.triggerEvent('draggingLayerChange', { layerId: layerId });
    },

    onStickerTouchMove(e) {
      if (this.properties.readonly || !this.data.selectedLayerId) return;
      
      const layerId = this.data.selectedLayerId;
      const layer = this.cakeState.layers.find(l => l.id === layerId);
      if (!layer) return;

      if (e.touches.length === 1) {
        // 单指拖拽：pageX/pageY 是屏幕 px，图层坐标存的是 rpx，需要按比例转换
        const delta = gesture.detectDrag(
          { pageX: e.touches[0].pageX, pageY: e.touches[0].pageY },
          { pageX: this.data._prevTouches[0].pageX, pageY: this.data._prevTouches[0].pageY }
        );
        const ratio = this.pxToRpxRatio || 2;
        cakeEditor.updateLayer(this.cakeState, layerId, {
          x: layer.x + delta.dx * ratio,
          y: layer.y + delta.dy * ratio
        });
        // P0-3：边界约束，拖不出画布
        cakeEditor.clampLayerPosition(layer, this.containerBounds);
      } else if (e.touches.length === 2) {
        // 双指缩放+旋转
        const pinch = gesture.detectPinch(e.touches, this.data._prevTouches);
        if (pinch) {
          cakeEditor.updateLayer(this.cakeState, layerId, {
            scale: Math.max(0.2, Math.min(3.0, layer.scale * pinch.scale)),
            rotate: layer.rotate + pinch.rotate
          });
          // 缩放放大后盒子占位变大，同样需要回约束
          cakeEditor.clampLayerPosition(layer, this.containerBounds);
        }
      }

      this.setData({
        _prevTouches: e.touches,
        stickerLayers: this._getStickerLayers(this.cakeState)
      });
    },

    onStickerTouchEnd(e) {
      if (this.properties.readonly) return;
      this.setData({
        _touchStartPos: null,
        _prevTouches: null
      });
      this._pushHistory();
      // 手指松开，拖拽保护解除
      this.triggerEvent('draggingLayerChange', { layerId: null });
    },

    // ========== 操作按钮 ==========
    onUndo() {
      if (!this.history.canUndo()) return;
      const prevState = this.history.undo();
      if (prevState) {
        this.cakeState = prevState;
        this.setData({
          cakeState: prevState,
          stickerLayers: this._getStickerLayers(prevState),
          canUndo: this.history.canUndo(),
          canRedo: this.history.canRedo()
        });
        this._redrawStrokes();
        this._notifyChange();
      }
    },

    onRedo() {
      if (!this.history.canRedo()) return;
      const nextState = this.history.redo();
      if (nextState) {
        this.cakeState = nextState;
        this.setData({
          cakeState: nextState,
          stickerLayers: this._getStickerLayers(nextState),
          canUndo: this.history.canUndo(),
          canRedo: this.history.canRedo()
        });
        this._redrawStrokes();
        this._notifyChange();
      }
    },

    onDeleteLayer() {
      // v1.1 规格第 4.3/10 节：删除走独立 F4 接口，PUT 永不处理删除语义。
      // 这里不在本地直接摘除图层，而是把事件交给父组件去调用 DELETE 接口，
      // 接口成功后父组件会用权威响应刷新本组件状态（见 room/index.js onDeleteLayer）。
      if (this.properties.readonly || !this.data.selectedLayerId) return;
      // 撤销/协作刷新后选中可能已悬空，校验后再发删除
      const exists = this.cakeState.layers.some(l => l.id === this.data.selectedLayerId);
      if (!exists) {
        this.setData({ selectedLayerId: '' });
        return;
      }
      this.triggerEvent('deleteLayer', { layerId: this.data.selectedLayerId });
    },

    // P0-4：选中工具条的变换操作（按钮化，替代不可发现的双指捏合手势；
    // 双指手势仍保留给熟练用户）
    onLayerTransform(e) {
      if (this.properties.readonly || !this.data.selectedLayerId) return;
      const op = e.currentTarget.dataset.op;
      const layer = this.cakeState.layers.find(l => l.id === this.data.selectedLayerId);
      if (!layer) return;

      if (op === 'grow') {
        layer.scale = Math.min(3.0, layer.scale * 1.25);
      } else if (op === 'shrink') {
        layer.scale = Math.max(0.2, layer.scale * 0.8);
      } else if (op === 'rot-left') {
        layer.rotate = layer.rotate - 15;
      } else if (op === 'rot-right') {
        layer.rotate = layer.rotate + 15;
      } else {
        return;
      }

      // 放大后占位变大，回约束到画布内
      cakeEditor.clampLayerPosition(layer, this.containerBounds);
      this.setData({ stickerLayers: this._getStickerLayers(this.cakeState) });
      this._pushHistory();
    },

    onClear() {
      if (this.properties.readonly) return;
      const that = this;
      wx.showModal({
        title: '清空画布',
        content: '确定清空所有装饰和涂鸦吗？底胚不会被清空。',
        confirmText: '清空',
        confirmColor: '#C14468',
        success(res) {
          if (res.confirm) {
            that.cakeState.layers = [];
            that.setData({
              selectedLayerId: '',
              stickerLayers: []
            });
            that._redrawStrokes();
            that._pushHistory();
          }
        }
      });
    },

    // ========== 对外接口 ==========
    /**
     * 获取当前蛋糕状态（供父组件保存）
     */
    getCakeState() {
      return JSON.parse(JSON.stringify(this.cakeState));
    },

    /**
     * v1.1：接受父组件传入的"轮询合并后的权威状态"（第 5 节 mergeForDisplay 的结果），
     * 同步进组件内部状态并重绘。不走 _pushHistory（这不是用户本地编辑动作，不应该进撤销栈，
     * 也不应该再触发一次 change 事件把它保存回服务端，否则会造成无意义的 PUT 循环）。
     * @param {Object} cakeState - 合并后的 { style, flavor, layers }
     */
    applyExternalCakeState(cakeState) {
      this.cakeState = cakeState;
      // 协作方可能删掉了当前选中的图层，清掉悬空选中，避免工具条指向不存在的图层
      const stillExists = this.data.selectedLayerId &&
        cakeState.layers.some(l => l.id === this.data.selectedLayerId);
      this.setData({
        cakeState: cakeState,
        flavorLocked: cakeState.style === cakeEditor.STYLES.BASQUE,
        stickerLayers: this._getStickerLayers(cakeState),
        selectedLayerId: stillExists ? this.data.selectedLayerId : ''
      });
      this._redrawStrokes();
    },

    /**
     * 添加贴纸（供装饰库调用）。
     * P0-2：不传坐标时按落点序列落在顶面区域内，连续添加自动避堆。
     */
    addSticker(stickerType, x, y) {
      if (this.properties.readonly) return;
      const spawn = (typeof x === 'number' && typeof y === 'number')
        ? { x: x, y: y }
        : cakeEditor.getSpawnPoint(this.cakeState.style, this._spawnIndex++);
      const layer = cakeEditor.addSticker(this.cakeState, stickerType, spawn.x, spawn.y);
      cakeEditor.clampLayerPosition(layer, this.containerBounds);
      this.setData({
        stickerLayers: this._getStickerLayers(this.cakeState),
        selectedLayerId: layer.id // 新元素直接选中，工具条立刻可用
      });
      this._pushHistory();
    },

    /**
     * 添加文字祝福（供页面「写句祝福」入口调用）
     */
    addText(text) {
      if (this.properties.readonly || !text) return;
      const spawn = cakeEditor.getSpawnPoint(this.cakeState.style, 0, 'text');
      // P1-3：文字祝福用当前调色板选中的颜色
      const layer = cakeEditor.addText(this.cakeState, text, spawn.x, spawn.y, this.data.currentStrokeColor);
      cakeEditor.clampLayerPosition(layer, this.containerBounds);
      this.setData({
        stickerLayers: this._getStickerLayers(this.cakeState),
        selectedLayerId: layer.id
      });
      this._pushHistory();
    }
  }
});
