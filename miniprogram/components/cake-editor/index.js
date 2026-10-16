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
    // 是否只读模式（庆祝阶段展示用）
    readonly: {
      type: Boolean,
      value: false
    }
  },

  data: {
    cakeState: null,
    baseTypes: [
      { value: cakeEditor.BASE_TYPES.CREAM, label: '奶油' },
      { value: cakeEditor.BASE_TYPES.MILLE, label: '千层' },
      { value: cakeEditor.BASE_TYPES.MOUSSE, label: '慕斯' },
      { value: cakeEditor.BASE_TYPES.BASQUE, label: '巴斯克' }
    ],
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
      // 初始化蛋糕状态
      const initial = this.properties.initialState;
      const state = initial && initial.base ? initial : cakeEditor.createEmptyCake();
      this.cakeState = state;
      this.history = new cakeEditor.EditorHistory();
      this.history.push(state);
      
      // 获取屏幕信息，计算 px 到 rpx 转换比例
      const sysInfo = wx.getSystemInfoSync();
      this.pxToRpxRatio = 750 / sysInfo.windowWidth;
      
      this.setData({
        cakeState: state,
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
    onBaseChange(e) {
      if (this.properties.readonly) return;
      const base = e.currentTarget.dataset.base;
      cakeEditor.changeBase(this.cakeState, base);
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
      if (this.properties.readonly || !this.data.selectedLayerId) return;
      cakeEditor.removeLayer(this.cakeState, this.data.selectedLayerId);
      this.setData({
        selectedLayerId: '',
        stickerLayers: this._getStickerLayers(this.cakeState)
      });
      this._redrawStrokes();
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
     * 添加贴纸（供装饰库调用）
     */
    addSticker(stickerType, x, y) {
      if (this.properties.readonly) return;
      cakeEditor.addSticker(this.cakeState, stickerType, x, y);
      this.setData({
        stickerLayers: this._getStickerLayers(this.cakeState)
      });
      this._pushHistory();
    }
  }
});
