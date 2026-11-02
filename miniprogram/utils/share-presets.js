// 分享卡片文案与封面图：对应 亲爱的你-产品规格与版本路线图.md §3.5/§3.6
//
// 微信小程序 onShareAppMessage 的返回值只有 title/path/imageUrl/promise 四个字段
// （官方文档：https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object），
// 没有独立的"描述"字段，分享卡片上唯一可见的文字就是 title。
// 规格 §3.6 写的"一句话钩子"内置文案，在技术实现上直接作为 title 使用。

// 内置文案（规格 §3.6 固定文案，保守版，已对齐 SKU 边界，不承诺配送同步）
const SHARE_TITLE_PRESETS = [
  '今年不想只发红包了，给你做了个蛋糕——等它到的时候，我们一起吹蜡烛',
  '给你留了场只有你能看的生日仪式，现在点开刚好',
  '偷偷备了个小惊喜，和你有关，和蛋糕有关'
];

// 兜底封面图：蛋糕尚未选定底胚/口味时使用（对应建房时的初始值 cream + vanilla）
const DEFAULT_SHARE_IMAGE = '/assets/cakes/cream_vanilla_thumb.png';

// basque 只有一款口味（original），缩略图文件名是 basque_original_thumb.png，
// 不随 flavor 变化；其余三款底胚（cream/mille/mousse）按 flavor 正常拼接文件名。
const BASQUE_IMAGE = '/assets/cakes/basque_original_thumb.png';

/**
 * 根据蛋糕当前的底胚（style）和口味（flavor）选出对应的分享封面图路径。
 * 找不到对应素材（style/flavor 为空、未选定，或组合不存在）时回退到默认封面，
 * 不抛错、不返回空字符串（避免 imageUrl 为空导致分享卡片封面空白，见微信社区已知问题）。
 * @param {string} style - cream / mille / mousse / basque
 * @param {string} flavor - vanilla / strawberry / matcha / chocolate / mango / original
 * @returns {string} 封面图路径
 */
function resolveShareImage(style, flavor) {
  if (!style) return DEFAULT_SHARE_IMAGE;
  if (style === 'basque') return BASQUE_IMAGE;
  if (!flavor) return DEFAULT_SHARE_IMAGE;
  return `/assets/cakes/${style}_${flavor}_thumb.png`;
}

module.exports = {
  SHARE_TITLE_PRESETS,
  DEFAULT_SHARE_IMAGE,
  resolveShareImage
};
