# 城哥的小视频站 Docker 镜像部署

镜像：`chengge-video:2026.10.13`。平台：**Linux / amd64 (x86-64)**，适用于 Intel/AMD 主机及相应 NAS。此文件不是 ARM64 镜像；ARM NAS 需要单独构建。Windows 使用 Docker Desktop 的 Linux 容器模式。

镜像包含站点前端、后台管理、Node.js 和 FFmpeg，不包含本机 `.env`、账号数据库或视频文件。新安装会创建空片库和管理员。已有本机数据需另行迁移，不会自动出现在容器里。

## 导入与启动

将本目录的镜像 `.tar`、`compose.yaml`、`.env.example` 放到 Docker 主机上的同一个部署目录，在该目录执行：

```sh
docker load -i chengge-video-2026.10.13-linux-amd64.tar
```

将 `.env.example` 复制为 `.env`。Linux / NAS：

```sh
cp .env.example .env
chmod 600 .env
```

Windows PowerShell：

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

编辑 `.env`，填写 `ADMIN_PASSWORD`，至少 12 个字符且使用唯一强密码。如果密码包含 `$` 或 `#`，用单引号包住完整值，避免 Compose 变量插值或注释解析。`ADMIN_USERNAME` 默认为 `admin`。主机端口占用时修改 `PORT`，容器内部端口保持 4300。

```sh
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 yingyu
```

访问 `http://主机IP:4300`，管理后台为 `http://主机IP:4300/admin`；如果修改了 `PORT`，使用新端口。健康接口 `/api/health` 应返回 `status: ok` 和 `database: true`。首次启动后 Docker 健康状态可能需要约 30 秒变为 healthy。

本目录的 Compose 仅使用已导入镜像，不联网拉取，不需要 Node.js、npm、FFmpeg 或源代码。Docker Desktop / Docker Engine 需要已安装并运行。

## NAS 图形界面

在镜像管理中使用“导入镜像”选择 `.tar`，然后创建容器：

- 镜像：`chengge-video:2026.10.13`。
- 端口映射：主机 `4300` 到容器 `4300/TCP`。
- 必填环境变量：`ADMIN_PASSWORD`，至少 12 字符；推荐设置 `ALLOW_REGISTRATION=false`。
- 数据持久化：将专用 Docker 数据卷挂载到 `/app/data`。优先使用本目录 Compose，它会自动创建权限正确的数据卷。
- 若使用 NAS 文件夹映射，需确保容器 UID/GID `1000:1000` 对这个专用文件夹有读写权限。不要把整个共享盘设为 777。
- 重启策略：`unless-stopped`。不需要特权模式、Docker socket 或额外设备。

## 数据与更新

数据库、上传的视频与封面保存在 `video-data` 数据卷内。实际卷名称含 Compose 项目前缀。请保留同一个部署目录或固定 Compose 项目名，以便下次使用同一个数据卷。

`docker compose down` 保留数据；**不要运行 `docker compose down -v`**，该命令会删除数据卷。更改 `.env` 中的管理员密码不会重置已存在的账号，应从管理后台重置密码。

更新前备份数据，导入新镜像后修改 `compose.yaml` 的镜像标签，再运行 `docker compose up -d --no-build`。不要让多个容器同时写同一个 SQLite 数据目录。

默认仅建议部署在可信局域网，勿直接将端口映射到公网。HTTPS 反向代理时设置 `COOKIE_SECURE=true`；只有确实存在一层受信任代理时才设置 `TRUST_PROXY=1`。默认关闭公开注册，可由管理员创建账号。

## 校验

SHA-256 校验文件为 `SHA256SUMS.txt`。Linux 可执行 `sha256sum -c SHA256SUMS.txt`；PowerShell 可使用 `Get-FileHash -Algorithm SHA256` 对比镜像文件哈希。

镜像构建与本机容器验证结果见 `verification.json`。这些检查不代表已在你的 NAS 真机上测试。
