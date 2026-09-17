<script setup lang="ts">
import { getSupabaseClient } from '../../utils/supabase'

definePageMeta({ ssr: false })

const error = ref('')

onMounted(async () => {
  const supabase = getSupabaseClient()
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const oauthError = params.get('error_description') || params.get('error')
  if (!supabase || oauthError) {
    error.value = 'Não foi possível concluir o login.'
    return
  }

  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      error.value = 'Não foi possível concluir o login.'
      return
    }
  }

  const { data, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !data.session) {
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
