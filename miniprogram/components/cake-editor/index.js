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
    stickerLayers: [],  // 贴纸和文字图层
    selectedLayerId: '',
    canUndo: false,
    canRedo: false,
    
    // 手势状态（内部）
    _touchStartPos: null,
    _prevTouches: null,
    _currentStrokePath: []  // 当前正在绘制的路径
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

    // ========== Canvas 涂鸦 ==========
    onCanvasTouchStart(e) {
      if (this.properties.readonly || !this.canvasCtx) return;
      const touch = e.touches[0];
      this.setData({
        _currentStrokePath: [{ x: touch.x, y: touch.y }]
      });
    },

    onCanvasTouchMove: strokeRenderer.throttle(function(e) {
      if (this.properties.readonly || !this.canvasCtx || !this.data._currentStrokePath) return;
      const touch = e.touches[0];
      const path = this.data._currentStrokePath;
      path.push({ x: touch.x, y: touch.y });
      
      // 实时绘制（增量）
      const ctx = this.canvasCtx;
      ctx.strokeStyle = '#FFE5EC';
      ctx.lineWidth = 20;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (path.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(path[path.length - 2].x, path[path.length - 2].y);
        ctx.lineTo(touch.x, touch.y);
        ctx.stroke();
      }
      
      this.setData({ _currentStrokePath: path });
    }, 16),

    onCanvasTouchEnd(e) {
      if (this.properties.readonly || !this.data._currentStrokePath || this.data._currentStrokePath.length < 2) {
        this.setData({ _currentStrokePath: [] });
        return;
      }

      // 保存笔画到图层
      cakeEditor.addStroke(
        this.cakeState, 
        this.data._currentStrokePath, 
        this.data.currentBrush,
        '#FFE5EC',
        20
      );
      
      // 重绘所有笔画（应用笔刷效果）
      this._redrawStrokes();
      
      this.setData({ 
        _currentStrokePath: [],
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
      } else if (e.touches.length === 2) {
        // 双指缩放+旋转
        const pinch = gesture.detectPinch(e.touches, this.data._prevTouches);
        if (pinch) {
          cakeEditor.updateLayer(this.cakeState, layerId, {
            scale: Math.max(0.2, Math.min(3.0, layer.scale * pinch.scale)),
            rotate: layer.rotate + pinch.rotate
          });
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
      this.triggerEvent('deleteLayer', { layerId: this.data.selectedLayerId });
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
      this.setData({
        cakeState: cakeState,
        flavorLocked: cakeState.style === cakeEditor.STYLES.BASQUE,
        stickerLayers: this._getStickerLayers(cakeState)
      });
      this._redrawStrokes();
    },

    /**
     * 添加贴纸（供装饰库调用）
     */
    addSticker(stickerType, x, y) {
      if (this.properties.readonly) return;
      cakeEditor.addSticker(this.cakeState, stickerType, x, y);
      this.setData({
        stickerLayers: this._getStickerLayers(this.cakeState)
      });
      this._pushHistory();
    },

    /**
     * 添加文字祝福（供页面「写句祝福」入口调用）
     */
    addText(text) {
      if (this.properties.readonly || !text) return;
      cakeEditor.addText(this.cakeState, text, 0, 0);
      this.setData({
        stickerLayers: this._getStickerLayers(this.cakeState)
      });
      this._pushHistory();
    }
  }
});
