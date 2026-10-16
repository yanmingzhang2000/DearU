// 歌词同步工具
// 参考调研：音乐播放器 onTimeUpdate -> 匹配 LRC 行 -> 高亮 的通用模式
// v1 歌词固定（生日歌），不需要解析 LRC 文件格式，直接用结构化数组定义时间戳

/**
 * 默认歌词时间轴（中文"祝你生日快乐"，4句经典歌词）
 * 时间戳需要配合实际占位/正式音频长度调整
 */
const DEFAULT_LYRICS = [
  { t: 0.0, text: '祝你生日快乐' },
  { t: 3.0, text: '祝你生日快乐' },
  { t: 6.0, text: '祝你永远快乐' },
  { t: 9.5, text: '祝你生日快乐' }
];

/**
 * 根据当前播放时间找到应该高亮的歌词行索引
 * @param {Array} lyrics - [{t, text}, ...]，按 t 升序排列
 * @param {number} currentTime - 当前播放时间（秒）
 * @returns {number} 索引，-1 表示还没到第一句
 */
function findActiveLyricIndex(lyrics, currentTime) {
  let activeIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].t <= currentTime) {
      activeIndex = i;
    } else {
      break;
    }
  }
  return activeIndex;
}

module.exports = { DEFAULT_LYRICS, findActiveLyricIndex };
