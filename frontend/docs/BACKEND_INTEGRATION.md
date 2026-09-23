# Synch Cash — contrato de integração

O front entregue funciona em modo local. Nenhuma API está integrada, mesmo se `NEXT_PUBLIC_API_URL` estiver definida. A variável configura apenas o cliente HTTP; é necessário substituir a persistência local pelas chamadas desse cliente. Consulte `HANDOFF.md` para o mapa dos pontos de ligação e as limitações conhecidas.

Este documento propõe um contrato; não descreve endpoints existentes. Alinhe-o com o responsável pelo backend antes de implementar. Tipos de requisição e resposta estão em `lib/synch-api.ts` e `lib/models.ts`.

## Endpoints esperados

- `POST /v1/auth/login`
- `POST /v1/auth/register`
- `POST /v1/auth/forgot-password`
- `POST /v1/auth/logout`
- `PUT /v1/auth/password`
- `GET /v1/bootstrap`
- `PUT /v1/transactions/:id`
- `DELETE /v1/transactions/:id`
- `PUT /v1/accounts/:id`
- `DELETE /v1/accounts/:id`
- `PUT /v1/budgets`
- `PUT /v1/recurring/:id`
- `DELETE /v1/recurring/:id`
- `PUT /v1/goals/:id`
- `DELETE /v1/goals/:id`
- `PUT /v1/preferences`
- `PUT /v1/profile/onboarding`
- `POST /v1/transfers`
- `GET /v1/cards/:id/invoices/:cycle/payments`
- `POST /v1/cards/:id/invoices/:cycle/payments`
- `POST /v1/cards/:id/invoices/:cycle/adjustments`
- `POST /v1/invoice-payments/:id/reverse`
- `POST /v1/transactions/:id/receipts`
- `POST /v1/transactions/imports`
- `POST /v1/transactions/imports/:draftId/confirm`
- `GET /v1/data-quality/issues`
- `POST /v1/data-quality/issues/:id/resolve`
- `GET /v1/billing/subscription`
- `POST /v1/billing/subscription/cancel`
- `POST /v1/billing/cakto/webhook`
- `POST /v1/assistant/messages`
- `POST /v1/assistant/transcriptions`

## Novos módulos do front

O painel também está preparado para os seguintes recursos. Enquanto a API não estiver conectada, os dados e as correções ficam no dispositivo:

- explorador de transações com busca por estabelecimento, conta, categoria, status e ordenação;
- estornos, comprovantes, meio de pagamento e estabelecimento normalizado;
- central de cartões com fatura atual/projetada, limite, fechamento, vencimento e histórico;
- assinaturas com projeção mensal/anual e confirmação de sugestões;
- análise de categorias com participação, quantidade de compras, comparação mensal e orçamento mensal de cada categoria (`PUT /v1/budgets`);
- onboarding com renda, dia de pagamento e objetivo principal;
- calendário financeiro (marca também as recorrências ativas previstas, no dia `day` de `RecurringData`), transferências pareadas e divisão por categorias;
- importação CSV/OFX com revisão antes da confirmação;
- comprovantes, pagamento de fatura e histórico do cartão;
- patrimônio líquido e previsão de saldo;
- calculadora financeira (juros compostos, meta de economia, parcelas com juros e à vista x parcelado), calculada inteiramente no navegador;
- assinatura, consumo da IA e páginas de pagamento aprovado, pendente e recusado;
- manifesto PWA, cache apenas de recursos públicos e aviso de funcionamento offline; abertura offline completa não é garantida.

Campos opcionais adicionados em `Transaction`: `merchant`, `paymentMethod`, `kind`, `receiptName`, `qualityResolved`, `transferPairId` e `split`.

Para automatizar esses módulos no backend, a próxima versão da API pode expor:

- `GET /v1/cards/:id/invoices?month=YYYY-MM`
- `GET /v1/analytics/categories?month=YYYY-MM`
- `GET /v1/subscriptions/suggestions`
- `POST /v1/subscriptions/suggestions/:id/confirm`
- `GET /v1/data-quality/issues`
- `POST /v1/data-quality/issues/:id/resolve`
- `POST /v1/transactions/:id/receipts`
- `POST /v1/transactions/imports`

## Autenticação

O cliente envia `credentials: include`. O backend deve preferir cookie `HttpOnly`, `Secure` e `SameSite` adequado, sem guardar tokens sensíveis no navegador.

## Carga inicial

`GET /v1/bootstrap` deve devolver transações, contas, pagamentos (`invoicePayments`), ajustes (`invoiceAdjustments`), orçamentos, recorrências, metas e preferências seguindo os tipos em `lib/models.ts`. Arrays vazios devem ser retornados como `[]`. Não preencher usuários reais com os exemplos demonstrativos do front.

## Pagamento de fatura

