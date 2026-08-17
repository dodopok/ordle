# ordle

Tipo o Wordle, mas Ordo... entendeu?

Uma palavra litúrgica de 5 letras por dia, em 6 tentativas. No fim da partida o
jogo revela a grafia acentuada e a **definição** do termo — quem erra "AMBÃO"
aprende o que é um ambão. É catequético por acidente, e é isso que justifica o
link para o [Ordo](https://oficio.app) na tela de resultado.

Nuxt 4 (`app/` para o client, `server/` para o Nitro).

## Rodando

```sh
npm install
npm run dev            # http://localhost:3000/ordle
```

Em produção, `ORDLE_SECRET` é obrigatório (o servidor se recusa a subir sem
ela). Veja `.env.example`.

```sh
npm run build
ORDLE_SECRET=$(openssl rand -base64 32) node .output/server/index.mjs
```

## Deploy (Vercel)

Nuxt detecta a Vercel sozinho — não precisa de `vercel.json`. Configure em
Settings → Environment Variables, nos três ambientes:

| Variável | Obrigatória | Valor |
|---|---|---|
| `ORDLE_SECRET` | sim | `openssl rand -base64 32`. **A mesma em Production e Preview** — trocar derruba as partidas em andamento |
| `ORDLE_LITURGY_KEY` | não | o `APP_INTERNAL_IDENTIFIER` do app. Sem ela o jogo usa o cálculo local |
| `ORDLE_LITURGY_HEADER` | não | só se sair de `X-App-Internal-Id` |
| `ORDLE_LITURGY_PRAYER_BOOK` | não | só se sair de `loc_2015` |

Sem `ORDLE_SECRET` o servidor devolve 500 em vez de assinar com a chave de dev,
que é pública — ver "fail-closed" abaixo.

Duas coisas guardam estado em memória do processo e, em serverless, valem por
instância: o **rate limit** (30 req/min vira 30 por lambda — na prática mais
frouxo) e o **cache da cor litúrgica** (cada instância nova paga um round-trip).
Nenhum dos dois afeta a integridade do jogo; se o rate limit passar a importar,
troque o Map por Vercel KV.

## Scripts

| | |
|---|---|
| `npm test` | testes unitários (coloração, palavra do dia, sessão, sanidade da lista) |
| `npm run build` | build de produção |
| `npm run check:leak` | varre `.output/public/` atrás de respostas vazadas |
| `npm run verify` | os três acima, em ordem — é o que roda no CI |
| `npm run dictionary` | regenera `server/utils/pt-5.json` a partir do Hunspell pt_BR |

## Como funciona

**A resposta nunca sai do servidor** até a partida acabar. `server/utils/words.ts`
não pode ser importado por nada dentro de `app/` — se entrar no bundle do
client, a resposta vaza. `npm run check:leak` reprova o
build quando isso acontece, e a regra vale também para exemplos na tela de
ajuda (por isso ela usa TRIGO/OLIVA/MURAL, que não estão na lista).

**O estado mora num cookie assinado.** Sem banco, sem Redis: o tabuleiro vai num
cookie `httpOnly` com HMAC-SHA256 (`server/utils/session.ts`). O cliente carrega
o estado mas não consegue forjá-lo, e não consegue zerar a contagem de
tentativas para brutar palpites na mesma partida. O `localStorage` é só cache de
UI e estatísticas — quem manda é o servidor, sempre.

A assinatura é **fail-closed**: a chave de fallback está aqui no repo, e com ela
qualquer um forja um cookie com `status: 'won'`, então ela só vale quando
`NODE_ENV` diz explicitamente `development` ou `test`. `NODE_ENV` vazio,
`preview` ou qualquer outra coisa estoura na hora de assinar em vez de cair no
atalho. O `secure` do cookie segue a mesma regra.

**A palavra do dia é determinística.** `gameNumber` conta dias desde 2026-01-01
em `America/Sao_Paulo`, e indexa uma permutação da lista embaralhada com seed
fixa (`server/utils/ordle.ts`). Sem estado, sem banco, e o dia seguinte nunca é
pré-carregado.

**Acentos são ignorados na digitação.** Toda comparação usa a forma normalizada
(`key`); a acentuada (`word`) só aparece no reveal. `UNCAO` vale para `UNÇÃO`.

**A cor do dia é o único acento variável.** O filete de 3px no header e o número
do jogo saem na cor litúrgica de hoje — roxo na Quaresma, rosa no Gaudete,
vermelho em mártires. As três cores de feedback (verde/ouro/cinza) são fixas: a
leitura precisa ser aprendida uma vez e valer sempre.

## Duas listas de palavras

- `server/utils/words.ts` — as respostas, curadas, com definição. 69 termos ≈
  dois meses e meio de jogo.
- `server/utils/pt-5.json` — os palpites válidos: ~19,6 mil palavras de 5 letras
  do dicionário Hunspell pt_BR (VERO/LibreOffice), com os afixos expandidos.
  Sem a expansão o jogador não conseguiria usar plural nem conjugação
  (`VELAS`, `REGRA`, `CASAS`) e o jogo ficaria insuportável.

O conjunto de palpites contém o de respostas — `dictionary.ts` insere as chaves
de `words.ts` no Set, porque o Hunspell não conhece KYRIE nem AGNUS. Há teste
para isso: é o tipo de bug que só aparece às 6h da manhã, quando a palavra do
dia é impossível de digitar.

## Cor litúrgica

`server/utils/liturgy.ts` busca o dia na API do Caminho Anglicano — a mesma que
alimenta o Ordo:

```
GET /api/v1/calendar/:ano/:mes/:dia?preferences[prayer_book_code]=loc_2015
    header X-App-Internal-Id: <chave>
```

Os dois são obrigatórios: sem o header vem 401 `APP_VERIFICATION_REQUIRED`, sem
o prayer book vem `PRAYER_BOOK_REQUIRED`. A chave sai de `ORDLE_LITURGY_KEY`
(veja `.env.example`); header e prayer book têm override próprio, mas o padrão
já é o certo.

Timeout de 2,5s (medido: ~725ms na primeira chamada, 125–160ms quente, 30 KiB
de payload), cache de uma hora com stale-while-revalidate — entrada vencida
responde na hora e revalida em segundo plano, então só a primeira chamada de
cada instância paga o round-trip. Qualquer falha (401, rede fora, timeout, cor
irreconhecível) cai no cálculo local: computus gregoriano + estações +
Gaudete/Laetare + as festas fixas que valem desvio de cor.

### Duas sutilezas do calendário

`extractDay()` faz o parsing separado da rede, e tem teste com recortes de
payloads reais para cada uma:

**A cor do dia é `liturgical_color`, no topo — nunca `celebration.color`.** Em
13/12/2026 a celebração é Luzia (`vermelho`), mas o dia é o Domingo Gaudete e
sai `rosa`. Ler a cor da celebração pintaria o header de vermelho no meio do
Advento.

**A celebração nem sempre nomeia o dia.** Ela só vale como rótulo quando a cor
dela bate com a do dia — festa que cede ao domingo vem com cor divergente. Em
18/10/2026 vem Lucas (`branco`) num domingo do Tempo Comum (`verde`): quem
nomeia é o `sunday_name`. Já em 01/11/2026, Todos os Santos (`branco`) bate com
o dia e vence o domingo, como manda a precedência de festa principal. O
fallback local reproduz essa precedência com uma flag por festa fixa.

## Antifraude

Jogo de navegador nunca é à prova de gente determinada; o objetivo é tirar a
resposta do alcance de quem abre o DevTools por curiosidade.

1. Lista de respostas só no servidor — resolve 95% do problema.
2. Contagem de tentativas no cookie assinado.
3. Rate limit de 30 req/min por IP em `/api/ordle/guess` (Map em memória; se
   rodar serverless com várias instâncias, troque por um KV).
4. O dia seguinte nunca é pré-carregado.
5. Dá para brutar com cookies novos. Não vale gastar mais que isso — não tem
   prêmio.
