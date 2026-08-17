<script setup lang="ts">
/**
 * O jogo mora na raiz. Esta rota existe só porque `/ordle` foi a URL canônica
 * durante o desenvolvimento e pode ter vazado em link — encaminha em vez de
 * dar 404.
 *
 * É redirect permanente de propósito: assim o buscador consolida na raiz e o
 * caminho antigo não fica competindo com ela.
 */
await navigateTo('/', { redirectCode: 301, replace: true })
</script>

<template>
  <div />
</template>
