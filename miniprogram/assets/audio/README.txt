生日歌音频资源说明与获取指南
================================

## 当前状态（v1 阶段）
`assets/audio/` 目录下**尚未放入**真实的 birthday-song.mp3 文件。
组件 `components/celebration-ritual/index.js` 中引用路径为：
  '/assets/audio/birthday-song.mp3'

目前已做兜底处理：音频文件不存在时，wx.createInnerAudioContext 触发 onError，
3 秒后自动跳过 singing 阶段进入 blowing（吹蜡烛），不会卡死或报错。

## 推荐方案（已调研确认）：Freesound 770325 CC0 音源

### 基本信息
- 链接：https://freesound.org/s/770325/
- 标题：Happy Birthday, by Group of Children
- 上传者：beautifuldaymonster1968
- 时长：0:20.767 秒
- 格式：WAV 44.1kHz 16bit Stereo（下载后需转 MP3）
- 授权：**Creative Commons 0 (CC0)** 
  原文："You can copy, modify, distribute and perform the sound, 
         even for commercial purposes, all without the need of asking permission."

### 音质说明（重要，请先试听再决定）
这是一位 56 岁女性刻意模仿童声跑调的演唱，有气声、off-pitch、业余感。
上传者描述："mimicking the inexpert, off-pitch, breathy way a GROUP of young children sing"
**不是**专业录音棚的完美演唱版本，而是故意做出的"不完美童真感"。

对恋人仪式产品的适配性需要你自己判断：
- ✅ 优点：真实童趣、温馨、不做作，CC0 授权零风险
- ⚠️ 考虑点：跑调感是否契合产品"浪漫精致"调性

### 如何获取并接入
1. 访问 https://freesound.org/s/770325/
2. 注册/登录 Freesound 账号（免费）
3. 点击 "Download" 按钮，下载 WAV 文件
4. 用格式转换工具（如 ffmpeg / Audacity / 在线转换器）转为 MP3：
   命令示例（如果有 ffmpeg）：
     ffmpeg -i 770325__beautifuldaymonster1968__happy-birthday.wav -b:a 192k birthday-song.mp3
5. 将转换后的 birthday-song.mp3 放入本目录（assets/audio/）
6. 更新 utils/lyrics-sync.js 中 DEFAULT_LYRICS 的时间戳，对齐真实音频的歌词出现时刻
   （当前时间戳是占位猜测值，需实际试听后调整）

### 许可证存档
为符合开源项目规范和未来合规审计，请在完成下载后：
- 在本目录创建子文件夹 license/
- 保存 Freesound 770325 页面截图（显示 CC0 标识）或将本 README 作为许可证明留存
- CC0 无需在产品内署名，但建议在代码仓库保留来源记录

## 备选方案

### 方案 B：Suno 付费版生成中文演唱（v1.5 升级项）
- 用 Suno Pro/Premier 订阅，生成"祝你生日快乐[名字]"中文演唱版
- 依据 Suno 服务条款，付费用户拥有生成歌曲并可商用
- 优点：中文演唱、可定制、音质专业
- 成本：需订阅 + 数分钟生成时间
- 注意：保留生成记录和订阅付费凭证，应对潜在版权质疑

### 方案 C：自行录制（最干净）
- 人声录制"祝你生日快乐"（旋律和歌词均属公有领域，无版权风险）
- 可叠加 OrangeFreeSounds CC BY 4.0 伴奏（https://orangefreesounds.com/happy-birthday-instrumental/）
- 使用 CC BY 4.0 素材需在"关于/致谢"页署名
- 优点：完全自有版权、最适配产品调性
- 成本：需录音设备和混音工时

## 不可使用的资源（合规红线）
❌ YouTube 音频库"标准许可"曲目（仅限 YouTube 平台内使用，不能用于小程序）
❌ 市面儿歌合集中的演唱录音（录音制作者享有邻接权，未授权商用有风险）
❌ 剪映 AI 音乐（服务条款授予剪映"永久独占许可"，商用有冲突）
❌ 来源不明的"免费下载站"MP3（盗版风险）

## 版权说明（调研依据）
"Happy Birthday to You" 歌曲本身：
- 旋律和原词于 2016 年经美国联邦法院判决确认为公有领域（Warner/Chappell 版权案）
- Hill 姊妹 1893 年创作，依著作权法保护期（作者逝世后 50/70 年），全球范围已过期
- 中文"祝你生日快乐"短句属通用名词/标语，不受著作权保护（台湾智财局 1141205 号解释）

实际录音文件的权利：
- 即使旋律/词公有领域，具体的"录音"仍享有录音制作者权（邻接权）
- 必须使用明确授权的录音（CC0/CC BY）或自有录音，不能随意抓取他人录制的版本

调研报告完整版见项目根目录 docs/ 或团队知识库。

---
最后更新：2026-10-16
调研执行：workbuddy
技术接入：AI assistant
