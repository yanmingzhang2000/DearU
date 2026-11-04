// 歌词同步工具
// 参考调研：音乐播放器 onTimeUpdate -> 匹配 LRC 行 -> 高亮 的通用模式
// v1 歌词固定（祝福语，非必须是"生日快乐"字面），不需要解析 LRC 文件格式，直接用结构化数组定义时间戳
//
// 当前曲目 assets/audio/celebration-song.mp3（Pixabay 下载，69 秒，含人声，整首播完才进入吹蜡烛阶段）：
// 还没有人逐句听过并标出每句歌词实际出现的秒数，所以这里先把 4 句歌词【均匀铺满全曲时长】
// （0s/18s/36s/54s 起），避免像之前"4句话全挤在前10秒、后面59秒歌词框空着"那样和实际演唱明显脱节。
// 这是能自动给出的最合理默认值，不是精确对齐结果。
// 如果想要逐句精准对齐（比如歌词卡点正好落在人声唱到对应词的瞬间），
// 需要实际听一遍这首歌，记录每句大致出现的秒数，再回来改下面的 t 值。
// 不要求曲目必须是"生日歌"——只要寓意好、免费授权（CC0/公有领域/平台免署名商用协议）即可，
// 见 assets/audio/README.txt 的获取指南。

/**
 * 默认歌词/祝福语时间轴（4 句，最后一句含寿星昵称占位）
 * 时间戳按 69 秒曲目均匀四分铺开，非逐句精确对齐（见上方注释）
 * 第 4 句含寿星昵称，见 buildLyrics()
 */
const DEFAULT_LYRICS = [
  { t: 0.0, text: '祝你生日快乐' },
  { t: 18.0, text: '祝你生日快乐' },
  { t: 36.0, text: '祝你生日快乐' },
  { t: 54.0, text: '亲爱的你生日快乐' }
];

/**
 * 按寿星昵称生成歌词（第 4 句 = 亲爱的{昵称}生日快乐）
 * @param {string} nickname - 房主设定的寿星昵称
 * @returns {Array} [{t, text}, ...]
 */
function buildLyrics(nickname) {
  const name = (nickname || '').trim() || '你';
  return DEFAULT_LYRICS.map(function (line, index) {
    return index === 3 ? { t: line.t, text: '亲爱的' + name + '生日快乐' } : { t: line.t, text: line.text };
  });
}

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

module.exports = { DEFAULT_LYRICS, buildLyrics, findActiveLyricIndex };
