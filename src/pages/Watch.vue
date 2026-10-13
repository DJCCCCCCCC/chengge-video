<script setup>
import { ref, watch, computed, onUnmounted } from 'vue';
import { useRoute, onBeforeRouteLeave } from 'vue-router';
import { ThumbsUp, Heart, Clock3, Share2, MessageSquare, Send, Play, ChevronLeft, Trash2, Volume2 } from 'lucide-vue-next';
import VideoCard from '../components/VideoCard.vue';
import { api, state, notify, needLogin, count, date, duration } from '../state';
const route = useRoute(), video = ref(null), player = ref(null), loading = ref(true), error = ref(''), playerError = ref(false);
const related = ref([]), comments = ref([]), commentCount = ref(0), commentMore = ref(false), commentPage = ref(1), commentText = ref(''), commenting = ref(false);
const danmaku = ref([]), danmakuText = ref(''), danmakuEnabled = ref(true), activeDanmaku = ref([]), sending = ref(false), dmColor = ref('#ffffff'), descriptionOpen = ref(false), paused = ref(true);
let lastTime = 0, lastSaved = -10, viewed = false, generation = 0;
const shown = new Set();
const colors = ['#ffffff', '#ffdd66', '#68edcc', '#ff9db8'];
const dmStyle = item => ({ color: item.color, top: `${12 + (item.id % 6) * 10}%`, animationPlayState: paused.value ? 'paused' : 'running' });
async function load() {
  const current = ++generation; loading.value = true; error.value = ''; video.value = null; shown.clear(); activeDanmaku.value = []; lastTime = 0; lastSaved = -10; viewed = false; playerError.value = false;
  try {
    const [detail, feed, commentData, dm] = await Promise.all([api(`/api/videos/${route.params.id}`), api('/api/videos?limit=8'), api(`/api/videos/${route.params.id}/comments`), api(`/api/videos/${route.params.id}/danmaku`)]);
    if (current !== generation) return;
    video.value = detail; related.value = feed.items.filter(item => item.id !== detail.id).slice(0, 5); comments.value = commentData.items; commentCount.value = commentData.total; commentMore.value = commentData.hasMore; commentPage.value = 1; danmaku.value = dm.items;
  } catch (e) { if (current === generation) error.value = e.message; } finally { if (current === generation) loading.value = false; }
}
function loaded() { if (video.value.position > 0 && video.value.position < video.value.duration - 3) { player.value.currentTime = video.value.position; lastTime = video.value.position; } }
function save(force = false) {
  if (!state.user || !player.value || !video.value) return;
  const position = player.value.currentTime;
  if (!force && Math.abs(position - lastSaved) < 5) return;
  lastSaved = position;
  api(`/api/videos/${video.value.id}/history`, { method: 'PUT', body: { position } }).catch(() => {});
}
function tick() {
  if (!player.value) return;
  const time = player.value.currentTime;
  if (time < lastTime - 1 || time > lastTime + 3) { shown.clear(); activeDanmaku.value = []; }
  if (danmakuEnabled.value) {
    for (const dm of danmaku.value) {
      if (dm.time >= time - 0.6 && dm.time <= time + 0.1 && !shown.has(dm.id)) {
        shown.add(dm.id); activeDanmaku.value = [...activeDanmaku.value.slice(-17), { ...dm, key: `${dm.id}-${Date.now()}` }];
      }
    }
  }
  lastTime = time; save();
}
function seeked() { shown.clear(); activeDanmaku.value = []; lastTime = player.value?.currentTime || 0; }
function onPlay() { paused.value = false; if (!viewed && video.value) { viewed = true; api(`/api/videos/${video.value.id}/view`, { method: 'POST' }).then(data => { if (video.value) video.value.views = data.views; }).catch(() => {}); } }
async function toggle(kind) {
  if (needLogin()) return;
  try {
    if (kind === 'like') { const result = await api(`/api/videos/${video.value.id}/like`, { method: 'PUT', body: { active: !video.value.liked } }); video.value.liked = result.liked; video.value.likes = result.likes; }
    else { const result = await api(`/api/videos/${video.value.id}/library`, { method: 'PUT', body: { kind, active: !video.value[kind] } }); video.value[kind] = result.active; notify(result.active ? '已加入片单' : '已移出片单'); }
  } catch (e) { notify(e.message, 'error'); }
}
async function postComment() {
  if (needLogin() || !commentText.value.trim()) return;
  commenting.value = true;
  try { await api(`/api/videos/${video.value.id}/comments`, { method: 'POST', body: { body: commentText.value } }); commentText.value = ''; await loadComments(); }
  catch (e) { notify(e.message, 'error'); } finally { commenting.value = false; }
}
async function loadComments(append = false) {
  const nextPage = append ? commentPage.value + 1 : 1;
  try { const data = await api(`/api/videos/${video.value.id}/comments?page=${nextPage}`); comments.value = append ? [...comments.value, ...data.items] : data.items; commentCount.value = data.total; commentMore.value = data.hasMore; commentPage.value = nextPage; }
  catch (e) { notify(e.message, 'error'); }
}
async function removeComment(comment) { if (!confirm('删除这条评论？')) return; try { await api(`/api/comments/${comment.id}`, { method: 'DELETE' }); await loadComments(); } catch (e) { notify(e.message, 'error'); } }
async function postDanmaku() {
  if (needLogin() || !danmakuText.value.trim() || !player.value) return;
  sending.value = true;
  try { const dm = await api(`/api/videos/${video.value.id}/danmaku`, { method: 'POST', body: { body: danmakuText.value, time: player.value.currentTime, color: dmColor.value } }); danmaku.value.push(dm); danmakuText.value = ''; if (danmakuEnabled.value) activeDanmaku.value.push({ ...dm, key: `${dm.id}-sent` }); shown.add(dm.id); }
  catch (e) { notify(e.message, 'error'); } finally { sending.value = false; }
}
async function share() { try { await navigator.clipboard.writeText(location.href); notify('视频链接已复制'); } catch { notify('当前浏览器无法复制，请从地址栏获取链接', 'error'); } }
watch(() => route.params.id, () => { save(true); load(); }, { immediate: true });
watch(() => state.user?.id, async () => { if (video.value) { try { const detail = await api(`/api/videos/${video.value.id}`); Object.assign(video.value, { liked: detail.liked, favorite: detail.favorite, later: detail.later }); } catch {} } });
watch(danmakuEnabled, value => { if (!value) activeDanmaku.value = []; });
onBeforeRouteLeave(() => { save(true); return true; });
onUnmounted(() => { generation++; });
</script>
<template>
  <div class="page watch-page"><RouterLink to="/" class="back-link"><ChevronLeft :size="16" />返回发现</RouterLink>
    <div v-if="loading" class="loading-state">正在加载视频…</div>
    <div v-else-if="error" class="empty-state"><Play :size="42" /><h2>无法打开视频</h2><p>{{ error }}</p><RouterLink to="/" class="primary-button">返回首页</RouterLink></div>
    <div v-else-if="video" class="watch-layout"><div class="watch-main">
      <div class="player-shell"><video ref="player" :key="video.id" :src="video.mediaUrl" :poster="video.cover" controls playsinline preload="metadata" @loadedmetadata="loaded" @timeupdate="tick" @seeked="seeked" @play="onPlay" @pause="paused = true; save(true)" @ended="paused = true; save(true)" @error="playerError = true"></video><div class="danmaku-layer" aria-hidden="true"><span v-for="dm in activeDanmaku" :key="dm.key" :style="dmStyle(dm)" @animationend="activeDanmaku = activeDanmaku.filter(item => item.key !== dm.key)">{{ dm.body }}</span></div><div v-if="playerError" class="player-error">该视频无法在当前浏览器播放，请检查文件或编码。</div></div>
      <div class="danmaku-toolbar"><label class="toggle-label"><input type="checkbox" v-model="danmakuEnabled" /><span class="toggle-track"></span>弹幕</label><div class="color-swatches"><button v-for="color in colors" :key="color" :style="{ background: color }" :class="{ selected: dmColor === color }" :aria-label="`弹幕颜色 ${color}`" :title="`弹幕颜色 ${color}`" @click="dmColor = color"></button></div><form class="danmaku-form" @submit.prevent="postDanmaku"><input v-model="danmakuText" maxlength="80" aria-label="发送弹幕" :placeholder="state.user ? '此刻，你想说什么？' : '登录后发送弹幕'" /><button :disabled="sending || !danmakuText.trim()" title="发送弹幕" aria-label="发送弹幕"><Send :size="17" /></button></form></div>
      <div class="watch-heading"><span class="video-category-label">{{ video.category }}</span><span v-if="video.isDemo" class="sample-label">本地演示影像</span><h1>{{ video.title }}</h1><div class="watch-meta"><span><Play :size="14" />{{ count(video.views) }} 次播放</span><span><MessageSquare :size="14" />{{ commentCount }} 条评论</span><span>{{ date(video.createdAt) }}</span></div></div>
      <div class="interaction-bar"><button :class="{ selected: video.liked }" @click="toggle('like')"><ThumbsUp :size="21" />{{ count(video.likes) || '点赞' }}</button><button :class="{ selected: video.favorite }" @click="toggle('favorite')"><Heart :size="21" :fill="video.favorite ? 'currentColor' : 'none'" />{{ video.favorite ? '已收藏' : '收藏' }}</button><button :class="{ selected: video.later }" @click="toggle('later')"><Clock3 :size="21" />{{ video.later ? '已加入' : '稍后再看' }}</button><button @click="share"><Share2 :size="20" />分享</button></div>
      <div class="author-block"><span class="avatar author-avatar">{{ video.author.slice(0, 1) }}</span><div><strong>{{ video.author }}</strong><small>@{{ video.authorUsername }}</small></div><span class="creator-badge">创作者</span></div><p :class="['video-description', { expanded: descriptionOpen }]">{{ video.description || '作者暂未填写简介。' }}</p><button v-if="video.description.length > 180" class="text-button" @click="descriptionOpen = !descriptionOpen">{{ descriptionOpen ? '收起简介' : '展开简介' }}</button>
      <section class="comments-section"><div class="section-heading"><h2>评论 <span class="muted">{{ commentCount }}</span></h2><span class="muted">最新</span></div><form class="comment-form" @submit.prevent="postComment"><span class="avatar">{{ state.user?.displayName.slice(0, 1) || '?' }}</span><textarea v-model="commentText" aria-label="评论内容" maxlength="1000" rows="2" :placeholder="state.user ? '分享你的感受…' : '登录后参与讨论…'"></textarea><button class="primary-button" :disabled="commenting || !commentText.trim()">发布</button></form><div v-if="!comments.length" class="no-comments">还没有评论，留下第一份共鸣。</div><article v-for="comment in comments" :key="comment.id" class="comment"><span class="avatar small-avatar">{{ comment.author.slice(0, 1) }}</span><div class="comment-content"><strong>{{ comment.author }}</strong><p>{{ comment.body }}</p><small>{{ date(comment.createdAt) }}</small></div><button v-if="state.user && (comment.userId === state.user.id || state.user.role === 'admin')" class="icon-button" title="删除评论" aria-label="删除评论" @click="removeComment(comment)"><Trash2 :size="14" /></button></article><button v-if="commentMore" class="load-more" @click="loadComments(true)">更多评论</button></section>
    </div><aside class="related-list"><div class="section-heading"><h2>接着看</h2><Play :size="16" /></div><VideoCard v-for="item in related" :key="item.id" :video="item" /></aside></div>
  </div>
</template>