O botão do front registra um pagamento informado pelo usuário; ele não movimenta dinheiro no banco. O backend deve processar o registro em uma única transação de banco de dados: criar o pagamento, debitar a conta de origem, reduzir o saldo da fatura, liberar o limite do cartão e criar o lançamento de auditoria.

Payload de `POST /v1/cards/:id/invoices/:cycle/payments`:

```json
{
  "sourceAccountId": 101,
  "amount": 540,
  "date": "2026-09-16",
  "mode": "full",
  "idempotencyKey": "uuid-gerado-uma-vez-por-operacao"
}
```

O backend deve validar saldo, fatura em aberto, valor máximo, propriedade das contas e ciclo no formato `YYYY-MM`. A `idempotencyKey` precisa ser única por usuário para impedir cobranças duplicadas em reenvios. O estorno (`POST /v1/invoice-payments/:id/reverse`) apaga na hora o pagamento e o gasto dele (a movimentação-espelho na conta de origem), sem movimentação inversa e sem corpo de resposta (`204`); a fatura volta a ficar em aberto e o saldo da conta é recalculado. É idempotente: repetir o pedido para um pagamento que já não existe também responde `204`. Se o banco recusar o `DELETE` sem erro (política de segurança sem permissão de apagar), o servidor confere: um pagamento ativo passa a `status: "reversed"` (sai da fatura do mesmo jeito) e apagar um registro já estornado responde `409 DELETE_BLOCKED`.

## Assinaturas e Cakto

O plano exibido no navegador é apenas uma prévia local. A fonte de verdade deve ser o backend. O endpoint de webhook da Cakto precisa validar a assinatura da requisição, tratar o mesmo evento de forma idempotente e atualizar o plano do usuário somente depois da confirmação do pagamento.

Configure na Cakto as páginas de retorno:

- sucesso: `/pagamento/sucesso`;
- pendente: `/pagamento/pendente`;
- recusado: `/pagamento/recusado`.

O front nunca deve liberar o plano premium apenas pelo redirecionamento do navegador.

Quem paga na Cakto **antes** de ter conta no app (ou paga/cancela com outro e-mail): o webhook (`POST /webhooks/cakto`) não acha usuário pra marcar em `assinaturas` nessa hora. Em vez de perder o evento, ele grava o estado (plano, evento, id da Cakto) por e-mail em `cakto_pendencias`, e `POST /v1/auth/register` e `POST /v1/auth/login` aplicam isso em `assinaturas` na primeira vez que essa pessoa criar a conta ou entrar com esse e-mail, depois limpando a pendência. Como é upsert por e-mail, o último evento da Cakto sempre vence (pagar e depois cancelar antes de existir conta não deixa a pessoa presa no plano pago). `cakto_pendencias` tem RLS ligado sem nenhuma policy: só a service_role (webhook e o próprio backend) lê e escreve; nenhum usuário autenticado alcança e-mail ou plano de outra pessoa por ali.

Bug real já encontrado e corrigido: antes de existir a coluna `plano`, o controle de acesso era só um booleano `ativa` (versão antiga do webhook). Quando `plano` foi criada, `alter table ... add column if not exists plano ... default 'gratis'` sobrescreveu quem já era assinante ativo antes da migração — a pessoa continuava com `cakto_evento` de compra/renovação, mas o plano virava `gratis` e nunca mais era corrigido (a Cakto não reenvia o evento original). `supabase_schema.sql` agora tem um `update` idempotente que reaplica `synch_ia` para toda linha com `plano = 'gratis'` e `cakto_evento` de um evento ativo — roda a cada migração, sem efeito depois de corrigida uma vez. Ao investigar isso na conta do próprio dono do produto, achamos e corrigimos 2 contas reais afetadas.

### Acesso vitalício Básico (taxa única, exigida para se cadastrar)

Diferente do Synch IA (assinatura recorrente), o plano Básico Vitalício passou a exigir uma taxa única — cobrada num checkout Cakto separado — só para poder **criar conta**. Não é um upgrade de plano: quem paga continua no `plano: "gratis"`, só ganha o direito de se cadastrar com aquele e-mail.

