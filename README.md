# 城哥的小视频站 · NAS 视频空间

一个原创、可自托管的视频站。界面采用接近 B 站网页端的顶部导航、横幅、分区、轮播与视频网格，不使用 B 站商标、前端 bundle、账户体系或视频内容。默认是**受信任局域网内共享浏览、登录后投稿和互动**的模型，不是多租户私密网盘。内部数据库文件名和 Cookie 标识保留旧值以兼容已有本地数据。

## 已实现

- 视频首页、分区筛选、中文关键词搜索、按播放量排序、分页。
- 本地账号注册/登录/退出、管理员初始化、HttpOnly 会话 Cookie、CSRF 和同源检查。
- MP4/WebM 上传、FFprobe 检查、封面提取、HTML5 播放、HTTP Range、进度恢复。
- 点赞、收藏、稍后再看、观看历史、评论、时间轴弹幕。
- 投稿管理与作者/管理员删除权限，关联记录级联清理。
- `/admin` 管理后台：总览、视频状态筛选与编辑、用户管理、评论/弹幕审核、分区管理、操作日志。
- 本地媒体和 SQLite 持久化、备份工具、单容器 Docker Compose 部署。
- 桌面和移动端布局、本地 8 部演示视频（图片生成的 10 秒无声样片，明确标注）。

## 本机运行

依赖：Node.js 22.20+ 或 24 LTS、npm、FFmpeg/FFprobe。推荐 Node 24 LTS；Node 22 的 `node:sqlite` 会输出实验性 API 提示。

```powershell
git clone https://github.com/DJCCCCCCCC/chengge-video.git
cd chengge-video
npm ci
npm run init
npm run build
# 可选：首次下载公开示例图片并生成本地演示视频，需要网络和 FFmpeg
npm run seed
npm start
```

浏览器访问 `http://127.0.0.1:4300`。

首次 `npm run init` 自动生成随机管理员密码，保存于项目根目录 `.env` 的 `ADMIN_PASSWORD`；管理员用户名默认为 `admin`。不要提交或公开 `.env`。也可以在网页创建普通账号测试，当前本机允许注册。

`ADMIN_PASSWORD` 仅用于首次建立管理员，不会在每次启动时重设已有账号密码。本地 `.env` 默认绑定 `127.0.0.1`，不会直接暴露到局域网。

开发模式：先停止已有 4300 服务，然后 `npm run dev`；后端 4300、Vite 5173，访问 `http://127.0.0.1:5173`。两个进程随开发命令结束而关闭。

## 架构

```text
Browser (Vue 3 / Vue Router / Lucide)
         |
         | Same origin: REST JSON + multipart + Range media
         v
Express application :4300
  |- sessions / CSRF / rate limits / ownership checks
  |- SQLite (WAL, foreign keys, prepared statements)
  |- FFprobe validation / FFmpeg cover generation
  |- /media/videos and /media/covers
  `- built Vue static files + SPA routing
