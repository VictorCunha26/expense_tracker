# Entrega técnica — Synch Cash frontend
Data: 17/09/2026

## Estado desta entrega
Frontend demonstrativo com dados locais, código-fonte e cliente HTTP tipado para integração futura. Não existe backend conectado. Definir NEXT_PUBLIC_API_URL sozinho NÃO muda a origem dos dados. Não disponibilizar o login simulado como autenticação de produção.

## Onde conectar
| Área | Arquivo / ponto atual | Trabalho de integração |
|---|---|---|
| Login, cadastro e sessão | app/page.tsx: LoginScreen, login, logout, getAuthSnapshot | Substituir flag local por sessão real; ligar login/cadastro/logout/recuperação; carregar usuário autenticado |
| Dados iniciais | app/page.tsx: Home; lib/use-local-ledger.ts | Buscar synchApi.bootstrap após login; mapear transactions → ledger.items, invoicePayments → payments e invoiceAdjustments → adjustments |
| Transações | app/page.tsx: submit, confirmDelete, importCsv | Usar API e respostas do servidor; loading e bloqueio de envio durante mutação; preservar formulário se falhar |
| Contas e faturas | components/accounts-card-center.tsx; lib/invoice-ledger.ts | Substituir commit local por operações atômicas de pagamento, estorno e ajuste; recarregar snapshot; manter revisão antes de confirmar |
| Metas, recorrências, orçamentos, preferências | app/page.tsx: useStoredState e setters | Persistência por usuário; não reutilizar armazenamento global local entre contas reais |
| Transferências | app/page.tsx: ramo mode=transfer | Operação atômica no backend; tratar par na edição/exclusão e retornar saldos atualizados |
| Calendário e planejamento | components/advanced-finance.tsx | Receber snapshot coerente; definir regra de datas e projeções com backend |
| Assinatura | components/advanced-finance.tsx: SubscriptionView; components/payment-status-page.tsx | Usar assinatura validada no servidor; retorno da Cakto não ativa plano |
| Assistente | app/page.tsx: AssistantExperience, processInput, confirmPending | Trocar regras locais por API; executar ferramentas só após confirmação; nova chave idempotente por ação |
| Voz | app/page.tsx: reconhecimento e speak | Navegador hoje; transcrição e voz premium via servidor ainda pendentes |
| Comprovantes | receiptName em Transaction | Upload real, autorização por usuário, URL temporária e exclusão segura |
| PWA | public/sw.js | Cache somente de arquivos públicos; não armazenar dados autenticados ou respostas de API |

Os nomes dos componentes são pontos de busca; não há necessidade de preservar o layout monolítico de app/page.tsx durante a integração.

## Sequência recomendada para o desenvolvedor
1. Rodar o ZIP localmente e alinhar os tipos de lib/models.ts e rotas de lib/synch-api.ts com o backend.
2. Implementar autenticação/sessão e separação de dados por usuário.
3. Carregar bootstrap e substituir as fontes locais. Em falha de API, mostrar erro e tentar novamente; não retornar silenciosamente aos dados demonstrativos.
4. Conectar CRUD de contas/transações e operações financeiras atômicas.
5. Conectar os demais módulos, arquivos, assistente e assinatura.
6. Validar erros de rede, sessão expirada, concorrência, idempotência e os fluxos em dispositivos reais.

## Regras essenciais de fatura
- O botão registra um pagamento que o usuário informou. Não paga banco ou boleto.
- Pagamentos parciais e totais debitam a conta escolhida e reduzem a obrigação do cartão em uma operação.
- Estornar apaga o pagamento e o gasto dele na hora (sem diálogo de confirmação e sem movimento inverso): a fatura volta a ficar em aberto e o saldo da conta é recalculado. Pagamento não conta como nova despesa de consumo.
- Compra no cartão nunca é pendente (`status` sempre `paid`); a pendência é a fatura. Na interface, o status de compra no cartão aparece como "Na fatura".
- Receita lançada numa conta de cartão é **estorno**: o servidor mantém a conta, grava `kind: "refund"` e ela abate a fatura do ciclo (devolve o valor ao limite). Antes a conta era descartada e o valor nunca voltava para o cartão.
- Cada cartão tem uma cor (`Account.color`, formato `#rrggbb`), escolhida numa paleta das cores mais comuns em cartões; o servidor ignora valores fora desse formato.
- A fatura leva o mês em que fecha. Compra até o dia do fechamento fica nela mesmo depois de paga (a fatura reabre com o novo valor em aberto); só o que passa do fechamento vai para a próxima. A fatura só aparece como "Fechada" depois do dia do fechamento.
- O limite considera todas as faturas em aberto, incluindo futuras. Crédito (estorno numa fatura ainda sem compras, ou pagamento a mais) abate o que se deve nas outras faturas, então o limite volta mesmo quando o estorno cai no ciclo seguinte; o usado nunca fica abaixo de zero. Fatura com crédito mostra "Crédito de estorno", nunca como valor pago.
- Cada ajuste manual tem justificativa e ciclo específico.
- Criar uma chave idempotente por operação; preservá-la ao repetir a mesma solicitação. Servidor deve retornar o resultado anterior para repetição com mesmo payload e rejeitar a mesma chave com payload diferente.
- Saldo importado do modelo anterior vira ajuste explícito; não reaplicar em cada mês.
- O saldo e permissões enviados pelo navegador não são autoridade. Revalidar tudo no servidor.

