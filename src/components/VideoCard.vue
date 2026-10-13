<script setup>
import { Clock3, Play, MessageSquare, Check } from 'lucide-vue-next';
import { ref } from 'vue';
import { api, count, duration, needLogin, notify } from '../state';
const props = defineProps({ video: { type: Object, required: true } });
const saved = ref(false);
async function later() {
  if (needLogin()) return;
  try { await api(`/api/videos/${props.video.id}/library`, { method: 'PUT', body: { kind: 'later', active: !saved.value } }); saved.value = !saved.value; notify(saved.value ? '已加入稍后再看' : '已移出稍后再看'); }
  catch (error) { notify(error.message, 'error'); }
}
</script>
<template>
  <article class="video-card">
    <div class="thumbnail">
      <RouterLink :to="`/watch/${video.id}`" :aria-label="`播放：${video.title}`">
        <img v-if="video.cover" :src="video.cover" :alt="video.title" loading="lazy" />
        <div v-else class="cover-placeholder"><Play :size="36" /></div>
        <div class="thumb-bottom"><span><Play :size="13" /> {{ count(video.views) }}<MessageSquare :size="12" /> {{ count(video.commentCount) }}</span><b>{{ duration(video.duration) }}</b></div>
        <span v-if="video.isDemo" class="demo-tag">演示</span>
      </RouterLink>
      <button class="later-button icon-button" @click="later" :title="saved ? '移出稍后再看' : '稍后再看'" :aria-label="saved ? '移出稍后再看' : '稍后再看'"><Check v-if="saved" :size="17" /><Clock3 v-else :size="17" /></button>
    </div>
    <RouterLink class="video-title" :to="`/watch/${video.id}`">{{ video.title }}</RouterLink>
    <div class="video-meta"><span class="up-badge">UP</span><span>{{ video.author }}</span><span class="meta-dot">·</span><span>{{ video.category }}</span></div>
  </article>
</template>
