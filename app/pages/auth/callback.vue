<script setup lang="ts">
// Também recebe callbacks do fluxo antigo que estavam abertos na migração.
const error = 'Não foi possível concluir o login. Volte ao jogo e entre novamente com Google.'
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
