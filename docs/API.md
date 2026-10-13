# 本项目 API 与数据库

同源 REST API，错误统一 `{ "error": "说明" }`。分页使用 page/limit。视频卡片字段包含 id、title、category、author、duration、views、likes、cover、mediaUrl 等。

| Method | Path | 登录 | 作用 |
| --- | --- | --- | --- |
| GET | `/api/health` | 否 | 应用和数据库健康 |
| GET | `/api/config` | 否 | 注册开关、上传上限 |
| GET | `/api/auth/me` | 否 | 当前用户与 CSRF token |
| POST | `/api/auth/register` | 否 | username/displayName/password |
| POST | `/api/auth/login` | 否 | username/password |
| POST | `/api/auth/logout` | 是 | 注销会话 |
| GET | `/api/categories` | 否 | 分区 |
| GET | `/api/videos` | 否 | q/category/sort/page/limit |
| GET | `/api/videos/:id` | 否 | 详情及当前账号互动状态 |
| POST | `/api/videos` | 是 | multipart：video/title/description/categoryId |
| DELETE | `/api/videos/:id` | 是 | 作者或管理员删除 |
| POST | `/api/videos/:id/view` | 否 | 播放计数，有限流 |
| PUT | `/api/videos/:id/like` | 是 | active: boolean，幂等 |
| PUT | `/api/videos/:id/library` | 是 | kind: favorite/later，active: boolean |
| PUT | `/api/videos/:id/history` | 是 | position: 秒 |
| GET | `/api/me/library` | 是 | kind: favorite/later/history/uploads，page |
| DELETE | `/api/me/history` | 是 | 清空自己的历史 |
| GET | `/api/me/stats` | 是 | 普通用户自己的统计；管理员空间统计 |
| GET | `/api/admin/overview` | 管理员 | 空间统计、系统运行状态、分区概览和最近投稿 |
| GET | `/api/admin/videos` | 管理员 | 管理员分页查看全部视频，支持 q/category/status |
| PATCH | `/api/admin/videos/:id` | 管理员 | 修改视频标题、简介和分区 |
| DELETE | `/api/admin/videos/:id` | 管理员 | 删除视频及其文件和关联互动记录 |
| GET/POST/PATCH | `/api/admin/users`、`/api/admin/users/:id` | 管理员 | 查看、创建和编辑账号角色/昵称 |
| POST | `/api/admin/users/:id/password` | 管理员 | 重置密码并撤销该账号全部会话 |
| DELETE | `/api/admin/users/:id/sessions` | 管理员 | 撤销指定账号的全部会话 |
| GET/DELETE | `/api/admin/comments`、`/api/admin/comments/:id` | 管理员 | 评论搜索与审核删除 |
| GET/DELETE | `/api/admin/danmaku`、`/api/admin/danmaku/:id` | 管理员 | 弹幕搜索与审核删除 |
| GET | `/api/admin/categories` | 管理员 | 分区搜索 q、分页、排序及视频/播放统计 |
| POST | `/api/admin/categories` | 管理员 | 创建分区：id/name/sortOrder |
| PATCH | `/api/admin/categories/:id` | 管理员 | 编辑名称和排序：name/sortOrder |
| DELETE | `/api/admin/categories/:id` | 管理员 | 删除空分区，至少保留一个分区 |
| GET | `/api/admin/audit` | 管理员 | 只读操作日志，支持 q/type/page/limit |
| GET/POST | `/api/videos/:id/comments` | POST 是 | 分页评论；body |
| DELETE | `/api/comments/:id` | 是 | 评论作者或管理员 |
| GET/POST | `/api/videos/:id/danmaku` | POST 是 | body/time/color |
| GET | `/media/videos/:filename` | 否 | 原视频流，Range/206 |
| GET | `/media/covers/:filename` | 否 | 本地 JPEG 封面 |

登录会话使用 `yingyu_session` Cookie，服务端只保存 token 的 SHA-256。登录后的所有非 GET 写请求需要 `X-CSRF-Token`，token 从登录响应或 `/api/auth/me` 获取。网页不把登录 token 放在 localStorage。密码使用随机 salt + scrypt。

主要状态码：400 输入无效，401 未登录，403 CSRF/来源/权限问题，404 不存在，409 用户名重复，413 文件过大，422 媒体无法处理，429 限流/并发处理已满，507 磁盘不足。

## 后台约定

后台列表返回 `{ items, total, page, limit, hasMore }`，默认每页 20 条，上限 50 条。请求页码超出结果范围时回到最后一页，空列表为第 1 页。视频支持 `status=ready|processing|failed`；用户支持 `role=admin|user`；评论和弹幕支持 `videoId`。总览包含 `videoStatuses`，最近视频包含 `status`。

分区标识最长 32 字符，以小写字母开头，仅包含小写字母、数字、下划线和短横线，创建后不可修改；名称为 1–32 字符；`sortOrder` 必须是 0–9999 的 JSON 整数，按排序值、标识升序排列。重复标识、删除非空分区或最后一个分区返回 409。

日志 `type` 为 `video|user|category|comment|danmaku`。每条记录包含 `id/actorUsername/action/targetType/targetId/summary/createdAt`；`action` 为 `create|update|delete|reset_password|revoke_sessions`。只记录后台接口成功执行的操作，与数据库变更在同一事务提交；不记录敏感认证字段、不补录历史、不覆盖前台写接口。日志没有修改或删除 API。

## 数据关系

```text
users 1 --- N sessions
users 1 --- N videos N --- 1 categories
users N --- N videos through video_likes
users N --- N videos through library (favorite/later)
users N --- N videos through history (position)
users 1 --- N comments N --- 1 videos
users 1 --- N danmaku  N --- 1 videos
```

删除视频会级联清理互动数据，再删除物理文件。异常中断或磁盘故障可能留下孤立文件，当前没有自动垃圾回收任务。上传先在 tmp 写临时文件，通过格式检查并成功生成封面后写数据库；正常错误路径会清理文件。

数据库使用 prepared statements，搜索以 `!` 转义 `%`、`_`。客户端用 Vue 文本插值显示评论/简介，不使用 `v-html`。数据库明文保存业务内容，因此备份也必须按私有数据保护。
