const cakeEditor = require('../../utils/cake-editor');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    stickers: [
      { type: cakeEditor.STICKER_TYPES.STRAWBERRY, label: '草莓' },
      { type: cakeEditor.STICKER_TYPES.BLUEBERRY, label: '蓝莓' },
      { type: cakeEditor.STICKER_TYPES.CANDLE, label: '蜡烛' }
    ]
  },

  methods: {
    onStickerTap(e) {
      const stickerType = e.currentTarget.dataset.sticker;
      this.triggerEvent('select', { stickerType });
      this.triggerEvent('close');
    },

    onClose() {
      this.triggerEvent('close');
    }
  }
});