```

SQLite 适合家庭/小团队、低并发写入场景。视频不存数据库，只存 UUID 文件名及元数据。这里的“热门”仅是播放量排序，首页是最新上传排序，不是机器学习推荐。播放量为客户端播放触发计数，不做唯一观众去重。

数据库结构在 `server/schema.sql`，包含 users、sessions、categories、videos、video_likes、library、history、comments、danmaku、admin_audit、schema_migrations。生产数据在 `data/yingyu.sqlite`、`data/videos/`、`data/covers/`。

## 管理后台

管理员登录后可从账号菜单进入 `/admin`。支持搜索、筛选、10/20/50 条分页和刷新；查询条件保留在 URL，刷新或浏览器返回时仍然生效。

- 总览显示真实数据库统计、发布状态、分区数量、系统状态和最近投稿；状态与分区可直接进入相应视频列表。
- 用户管理支持创建账号、编辑昵称/角色、重置密码与撤销会话；禁止取消自己的管理员权限。
- 分区支持创建、改名、排序和删除空分区；至少保留一个分区，包含视频时禁止删除。调整同步到导航、投稿和视频编辑，重启后不会重新生成已删除的默认分区。
- 操作日志记录通过 `/api/admin` 成功执行的写操作，支持对象筛选和摘要搜索。业务变更与日志在同一数据库事务中提交，不记录密码、Cookie 或 CSRF 令牌。
- 日志自功能启用后产生，不补录历史行为，也不包含前台投稿、互动和前台删除接口；它是本地管理记录，不是不可篡改审计系统。

## NAS 部署

见 [部署手册](docs/NAS_DEPLOYMENT.md)。设备 CPU 架构、内存、UGOS 版本和 Docker 版本尚未提供，因此这里只给出可调的通用方案，不声称已在 4300 Plus 真机上验证。

已生成两种架构的离线镜像：

- Linux amd64：`chengge-video:2026.10.13`，位于 `releases/chengge-video-2026.10.13-linux-amd64/`，适用于 Intel/AMD x86-64。
- Linux arm64：`chengge-video:2026.10.13-arm64`，位于 `releases/chengge-video-2026.10.13-linux-arm64/`，适用于 ARM64/AArch64，不支持 32 位 ARM。

使用对应目录内的 `DEPLOY.md` 与无 build 的 `compose.yaml` 可直接导入部署，不需要源码或镜像仓库联网。镜像不含本机数据库和视频。ARM64 已在 x86-64 主机的模拟环境验证，尚未验证 NAS 真机。

Git 仓库仅包含源码、配置示例和部署模板；镜像 `.tar`、真实 `.env`、数据库、视频及本机测试结果不提交。上述镜像文件为本地构建产物，不随 `git clone` 下载，也尚未发布到 GitHub Releases。没有镜像文件时，可使用下方的源码构建部署流程。

```sh
# 在 NAS 的项目目录，创建私有 .env 并填写配置
cp .env.example .env
# 编辑 ADMIN_PASSWORD 为至少 12 字符的唯一密码，建议关闭注册
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 yingyu
```

访问 `http://NAS_IP:4300`。Compose 内部强制 `HOST=0.0.0.0`，本机 `.env` 的 HOST 不会导致容器不可访问。

## 验证

```sh
npm test
npm run build
npm run test:ui
npm run test:admin-ui
docker compose config --quiet
```

API 测试使用独立临时数据库和真实 FFmpeg 小视频，覆盖注册登录、CSRF、越权、上传验证、特殊字符搜索、Range、互动、持久化与级联删除。UI 测试要求本地服务已启动且演示片库存在；Windows 自动使用已安装 Edge，其他系统先 `npx playwright install chromium`，或设置 `BROWSER_PATH`。测试会创建带随机标记的普通账号，默认本地模式完成后清理该账号；远端 `TEST_BASE_URL` 模式不直接操作本地数据库。

后台浏览器测试在独立临时数据库和随机端口运行，使用构建后的前端以及本地演示视频/封面，结束后清理临时数据，不修改实际账号和片库。

测试报告和截图保存在 `test-results/`，本次结果见 [验证记录](docs/VERIFICATION.md)。

## 边界

- 没有实现自动转码、HLS 多码率、HEVC 转码、直播推流、关注私信、分布式推荐、断点续传。
- 支持的编码由 FFprobe 初筛，最终播放能力还取决于浏览器。最稳妥格式是 MP4 / H.264 / AAC。
- 所有 ready 视频可被当前网络访问者读取；收藏和历史按账号隔离，但视频不是账号私有。不要把端口直接映射到公网。
- 弹幕为数据库持久化 + 播放前加载，不是 WebSocket 实时广播；单视频目前返回最多 5000 条。
- 本地开发允许注册，NAS 建议 `ALLOW_REGISTRATION=false`，可信网络内按需启用。
- 已通过本机 Docker Desktop 的 AMD64 原生及 ARM64 模拟构建、导入、容器启动和媒体流程测试；NAS 真机与 ARM 原生性能仍未验证。
- 未执行 B 站下载代码；没有复制其后端。公开接口观察及其推断边界见 [接口分析记录](docs/BILIBILI_SERVER_OBSERVATIONS.md)。

## 备份

先停止服务，再运行 `npm run backup -- ./backups/backup-name`。该工具通过 `VACUUM INTO` 获取一致的数据库快照，并复制视频和封面。不要只复制正在使用的 `.sqlite` 而漏掉 WAL 中的数据。

演示素材来源与许可写在每个视频简介和 `data/demo-attribution.json`，网页与媒体在生成后可离线使用。正式使用请换成有权发布的视频。
