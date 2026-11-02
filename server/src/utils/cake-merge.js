// v1.1 `PUT /rooms/:id/cake` 保存语义：字段级权限 + 图层合并
// 对应 v1.1-转盘仪式与协作合并规格.md 第 4 节
// 拆成纯函数，不触碰数据库/HTTP，方便集成测试和将来的单测直接验证边界条件

/**
 * 第 4.1 节：底胚/口味字段级权限校验
 *
 * 规则（仅在 making_phase 处于 cake_editing / decorating 时生效，其余子阶段沿用 v1 既有权限，不受理）：
 * - cake_editing 阶段：style/flavor 发生变化（与数据库当前值不同）必须由寿星发起，否则视为越权
 * - decorating 及之后：style/flavor 的变化被静默忽略，不报错，落地值永远是数据库旧值
 *
 * @param {Object} params
 * @param {string} params.makingPhase - 数据库当前 making_phase
 * @param {boolean} params.isInvitee - 发起请求者是否是寿星
 * @param {Object} params.dbCake - 数据库当前 cake_state（已解析对象）
 * @param {Object} params.requestCake - 请求体里的 cakeState（已解析对象）
 * @returns {{ allowed: boolean, style: string, flavor: string }}
 *   allowed=false 表示整个请求应被 403 拒绝（不做部分成功）
 *   allowed=true 时 style/flavor 是本次应该落地的最终值（可能是旧值，也可能是请求体的新值）
 */
function checkBaseFlavorPermission({ makingPhase, isInvitee, dbCake, requestCake }) {
  const styleChanged = requestCake.style !== dbCake.style;
  const flavorChanged = requestCake.flavor !== dbCake.flavor;
  const hasChange = styleChanged || flavorChanged;

  if (!hasChange) {
    // 值本身没变，哪怕请求体里原样带着这两个字段，也不触发权限校验（避免误伤贴纸/涂鸦保存请求）
    return { allowed: true, style: dbCake.style, flavor: dbCake.flavor };
  }

  if (makingPhase === 'cake_editing') {
    if (!isInvitee) {
      // 房主或非法角色试图改 style/flavor：整个请求拒绝，不做字段级部分成功
      return { allowed: false, style: dbCake.style, flavor: dbCake.flavor };
    }
    return { allowed: true, style: requestCake.style, flavor: requestCake.flavor };
  }

  if (makingPhase === 'decorating') {
    // 锁定后任何人的变化都静默忽略，以数据库旧值为准，不报错
    return { allowed: true, style: dbCake.style, flavor: dbCake.flavor };
  }

  // awaiting_both / wheel_ready / wheel_playing：延续 v1 既有权限（不受本次改动影响），不限制
  return { allowed: true, style: requestCake.style, flavor: requestCake.flavor };
}

/**
 * 第 4.2 节：图层合并算法（upsert-only，无删除语义）
 * 客户端提交的图层全部采纳（新增或覆盖同 id）；数据库有、客户端没有的图层视为"对方新增"保留。
 * 最终按 zIndex 重排，服务端统一赋值，客户端不得再本地重算。
 *
 * @param {Array} dbLayers - 数据库当前图层数组
 * @param {Array} clientLayers - 请求体提交的图层数组
 * @returns {Array} 合并后的图层数组（已按 zIndex 重新排序赋值）
 */
function mergeCakeLayers(dbLayers, clientLayers) {
  const clientIds = new Set(clientLayers.map((l) => l.id));
  const merged = [...clientLayers];
  for (const dbLayer of dbLayers) {
    if (!clientIds.has(dbLayer.id)) {
      merged.push(dbLayer);
    }
  }
  merged.sort((a, b) => a.zIndex - b.zIndex);
  merged.forEach((layer, index) => {
    layer.zIndex = index;
  });
  return merged;
}

/**
 * 组合入口：对一次 PUT /cake 请求做完整的保存语义计算。
 * 先决定 style/flavor 的最终落地值（权限过滤），再对 layers 跑合并算法，
 * 两者合并进同一个最终对象，由调用方一次性写入数据库，不分两次写，避免中间状态。
 *
 * @param {Object} params
 * @param {string} params.makingPhase
 * @param {boolean} params.isInvitee
 * @param {Object} params.dbCake - 数据库当前 cake_state
 * @param {Object} params.requestCake - 请求体 cakeState
 * @returns {{ allowed: boolean, cakeState: Object|null }}
 */
function resolveCakeSave({ makingPhase, isInvitee, dbCake, requestCake }) {
  const permission = checkBaseFlavorPermission({ makingPhase, isInvitee, dbCake, requestCake });
  if (!permission.allowed) {
    return { allowed: false, cakeState: null };
  }

  const mergedLayers = mergeCakeLayers(dbCake.layers || [], requestCake.layers || []);

  return {
    allowed: true,
    cakeState: {
      style: permission.style,
      flavor: permission.flavor,
      layers: mergedLayers
    }
  };
}

module.exports = {
  checkBaseFlavorPermission,
  mergeCakeLayers,
  resolveCakeSave
};
