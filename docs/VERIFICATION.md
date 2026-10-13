# 本机验证记录

日期：2026-10-13，Asia/Shanghai。

## 环境

- Windows x64，Node.js 22.20.0，系统 FFmpeg/FFprobe。
- Playwright 驱动本机 Edge 的无头实例。
- 应用监听 `127.0.0.1:4300`，使用本地 SQLite 与文件媒体目录。
- Docker CLI 28.3.2；后续启动 Docker Desktop 4.44.3，Linux amd64 引擎可连接，镜像验证见文末。

## 已通过

- `npm run build`：生产静态资源构建成功。
- `npm test`：独立临时数据库中的 API、权限和媒体生命周期测试通过；包含 SQLite 快照及媒体恢复检查。
- `npm run test:ui`：站名、横幅、手动轮播、分类、搜索、注册登录、播放、收藏、稍后再看、评论、弹幕、真实上传后播放。
- 播放测试检查 `currentTime` 前进，并将已解码的视频帧绘制到 canvas 检查非空像素。
- 320、390、768、1920 像素宽度下，首页与播放页无横向溢出，页头品牌、搜索和操作区域无重叠。
- 人工检查桌面首页、移动首页、桌面播放页截图。
- `docker compose config --quiet`：Compose 配置可解析。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：此次检查无已知依赖漏洞。

`test-results/browser-result.json` 为浏览器测试结果，`test-results/*.png` 为各视口截图。测试写入随机前缀账号；成功的默认本机测试会清理该账号及其关联互动，播放计数不回退。

## 仍未验证

- ARM64 原生硬件和性能测试；本机 ARM64 验证通过模拟环境完成。
- 绿联 NAS 真机运行、UGOS 反向代理和硬件兼容性。
- 大文件长期上传、多人并发负载、弱网中断恢复、浏览器全覆盖。
- 公网安全部署；默认方案仅面向可信局域网。

## 本轮外观调整

- 站名统一为“城哥的小视频站”。
- 桌面左侧导航改为 B 站式顶部导航与下拉分区。
- 首页增加风景横幅、快捷入口、分区导航、带控制按钮的轮播与密集视频网格。
- 白底、蓝色交互、粉色投稿按钮；播放页标题在播放器上方，右侧紧凑推荐列表。
- 保留原有 API、用户数据和数据库标识，未为了更名迁移或清空数据库。
- 这是接近原站信息结构与视觉风格的实现，不是对原站截图的像素级复刻；横幅、站名和视频素材为本项目自己的内容。

## 后台管理续建验证

日期：2026-10-13，Asia/Shanghai。

- `npm run build`：通过。
- `npm test`：30 项通过，覆盖原有 API 与后台权限、分区验证、非空/最后分区删除保护、重新打开数据库后的持久化、日志字段脱敏和日志失败时的事务回滚。
- `npm run test:admin-ui`：通过，使用独立临时数据库，不修改实际站点数据。
- 浏览器验证：管理员登录、状态统计跳转、视频编辑、搜索/重置、分页 URL 刷新恢复、创建用户、分区增删改和前台同步、日志筛选、评论/弹幕删除、网络失败重试、撤销管理员权限后的拦截。
- 320、390、768、1440、1920 像素宽度下，七个后台页面均无页面级横向溢出；宽表格在局部容器内滚动。
- 检查手机弹窗边界及截图，修复保存失败后的焦点恢复；检查删除默认分区后的投稿选择，以及 32 字符长分区名在前台导航中的换行。
- 浏览器测试无页面脚本异常，无媒体请求失败。处理失败的视频使用占位图，不链接至不可播放页面。
- 人工检查总览、分区、操作日志、手机总览与手机弹窗截图。

后台结果：`test-results/admin-browser-result.json`；截图：`test-results/admin-*.png`。
新版本机预览使用 `http://127.0.0.1:4302/admin`，避开现有 4300 服务，继续使用原有数据目录。NAS 真机验证边界不变。

## Docker 镜像交付验证

日期：2026-10-13，Asia/Shanghai。

- `docker build --platform linux/amd64 --tag chengge-video:2026.10.13 .`：成功，使用官方 `node:24-bookworm-slim` 与 Debian FFmpeg。
- Docker Hub 首次直连超时；仅在构建进程设置本机已有 HTTP/HTTPS 代理后成功，未修改全局 Docker 或系统代理配置。
- `docker image save --platform linux/amd64`：成功，导出 `releases/chengge-video-2026.10.13-linux-amd64/chengge-video-2026.10.13-linux-amd64.tar`，264306176 字节。
- 对导出 `.tar` 执行 `docker image load`：成功。
- SHA-256：`95a3d98cc84257979db3c307faa734dee42b492e095cfc147b1026f6c780cb89`。
- `node tests/docker.mjs`：通过，使用交付 Compose、独立随机项目名和临时数据卷。测试以健康容器启动，验证管理员登录、关闭注册、后台权限、分区与日志、实际视频上传、FFmpeg 封面、Range/206 播放。
- Playwright 访问容器内构建的站点，验证后台页面和视频时间推进，并将视频帧绘制到 canvas 检查非空像素，无页面脚本异常。
- 容器重启后，视频元数据、账号、会话及操作日志持久保留；镜像以 UID 1000 运行，不包含本机 `.env`、测试结果或 Vite 开发依赖。
- 测试容器与专用临时卷已清理，实际站点数据库和本机 Node 服务未修改。

交付目录内含 `compose.yaml`、`.env.example`、`DEPLOY.md`、`SHA256SUMS.txt` 和 `verification.json`。首次部署需设置唯一管理员密码；镜像不包含本机账号或视频。ARM64 后续验证见下节，NAS 真机仍未验证。

## ARM64 镜像交付验证

日期：2026-10-13，Asia/Shanghai。

- 使用同一 Dockerfile 和应用代码，`docker build --platform linux/arm64 --tag chengge-video:2026.10.13-arm64 .` 成功；未覆盖 AMD64 镜像标签。
- `docker image save --platform linux/arm64` 导出 `releases/chengge-video-2026.10.13-linux-arm64/chengge-video-2026.10.13-linux-arm64.tar`，247945728 字节；再次 `docker image load` 导入成功。
- SHA-256：`962760367e3146ab0ccc78fd1b9af48dfec92e2842aa54c13c7d55b773f95aa6`。
- `node tests/docker.mjs arm64`：通过。镜像架构 `linux/arm64`，运行时 `process.arch=arm64`，Node.js v24.21.0；主机为 amd64，使用 Docker 模拟执行。
- 验证健康启动、非 root 用户、登录和后台权限、分区与日志、真实视频上传、ARM64 FFmpeg 封面生成、Range/206 视频流、浏览器后台及视频时间推进/非空帧像素。
- 重启后数据库、视频文件、管理员会话和日志保留；临时测试容器及数据卷已清理。
- 参数化后的同一验证脚本也通过 `node tests/docker.mjs amd64` 回归。
- 原有 `chengge-video-local` AMD64 部署继续监听 4303；未变更它的密码、数据卷或容器配置。

ARM64 部署目录内含单独的 Compose、配置示例、部署文档、校验值和 `verification.json`。截图为 `test-results/docker-arm64-admin.png`。本次不构成 ARM NAS 真机兼容性或性能验证。
