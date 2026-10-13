<script setup>
import { ref, watch } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { UploadCloud, Film, X, Check, ArrowRight } from 'lucide-vue-next';
import { state, notify } from '../state';
const router = useRouter(), file = ref(null), title = ref(''), description = ref(''), category = ref('life'), busy = ref(false), progress = ref(0), error = ref(''), dragging = ref(false), fileInput = ref(null);
let request;
watch(() => state.categories, categories => {
  if (!categories.some(item => item.id === category.value)) category.value = categories[0]?.id || '';
}, { immediate: true });
function choose(files) {
  if (busy.value || !files?.length) return;
  const item = files[0];
  if (!/\.(mp4|webm)$/i.test(item.name)) { error.value = '请选择 MP4 或 WebM 视频'; return; }
  if (item.size > (state.config.maxUploadMb || 2048) * 1024 * 1024) { error.value = `文件超过 ${state.config.maxUploadMb} MB`; return; }
  file.value = item; title.value ||= item.name.replace(/\.[^.]+$/, '').slice(0, 160); error.value = '';
}
function cancel() { request?.abort(); busy.value = false; }
function upload() {
  if (!state.user) { state.authOpen = true; return; }
  if (!file.value) { error.value = '请选择视频文件'; return; }
  const data = new FormData(); data.append('video', file.value); data.append('title', title.value); data.append('description', description.value); data.append('categoryId', category.value);
  busy.value = true; error.value = ''; progress.value = 0;
  request = new XMLHttpRequest(); request.open('POST', '/api/videos'); request.setRequestHeader('X-CSRF-Token', state.csrf);
  request.upload.onprogress = event => { if (event.lengthComputable) progress.value = Math.round(event.loaded / event.total * 100); };
  request.onload = () => { busy.value = false; try { const result = JSON.parse(request.responseText); if (request.status >= 400) { error.value = result.error; return; } notify('视频已发布'); router.push(`/watch/${result.id}`); } catch { error.value = '服务返回异常，请检查网络'; } };
  request.onerror = () => { busy.value = false; error.value = '网络连接失败'; };
  request.onabort = () => { busy.value = false; error.value = '上传已取消'; };
  request.send(data);
}
onBeforeRouteLeave(() => { if (!busy.value) return true; if (confirm('上传尚未完成，取消并离开？')) { cancel(); return true; } return false; });
</script>
<template>
  <div class="page upload-page"><div class="page-heading"><div><div class="eyebrow">创作中心</div><h1>视频投稿</h1></div><span class="step-label">01 <span>/</span> 上传作品</span></div>
    <div v-if="!state.user" class="empty-state"><UploadCloud :size="42" /><h3>登录后上传你的作品</h3><button class="primary-button" @click="state.authOpen = true">登录账号</button></div>
    <form v-else class="upload-form" @submit.prevent="upload">
      <div class="upload-main"><input ref="fileInput" type="file" accept=".mp4,.webm" class="hidden-input" aria-label="选择视频" @change="choose($event.target.files)" :disabled="busy" />
        <button type="button" :class="['dropzone', { dragging, chosen: file }]" :disabled="busy" @click="fileInput.click()" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dragging = false; choose($event.dataTransfer.files)"><component :is="file ? Film : UploadCloud" :size="40" /><strong>{{ file ? file.name : '选择视频文件' }}</strong><span>{{ file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `MP4 / WebM · 最大 ${state.config.maxUploadMb || 2048} MB` }}</span><span class="file-status" v-if="file"><Check :size="14" /> 文件已就绪</span></button>
        <div v-if="busy" class="upload-progress"><div><span>{{ progress === 100 ? '正在校验视频并生成封面…' : '正在上传…' }}</span><b>{{ progress }}%</b></div><progress :value="progress" max="100"></progress><button type="button" class="text-button" @click="cancel"><X :size="14" />取消上传</button></div>
        <label>作品标题 <small>{{ title.length }}/160</small><input v-model="title" required maxlength="160" :disabled="busy" placeholder="给这一刻起个名字" /></label>
        <label>作品简介 <small>{{ description.length }}/4000</small><textarea v-model="description" maxlength="4000" rows="5" :disabled="busy" placeholder="记录这部作品背后的故事"></textarea></label>
        <label>分区<select v-model="category" :disabled="busy"><option v-for="item in state.categories" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p><div class="upload-footer"><span>发布至当前 NAS 片库</span><button class="primary-button" :disabled="busy || !file">{{ busy ? '处理中…' : '发布作品' }}<ArrowRight :size="17" /></button></div>
      </div><aside class="upload-aside"><h2>投稿信息</h2><div class="aside-rule"></div><dl><dt>视频编码</dt><dd>推荐 H.264 + AAC</dd><dt>可见范围</dt><dd>当前空间的访问者</dd><dt>存储位置</dt><dd>NAS 本地媒体库</dd></dl></aside>
    </form>
  </div>
</template>
