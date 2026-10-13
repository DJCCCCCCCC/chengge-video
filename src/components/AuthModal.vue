<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { X, ArrowRight, LockKeyhole } from 'lucide-vue-next';
import { state, api, notify } from '../state';
const mode = ref('login'), username = ref(''), password = ref(''), displayName = ref(''), busy = ref(false), error = ref('');
const heading = computed(() => mode.value === 'login' ? '账号登录' : '注册账号');
const dialog = ref(), previousFocus = document.activeElement;
function close() { state.authOpen = false; }
function onKey(event) {
  if (event.key === 'Escape') close();
  if (event.key === 'Tab') {
    const nodes = dialog.value.querySelectorAll('button:not(:disabled), input, a[href]');
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1]?.focus(); }
    else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0]?.focus(); }
  }
}
onMounted(() => { dialog.value.querySelector('input')?.focus(); document.addEventListener('keydown', onKey); });
onUnmounted(() => { document.removeEventListener('keydown', onKey); previousFocus?.focus(); });
async function submit() {
  busy.value = true; error.value = '';
  try { const session = await api(`/api/auth/${mode.value}`, { method: 'POST', body: { username: username.value, password: password.value, displayName: displayName.value } }); state.user = session.user; state.csrf = session.csrfToken; close(); notify(`欢迎，${session.user.displayName}`); }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>
<template>
  <div class="modal-backdrop" @mousedown.self="close">
    <section ref="dialog" class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button class="icon-button modal-close" title="关闭" aria-label="关闭" @click="close"><X :size="20" /></button>
      <div class="brand-mark"><PlayIcon /></div>
      <span class="auth-site-name">城哥的小视频站</span><h2 id="auth-title">{{ heading }}</h2>
      <form @submit.prevent="submit">
        <label>用户名<input v-model="username" required minlength="3" maxlength="32" autocomplete="username" placeholder="用户名" /></label>
        <label v-if="mode === 'register'">昵称<input v-model="displayName" required maxlength="32" autocomplete="nickname" placeholder="你的名字" /></label>
        <label>密码<input v-model="password" type="password" required :minlength="mode === 'register' ? 12 : 1" maxlength="128" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :placeholder="mode === 'register' ? '至少 12 个字符' : '输入密码'" /></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="primary-button full" :disabled="busy">{{ busy ? '正在处理…' : mode === 'login' ? '登录' : '创建账号' }}<ArrowRight :size="17" /></button>
      </form>
      <button v-if="state.config.allowRegistration" class="text-button auth-switch" @click="mode = mode === 'login' ? 'register' : 'login'; error = ''">{{ mode === 'login' ? '还没有账号？创建账号' : '已有账号？登录' }}</button>
      <div class="auth-foot"><LockKeyhole :size="13" /> 私人 NAS · 本地账号</div>
    </section>
  </div>
</template>
<script>
import { Play as PlayIcon } from 'lucide-vue-next';
export default { components: { PlayIcon } };
</script>
