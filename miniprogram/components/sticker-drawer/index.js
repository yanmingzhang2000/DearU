const cakeEditor = require('../../utils/cake-editor');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    // P1-5：按 STICKER_CATEGORIES 分组，素材表来自 STICKER_META
    groups: []
  },

  lifetimes: {
    attached() {
      const meta = cakeEditor.STICKER_META;
      const groups = cakeEditor.STICKER_CATEGORIES
        .map(cat => ({
          key: cat.key,
          label: cat.label,
          items: Object.keys(meta)
            .filter(type => meta[type].category === cat.key)
            .map(type => ({ type, label: meta[type].label }))
        }))
        .filter(g => g.items.length > 0);
      this.setData({ groups });
    }
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
