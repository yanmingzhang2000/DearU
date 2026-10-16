// 测试辅助工具：为每个测试文件提供独立的内存数据库 + 临时端口的 app 实例
// 避免测试互相污染生产数据库 (server/data/dearu-v1.db)

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/**
 * 启动一个用于测试的 app 实例，监听随机端口，使用独立临时数据库文件。
 * 每次调用都会清掉 require 缓存中的 db/路由模块，确保拿到全新的数据库连接。
 * @returns {Promise<{baseUrl: string, close: Function, dbPath: string}>}
 */
async function startTestServer() {
  const dbPath = path.join(os.tmpdir(), `dearu-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DEARU_TEST_DB_PATH = dbPath;

  // 清掉已缓存的模块，确保用新的 DEARU_TEST_DB_PATH 重新初始化数据库连接
  const modulesToReset = [
    '../src/db',
    '../src/schema',
    '../src/server',
    '../src/routes/auth',
    '../src/routes/rooms',
    '../src/routes/invites',
    '../src/routes/analytics',
    '../src/middleware/auth',
    '../src/utils/format',
    '../src/auth'
  ];
  modulesToReset.forEach((mod) => {
    const resolved = require.resolve(mod);
    delete require.cache[resolved];
  });

  const { createApp } = require('../src/server');
  const app = createApp();
  const db = require('../src/db'); // 拿到这次测试用的数据库连接，供 close() 时显式关闭

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://localhost:${port}/api/v1`,
        close: () => new Promise((res) => {
          server.close(() => {
            try {
              db.close();
            } catch (e) {
              // 已关闭或其他非致命错误，忽略
            }
            res();
          });
        }),
        dbPath
      });
    });
    server.on('error', reject);
  });
}

/**
 * 清理测试数据库文件（含 WAL/SHM 伴随文件）
 * Windows 上文件锁释放可能略有延迟，失败时重试几次再放弃
 * @param {string} dbPath
 */
async function cleanupTestDb(dbPath) {
  const suffixes = ['', '-wal', '-shm'];
  for (let attempt = 0; attempt < 5; attempt++) {
    let allRemoved = true;
    for (const suffix of suffixes) {
      const file = dbPath + suffix;
      if (fs.existsSync(file)) {
        try {
          fs.rmSync(file, { force: true });
        } catch (e) {
          allRemoved = false;
        }
      }
    }
    if (allRemoved) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  delete process.env.DEARU_TEST_DB_PATH;
}

/**
 * 便捷的 fetch 封装：自动拼 baseUrl，自动带 JSON header
 */
function makeClient(baseUrl) {
  return async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // 空响应体，忽略
    }
    return { status: res.status, body: data };
  };
}

/**
 * 登录一个 dev 身份，返回 accessToken
 */
async function loginAs(request, identity) {
  const res = await request('POST', '/auth/dev-login', { body: { identity } });
  return res.body.accessToken;
}

module.exports = { startTestServer, cleanupTestDb, makeClient, loginAs };
