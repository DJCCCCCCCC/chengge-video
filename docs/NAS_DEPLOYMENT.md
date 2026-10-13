# 绿联 NAS 部署与迁移

## 已构建镜像部署

Linux amd64 镜像及 Compose 配置位于 `releases/chengge-video-2026.10.13-linux-amd64/`，ARM64 版本位于 `releases/chengge-video-2026.10.13-linux-arm64/`。按 NAS 架构选择目录，无需复制源码；在 Docker 主机上按该目录的 `DEPLOY.md` 执行 `docker load`、设置 `.env` 中的管理员密码，然后运行 `docker compose up -d --no-build`。

本机 Docker Desktop 已验证两种镜像的健康启动、后台、视频上传/播放和重启持久化；AMD64 为原生运行，ARM64 为 x86-64 主机上的模拟运行，不代表 NAS 真机验证。镜像均不包含当前电脑的账号数据库和视频，已有数据迁移见第 4 节。

## 1. 先确认设备

当前用户提供的 CPU 架构/内存/系统/Docker 信息仍是占位符。不能仅凭“4300 Plus”推定硬件或系统兼容性。请从系统信息查看，或在受信任 SSH 终端执行：

```sh
uname -m
cat /etc/os-release
free -h
docker version
docker compose version
```

本 Dockerfile 采用官方 `node:24-bookworm-slim` 和 Debian FFmpeg，不固定 `platform`，目标是 Linux amd64 / arm64。实际能否启动仍需 NAS 的 Docker、内核和镜像仓库访问条件验证；32 位 ARM 不在本方案支持范围。

默认运行限制为 2 CPU / 1 GiB 内存，面向小型局域网场景，不是压测结论。构建时另需内存和磁盘空间。尚未开启硬件转码，不需要 `/dev/dri`、特权容器或 Docker socket 挂载。

## 2. 部署目录与配置

把 `nas-video` 项目目录放到 NAS 的应用目录；无需复制 `node_modules`、`dist`、测试截图或此前 REA 的 artifacts。

先创建 `.env`：

```dotenv
PORT=4300
NAS_BIND_IP=0.0.0.0
ADMIN_USERNAME=admin
ADMIN_PASSWORD=REPLACE_WITH_A_UNIQUE_LONG_RANDOM_PASSWORD
ALLOW_REGISTRATION=false
COOKIE_SECURE=false
TRUST_PROXY=0
MAX_UPLOAD_MB=2048
```

以上密码占位符必须换掉，`.env` 应仅管理员可读。端口占用时把 PORT 改为 4301 等空闲端口。推荐 NAS_BIND_IP 填实际 LAN 地址，配合 NAS 防火墙仅允许可信网段访问。

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 yingyu
curl http://127.0.0.1:4300/api/health
```

浏览器打开 `http://NAS_IP:4300`。健康接口应返回 `status=ok`、`database=true`。

首次数据库为空时用环境变量创建管理员。之后更改 ADMIN_PASSWORD 不会修改已有账号；迁移数据库后必须使用原账号密码。

## 3. 持久化

默认使用 Docker named volume `video-data`，实际名称受 Compose 项目名前缀影响。容器以 UID/GID 1000 的 `node` 用户运行，应用目录只读，数据目录可写。named volume 在首次初始化时继承镜像内的数据目录权限。

不要运行 `docker compose down -v`，它会删除 named volume。普通 `docker compose down` 不删除数据。

要改为 NAS 可见的 bind mount，可将 `volumes` 项替换为：

```yaml
volumes:
  - /YOUR/NAS/APPDATA/yingyu:/app/data
```

这是占位路径，必须替换为 NAS 上真实的专用应用目录，并仅对此目录赋予 UID 1000 所需读写权限。不要递归更改整个共享盘权限，不要使用 777 作为默认解决办法。NAS 的 ACL 可优先在管理界面配置。

SQLite 数据库需要本地可靠文件锁，不要把活动数据库放在不可靠的 SMB/NFS 网络挂载上。使用 NAS 自身本地卷；可把停机备份复制到远端。

## 4. 从本机迁移

1. 停止本机 Node 服务，避免备份期间上传或删除媒体。
2. 在本机项目目录运行 `npm run backup -- ./backups/nas-migration`。
3. 将生成的备份目录复制到 NAS，不公开原始 `.env`。
4. 先在 NAS 上创建并启动容器一次，随后 `docker compose stop yingyu`。
5. 容器停止后，把备份内容复制到 `/app/data`：

```sh
# 在备份目录位于 ./nas-migration 时；目标必须是此项目的容器
docker compose cp ./nas-migration/. yingyu:/app/data/
```

6. 若 `compose cp` 导致文件归 root 所有，可仅修复该数据卷：

```sh
docker compose run --rm --no-deps --user 0 --entrypoint sh yingyu -c 'chown -R 1000:1000 /app/data'
docker compose up -d
```

该命令针对容器内 `/app/data`，运行前确认 volume 的确指向本应用的专用数据目录。恢复到曾运行过的旧数据库时，应先备份旧目录并避免残留旧 `-wal`/`-shm` 文件；最稳妥方式是恢复到新的空数据卷，再切换服务，而不是覆盖正在运行的数据库。

## 5. HTTPS 与反向代理

默认方案只面向局域网。需要 HTTPS 时建议使用 NAS 自带反向代理或已维护的反向代理，把同域名路径转发到本服务。不要开放跨域写入，也不要暴露 SQLite 文件。

若恰好有一层受信任代理：`TRUST_PROXY=1`；不要盲目信任任意代理。HTTPS 时设置 `COOKIE_SECURE=true`，HTTP 调试时保持 false，否则浏览器不发送登录 Cookie。代理需保留 Host，并正确设置 `X-Forwarded-Proto`。

Nginx 示例（放入你已有的 HTTPS server 中）：

```nginx
client_max_body_size 2048m;
location / {
    proxy_pass http://127.0.0.1:4300;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_request_buffering off;
    proxy_read_timeout 300s;
}
```

如仍用 2 GiB 上传上限，应同时考虑代理、NAS 空间和较慢网络的超时。上传处理阶段目前有两任务并发限制，不是断点续传或异步转码队列。

## 6. 维护与备份

```sh
docker compose stop yingyu
docker compose run --rm --no-deps --volume /YOUR/NAS/BACKUPS:/backups yingyu node scripts/backup.mjs /backups/yingyu-YYYYMMDD
docker compose up -d
```

备份路径必须替换，且 UID 1000 可写。定期更新 Node/FFmpeg 镜像和 npm 锁定依赖，更新前备份。日志按 10 MB × 3 轮转。

## 7. 已知运行边界

- 使用原文件播放，不保证 iOS/旧浏览器能播放所有 WebM/AV1。
- 不支持多实例共用一份 SQLite；当前 Compose 仅一个应用实例。
- 不提供互联网级上传隔离/病毒扫描，媒体处理运行于非 root 容器但 FFmpeg 仍需及时更新。
- 公开注册和公网暴露会增加磁盘滥用风险；当前没有按用户配额，依靠访问边界、文件上限和磁盘剩余检查。
- 两个最大上传可能竞争剩余空间，必须为数据卷预留余量并监控容量；上传前检查不是存储配额系统。
