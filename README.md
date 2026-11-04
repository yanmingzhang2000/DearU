# DearU · 亲爱的你

DearU 是一个从零开发的微信小程序：让异地的两个人一起做一块生日蛋糕、一起完成一场私密的数字仪式。

当前版本是 **v1 核心闭环**，只支持生日场合，默认流程为：

1. 房主创建生日房间并先做装饰打底；
2. 房主分享唯一邀请链接给寿星；
3. 寿星进入房间，选择蛋糕品类/口味并继续装饰；
4. 寿星点击“我选好了”，房主终审封装；
5. 双方各自点击“开始庆祝”，通过微信通话陪伴完成仪式。

## 当前工程结构

```text
miniprogram/   原生微信小程序前端
server/        v1 后端工程目录
shared/        前后端共享契约
```

核心产品规格位于根目录：

- `亲爱的你-产品规格与版本路线图.md`
- `v1产品契约决策回答.md`
- `v1-状态机.md`
- `v1-数据模型.md`
- `v1-埋点schema.md`

## 本地开发

使用微信开发者工具打开 `miniprogram/`。当前 `miniprogram/project.config.json` 使用开发用 `touristappid`，生产环境需要替换为正式小程序 AppID，并配置 HTTPS 备案域名和微信后台合法 request 域名。

开发工具模式默认启用 `miniprogram/app.js` 中的 `devMode`，可切换房主、寿星和第三人身份验证房间权限。生产环境必须关闭开发登录，改用微信登录。

后端接口地址通过 `miniprogram/app.js` 的 `apiBaseUrl` 配置；当前后端和数据库仍处于 v1 最小原型开发阶段。

### 微信登录配置

`POST /auth/wechat-login` 已实现真实的 `code2Session` 换取 `openid` 逻辑（见 `server/src/utils/wechat.js`、`server/src/routes/auth.js`），但依赖真实小程序主体的 AppID/AppSecret：

