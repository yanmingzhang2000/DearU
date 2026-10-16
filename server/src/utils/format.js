// 字段命名转换工具
// 数据库用 snake_case，前端 API 契约用 camelCase

/**
 * 转换房间对象为前端 API 格式
 * @param {Object} room - 数据库 room 行
 * @param {Object} celebration - 数据库 celebration 行（可选）
 * @param {string} role - 用户角色（creator/invitee）
 * @param {string} inviteToken - 邀请 token（可选）
 * @returns {Object} 前端期望的格式
 */
function formatRoomResponse(room, celebration = null, role = '', inviteToken = '') {
  const response = {
    room: {
      roomId: room.room_id,
      status: room.status,
      cakeState: typeof room.cake_state === 'string' ? JSON.parse(room.cake_state) : room.cake_state,
      creatorId: room.creator_id,
      inviteeId: room.invitee_id,
      inviteLinkToken: room.invite_link_token,
      inviteeReadyAt: room.invitee_ready_at,
      sealedAt: room.sealed_at,
      createdAt: room.created_at,
      completedAt: room.completed_at,
      celebration: null
    }
  };

  if (celebration) {
    response.room.celebration = {
      creatorStartedAt: celebration.creator_started_at,
      inviteeStartedAt: celebration.invitee_started_at,
      creatorCompletedAt: celebration.creator_completed_at,
      inviteeCompletedAt: celebration.invitee_completed_at
    };
  }

  if (role) {
    response.role = role;
  }

  if (inviteToken) {
    response.inviteToken = inviteToken;
  }

  return response;
}

/**
 * 转换邀请响应格式
 */
function formatInviteResponse(room, role, inviteToken) {
  return formatRoomResponse(room, null, role, inviteToken);
}

module.exports = {
  formatRoomResponse,
  formatInviteResponse
};
