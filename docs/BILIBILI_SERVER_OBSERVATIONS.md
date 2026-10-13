# Bilibili 服务端可观察边界

日期：2026-10-13（Asia/Shanghai）。这是针对公开接口契约和客户端调用的观察，不是服务端源码反编译。

## 本轮尝试

读取此前 REA 保存的首页产物及 Evidence，并发出一次普通、未登录 GET：

`https://api.bilibili.com/x/web-interface/nav`

观察到 HTTP 200，业务 JSON 中 `code=-101`、`message=账号未登录`、`data.isLogin=false`。data 中还包含 `wbi_img` 与 `ip_region` 字段。本报告只记录字段名，不展示地区值或临时签名相关值。

原响应保存在父工作区 `artifacts/public-nav-response.json`。该响应由普通 HTTP 工具获得，**不是 REA Evidence**。本轮没有携带浏览器 Cookie，没有登录、批量调用、枚举用户或绕过验证码。HTTP 200 不等于业务成功，应同时检查 JSON code。

## 从 REA 客户端证据可以确认什么

原始 Evidence：`ev_c122e9d1c050b5af891374622076543c1763fc5195f3cc59182e6c9c0955f066`，以及聚焦切片 `ev_7369148c270c314f612810a38199a20b8bf8fb55ea236f75ca2247c42827967d`。证据范围与资源限制见父目录 `BILIBILI_STRUCTURE_REPORT.md`。

1. 首页推荐客户端调用链分为参数组织、插件式请求封装、响应适配、store 更新、卡片渲染。
2. 浏览器推荐路径包含 `/wbi`，服务端渲染分支可省略；客户端存在 `SERVER_SIDE`、`SERVICE_DISCOVERY`、`LOCALE_META` 选项。它们反映客户端 SDK 的边界，不证明真实后端部署拓扑。
3. `api.bilibili.com`、`passport.bilibili.com`、`api.live.bilibili.com` 等 hostname 表明客户端面向多个服务域；不能等价推断出多少个微服务或哪种语言。
4. 推荐、历史、收藏、稍后再看、评论/弹幕等是适合独立建模的业务领域。本项目从功能需求出发自行设计 API 与数据库，不模拟 B 站私有协议或签名。

## 仍然未知

- B 站实际服务端源代码、框架与实现语言。
- 私有数据库表、缓存策略、消息系统、服务发现实现。
- 推荐模型、排序特征、风控算法、签名校验内部机制。
- 线上负载均衡、权限判断细节和内部网络拓扑。

远端服务器没有提供二进制、镜像、源码或有权限的调试入口，因此 REA 无法从网页直接恢复这些事实。要做服务端代码逆向，需要用户有权提供的服务端构建产物。当前项目中的 Express + SQLite 是明确的原创工程选择，而非对 B 站服务端技术栈的断言。
