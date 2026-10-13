import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Home from './pages/Home.vue';
import Watch from './pages/Watch.vue';
import Library from './pages/Library.vue';
import Upload from './pages/Upload.vue';
import './style.css';

const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/', component: Home },
  { path: '/watch/:id', component: Watch },
  { path: '/library/:kind', component: Library },
  { path: '/upload', component: Upload },
  { path: '/admin', component: () => import('./pages/Admin.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
], scrollBehavior: () => ({ top: 0 }) });
createApp(App).use(router).mount('#app');
