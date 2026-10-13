<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Flame, Star, Clock3, History, RefreshCw, ArrowDown, SearchX, Film, ChevronLeft, ChevronRight, Clapperboard, Upload, ArrowUp } from 'lucide-vue-next';
import VideoCard from '../components/VideoCard.vue';
import { api, state, needLogin } from '../state';

const route = useRoute(), router = useRouter();
const videos = ref([]), total = ref(0), page = ref(1), more = ref(false), loading = ref(true), error = ref(''), slide = ref(0), hovering = ref(false);
let generation = 0, timer;
const category = computed(() => route.query.category || '');
const query = computed(() => route.query.q || '');
const slides = computed(() => videos.value.slice(0, 5));
const featured = computed(() => slides.value[slide.value % (slides.value.length || 1)]);
const showFeature = computed(() => !query.value && !category.value && route.query.sort !== 'popular' && !!featured.value);
const title = computed(() => query.value ? `“${query.value}”的搜索结果` : category.value ? state.categories.find(c => c.id === category.value)?.name : route.query.sort === 'popular' ? '热门视频' : '推荐视频');
async function load(append = false) {
  const current = ++generation; loading.value = true; error.value = '';
  const nextPage = append ? page.value + 1 : 1;
  try {
    const params = new URLSearchParams({ page: String(nextPage), limit: '18', ...(category.value && { category: category.value }), ...(query.value && { q: query.value }), ...(route.query.sort && { sort: route.query.sort }) });
    const data = await api(`/api/videos?${params}`);
    if (current !== generation) return;
    videos.value = append ? [...videos.value, ...data.items] : data.items; total.value = data.total; more.value = data.hasMore; page.value = nextPage;
    if (!append) slide.value = 0;
  } catch (e) { if (current === generation) error.value = e.message; } finally { if (current === generation) loading.value = false; }
}
function select(id) { router.push({ path: '/', query: { ...route.query, category: id || undefined } }); }
function changeSlide(delta) { slide.value = (slide.value + delta + slides.value.length) % slides.value.length; }
function upload() { if (!needLogin()) router.push('/upload'); }
function toTop() { window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
onMounted(() => { timer = setInterval(() => { if (slides.value.length > 1 && !hovering.value && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) changeSlide(1); }, 6000); });
onUnmounted(() => { clearInterval(timer); generation++; });
watch(() => route.fullPath, () => load(), { immediate: true });
</script>

<template>
  <div class="page home-page">
    <div class="channel-bar">
      <div class="quick-channels"><RouterLink to="/?sort=popular" class="quick-channel"><span class="quick-icon hot"><Flame :size="25" fill="currentColor" /></span><span>热门</span></RouterLink><RouterLink to="/library/favorite" class="quick-channel"><span class="quick-icon favorites"><Star :size="24" fill="currentColor" /></span><span>收藏</span></RouterLink></div>
      <nav class="category-tabs" aria-label="视频分类"><button :class="{ selected: !category }" @click="select('')">全部</button><button v-for="item in state.categories" :key="item.id" :class="{ selected: category === item.id }" @click="select(item.id)">{{ item.name }}</button><RouterLink to="/?sort=popular" :class="{ selected: route.query.sort === 'popular' }">排行榜</RouterLink></nav>
      <nav class="channel-utilities" aria-label="个人视频入口"><RouterLink to="/library/later"><Clock3 :size="17" />稍后再看</RouterLink><RouterLink to="/library/history"><History :size="17" />观看历史</RouterLink><RouterLink to="/library/uploads"><Clapperboard :size="17" />我的投稿</RouterLink><button @click="upload"><Upload :size="17" />上传视频</button></nav>
    </div>
    <div class="section-heading feed-heading"><div><h2>{{ title }}</h2><span class="muted">{{ total }} 个视频</span></div><button class="refresh-button" @click="load()" :disabled="loading"><RefreshCw :size="15" :class="{ spinning: loading }" />刷新</button></div>
    <div v-if="error" class="empty-state"><SearchX :size="36" /><h3>暂时无法加载</h3><p>{{ error }}</p><button class="primary-button" @click="load()">重试</button></div>
    <div v-else-if="!loading && !videos.length" class="empty-state"><Film :size="42" /><h3>{{ query ? '没有找到相关视频' : '还没有视频' }}</h3><RouterLink v-if="!query" class="primary-button" to="/upload">上传视频</RouterLink></div>
    <div v-else :class="['video-grid', 'home-feed', { 'has-carousel': showFeature }]">
      <section v-if="showFeature" class="feed-carousel" aria-label="精选视频轮播" @mouseenter="hovering = true" @mouseleave="hovering = false" @focusin="hovering = true" @focusout="hovering = false">
        <RouterLink :to="`/watch/${featured.id}`" class="carousel-link"><img :key="featured.id" :src="featured.cover" :alt="featured.title" /><div class="carousel-caption"><span v-if="featured.isDemo" class="carousel-tag">演示视频</span><h2>{{ featured.title }}</h2></div></RouterLink>
        <div class="carousel-controls"><div class="carousel-dots"><button v-for="(item, index) in slides" :key="item.id" :class="{ selected: slide % slides.length === index }" :aria-label="`轮播第 ${index + 1} 项`" :aria-pressed="slide % slides.length === index" @click="slide = index"></button></div><div class="carousel-arrows"><button title="上一个视频" aria-label="上一个视频" @click="changeSlide(-1)"><ChevronLeft :size="18" /></button><button title="下一个视频" aria-label="下一个视频" @click="changeSlide(1)"><ChevronRight :size="18" /></button></div></div>
      </section>
      <VideoCard v-for="video in videos" :key="video.id" :video="video" />
      <template v-if="loading"><div v-for="n in 8" :key="`skeleton-${n}`" class="video-skeleton"><div></div><span></span><small></small></div></template>
    </div>
    <button v-if="more" class="load-more" :disabled="loading" @click="load(true)">{{ loading ? '加载中…' : '加载更多' }}<ArrowDown :size="16" /></button>
    <div v-else-if="videos.length && !loading" class="end-marker">已经到底啦</div>
    <button class="back-to-top icon-button" title="返回顶部" aria-label="返回顶部" @click="toTop"><ArrowUp :size="20" /></button>
  </div>
</template>