- `CAKTO_OFERTAS_BASICO_VITALICIO` (env, lista separada por vírgula) tem os `id`s de oferta desse checkout, como aparecem em `data.offer.id` no webhook da Cakto — hoje é só `psh8aeu`, já com esse valor como padrão no código (dá pra sobrescrever pela env sem precisar editar `app.py`, ex.: se um dia existir um segundo checkout pro mesmo acesso). Sem nenhum id (env vazia de propósito), a exigência fica **desligada** e todo cadastro é livre, como antes desse recurso.
- `CAKTO_CHECKOUT_BASICO_VITALICIO` (env, opcional; padrão `https://pay.cakto.com.br/psh8aeu_1097259`) é a URL do checkout, devolvida em `checkoutUrl` no erro `402 PAYMENT_REQUIRED` de `POST /v1/auth/register`; o front usa isso para oferecer um botão "Pagar acesso" direto na notificação de erro.
- **Cuidado com a URL do checkout vs. o `offer.id` do webhook**: a URL concatena `<offer.id>_<checkout>` (ex.: `psh8aeu_1097259`, onde `1097259` é `data.checkout`, o produto/funil — o MESMO número aparece em outras ofertas do mesmo produto, como o Synch IA). O código já compara com o `offer.id` sozinho (`psh8aeu`); usar a URL inteira como id, como uma versão anterior deste arquivo fazia (`psh8aeu_1097259`), nunca bate com nenhum webhook real — confirmado com um payload de teste real antes de corrigir.
- Webhook: uma compra aprovada para essa oferta grava a autorização em `cakto_pendencias` (mesma tabela do Synch IA, reaproveitada) só se a conta ainda não existir; se já existir, não faz nada (quem já tem conta continua normalmente, sem qualquer exigência retroativa). Reembolso/chargeback antes de existir conta revoga essa autorização.
- `POST /v1/auth/register` recusa com `402 PAYMENT_REQUIRED` qualquer e-mail sem uma linha correspondente em `cakto_pendencias`, antes até de chamar o Supabase Auth (evita criar usuário/disparar e-mail de confirmação para quem não pagou). A autorização é **consumida** (apagada) no primeiro cadastro bem-sucedido, então o mesmo pagamento não serve para criar uma segunda conta depois.
- Contas já existentes antes desse recurso não são afetadas: a exigência vale só para cadastros novos.

## Arquivos e funcionamento offline

O nome do comprovante é salvo localmente apenas para demonstrar o fluxo. O arquivo real deve ser enviado a armazenamento privado, com URL temporária autorizada pelo backend. O service worker só armazena logo, favicon e manifesto. Não armazena HTML, dados da API, autenticação ou pagamento. Sincronização, fila offline e resolução de conflitos ainda não estão implementadas.

## Convenções do contrato

- Datas de movimentações: `YYYY-MM-DD`, sem converter para UTC. Instantes de auditoria: ISO 8601 com timezone.
- Ciclo de fatura: `YYYY-MM`, referente ao mês em que a fatura **fecha** (é a chave que o backend grava em compras e pagamentos). Compra até o dia do fechamento, inclusive, permanece nesse ciclo mesmo que ele já tenha sido pago; só o que passa do fechamento vai para o ciclo seguinte. O vencimento cai no mesmo mês do fechamento quando `dueDay > closingDay` e no mês seguinte quando `dueDay <= closingDay`. Dias 29–31 são limitados ao último dia do mês.
- Compra no cartão nunca é pendente: o servidor grava e devolve `status: "paid"` para qualquer transação de conta do tipo cartão de crédito (a pendência é da fatura). Dados antigos pendentes no cartão também saem como `paid`.
- Receita em conta de cartão é estorno: a conta é mantida, `kind` vira `"refund"` e o valor abate a fatura do ciclo (mesma regra de ciclo das compras). `Account.color` deve ser `#rrggbb`; outro formato cai na cor atual (ou no padrão).
- Dinheiro: o front usa reais numéricos e faz cálculos de fatura em centavos inteiros. Persistir decimal exato ou centavos inteiros no servidor; manter uma conversão explícita na borda da API.
- `Transaction.id` e IDs de conta são números no front atual. Se o backend usar UUID, mudar os tipos e referências no front, incluindo pares de transferência, em vez de converter UUID com `Number()`.
- `Account.balance` para cartões é o compromisso total entre ciclos; não é necessariamente o valor da fatura selecionada. Para contas, representa o saldo exibido. `invoicePaymentId` identifica registros de auditoria que não devem ser editados como compras.
- Retornar 200/201 com JSON válido; 204 sem corpo para operações sem resposta. Erros: `{ "code": "STALE_DATA", "message": "Atualize os dados antes de continuar." }`, opcional `X-Request-Id`.
- 401: expirar sessão e limpar os dados em memória; 403: negar ação; 409: recarregar e pedir nova revisão; 422: apontar campos; 429: aguardar. A interface precisa mapear esses estados ao conectar as chamadas.
- Cliente HTTP: timeout de 30 segundos, `credentials: include`, `cache: no-store`, cancelamento no bootstrap, multipart sem Content-Type manual. Sem repetição automática de mutações: após timeout confirmar resultado usando a mesma chave idempotente.
- Após pagar, estornar, conciliar, importar ou transferir, buscar o snapshot atualizado do servidor. Não aplicar também o cálculo local: isso duplicaria o efeito.
- PUTs de criação são uma proposta de upsert com ID do cliente. Para IDs gerados pelo servidor, separar POST de criação e PUT/PATCH de edição e atualizar o cliente antes de ligar a interface.
- Webhook Cakto é servidor-servidor; verificar autenticidade conforme a configuração/documentação do gateway, usuário/compra e duplicidade do evento. Nunca confiar no plano salvo no navegador.
