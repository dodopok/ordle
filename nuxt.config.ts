export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  // Vercel Analytics: sem cookie e sem identificador de usuário, então não
  // pede banner de consentimento. Só coleta rodando na Vercel — em dev e em
  // `node .output/server/index.mjs` o script fica inerte.
  modules: ['@vercel/analytics/nuxt'],
  css: ['~/assets/css/ordle.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
    },
  },
  typescript: { strict: true },
})