1. 复制 `server/.env.example` 为 `server/.env`（已加入 `.gitignore`，不会被提交）。
2. 在[微信公众平台](https://mp.weixin.qq.com/) 的「开发 → 开发设置」中获取小程序的 AppID 和 AppSecret，填入 `server/.env` 的 `WX_APPID` / `WX_SECRET`。
3. 将 `miniprogram/project.config.json` 的 `appid` 从 `touristappid` 替换为同一个真实 AppID（`wx.login()` 拿到的 code 必须和后端 `code2Session` 用的是同一个 AppID，否则会报 `40029 invalid code`）。
4. 将 `miniprogram/app.js` 的 `devMode` 改为 `false`，重启小程序即会走 `wx.login()` → `/auth/wechat-login` 的真实登录链路。

**未配置 `WX_APPID`/`WX_SECRET` 时**，`/auth/wechat-login` 会返回 `501 NOT_IMPLEMENTED` 并提示去配置 `.env`，不会用空值发出请求；`devMode` 下的 `/auth/dev-login` 不依赖这两个变量，可在没有真实小程序主体时用于本地功能验证。

`JWT_SECRET` 同样在 `server/.env` 中配置，生产环境必须替换为随机强密钥，不可使用 `.env.example` 里的默认占位值。

### 房间生命周期管理

- **房主撤销邀请链接**：`POST /rooms/:id/revoke`（E10）。已完成的房间不可撤销；撤销是幂等操作，重复调用不报错。撤销只影响链接本身的后续使用，不影响已绑定双方通过房间内已有流程继续操作。
- **房主删除房间**：`DELETE /rooms/:id`（E11）。逻辑删除：写 `deleted_at` 并清空 `cake_state` 中的底胚/口味/图层等用户输入内容（不物理删除整行，保留审计痕迹），同时使邀请链接失效。任意房间状态下均可删除。
- **自动清理（S4）**：`server/scripts/cleanup-rooms.js` 按房间状态扫表并执行与 E11 相同的软删除逻辑：
  - `draft` / `collaborating`：连续 14 天无活动（`last_activity_at`）
  - `awaiting`：自封装（`sealed_at`）起 7 天未完成庆祝
  - `completed`：自完成（`completed_at`）起 30 天

  本脚本**不内置定时器**，不随 `npm start` 常驻进程启动，需要部署方自行调度：

  ```bash
  npm run cleanup:dry-run   # 只打印将被清理的房间，不实际写入，建议第一次部署先跑这个确认范围
  npm run cleanup           # 实际执行清理
  ```

  生产环境建议用系统 cron（Linux）、任务计划程序（Windows）或云函数定时触发器，每天调度一次 `npm run cleanup`。不内建调度是为了避免"进程重启后定时器丢失或重复触发"的运维风险，交给平台原生的定时任务机制更可靠。

  **清理日志**：每次通过 CLI 执行（`npm run cleanup` / `npm run cleanup:dry-run`）后，无论是否有房间被清理，都会追加写一行到 `server/data/cleanup.log`（含时间戳、dry-run 标记、被清理房间的 room_id/状态/原因）。这是专门为"后台调度场景"准备的——cron 跑完没人盯着终端，`console.log` 的内容看不到，必须落盘才能事后排查"昨晚到底清了哪些房间"。该文件已被 `.gitignore` 的 `*.log` 规则排除，不会被提交；通过 `require('../scripts/cleanup-rooms')` 直接调用 `runCleanup()` 纯函数（测试用的方式）不会写日志，只有 CLI 入口会写。

  **生产环境调度配置（部署到真实服务器后再做，本地开发机不需要配）**：

  - **Linux（crontab，多数生产场景）**：

    ```bash
    # 1. 确认 node 可执行文件的绝对路径（cron 环境变量很精简，PATH 里通常没有 nvm/手动装的 node）
    which node   # 例如输出 /usr/bin/node 或 /home/deploy/.nvm/versions/node/v20.x.x/bin/node

    # 2. 编辑该部署用户的 crontab
    crontab -e

    # 3. 添加一行：每天凌晨 3:00 执行一次（错开白天高峰，避免清理时恰好有人在操作房间）
    #    务必用绝对路径（node 可执行文件 + 项目目录），cron 不会继承你 shell 里的 cd/alias
    0 3 * * * cd /path/to/DearU/server && /usr/bin/node scripts/cleanup-rooms.js >> data/cleanup-cron-stdout.log 2>&1
    ```

    `>> ... 2>&1` 这段是把 cron 本身的标准输出/报错（比如 node 路径写错、脚本抛未捕获异常）额外存一份，和脚本内部业务层的 `cleanup.log` 是两个不同层面的日志，排查"调度没生效"时看这个，排查"清理逻辑结果"时看 `cleanup.log`。

  - **Windows（任务计划程序，如果生产部署在 Windows Server）**：

    1. 打开"任务计划程序"（Task Scheduler）→ 右侧"创建基本任务"
    2. 触发器：每天，设定一个低峰时段（如凌晨 3:00）
    3. 操作：选择"启动程序"
       - 程序/脚本：填 `node` 可执行文件的绝对路径（命令行输入 `where node` 查看）
       - 添加参数：`scripts/cleanup-rooms.js`
       - 起始于：填 `server` 目录的绝对路径（相当于 cwd，脚本里用的相对路径 `../data/dearu-v1.db` 依赖这个起始目录是 `server/`，填错会导致找不到数据库文件）
    4. 创建后建议先手动"运行"一次，确认 `server/data/cleanup.log` 有新增一行，再放心交给定时触发

  - **云函数定时触发器（如用 serverless 部署）**：思路一致——定时触发器调用一个入口，入口内 `require('./scripts/cleanup-rooms').runCleanup(db)`（直接调纯函数，自己管理 db 连接的开关），不依赖本地文件系统写日志的话可以把结果转发到云平台自带的日志服务，视具体云厂商 API 而定，这里不展开。

### 分享卡片文案与封面图

对应 `亲爱的你-产品规格与版本路线图.md` §3.5/§3.6。实现在 `miniprogram/utils/share-presets.js` + `miniprogram/pages/room/index.js` 的 `onShareAppMessage`：

- **文案**：微信小程序 `onShareAppMessage` 返回值只有 `title`/`path`/`imageUrl`/`promise` 四个字段（[官方文档](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onShareAppMessage-Object-object)），没有独立的"描述"字段，分享卡片上唯一可见的文字就是 `title`。规格 §3.6 的 3 条内置钩子文案直接作为 `title` 候选项，房主可在"唯一邀请链接"卡片里点击切换预设或输入自定义文案（限 50 字，不可留空）。
- **封面图**：按房间当前蛋糕的 `style`/`flavor` 自动选择对应的 `assets/cakes/{style}_{flavor}_thumb.png` 作为 `imageUrl`；蛋糕尚未选定时回退到默认封面（奶油香草）。规格里"场合符号角标"（🎂）暂未实现——现有素材没有带角标版本，v1 只有生日一个场合，角标信息量为零，留到场合变多、有真实设计资源时再补。
- **持久化**：文案选择存本地 `wx.setStorageSync`（按 `roomId` 区分），不同步到服务端。换设备或清缓存后会丢失、重新回到默认预设，这是刻意的产品取舍（轻量优先），不是遗漏。

## 部署说明

本项目不是 H5 网站，**不使用 GitHub Pages，也不需要 GitHub Pages 自动部署**。微信小程序通过微信开发者工具上传并提交审核；后端需要单独部署到满足 HTTPS、备案和微信域名白名单要求的服务器。

仓库中不再保留旧 H5 的 `index.html`、URL hash 接力逻辑或 GitHub Pages workflow。
