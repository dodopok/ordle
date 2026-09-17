<script setup lang="ts">
import { getSupabaseClient } from '../../utils/supabase'

definePageMeta({ ssr: false })

const error = ref('')

onMounted(async () => {
  const supabase = getSupabaseClient()
  const code = new URLSearchParams(window.location.search).get('code')
  if (!supabase || !code) {
    error.value = 'Não foi possível concluir o login.'
    return
  }
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    error.value = 'Não foi possível concluir o login.'
    return
  }
  await navigateTo('/')
})
</script>

<template>
  <main class="auth-callback">
    <p v-if="!error">Entrando…</p>
    <p v-else role="alert">{{ error }}</p>
    <NuxtLink v-if="error" to="/">Voltar ao jogo</NuxtLink>
  </main>
</template>

<style scoped>
.auth-callback {
  min-height: 100dvh;
  display: grid;
  place-content: center;
  gap: 1rem;
  text-align: center;
  color: var(--ord-ink);
}
</style>
