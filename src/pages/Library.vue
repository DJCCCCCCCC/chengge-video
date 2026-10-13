<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Heart, Clock3, History, Folder as FolderVideo, Upload, Trash2, HardDrive, Play } from 'lucide-vue-next';
import { api, state, notify } from '../state';
import VideoCard from '../components/VideoCard.vue';
const route = useRoute(), videos = ref([]), stats = ref(null), loading = ref(false), error = ref(''), total = ref(0), more = ref(false), page = ref(1);
const definitions = { favorite: ['我的收藏', Heart, '喜欢的影像，在这里相遇'], later: ['稍后再看', Clock3, '把好内容留给有空的自己'], history: ['观看历史', History, '重温那些看过的瞬间'], uploads: ['我的投稿', FolderVideo, '每一部作品，都有你的视角'] };
const kind = computed(() => definitions[route.params.kind] ? route.params.kind : 'favorite');
const info = computed(() => definitions[kind.value]);
let generation = 0;
async function load(append = false) {
  const current = ++generation;
  if (!state.user) { videos.value = []; return; }
  loading.value = true; error.value = ''; const nextPage = append ? page.value + 1 : 1;
  try { const [data, details] = await Promise.all([api(`/api/me/library?kind=${kind.value}&page=${nextPage}`), api('/api/me/stats')]); if (current !== generation) return; videos.value = append ? [...videos.value, ...data.items] : data.items; total.value = data.total; more.value = data.hasMore; page.value = nextPage; stats.value = details; }
  catch (e) { if (current === generation) error.value = e.message; } finally { if (current === generation) loading.value = false; }
}
async function clear() { if (!confirm('清空你的全部观看历史？')) return; try { await api('/api/me/history', { method: 'DELETE' }); await load(); notify('观看历史已清空'); } catch (e) { notify(e.message, 'error'); } }
async function remove(video) { if (!confirm(`永久删除“${video.title}”及其评论、弹幕？`)) return; try { await api(`/api/videos/${video.id}`, { method: 'DELETE' }); await load(); notify('视频已删除'); } catch (e) { notify(e.message, 'error'); } }
watch([() => route.params.kind, () => state.user?.id], () => load(), { immediate: true });
</script>
<template>
  <div class="page"><div class="page-heading"><div><div class="eyebrow">个人中心</div><h1>{{ info[0] }}</h1></div><button v-if="kind === 'history' && total && state.user" class="text-button" @click="clear"><Trash2 :size="16" />清空历史</button><RouterLink v-if="kind === 'uploads' && state.user" to="/upload" class="primary-button"><Upload :size="16" />上传视频</RouterLink></div>
    <div v-if="kind === 'uploads' && stats && state.user" class="stats-band"><div><FolderVideo :size="21" /><span><b>{{ stats.videos }}</b><small>{{ stats.scope === 'space' ? '空间总视频' : '我的视频' }}</small></span></div><div><HardDrive :size="21" /><span><b>{{ (stats.bytes / 1024 / 1024).toFixed(1) }} <em>MB</em></b><small>{{ stats.scope === 'space' ? '空间媒体容量' : '我的媒体容量' }}</small></span></div><div><Play :size="21" /><span><b>{{ stats.views }}</b><small>累计播放</small></span></div></div>
    <div v-if="!state.user" class="empty-state"><component :is="info[1]" :size="42" /><h3>登录后查看{{ info[0] }}</h3><button class="primary-button" @click="state.authOpen = true">登录账号</button></div>
    <div v-else-if="error" class="empty-state"><h3>加载失败</h3><p>{{ error }}</p><button @click="load()" class="primary-button">重试</button></div>
    <div v-else-if="loading && !videos.length" class="loading-state">正在加载片单…</div>
    <div v-else-if="!videos.length" class="empty-state"><component :is="info[1]" :size="42" /><h3>这里还没有视频</h3><RouterLink to="/" class="primary-button">去发现</RouterLink></div>
    <template v-else><div class="section-heading"><h2>全部视频 <span class="muted">{{ total }}</span></h2></div><div class="video-grid"><div v-for="video in videos" :key="video.id"><VideoCard :video="video" /><button v-if="kind === 'uploads'" class="delete-video text-button" @click="remove(video)"><Trash2 :size="14" />删除</button></div></div><button v-if="more" class="load-more" :disabled="loading" @click="load(true)">加载更多</button></template>
  </div>
</template>
