# Migração do Ordle

O site continua na Vercel. As APIs Nitro acessam um PostgreSQL privado na Railway;
o Google autentica diretamente no Ordle, com sessão em cookie HttpOnly.

## Dados

A exportação contém somente as quatro tabelas `ordle_*` e, para suas contas,
UUID, identificador Google, primeiro nome e data de criação. Não contém senhas,
tokens, e-mails nem dados dos outros aplicativos. Mantenha-a fora do Git e com
permissão 600. O diretório `.data/` já é ignorado.

Importe em um banco PostgreSQL 14+ exclusivo e vazio, usando o usuário proprietário:

```sh
DATABASE_URL=... node scripts/import-supabase.mjs .data/migration/ordle-export.json
```

O script cria o schema sem extensões, importa tudo em uma transação e compara
todos os registros com a origem antes de confirmar. Recusa um destino com dados.
Preserva UUIDs, vínculos Google, partidas, estatísticas, preferências e recibos
de importação local. As credenciais do banco ficam somente no servidor.

## Configuração e ativação

1. Configure as variáveis descritas em `.env.example` na Vercel. Use a conexão
   pública autenticada da Railway, pois a Vercel não alcança sua rede privada.
2. Preserve o `ORDLE_SECRET` atual. Gere um `NUXT_SESSION_PASSWORD` separado,
   com pelo menos 32 caracteres. A troca do backend exige entrar novamente com
   Google; os dados locais e os UUIDs das contas continuam os mesmos.
3. No cliente OAuth Google existente, acrescente
   `https://ordle.oficio.app/auth/google` às URIs de redirecionamento autorizadas.
   Preserve o callback do Supabase para os outros aplicativos.
4. Defina `NUXT_OAUTH_GOOGLE_REDIRECT_URL` com esse mesmo valor, configure
   `NUXT_OAUTH_GOOGLE_CLIENT_ID` e `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`, e habilite
   `NUXT_PUBLIC_ACCOUNTS_ENABLED=true`.
5. Execute `npm run verify`; publique e valide login, sincronização de uma conta
   existente, ranking, troca de dispositivo e gravação de uma partida.

Não crie outra instância Railway sem verificar custo. Um banco lógico e um
usuário exclusivos em uma instância PostgreSQL existente evitam outra instância,
mas o uso adicional de recursos ainda pode afetar a cobrança.

## Retorno

O Supabase de origem é preservado. Antes de ativar, guarde a versão e as variáveis
anteriores da Vercel. Para retornar, publique essa versão e restaure suas variáveis.
Após a primeira gravação na Railway, faça uma exportação do destino antes de
retornar; voltar somente à cópia antiga deixaria de fora as partidas novas.
