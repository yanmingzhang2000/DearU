// POST /auth/wechat-login 测试：覆盖缺少凭证配置、成功换取 openid、微信 errcode 映射、
// openid 复用已有用户三类场景。不发真实网络请求，用 node:test 内置 mock 替换
// utils/wechat.callCode2Session 的实现。
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer, cleanupTestDb, makeClient } = require('./helpers');

let server;
let request;

before(async () => {
  server = await startTestServer();
  request = makeClient(server.baseUrl);
});

after(async () => {
  await server.close();
  await cleanupTestDb(server.dbPath);
});

beforeEach(() => {
  delete process.env.WX_APPID;
  delete process.env.WX_SECRET;
});

test('缺少 code 参数时返回 400 MISSING_CODE', async () => {
  process.env.WX_APPID = 'test_appid';
  process.env.WX_SECRET = 'test_secret';
  const res = await request('POST', '/auth/wechat-login', { body: {} });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_CODE');
});

test('未配置 WX_APPID/WX_SECRET 时返回 501 NOT_IMPLEMENTED，不发出真实请求', async () => {
  const res = await request('POST', '/auth/wechat-login', { body: { code: 'fake_code' } });
  assert.strictEqual(res.status, 501);
  assert.strictEqual(res.body.error.code, 'NOT_IMPLEMENTED');
});

test('code2Session 成功换取 openid：首次登录创建新用户并签发 token', async (t) => {
  process.env.WX_APPID = 'test_appid';
  process.env.WX_SECRET = 'test_secret';

  const wechatUtil = require('../src/utils/wechat');
  t.mock.method(wechatUtil, 'callCode2Session', async () => ({
    openid: 'wx_openid_new_user',
    session_key: 'fake_session_key'
  }));

  const res = await request('POST', '/auth/wechat-login', { body: { code: 'valid_code' } });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.ok(res.body.user.user_id);
  assert.strictEqual(res.body.user.nickname, null);
});

test('同一 openid 第二次登录复用已有 user_id，不重复建号', async (t) => {
  process.env.WX_APPID = 'test_appid';
  process.env.WX_SECRET = 'test_secret';

  const wechatUtil = require('../src/utils/wechat');
  t.mock.method(wechatUtil, 'callCode2Session', async () => ({
    openid: 'wx_openid_repeat_user',
    session_key: 'fake_session_key'
  }));

  const first = await request('POST', '/auth/wechat-login', { body: { code: 'code_one' } });
  const second = await request('POST', '/auth/wechat-login', { body: { code: 'code_two' } });

  assert.strictEqual(first.status, 200);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(first.body.user.user_id, second.body.user.user_id);
});

test('微信返回 errcode 40029（code 无效）时映射为 400 INVALID_WX_CODE', async (t) => {
  process.env.WX_APPID = 'test_appid';
  process.env.WX_SECRET = 'test_secret';

  const wechatUtil = require('../src/utils/wechat');
  t.mock.method(wechatUtil, 'callCode2Session', async () => ({
    errcode: 40029,
    errmsg: 'invalid code'
  }));

  const res = await request('POST', '/auth/wechat-login', { body: { code: 'bad_code' } });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_WX_CODE');
});

test('微信返回 errcode 45011（频率限制）时映射为 400 RATE_LIMITED', async (t) => {
  process.env.WX_APPID = 'test_appid';
  process.env.WX_SECRET = 'test_secret';

  const wechatUtil = require('../src/utils/wechat');
  t.mock.method(wechatUtil, 'callCode2Session', async () => ({
    errcode: 45011,
    errmsg: 'frequency limit'
  }));

  const res = await request('POST', '/auth/wechat-login', { body: { code: 'any_code' } });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'RATE_LIMITED');
});

test('code2Session 网络请求失败时返回 502 WECHAT_UNREACHABLE', async (t) => {
  process.env.WX_APPID = 'test_appid';
  process.env.WX_SECRET = 'test_secret';

  const wechatUtil = require('../src/utils/wechat');
  t.mock.method(wechatUtil, 'callCode2Session', async () => {
    throw new Error('network down');
  });

  const res = await request('POST', '/auth/wechat-login', { body: { code: 'any_code' } });
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.error.code, 'WECHAT_UNREACHABLE');
});