## Limitações conhecidas para concluir com o backend
- Login/cadastro demonstrativos; não enviam e-mail, validam identidade ou protegem dados.
- Dados locais são do dispositivo, não isolados entre usuários. Não migrar automaticamente para uma conta real sem revisão e confirmação.
- Contas comuns têm saldos editáveis; lançamentos normais e transferências ainda não constituem um livro-caixa bancário conciliado. Definir saldo inicial + movimentos no servidor e retornar saldo autoritativo.
- Transferências locais criam um par demonstrativo. Edição/exclusão de pares e conciliação de contas precisam do serviço transacional.
- Preferências/metas/recorrências usam chaves locais separadas; operações que atravessam módulos não são transações de banco de dados.
- A Synch IA roda no Gemini (Google, plano gratuito) pelo backend (`synch_ia.py`, rota `/api/v1/assistant/messages`), usando a API compatível com OpenAI; exige `GEMINI_API_KEY` no ambiente do Flask. `SYNCH_IA_MODELOS` define a lista de modelos (tenta o próximo quando um está sobrecarregado ou sem cota) e `SYNCH_IA_BASE_URL` + `SYNCH_IA_API_KEY` apontam para outro provedor compatível. No plano gratuito o Google pode usar o conteúdo enviado para melhorar os produtos dele. A voz continua usando o reconhecimento e a síntese do navegador. A IA só propõe ações: nada é gravado sem a confirmação do usuário no card. O percentual de confiança é a autoavaliação do modelo, não uma garantia.
- Recorrências não possuem execução agendada no servidor; notificações, resumo semanal e compartilhamento familiar não estão automatizados.
- O arquivo do comprovante não é persistido: apenas seu nome.
- Importação CSV/OFX é uma interpretação local com revisão; validar os formatos reais dos bancos e deduplicação no servidor.
- Plano e limites locais são demonstração. Webhook, cancelamento, consumo e bloqueios por plano precisam de validação do backend.
- Confirmar domínio/e-mail de suporte, preços, periodicidade e links Cakto antes de publicar para clientes.
- Sem chaves de IA, gateway, banco ou segredos no ZIP. Nunca colocar segredos em NEXT_PUBLIC_*.
- Configuração de CORS, cookies, CSRF e autorização depende da implantação escolhida. Validar no backend; não desabilitar proteções para contornar erros.
- A validação visual final de celular e os fluxos conectados dependem de testes posteriores. Não foi feita homologação com uma API real nesta entrega.

## QA para homologação
- Desktop e celulares de 360, 390 e 768 px: menu, modal, teclado, tabelas, rolagem, foco e botão de confirmar visíveis.
- Criar/editar/excluir transação; atualizar página; conferir persistência por usuário.
- Compra no fechamento, após fechamento, dezembro/janeiro e fevereiro.
- R$ 100 em 3 parcelas deve resultar em 33,34 + 33,33 + 33,33.
- Pagamento parcial, pagamento total, duplo clique, timeout, reenvio e estorno.
- Editar dados em duas abas; impedir salvar com versão antiga.
- CSV com aspas, vírgulas, linhas e R$ 149,90; conferir total antes de importar.
- Retorno /pagamento/sucesso sem pagamento não concede acesso.
- Logout e entrada com outro usuário não exibem dados anteriores.
- Negar microfone, cancelar áudio e corrigir transcrição antes de enviar.

## Arquitetura de exportação
O ZIP usa Next.js padrão, sem exigir o ambiente de hospedagem anterior ou comandos bash. A cópia de exportação não contém worker/D1, pasta .git, node_modules, credenciais, build gerado ou a rota temporária de QA. Algumas dependências antigas permanecem no lockfile para preservar versões reproduzíveis; podem ser removidas após a integração.

Leia BACKEND_INTEGRATION.md para o contrato proposto. O cliente HTTP não chama endpoints ao iniciar o app.
