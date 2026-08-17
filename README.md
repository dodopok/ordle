# ordle

Tipo o Wordle, mas Ordo... entendeu?

Uma palavra litúrgica de 5 letras por dia, em 6 tentativas. No fim da partida o
jogo revela a grafia acentuada e a **definição** do termo — quem erra "AMBÃO"
aprende o que é um ambão. É catequético por acidente, e é isso que justifica o
link para o [Ordo](https://oficio.app) na tela de resultado.

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
não pode ser importado por nada em `composables/`, `components/` ou `pages/` —
se entrar no bundle do client, a resposta vaza. `npm run check:leak` reprova o
build quando isso acontece, e a regra vale também para exemplos na tela de
ajuda (por isso ela usa TRIGO/OLIVA/MURAL, que não estão na lista).

**O estado mora num cookie assinado.** Sem banco, sem Redis: o tabuleiro vai num
cookie `httpOnly` com HMAC-SHA256 (`server/utils/session.ts`). O cliente carrega
o estado mas não consegue forjá-lo, e não consegue zerar a contagem de
tentativas para brutar palpites na mesma partida. O `localStorage` é só cache de
UI e estatísticas — quem manda é o servidor, sempre.

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

`server/utils/liturgy.ts` prefere a Estêvão API (a mesma que alimenta o Ordo),
configurada via `ORDLE_LITURGY_API` — o `gameId` é concatenado no fim da URL,
a resposta precisa ter um campo `color` (aceita pt-BR ou inglês). Timeout de
1,5s, cache de uma hora, e qualquer falha cai no cálculo local: computus
gregoriano + estações + as festas fixas que valem desvio de cor. O jogo nunca
quebra por causa de um filete colorido.

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
