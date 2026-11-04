const express = require('express');
const db = require('../db');
const dashboardAuthMiddleware = require('../middleware/dashboard-auth');
const {
  computeCoreMetrics,
  computeEventCounts,
  computeRoomStatusBreakdown,
  computeRecentEvents
} = require('../utils/dashboard-metrics');

const router = express.Router();

// GET /dashboard/metrics - 聚合指标 JSON（需要管理员密码，见 dashboard-auth.js）
// 路由本身不挂载在这里加鉴权中间件，是因为 HTML 页面（下方 / 路由）必须无鉴权即可加载，
// 否则浏览器直接访问会先看到裸的 401 JSON 而不是输入密码的界面。
router.get('/metrics', dashboardAuthMiddleware, (req, res) => {
  const recentLimit = Math.min(Number(req.query.recentLimit) || 50, 200);
  res.json({
    coreMetrics: computeCoreMetrics(db),
    eventCounts: computeEventCounts(db),
    roomStatusBreakdown: computeRoomStatusBreakdown(db),
    recentEvents: computeRecentEvents(db, recentLimit),
    generatedAt: new Date().toISOString()
  });
});

// GET /dashboard - 纯 HTML 看板页面（无鉴权，页面本身不含数据；加载后由浏览器端 JS
// 提示输入密码，密码存 sessionStorage，再用它去请求上面的 /metrics 接口）
router.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DearU 数据看板</title>
<style>
  :root {
    --bg: #faf6f2;
    --card-bg: #ffffff;
    --text: #3a2e2a;
    --muted: #8a7a72;
    --accent: #e0637a;
    --border: #eee0d8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
  }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 15px; color: var(--muted); margin: 32px 0 12px; }
  .login-box {
    max-width: 360px;
    margin: 120px auto;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px;
    text-align: center;
  }
  .login-box input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 16px 0;
    font-size: 14px;
  }
  .login-box button, .refresh-btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
  }
  .login-box .error { color: var(--accent); font-size: 13px; min-height: 18px; }
  #dashboard { display: none; }
  table { width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { color: var(--muted); font-weight: 500; }
  tr:last-child td { border-bottom: none; }
  .top-bar { display: flex; justify-content: space-between; align-items: center; }
  .timestamp { font-size: 12px; color: var(--muted); }
  .props-cell { font-family: monospace; font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* 北极星区 */
  .star-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    text-align: center;
  }
  .star-card .star-label { font-size: 14px; color: var(--muted); margin-bottom: 8px; }
  .star-card .star-value { font-size: 42px; font-weight: 700; line-height: 1; }
  .star-card .star-value.na { font-size: 22px; color: var(--muted); }
  .star-card .star-fraction { font-size: 13px; color: var(--muted); margin-top: 8px; }
  .star-card .star-rule { font-size: 12px; color: var(--muted); margin-top: 16px; }
  .star-badge {
    display: inline-block;
    margin-top: 10px;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
  }
  .star-badge.green { background: #e3f3e6; color: #2f7d3c; }
  .star-badge.yellow { background: #fbf0d9; color: #96720f; }
  .star-badge.red { background: #fbe4e4; color: #b3382c; }
  .star-badge.na { background: var(--border); color: var(--muted); }

  /* 漏斗区（横向，从左到右逐级变窄） */
  .funnel-track {
    display: flex;
    align-items: stretch;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 8px 8px;
    overflow-x: auto;
  }
  .funnel-seg {
    flex: 1 1 0;
    min-width: 92px;
    position: relative;
    padding: 0 4px;
  }
  .funnel-seg-shape {
    height: 64px;
    background: var(--accent);
    /* 梯形：左边界按上一级的收窄比例内缩，右边界按本级收窄比例内缩，
       两侧内缩量由 JS 内联 style 按 count/maxCount 算好写入，段与段之间视觉相接形成漏斗轮廓 */
    clip-path: polygon(0 var(--in-left, 0%), 100% var(--in-right, 0%), 100% calc(100% - var(--in-right, 0%)), 0 calc(100% - var(--in-left, 0%)));
  }
  .funnel-seg.is-warn .funnel-seg-shape { background: #c0392b; }
  .funnel-seg-name { font-size: 12px; font-weight: 600; margin-top: 8px; text-align: center; }
  .funnel-seg-count { font-size: 15px; font-weight: 700; text-align: center; margin-top: 2px; }
  .funnel-seg-conv { font-size: 11px; color: var(--muted); text-align: center; margin-top: 2px; min-height: 14px; }
  .funnel-seg-conv.warn { color: #b3382c; font-weight: 600; }
  .funnel-arrow {
    flex: 0 0 auto;
    width: 16px;
    align-self: center;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    margin-top: -40px;
  }
  .funnel-anomaly {
    background: #fbe4e4;
    border: 1px solid #f3b9b4;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 12px;
    color: #8a2a21;
    margin-top: 12px;
    line-height: 1.6;
  }

  /* 存量区（横向条块，中性配色区别于②的强调色，强调"存量"而非"转化"） */
  .stock-note { font-size: 12px; color: var(--muted); margin: -4px 0 12px; }
  .stock-track {
    display: flex;
    gap: 10px;
    overflow-x: auto;
  }
  .stock-seg {
    flex: 1 1 0;
    min-width: 110px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 10px;
    text-align: center;
  }
  .stock-seg-bar-track { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; height: 8px; overflow: hidden; margin-bottom: 10px; }
  .stock-seg-bar-fill { background: #b8a99a; height: 100%; border-radius: 6px; }
  .stock-seg-name { font-size: 12px; color: var(--muted); }
  .stock-seg-count { font-size: 20px; font-weight: 700; margin-top: 4px; }

  /* 原始数据折叠区 */
  details.raw-section summary {
    cursor: pointer;
    font-size: 15px;
    color: var(--muted);
    margin: 32px 0 12px;
    outline: none;
  }
  details.raw-section summary::-webkit-details-marker { color: var(--muted); }
  details.raw-section[open] summary { margin-bottom: 16px; }
  details.raw-section h3 { font-size: 13px; color: var(--muted); margin: 20px 0 8px; }
</style>
</head>
<body>

<div class="login-box" id="loginBox">
  <h1>DearU 数据看板</h1>
  <input type="password" id="passwordInput" placeholder="管理员密码" autocomplete="off">
  <div class="error" id="loginError"></div>
  <button onclick="attemptLogin()">进入看板</button>
</div>

<div id="dashboard">
  <div class="top-bar">
    <h1>DearU 数据看板</h1>
    <div>
      <span class="timestamp" id="generatedAt"></span>
      <button class="refresh-btn" onclick="loadData()">刷新</button>
    </div>
  </div>

  <h2>① 北极星指标（本周期 magic 是否成立）</h2>
  <div id="starCard"></div>

  <h2>② 漏斗：卡在哪一步（按 v1-埋点schema.md §1 的 8 步顺序）</h2>
  <div id="funnelCard"></div>

  <h2>③ 当前房间存量状态（现有多少房间停在哪一步，非转化率）</h2>
  <p class="stock-note">注意：这是"此刻"的库存快照，不是漏斗转化率；用灰棕色区分②的粉色转化漏斗，不要混着看。</p>
  <div id="stockTrack"></div>

  <details class="raw-section">
    <summary>④ 原始数据（调试用，默认收起）</summary>

    <h3>事件计数（v1-埋点schema.md §2 的 8 个事件，原始口径，未按漏斗排序）</h3>
    <table id="eventTable"><thead><tr><th>事件名</th><th>次数</th></tr></thead><tbody></tbody></table>

    <h3>最近事件明细</h3>
    <table id="recentTable">
      <thead><tr><th>时间</th><th>事件</th><th>房间</th><th>用户</th><th>属性</th></tr></thead>
      <tbody></tbody>
    </table>
  </details>
</div>

<script>
  var STORAGE_KEY = 'dearu_dashboard_password';

  function attemptLogin() {
    var pwd = document.getElementById('passwordInput').value;
    if (!pwd) return;
    sessionStorage.setItem(STORAGE_KEY, pwd);
    loadData();
  }

  function formatRate(rate) {
    if (rate === null || rate === undefined) return { text: 'N/A', isNa: true };
    return { text: (rate * 100).toFixed(1) + '%', isNa: false };
  }

  // 北极星判定线（来自 v1-埋点schema.md §4.5）：
  // rate === null（无样本）-> 灰色 N/A
  // rate >= 0.6 -> 绿色，继续打磨
  // rate < 0.3 -> 红色，视为"打开率"维度已不及格（<30% 打开即废）
  // 其余（0.3~0.6 之间）-> 黄色，接近及格线，继续观察
  function starJudgement(rate) {
    if (rate === null || rate === undefined) {
      return { level: 'na', text: '样本不足，暂无法判定' };
    }
    if (rate >= 0.6) {
      return { level: 'green', text: '🟢 达标，继续打磨 v1' };
    }
    if (rate < 0.3) {
      return { level: 'red', text: '🔴 低于判定线，建议先改流程/文案' };
    }
    return { level: 'yellow', text: '🟡 接近及格线，继续观察' };
  }

  function renderStarCard(coreMetrics) {
    var m = coreMetrics.starMetric;
    var r = formatRate(m.rate);
    var judge = starJudgement(m.rate);
    var el = document.getElementById('starCard');
    el.innerHTML =
      '<div class="star-card">' +
        '<div class="star-label">' + m.name + '</div>' +
        '<div class="star-value' + (r.isNa ? ' na' : '') + '">' + r.text + '</div>' +
        '<div class="star-fraction">' + m.numerator + ' 完成 / ' + m.denominator + ' 发出邀请</div>' +
        '<div class="star-badge ' + judge.level + '">' + judge.text + '</div>' +
        '<div class="star-rule">判定线：≥60% 继续打磨　|　&lt;30% 打开或 &lt;40% 走完 → 先改流程（详见 schema §4.5）</div>' +
      '</div>';
  }

  // 漏斗按 v1-埋点schema.md §1 的 8 步固定顺序排列（不按后端返回的 count 降序，
  // 否则步骤顺序会乱，无法看出"卡在哪一步"）。
  // 每步绑定一个事件名用于取 count，以及可选的 coreMetrics 字段名用于取现成转化率。
  var FUNNEL_STEPS = [
    { label: '1 建房', eventName: 'room_created' },
    { label: '2 TA进制作', eventName: 'invitee_entered_edit', rateKey: 'openRate' },
    { label: '3 完成制作', eventName: 'invitee_ready' },
    { label: '4 封装', eventName: 'room_sealed' },
    { label: '5 TA进庆祝', eventName: 'invitee_entered_celebrate' },
    { label: '6 仪式走完', eventName: 'celebration_completed', rateKey: 'walkthroughRate' },
    { label: '7 主动表达', eventName: 'user_expressed', rateKey: 'expressionRate' },
    { label: '8 TA后续建房', eventName: 'invitee_created_room', rateKey: 'kFactor' }
  ];

  // 梯形每侧的最大内缩比例（占段高度的百分之几），数值越小漏斗收窄越不明显，
  // 45% 时首尾对比最强（count=0 时几乎收成一个点，count=max 时几乎是满高矩形）
  var FUNNEL_MAX_INSET_PCT = 45;

  function insetPctForCount(count, maxCount) {
    if (maxCount <= 0) return FUNNEL_MAX_INSET_PCT;
    var ratio = Math.max(count / maxCount, 0.04); // 保底 4%，避免 count=0 时梯形塌缩成看不见的线
    return (1 - ratio) * FUNNEL_MAX_INSET_PCT;
  }

  function renderFunnelCard(eventCounts, coreMetrics) {
    var countMap = {};
    eventCounts.known.concat(eventCounts.unknown).forEach(function (row) {
      countMap[row.eventName] = row.count;
    });

    var maxCount = Math.max.apply(null, FUNNEL_STEPS.map(function (s) { return countMap[s.eventName] || 0; }));
    var segHtml = '';
    var anomalies = [];

    FUNNEL_STEPS.forEach(function (step, i) {
      var count = countMap[step.eventName] || 0;
      var prevCount = i > 0 ? (countMap[FUNNEL_STEPS[i - 1].eventName] || 0) : count;
      var insetLeft = insetPctForCount(prevCount, maxCount);
      var insetRight = insetPctForCount(count, maxCount);

      var convHtml = '<div class="funnel-seg-conv"></div>';
      var isWarn = false;
      if (i > 0) {
        var convText;
        if (step.rateKey && coreMetrics[step.rateKey] && coreMetrics[step.rateKey].rate !== null) {
          convText = formatRate(coreMetrics[step.rateKey].rate).text;
        } else if (prevCount > 0) {
          convText = ((count / prevCount) * 100).toFixed(1) + '%';
        } else {
          convText = 'N/A';
        }
        // 异常检测：后一步事件数大于前一步，说明埋点口径矛盾（漏斗不该变宽）
        if (count > prevCount) {
          isWarn = true;
          anomalies.push(
            '第' + (i + 1) + '步「' + step.label + '」(' + count + ') 大于第' + i + '步「' +
            FUNNEL_STEPS[i - 1].label + '」(' + prevCount + ')，数值矛盾，疑似漏埋点或埋点时机有误，建议核对代码而非当作正常转化解读。'
          );
        }
        convHtml = '<div class="funnel-seg-conv' + (isWarn ? ' warn' : '') + '">' + convText + (isWarn ? ' ⚠️' : '') + '</div>';
      }

      var arrowHtml = i > 0 ? '<div class="funnel-arrow">→</div>' : '';

      segHtml +=
        arrowHtml +
        '<div class="funnel-seg' + (isWarn ? ' is-warn' : '') + '">' +
          '<div class="funnel-seg-shape" style="--in-left:' + insetLeft + '%;--in-right:' + insetRight + '%"></div>' +
          '<div class="funnel-seg-name">' + step.label + '</div>' +
          '<div class="funnel-seg-count">' + count + '</div>' +
          convHtml +
        '</div>';
    });

    var anomalyHtml = '';
    if (anomalies.length > 0) {
      anomalyHtml = '<div class="funnel-anomaly">⚠️ 口径异常：<br>' + anomalies.join('<br>') + '</div>';
    }

    document.getElementById('funnelCard').innerHTML = '<div class="funnel-track">' + segHtml + '</div>' + anomalyHtml;
  }

  // 状态中文映射对照 v1-状态机.md §1：draft -> collaborating -> sealed -> awaiting -> completed
  var STATUS_LABELS = {
    draft: '草稿（房主制作中）',
    collaborating: '协作中（双方制作）',
    sealed: '已封装（待庆祝）',
    awaiting: '待庆祝（等待双方播放）',
    completed: '已完成（仪式走完）'
  };

  // 存量按状态机顺序排列（draft -> collaborating -> sealed -> awaiting -> completed），
  // 而非后端返回的任意 GROUP BY 顺序，这样横向排列时能看出"从新建到完成"的大致分布趋势
  var STATUS_ORDER = ['draft', 'collaborating', 'sealed', 'awaiting', 'completed'];

  function renderStockTrack(breakdown) {
    var cntByStatus = {};
    breakdown.active.forEach(function (row) { cntByStatus[row.status] = row.cnt; });

    var maxCnt = Math.max.apply(null, STATUS_ORDER.map(function (s) { return cntByStatus[s] || 0; }).concat([breakdown.deletedCount]));
    var segHtml = '';

    STATUS_ORDER.forEach(function (status) {
      var cnt = cntByStatus[status] || 0;
      var widthPct = maxCnt > 0 ? Math.max((cnt / maxCnt) * 100, cnt > 0 ? 4 : 0) : 0;
      segHtml +=
        '<div class="stock-seg">' +
          '<div class="stock-seg-bar-track"><div class="stock-seg-bar-fill" style="width:' + widthPct + '%"></div></div>' +
          '<div class="stock-seg-count">' + cnt + '</div>' +
          '<div class="stock-seg-name">' + (STATUS_LABELS[status] || status) + '</div>' +
        '</div>';
    });

    var deletedWidthPct = maxCnt > 0 ? Math.max((breakdown.deletedCount / maxCnt) * 100, breakdown.deletedCount > 0 ? 4 : 0) : 0;
    segHtml +=
      '<div class="stock-seg">' +
        '<div class="stock-seg-bar-track"><div class="stock-seg-bar-fill" style="width:' + deletedWidthPct + '%"></div></div>' +
        '<div class="stock-seg-count">' + breakdown.deletedCount + '</div>' +
        '<div class="stock-seg-name">已删除（软删除）</div>' +
      '</div>';

    document.getElementById('stockTrack').innerHTML = '<div class="stock-track">' + segHtml + '</div>';
  }

  function renderEventTable(eventCounts) {
    var tbody = document.querySelector('#eventTable tbody');
    tbody.innerHTML = '';
    eventCounts.known.concat(eventCounts.unknown).forEach(function (row) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + row.eventName + '</td><td>' + row.count + '</td>';
      tbody.appendChild(tr);
    });
  }

  function renderRecentTable(events) {
    var tbody = document.querySelector('#recentTable tbody');
    tbody.innerHTML = '';
    events.forEach(function (ev) {
      var tr = document.createElement('tr');
      var tdProps = document.createElement('td');
      tdProps.className = 'props-cell';
      tdProps.title = ev.properties || '';
      tdProps.textContent = ev.properties || '';
      tr.innerHTML =
        '<td>' + ev.created_at + '</td>' +
        '<td>' + ev.event_name + '</td>' +
        '<td>' + (ev.room_id || '-') + '</td>' +
        '<td>' + (ev.user_id || '-') + '</td>';
      tr.appendChild(tdProps);
      tbody.appendChild(tr);
    });
  }

  function loadData() {
    var pwd = sessionStorage.getItem(STORAGE_KEY);
    if (!pwd) return showLogin('');
    fetch('/api/v1/dashboard/metrics', { headers: { 'X-Dashboard-Password': pwd } })
      .then(function (res) {
        if (res.status === 401) {
          sessionStorage.removeItem(STORAGE_KEY);
          showLogin('密码错误，请重新输入');
          throw new Error('unauthorized');
        }
        if (!res.ok) throw new Error('request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        showDashboard();
        renderStarCard(data.coreMetrics);
        renderFunnelCard(data.eventCounts, data.coreMetrics);
        renderStockTrack(data.roomStatusBreakdown);
        renderEventTable(data.eventCounts);
        renderRecentTable(data.recentEvents);
        document.getElementById('generatedAt').textContent = '更新于 ' + data.generatedAt;
      })
      .catch(function (err) {
        if (err.message !== 'unauthorized') console.error(err);
      });
  }

  function showLogin(message) {
    document.getElementById('loginBox').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('loginError').textContent = message;
  }

  function showDashboard() {
    document.getElementById('loginBox').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
  }

  document.getElementById('passwordInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') attemptLogin();
  });

  loadData();
</script>
</body>
</html>`;

module.exports = router;
