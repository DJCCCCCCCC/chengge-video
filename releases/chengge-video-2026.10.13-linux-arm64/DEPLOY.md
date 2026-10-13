# 城哥的小视频站 ARM64 镜像部署

镜像：`chengge-video:2026.10.13-arm64`。平台：**Linux / ARM64 (AArch64)**。适用于运行 64 位 ARM Linux 的 Docker 主机或 NAS，不适用于 32 位 ARM 系统。可通过 `uname -m` 查看设备架构，ARM64 通常显示 `aarch64`。

与 AMD64 版本为同一份应用代码，包含前台、管理后台、Node.js 和 FFmpeg。镜像不包含本机账号、密码、数据库或视频文件，新安装为独立空片库。Intel/AMD 主机应使用 AMD64 版本，避免不必要的模拟开销。

## 导入并启动

将本目录传到 ARM64 Docker 主机，在该目录执行：

```sh
docker load -i chengge-video-2026.10.13-linux-arm64.tar
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，填写至少 12 字符的唯一强密码 `ADMIN_PASSWORD`。默认用户名是 `admin`。密码含 `$` 或 `#` 时用单引号包住完整值，以免 Compose 解析为变量或注释。若主机 4300 端口被占用，只需修改 `.env` 中的 `PORT`。

```sh
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 yingyu
```

访问 `http://主机IP:4300`，后台为 `http://主机IP:4300/admin`。使用自定义 PORT 时替换端口。`/api/health` 应返回 `status: ok` 和 `database: true`。

本 Compose 使用已导入的 ARM64 镜像，不拉取仓库，不进行源码构建。Docker 主机无需另装 Node.js、npm 或 FFmpeg。

## NAS 图形界面设置

- 在镜像管理中导入 `.tar`，选择 `chengge-video:2026.10.13-arm64` 创建容器。
- 主机端口 `4300` 映射到容器 `4300/TCP`。
- 必填环境变量：`ADMIN_PASSWORD`，至少 12 字符。推荐 `ALLOW_REGISTRATION=false`。
- 专用数据卷挂载到 `/app/data`。建议使用附带 Compose，自动创建权限正确的 named volume。
- 使用 NAS 文件夹映射时，确保容器 UID/GID `1000:1000` 对这个专用文件夹可读写；不要给整个共享盘设 777。
- 重启策略 `unless-stopped`；不需要特权模式、Docker socket 或额外设备。

## 数据与安全

数据库、视频、封面存储在 `video-data` named volume 中，实际卷名包含 Compose 项目前缀。保持部署目录或项目名不变，以复用同一个数据卷。更新版本前先备份。

`docker compose down` 会保留数据。**不要运行 `docker compose down -v`**，否则数据卷会被删除。管理员已创建后，修改环境变量不会重置密码，应在后台重置。不要让多个应用容器同时写入一个 SQLite 数据目录。

默认面向可信局域网，不建议直接暴露到公网。仅在 HTTPS 下启用 `COOKIE_SECURE=true`，仅在确有一层受信任代理时设置 `TRUST_PROXY=1`。注册默认关闭，由管理员创建账号。

## 校验与验证范围

```sh
sha256sum -c SHA256SUMS.txt
docker image inspect chengge-video:2026.10.13-arm64 --format '{{.Os}}/{{.Architecture}}'
```

架构应为 `linux/arm64`。验证结果见 `verification.json`。本机为 x86-64，ARM64 运行验证通过 Docker 的模拟环境完成；模拟验证不等于 ARM NAS 真机或性能验证。原有 AMD64 镜像和 4303 本机站点不受影响。
