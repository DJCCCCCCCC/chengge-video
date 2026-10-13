<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { LayoutDashboard, Video, Users, MessageSquare, MessagesSquare, ShieldCheck, RefreshCw, Search, Pencil, Trash2, Plus, KeyRound, LogOut, X, Save, ChevronLeft, ChevronRight, Play, HardDrive, Activity, ArrowUpRight, FolderTree, ClipboardList, RotateCcw, CircleCheck, LoaderCircle, CircleAlert } from 'lucide-vue-next';
import { api, state, notify, count, duration } from '../state';
import '../admin.css';

const route = useRoute(), router = useRouter();
const tabs = [
  { id: 'overview', label: '数据总览', icon: LayoutDashboard },
  { id: 'videos', label: '视频管理', icon: Video },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'comments', label: '评论管理', icon: MessageSquare },
  { id: 'danmaku', label: '弹幕管理', icon: MessagesSquare },
  { id: 'categories', label: '分区管理', icon: FolderTree },
  { id: 'audit', label: '操作日志', icon: ClipboardList },
];
const tab = computed(() => tabs.find(item => item.id === route.query.tab)?.id || 'overview');
const heading = computed(() => tabs.find(item => item.id === tab.value));
const isAdmin = computed(() => state.user?.role === 'admin');
const overview = ref(null), items = ref([]), total = ref(0), page = ref(1), limit = ref(20);
const loading = ref(false), saving = ref(false), error = ref(''), q = ref(''), filter = ref(''), status = ref(''), videoId = ref('');
const modal = ref(null), dialog = ref(null), draft = reactive({}), modalError = ref('');
const statusLabels = { ready: '已发布', processing: '处理中', failed: '处理失败' };
const statusIcons = { ready: CircleCheck, processing: LoaderCircle, failed: CircleAlert };
const typeLabels = { video: '视频', user: '用户', category: '分区', comment: '评论', danmaku: '弹幕' };
const actionLabels = { create: '创建', update: '编辑', delete: '删除', reset_password: '重置密码', revoke_sessions: '撤销会话' };
const filterKey = computed(() => ({ videos: 'category', users: 'role', audit: 'type' }[tab.value]));
const hasFilters = computed(() => !!(q.value || filter.value || status.value || videoId.value));
const searchPlaceholder = computed(() => ({ videos: '搜索标题、投稿账号', users: '搜索账号、昵称', categories: '搜索分区名称、标识', audit: '搜索操作人、摘要、目标 ID' }[tab.value] || '搜索内容、视频、账号'));
let generation = 0, returnFocus, previousOverflow;
const bytes = value => {
  if (!value) return '0 B';
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
};
const timestamp = value => new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')).toLocaleString('zh-CN', { hour12: false });
const uptime = value => value >= 86400 ? `${Math.floor(value / 86400)} 天 ${Math.floor(value % 86400 / 3600)} 小时` : value >= 3600 ? `${Math.floor(value / 3600)} 小时 ${Math.floor(value % 3600 / 60)} 分钟` : `${Math.floor(value / 60)} 分钟`;
const pages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));
const metrics = computed(() => overview.value ? [
  { label: '视频总数', value: count(overview.value.totals.videos), icon: Video, tone: 'blue' },
  { label: '注册用户', value: count(overview.value.totals.users), icon: Users, tone: 'green' },
  { label: '累计播放', value: count(overview.value.totals.views), icon: Play, tone: 'pink' },
  { label: '视频文件容量', value: bytes(overview.value.totals.mediaBytes), icon: HardDrive, tone: 'amber' },
] : []);
const modalTitle = computed(() => ({
  video: '编辑视频', user: '编辑用户', createUser: '创建用户', password: '重置密码',
  sessions: '撤销登录会话', deleteVideo: '删除视频', deleteMessage: tab.value === 'comments' ? '删除评论' : '删除弹幕',
  category: '编辑分区', createCategory: '创建分区', deleteCategory: '删除分区',
}[modal.value?.kind] || ''));
async function sessionError(e) {
  if (e.status === 401) { state.user = null; state.csrf = null; }
  if (e.status === 403) {
    try { const session = await api('/api/auth/me'); state.user = session.user; state.csrf = session.csrfToken; } catch { /* Keep the original request error visible. */ }
  }
}
async function load(nextPage = page.value) {
  const current = ++generation;
  if (!isAdmin.value) { loading.value = false; overview.value = null; items.value = []; return; }
  loading.value = true; error.value = '';
  const activeTab = tab.value;
  const query = new URLSearchParams({ page: String(nextPage), limit: String(limit.value) });
  for (const key of ['q', 'category', 'role', 'status', 'videoId', 'type']) {
    if (typeof route.query[key] === 'string' && route.query[key]) query.set(key, route.query[key]);
  }
  try {
    const [data, categories] = await Promise.all([
      api(activeTab === 'overview' ? '/api/admin/overview' : `/api/admin/${activeTab}?${query}`),
      api('/api/categories'),
    ]);
    if (current !== generation) return;
    state.categories = categories.items;
    if (activeTab === 'overview') overview.value = data;
    else { items.value = data.items; total.value = data.total; page.value = data.page; limit.value = data.limit; }
  } catch (e) {
    if (current !== generation) return;
    error.value = e.message; await sessionError(e);
  } finally { if (current === generation) loading.value = false; }
}
function selectTab(id, query = {}) { router.push({ path: '/admin', query: { ...(id !== 'overview' && { tab: id }), ...query } }); }
function applyFilters(reset = false) {
  const query = { tab: tab.value, limit: String(limit.value) };
  if (reset) { q.value = ''; filter.value = ''; status.value = ''; videoId.value = ''; }
  if (!reset) {
    if (q.value.trim()) query.q = q.value.trim();
    if (filter.value && filterKey.value) query[filterKey.value] = filter.value;
    if (tab.value === 'videos' && status.value) query.status = status.value;
    if (['comments', 'danmaku'].includes(tab.value) && videoId.value) query.videoId = String(videoId.value);
  }
  if (router.resolve({ path: '/admin', query }).fullPath === route.fullPath) load(1);
  else router.push({ path: '/admin', query });
}
function goPage(value) { router.push({ query: { ...route.query, page: String(value), limit: String(limit.value) } }); }
watch([() => route.fullPath, () => state.user?.id, () => state.user?.role, () => state.initialized], () => {
  const value = key => typeof route.query[key] === 'string' ? route.query[key] : '';
  q.value = value('q'); filter.value = value(filterKey.value); status.value = value('status'); videoId.value = value('videoId');
  page.value = Math.max(1, Math.min(10000, Number.parseInt(value('page')) || 1));
  limit.value = [10, 20, 50].includes(Number(value('limit'))) ? Number(value('limit')) : 20;
  items.value = []; total.value = 0; close(true); load();
}, { immediate: true });
watch(modal, (value, old) => {
  if (value && !old) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  if (!value && old) document.body.style.overflow = previousOverflow || '';
});
onBeforeRouteLeave(() => !saving.value);
onBeforeRouteUpdate(() => !saving.value);
async function open(kind, item = null) {
  returnFocus = document.activeElement;
  Object.assign(draft, { title: item?.title || '', description: item?.description || '', categoryId: item?.categoryId || state.categories[0]?.id || '', username: '', displayName: item?.displayName || '', role: item?.role || 'user', password: '', id: item?.id || '', name: item?.name || '', sortOrder: item?.sortOrder ?? 0 });
  modalError.value = ''; modal.value = { kind, item };
  await nextTick();
  dialog.value?.querySelector('input,select,textarea,button')?.focus();
}
function close(force = false) {
  if (saving.value && force !== true) return;
  modal.value = null; draft.password = ''; modalError.value = '';
  returnFocus?.focus(); returnFocus = null;
}
function modalKeys(event) {
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  if (event.key !== 'Tab') return;
  const nodes = [...dialog.value.querySelectorAll('button,input,textarea,select')].filter(node => !node.disabled);
  if (!nodes.length) { event.preventDefault(); return; }
  const first = nodes[0], last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
async function submit() {
  if (saving.value) return;
  const { kind, item } = modal.value;
  const activePath = route.fullPath, actorId = state.user.id;
  saving.value = true; modalError.value = '';
  try {
    let result;
    if (kind === 'video') result = await api(`/api/admin/videos/${item.id}`, { method: 'PATCH', body: { title: draft.title, description: draft.description, categoryId: draft.categoryId } });
    if (kind === 'user') {
      result = await api(`/api/admin/users/${item.id}`, { method: 'PATCH', body: { displayName: draft.displayName, role: draft.role } });
      if (state.user?.id === item.id) state.user = result;
    }
    if (kind === 'createUser') result = await api('/api/admin/users', { method: 'POST', body: { username: draft.username, displayName: draft.displayName, password: draft.password, role: draft.role } });
    if (kind === 'password') result = await api(`/api/admin/users/${item.id}/password`, { method: 'POST', body: { password: draft.password } });
    if (kind === 'sessions') result = await api(`/api/admin/users/${item.id}/sessions`, { method: 'DELETE' });
    if (kind === 'deleteVideo') result = await api(`/api/admin/videos/${item.id}`, { method: 'DELETE' });
    if (kind === 'deleteMessage') result = await api(`/api/admin/${tab.value}/${item.id}`, { method: 'DELETE' });
    if (kind === 'createCategory') result = await api('/api/admin/categories', { method: 'POST', body: { id: draft.id, name: draft.name, sortOrder: draft.sortOrder } });
    if (kind === 'category') result = await api(`/api/admin/categories/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { name: draft.name, sortOrder: draft.sortOrder } });
    if (kind === 'deleteCategory') result = await api(`/api/admin/categories/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    if (state.user?.id !== actorId || route.fullPath !== activePath) return;
    saving.value = false; close();
    notify(kind.startsWith('delete') ? '内容已删除' : kind === 'sessions' ? '登录会话已撤销' : '已保存');
    if (result?.signedOut) { state.user = null; state.csrf = null; state.authOpen = true; }
    else await load(kind.startsWith('delete') && items.value.length === 1 ? Math.max(1, page.value - 1) : page.value);
  } catch (e) { modalError.value = e.message; await sessionError(e); }
  finally {
    saving.value = false;
    await nextTick();
    if (modal.value && dialog.value && !dialog.value.contains(document.activeElement)) {
      dialog.value.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)')?.focus();
    }
  }
}
onUnmounted(() => { generation++; draft.password = ''; if (modal.value) document.body.style.overflow = previousOverflow || ''; });
</script>

<template>
  <div class="page admin-page">
    <div class="admin-heading"><div><div class="eyebrow">城哥的小视频站</div><h1><ShieldCheck :size="24" />管理后台</h1></div><RouterLink to="/" class="text-button">返回视频站<ArrowUpRight :size="16" /></RouterLink></div>
    <div v-if="!state.initialized" class="loading-state">正在验证登录状态…</div>
    <div v-else-if="!isAdmin" class="empty-state admin-gate"><ShieldCheck :size="42" /><h3>{{ state.user ? '需要管理员权限' : '登录管理后台' }}</h3><p>{{ state.user ? '当前账号为普通用户' : '使用站点管理员账号登录' }}</p><button v-if="!state.user" class="primary-button" @click="state.authOpen = true">管理员登录</button><RouterLink v-else to="/" class="primary-button">返回首页</RouterLink></div>
    <div v-else class="admin-layout">
      <aside class="admin-sidebar"><div class="admin-sidebar-inner"><nav aria-label="后台导航"><button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" :disabled="saving" @click="selectTab(item.id)"><component :is="item.icon" :size="18" />{{ item.label }}</button></nav><div class="admin-identity"><span class="admin-status-dot"></span><span>{{ state.user.displayName }}<small>管理员</small></span></div></div></aside>
      <section class="admin-main" :aria-busy="loading">
        <div class="admin-section-heading"><h2>{{ heading.label }}</h2><div><span v-if="loading" class="muted">加载中…</span><button class="icon-button admin-action" title="刷新数据" aria-label="刷新数据" :disabled="loading" @click="load()"><RefreshCw :size="17" /></button></div></div>
        <div v-if="error" class="admin-error" role="alert">{{ error }}<button class="text-button" @click="load()">重试</button></div>
        <template v-else-if="tab === 'overview' && overview">
          <div class="admin-metrics"><div v-for="metric in metrics" :key="metric.label" class="admin-metric"><span :class="['admin-metric-icon', metric.tone]"><component :is="metric.icon" :size="22" /></span><div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong></div></div></div>
          <div class="admin-status-summary" aria-label="视频发布状态"><button v-for="(label, key) in statusLabels" :key="key" :class="['admin-status-item', key]" @click="selectTab('videos', { status: key })"><component :is="statusIcons[key]" :size="17" /><span>{{ label }}</span><strong>{{ count(overview.videoStatuses[key]) }}</strong><ChevronRight :size="15" /></button></div>
          <div class="admin-overview-columns">
            <section class="admin-overview-section"><h3>分区内容<button class="icon-button" title="管理分区" aria-label="管理分区" @click="selectTab('categories')"><FolderTree :size="16" /></button></h3><div class="admin-category-header"><span>分区</span><span>视频 / 播放</span></div><button v-for="category in overview.categories" :key="category.id" class="admin-category-row" :aria-label="`查看分区：${category.name}`" @click="selectTab('videos', { category: category.id })"><span><span>{{ category.name }}</span><span>{{ count(category.videos) }} / {{ count(category.views) }}</span></span><span class="admin-category-track"><i :style="{ width: `${overview.totals.videos ? category.videos / overview.totals.videos * 100 : 0}%` }"></i></span></button><div class="admin-interaction-totals"><button @click="selectTab('comments')">评论 <b>{{ count(overview.totals.comments) }}</b></button><button @click="selectTab('danmaku')">弹幕 <b>{{ count(overview.totals.danmaku) }}</b></button><span>点赞 <b>{{ count(overview.totals.likes) }}</b></span></div></section>
            <section class="admin-overview-section"><h3><Activity :size="17" />服务状态<span class="admin-status">运行中</span></h3><dl class="admin-system"><div><dt>运行环境</dt><dd>{{ overview.system.nodeVersion }} · {{ overview.system.platform }} / {{ overview.system.architecture }}</dd></div><div><dt>数据库</dt><dd>{{ overview.system.database }} · {{ bytes(overview.system.databaseBytes) }}</dd></div><div><dt>进程内存 / 运行时间</dt><dd>{{ bytes(overview.system.memoryBytes) }} / {{ uptime(overview.system.uptimeSeconds) }}</dd></div><div><dt>存储卷可用空间</dt><dd>{{ bytes(overview.system.diskFreeBytes) }} / {{ bytes(overview.system.diskTotalBytes) }}</dd></div><div><dt>单文件上限 / 并发处理</dt><dd>{{ overview.system.maxUploadMb }} MB / {{ overview.system.uploadConcurrency }}</dd></div><div><dt>公开注册</dt><dd>{{ overview.system.allowRegistration ? '已开启' : '已关闭' }}</dd></div></dl></section>
          </div>
          <section class="admin-recent"><div class="admin-section-heading"><h3>最近投稿</h3><button class="text-button" @click="selectTab('videos')">全部视频<ArrowUpRight :size="15" /></button></div><div v-if="!overview.recentVideos.length" class="admin-table-empty">暂无投稿</div><RouterLink v-for="video in overview.recentVideos" :key="video.id" :to="video.status === 'ready' ? `/watch/${video.id}` : { path: '/admin', query: { tab: 'videos', status: video.status } }" class="admin-recent-row"><img v-if="video.cover && video.status === 'ready'" :src="video.cover" :alt="video.title" /><span v-else class="admin-cover-fallback"><Video :size="25" /></span><div><strong>{{ video.title }}</strong><small>{{ video.author }} · {{ video.category }} · {{ statusLabels[video.status] }}</small></div><span>{{ count(video.views) }} 次播放</span><ArrowUpRight :size="16" /></RouterLink></section>
        </template>
        <template v-else-if="tab !== 'overview'">
          <form class="admin-toolbar" @submit.prevent="applyFilters()">
            <div class="admin-search"><Search :size="17" /><input v-model="q" :aria-label="`搜索${heading.label}`" :placeholder="searchPlaceholder" maxlength="100" /><button type="submit" class="icon-button" aria-label="执行搜索" title="搜索"><Search :size="17" /></button></div>
            <select v-if="tab === 'videos'" v-model="filter" aria-label="视频分区筛选" @change="applyFilters()"><option value="">全部分区</option><option v-for="category in state.categories" :key="category.id" :value="category.id">{{ category.name }}</option></select>
            <select v-if="tab === 'videos'" v-model="status" aria-label="视频状态筛选" @change="applyFilters()"><option value="">全部状态</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select>
            <select v-if="tab === 'users'" v-model="filter" aria-label="用户角色筛选" @change="applyFilters()"><option value="">全部角色</option><option value="admin">管理员</option><option value="user">普通用户</option></select>
            <select v-if="tab === 'audit'" v-model="filter" aria-label="操作对象筛选" @change="applyFilters()"><option value="">全部对象</option><option v-for="(label, key) in typeLabels" :key="key" :value="key">{{ label }}</option></select>
            <input v-if="['comments', 'danmaku'].includes(tab)" v-model="videoId" class="admin-video-filter" aria-label="所属视频 ID" placeholder="视频 ID" type="number" min="1" step="1" />
            <button v-if="hasFilters" type="button" class="icon-button admin-action" title="清除筛选" aria-label="清除筛选" @click="applyFilters(true)"><RotateCcw :size="16" /></button>
            <span class="admin-total" aria-live="polite">共 {{ count(total) }} 条</span>
            <button v-if="tab === 'users'" type="button" class="primary-button" @click="open('createUser')"><Plus :size="17" />创建用户</button>
            <button v-if="tab === 'categories'" type="button" class="primary-button" @click="open('createCategory')"><Plus :size="17" />创建分区</button>
          </form>
          <div class="admin-table-wrap">
            <table v-if="tab === 'videos'" class="admin-table admin-videos-table"><thead><tr><th>视频</th><th>投稿人 / 分区</th><th>播放 / 互动</th><th>大小 / 状态</th><th>上传时间</th><th>操作</th></tr></thead><tbody><tr v-for="video in items" :key="video.id"><td><div class="admin-video-cell"><img v-if="video.cover && video.status === 'ready'" :src="video.cover" :alt="video.title" /><span v-else class="admin-cover-fallback"><Video :size="23" /></span><div><RouterLink v-if="video.status === 'ready'" :to="`/watch/${video.id}`">{{ video.title }}</RouterLink><span v-else>{{ video.title }}</span><small>#{{ video.id }} · {{ duration(video.duration) }}<span v-if="video.isDemo"> · 演示</span></small></div></div></td><td>{{ video.author }}<small>{{ video.category }}</small></td><td>{{ count(video.views) }} 次播放<small>{{ video.likes }} 赞 · {{ video.commentCount }} 评论</small></td><td>{{ bytes(video.sizeBytes) }}<small :class="['admin-video-status', video.status]"><component :is="statusIcons[video.status]" :size="12" />{{ statusLabels[video.status] }}</small></td><td class="admin-date">{{ timestamp(video.createdAt) }}</td><td><div class="admin-row-actions"><button class="icon-button" :title="`编辑视频：${video.title}`" :aria-label="`编辑视频：${video.title}`" @click="open('video', video)"><Pencil :size="16" /></button><button class="icon-button admin-danger" :title="`删除视频：${video.title}`" :aria-label="`删除视频：${video.title}`" @click="open('deleteVideo', video)"><Trash2 :size="16" /></button></div></td></tr></tbody></table>
            <table v-else-if="tab === 'categories'" class="admin-table admin-categories-table"><thead><tr><th>分区名称</th><th>分区标识</th><th>排序</th><th>视频数量</th><th>累计播放</th><th>操作</th></tr></thead><tbody><tr v-for="category in items" :key="category.id"><td><strong>{{ category.name }}</strong></td><td><code>{{ category.id }}</code></td><td>{{ category.sortOrder }}</td><td><button class="admin-inline-link" :aria-label="`查看分区视频：${category.name}`" @click="selectTab('videos', { category: category.id })">{{ count(category.videos) }}<ArrowUpRight :size="13" /></button></td><td>{{ count(category.views) }}</td><td><div class="admin-row-actions"><button class="icon-button" :title="`编辑分区：${category.name}`" :aria-label="`编辑分区：${category.name}`" @click="open('category', category)"><Pencil :size="16" /></button><button class="icon-button admin-danger" :title="category.videos ? '该分区仍有视频' : state.categories.length <= 1 ? '至少保留一个分区' : `删除分区：${category.name}`" :aria-label="`删除分区：${category.name}`" :disabled="category.videos > 0 || state.categories.length <= 1" @click="open('deleteCategory', category)"><Trash2 :size="16" /></button></div></td></tr></tbody></table>
            <table v-else-if="tab === 'audit'" class="admin-table admin-audit-table"><thead><tr><th>操作摘要</th><th>操作人</th><th>动作</th><th>操作对象</th><th>时间</th></tr></thead><tbody><tr v-for="entry in items" :key="entry.id"><td>{{ entry.summary }}<small>#{{ entry.id }}</small></td><td>@{{ entry.actorUsername }}</td><td><span :class="['admin-audit-action', { destructive: entry.action === 'delete' }]">{{ actionLabels[entry.action] || entry.action }}</span></td><td>{{ typeLabels[entry.targetType] }}<small>#{{ entry.targetId }}</small></td><td class="admin-date">{{ timestamp(entry.createdAt) }}</td></tr></tbody></table>
            <table v-else-if="tab === 'users'" class="admin-table admin-users-table"><thead><tr><th>用户</th><th>角色</th><th>投稿</th><th>有效会话</th><th>注册时间</th><th>操作</th></tr></thead><tbody><tr v-for="user in items" :key="user.id"><td><div class="admin-user-cell"><span class="admin-user-avatar">{{ user.displayName.slice(0, 1) }}</span><div><strong>{{ user.displayName }}<span v-if="user.id === state.user.id" class="admin-self">我</span></strong><small>@{{ user.username }} · #{{ user.id }}</small></div></div></td><td><span :class="['admin-role', { elevated: user.role === 'admin' }]">{{ user.role === 'admin' ? '管理员' : '普通用户' }}</span></td><td>{{ user.videoCount }}</td><td>{{ user.sessions }}</td><td class="admin-date">{{ timestamp(user.createdAt) }}</td><td><div class="admin-row-actions"><button class="icon-button" :title="`编辑用户：${user.username}`" :aria-label="`编辑用户：${user.username}`" @click="open('user', user)"><Pencil :size="16" /></button><button class="icon-button" :title="`重置密码：${user.username}`" :aria-label="`重置密码：${user.username}`" @click="open('password', user)"><KeyRound :size="16" /></button><button class="icon-button" :title="`撤销会话：${user.username}`" :aria-label="`撤销会话：${user.username}`" :disabled="!user.sessions" @click="open('sessions', user)"><LogOut :size="16" /></button></div></td></tr></tbody></table>
            <table v-else class="admin-table admin-messages-table"><thead><tr><th>{{ tab === 'comments' ? '评论内容' : '弹幕内容' }}</th><th>所属视频</th><th>发送人</th><th>发布时间</th><th>操作</th></tr></thead><tbody><tr v-for="message in items" :key="message.id"><td><p class="admin-message-body">{{ message.body }}</p><small>#{{ message.id }}<span v-if="tab === 'danmaku'"> · {{ duration(message.time) }} <i class="admin-color-dot" :style="{ background: message.color }"></i></span></small></td><td><RouterLink :to="`/watch/${message.videoId}`">{{ message.videoTitle }}</RouterLink></td><td>{{ message.author }}<small>@{{ message.username }}</small></td><td class="admin-date">{{ timestamp(message.createdAt) }}</td><td><button class="icon-button admin-danger" :title="`删除${tab === 'comments' ? '评论' : '弹幕'} #${message.id}`" :aria-label="`删除${tab === 'comments' ? '评论' : '弹幕'} #${message.id}`" @click="open('deleteMessage', message)"><Trash2 :size="16" /></button></td></tr></tbody></table>
          </div>
          <div v-if="!items.length" class="admin-table-empty" role="status">{{ loading ? '正在加载…' : hasFilters ? '没有符合条件的记录' : '暂无记录' }}</div>
          <div class="admin-pagination"><span>第 {{ page }} / {{ pages }} 页</span><div><select v-model.number="limit" aria-label="每页条数" :disabled="loading" @change="applyFilters()"><option :value="10">10 条 / 页</option><option :value="20">20 条 / 页</option><option :value="50">50 条 / 页</option></select><button class="icon-button" aria-label="上一页" title="上一页" :disabled="loading || page <= 1" @click="goPage(page - 1)"><ChevronLeft :size="18" /></button><button class="icon-button" aria-label="下一页" title="下一页" :disabled="loading || page >= pages" @click="goPage(page + 1)"><ChevronRight :size="18" /></button></div></div>
        </template>
        <div v-else class="loading-state">正在加载站点数据…</div>
      </section>
    </div>
    <Teleport to="body">
      <div v-if="modal && isAdmin" class="admin-modal-backdrop" @click.self="close">
        <section ref="dialog" class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" @keydown="modalKeys"><div class="admin-dialog-heading"><h2 id="admin-dialog-title">{{ modalTitle }}</h2><button class="icon-button" aria-label="关闭弹窗" title="关闭" :disabled="saving" @click="close"><X :size="20" /></button></div>
          <form @submit.prevent="submit">
            <template v-if="['category', 'createCategory'].includes(modal.kind)"><label>分区名称<input v-model="draft.name" required maxlength="32" :disabled="saving" /></label><label>分区标识<input v-model="draft.id" required maxlength="32" pattern="[a-z][a-z0-9_-]*" autocomplete="off" :disabled="saving || modal.kind === 'category'" /></label><label>排序值<input v-model.number="draft.sortOrder" type="number" required min="0" max="9999" step="1" :disabled="saving" /></label></template>
            <template v-if="modal.kind === 'video'"><label>视频标题<input v-model="draft.title" required maxlength="160" :disabled="saving" /></label><label>视频简介<textarea v-model="draft.description" rows="5" maxlength="4000" :disabled="saving"></textarea></label><label>分区<select v-model="draft.categoryId" :disabled="saving"><option v-for="category in state.categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label></template>
            <template v-if="['user', 'createUser'].includes(modal.kind)"><label v-if="modal.kind === 'createUser'">用户名<input v-model="draft.username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_]+" autocomplete="off" :disabled="saving" /></label><p v-else class="admin-dialog-account">@{{ modal.item.username }}</p><label>昵称<input v-model="draft.displayName" required maxlength="32" :disabled="saving" /></label><label>角色<select v-model="draft.role" :disabled="saving || modal.item?.id === state.user.id"><option value="user">普通用户</option><option value="admin">管理员</option></select></label></template>
            <label v-if="['password', 'createUser'].includes(modal.kind)">新密码<input v-model="draft.password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" placeholder="至少 12 个字符" :disabled="saving" /></label>
            <p v-if="modal.kind === 'password'" class="admin-confirm-copy">账号 @{{ modal.item.username }} 的现有登录会话将同时失效。</p>
            <p v-if="modal.kind === 'sessions'" class="admin-confirm-copy">撤销 @{{ modal.item.username }} 的全部登录会话？该用户需要重新登录。</p>
            <template v-if="modal.kind === 'deleteVideo'"><p class="admin-confirm-copy">永久删除「{{ modal.item.title }}」？</p><p class="muted">视频文件、封面、评论、弹幕和相关互动记录将一起删除。</p></template>
            <template v-if="modal.kind === 'deleteMessage'"><p class="admin-confirm-copy">删除 @{{ modal.item.username }} 发布的这条{{ tab === 'comments' ? '评论' : '弹幕' }}？</p><blockquote>{{ modal.item.body }}</blockquote></template>
            <p v-if="modal.kind === 'deleteCategory'" class="admin-confirm-copy">永久删除分区「{{ modal.item.name }}」？</p>
            <p v-if="modalError" class="form-error" role="alert">{{ modalError }}</p>
            <div class="admin-dialog-footer"><button type="button" class="text-button" :disabled="saving" @click="close">取消</button><button :class="['primary-button', { 'admin-delete-button': modal.kind.startsWith('delete') }]" :disabled="saving"><Trash2 v-if="modal.kind.startsWith('delete')" :size="16" /><LogOut v-else-if="modal.kind === 'sessions'" :size="16" /><Save v-else :size="16" />{{ saving ? '处理中…' : modal.kind.startsWith('delete') ? '确认删除' : modal.kind === 'sessions' ? '确认撤销' : '保存' }}</button></div>
          </form>
        </section>
      </div>
    </Teleport>
  </div>
</template>
