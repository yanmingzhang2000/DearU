// v1.1-转盘仪式与协作合并规格.md 第 5 节：前端显示侧合并
// 解决"轮询刷新不打断正在操作的手指"，与服务端 4.2 合并算法职责不重叠、互不依赖。
// draggingLayerId 只作为独立参数传入，不混进 cake 对象字段，不提交给服务端。

/**
 * @param {Object} localCake - 本端当前内存里的 cakeState（{ style, flavor, layers }）
 * @param {Object} remoteCake - 本次轮询 GET 到的服务端 cakeState
 * @param {string|null} draggingLayerId - 本端手指正按着的图层 id（纯前端内存态，不落库）
 * @returns {Object} 合并后用于渲染的 cakeState
 */
function mergeForDisplay(localCake, remoteCake, draggingLayerId) {
  const localLayers = new Map(localCake.layers.map((l) => [l.id, l]));
  const merged = remoteCake.layers.map((remoteLayer) =>
    remoteLayer.id === draggingLayerId && localLayers.has(remoteLayer.id)
      ? localLayers.get(remoteLayer.id) // 本地手指正按着的图层，暂不采纳远端版本
      : remoteLayer // 其余信任服务端（含服务端已重排的 zIndex，不本地重算）
  );
  const remoteIds = new Set(remoteCake.layers.map((l) => l.id));
  for (const localLayer of localCake.layers) {
    if (!remoteIds.has(localLayer.id)) merged.push(localLayer); // 本地刚画、尚未保存成功的
  }
  return { style: remoteCake.style, flavor: remoteCake.flavor, layers: merged };
}

module.exports = { mergeForDisplay };
