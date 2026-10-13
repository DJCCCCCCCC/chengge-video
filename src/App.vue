<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { TvMinimalPlay, Search, Upload, House, Flame, Star, Clock3, History, Clapperboard, Menu, X, LogOut, CircleCheck, AlertCircle, ChevronDown, ShieldCheck } from 'lucide-vue-next';
import AuthModal from './components/AuthModal.vue';
import { state, initialize, api, notify, needLogin } from './state';

const route = useRoute(), router = useRouter(), search = ref(''), scrolled = ref(false);
const isHome = computed(() => route.path === '/');
const overlayHeader = computed(() => isHome.value && !scrolled.value && !state.menuOpen);
const shortcuts = [
  { label: '收藏', icon: Star, to: '/library/favorite' },
  { label: '历史', icon: History, to: '/library/history' },
  { label: '稍后再看', icon: Clock3, to: '/library/later' },
  { label: '创作中心', icon: Clapperboard, to: '/library/uploads' },
];
function doSearch() { router.push({ path: '/', query: search.value.trim() ? { q: search.value.trim() } : {} }); }
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); state.user = null; state.csrf = null; notify('已退出登录'); }
  catch (e) { notify(e.message, 'error'); }
}
function upload() { if (!needLogin()) router.push('/upload'); }
function onScroll() { scrolled.value = window.scrollY > 90; }
watch(() => route.fullPath, () => { state.menuOpen = false; search.value = route.query.q || ''; });
onMounted(() => { search.value = route.query.q || ''; initialize(); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); });
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header :class="['topbar', { 'over-banner': overlayHeader }]">
    <div class="header-left">
      <button class="icon-button mobile-menu" aria-label="展开导航" title="导航" :aria-expanded="state.menuOpen" @click="state.menuOpen = !state.menuOpen"><Menu :size="22" /></button>
      <RouterLink to="/" class="brand"><TvMinimalPlay :size="27" /><strong>城哥的小视频站</strong></RouterLink>
      <nav class="header-navigation" aria-label="主导航">
        <RouterLink to="/" :class="{ current: isHome && !route.query.sort }">首页</RouterLink>
        <RouterLink to="/?sort=popular" :class="{ current: route.query.sort === 'popular' }">热门</RouterLink>
        <div class="channel-menu"><button>分区 <ChevronDown :size="12" /></button><div class="channel-dropdown"><RouterLink v-for="item in state.categories" :key="item.id" :to="{ path: '/', query: { category: item.id } }">{{ item.name }}</RouterLink></div></div>
      </nav>
    </div>
    <form class="search-box" @submit.prevent="doSearch">
      <input v-model="search" aria-label="搜索视频" placeholder="搜索视频、发现更多精彩" maxlength="100" />
      <button v-if="search" type="button" class="icon-button search-clear" title="清除搜索" aria-label="清除搜索" @click="search = ''"><X :size="15" /></button>
      <button type="submit" class="search-submit" title="搜索" aria-label="搜索"><Search :size="20" /></button>
    </form>
    <div class="top-actions">
      <button v-if="!state.user" class="login-button" @click="state.authOpen = true">登录</button>
      <div v-else class="account-menu"><button class="avatar" :title="state.user.displayName" aria-label="账号菜单">{{ state.user.displayName.slice(0, 1) }}</button><div class="account-dropdown"><strong>{{ state.user.displayName }}</strong><small>@{{ state.user.username }}</small><RouterLink to="/library/uploads">我的投稿</RouterLink><RouterLink v-if="state.user.role === 'admin'" to="/admin"><ShieldCheck :size="15" />管理后台</RouterLink><button @click="logout"><LogOut :size="15" />退出登录</button></div></div>
      <RouterLink v-for="item in shortcuts" :key="item.to" :to="item.to" class="header-action" :title="item.label"><component :is="item.icon" :size="21" /><span>{{ item.label }}</span></RouterLink>
      <button class="upload-button" @click="upload"><Upload :size="18" /><span>投稿</span></button>
    </div>
  </header>
  <div v-if="isHome" class="site-banner"><img src="/banner.jpg" alt="山间湖泊与远山" fetchpriority="high" /><div class="banner-title"><TvMinimalPlay :size="42" /><h1>城哥的小视频站</h1></div></div>
  <div v-if="state.menuOpen" class="sidebar-scrim" @click="state.menuOpen = false"></div>
  <nav :class="['sidebar', { open: state.menuOpen }]" aria-label="移动端导航">
    <RouterLink to="/" class="nav-item"><House :size="20" />首页</RouterLink><RouterLink to="/?sort=popular" class="nav-item"><Flame :size="20" />热门</RouterLink>
    <RouterLink v-for="item in shortcuts" :key="item.to" :to="item.to" class="nav-item"><component :is="item.icon" :size="20" />{{ item.label }}</RouterLink>
    <button class="nav-item" @click="upload"><Upload :size="20" />上传视频</button>
    <RouterLink v-if="state.user?.role === 'admin'" to="/admin" class="nav-item"><ShieldCheck :size="20" />管理后台</RouterLink>
  </nav>
  <main :class="['main-content', { 'home-content': isHome }]"><RouterView /></main>
  <footer class="site-footer"><span>城哥的小视频站</span><span>记录生活，分享热爱</span></footer>
  <AuthModal v-if="state.authOpen" />
  <Transition name="toast"><div v-if="state.toast" class="toast" :class="state.toastKind" role="status"><AlertCircle v-if="state.toastKind === 'error'" :size="18" /><CircleCheck v-else :size="18" />{{ state.toast }}</div></Transition>
</template>
