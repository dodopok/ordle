<script setup lang="ts">
const emit = defineEmits<{ (e: 'close'): void }>()

/**
 * Nenhum destes exemplos pode estar na lista de respostas — eles vão para o
 * bundle do client, e a checagem de vazamento (`npm run check:leak`) reprova
 * qualquer resposta que apareça lá.
 */
const examples = [
  {
    word: 'TRIGO',
    marks: ['correct', 'absent', 'absent', 'absent', 'absent'],
    text: 'T está na palavra e na posição certa.',
  },
  {
    word: 'OLIVA',
    marks: ['absent', 'present', 'absent', 'absent', 'absent'],
    text: 'L está na palavra, mas em outra posição.',
  },
  {
    word: 'MURAL',
    marks: ['absent', 'absent', 'absent', 'absent', 'absent'],
    text: 'Nenhuma dessas letras está na palavra.',
  },
] as const
</script>

<template>
  <OrdleModal title="Como jogar" @close="emit('close')">
    <p>
      Adivinhe a palavra litúrgica do dia em <strong>6 tentativas</strong>. Cada palpite tem que ser
      uma palavra de 5 letras.
    </p>
    <p class="muted">
      Acentos são ignorados: digite <strong>PATIO</strong> para <strong>PÁTIO</strong>.
    </p>
    <p class="muted">
      Dá para <strong>tocar num quadrado</strong> e escrever a letra direto naquela posição —
      útil quando você já sabe onde uma letra entra.
    </p>

    <div v-for="ex in examples" :key="ex.word" class="ex">
      <div class="ex__row">
        <OrdleTile
          v-for="(l, i) in ex.word.split('')"
          :key="i"
          :letter="l"
          :mark="ex.marks[i]"
          :index="i"
        />
      </div>
      <p class="ex__text">{{ ex.text }}</p>
    </div>

    <p class="muted">
      Uma palavra nova todo dia à meia-noite (horário de Brasília). No fim da partida, a definição
      do termo aparece — é o jogo devolvendo alguma catequese.
    </p>
  </OrdleModal>
</template>

<style scoped>
p { margin: 0 0 0.75rem; line-height: 1.5; font-size: 0.9375rem; }
.muted { color: var(--ord-muted); font-size: 0.875rem; }
.ex { margin: 1rem 0; }
.ex__row { display: flex; gap: 4px; --ord-tile: 2.25rem; }
.ex__text { margin: 0.5rem 0 0; font-size: 0.875rem; color: var(--ord-muted); }
</style>
