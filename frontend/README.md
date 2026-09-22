# Synch Cash — frontend para integração

Entrega: 18/09/2026. Next.js + React + TypeScript.
O backend NÃO está conectado. O login e os dados atuais são demonstrativos e locais.

## Abrir no VS Code
Instale Node.js 24 LTS. Extraia o ZIP; abra a pasta synch-cash-frontend no VS Code.
No terminal dessa pasta (PowerShell, Prompt, bash ou terminal do VS Code):

```sh
npm ci
npm run dev
```

Abra http://localhost:3000. Para testar a demonstração, use um e-mail fictício válido e uma senha fictícia de pelo menos 6 caracteres. Não há criação de conta real.
Não execute os comandos dentro do ZIP sem extrair.

## Verificar e gerar produção
```sh
npm test
npm run typecheck
npm run build
npm start
```

Pare o servidor de desenvolvimento antes de rodar npm start na mesma porta.
O ZIP não inclui node_modules ou builds; npm ci instala as versões do package-lock.json.

## Entrega para o backend
Comece por docs/HANDOFF.md, depois docs/BACKEND_INTEGRATION.md.
- lib/models.ts: modelos usados na interface.
- lib/synch-api.ts: chamadas HTTP tipadas, erros, timeout e contratos propostos.
- lib/invoice-ledger.ts: regras locais de fatura para referência e testes.
- lib/use-local-ledger.ts: persistência local que deve ser substituída.
- tests/: testes de regras financeiras, CSV e transporte HTTP.
- .env.example: única variável pública prevista.

Copiar .env.example para .env.local e preencher a URL NÃO conecta a interface automaticamente.
O desenvolvedor precisa trocar os setters locais pelas chamadas e tratar estados de carregamento, erro e sessão. Não colocar chaves privadas em variáveis NEXT_PUBLIC_*.

## Vercel
Crie um repositório com esta pasta e importe na Vercel como Next.js.
Root Directory: pasta que contém package.json.
Install Command: npm ci.
Build Command: npm run build.
Output Directory: padrão do Next.js; não selecionar dist.
Publicar este ZIP sozinho disponibiliza a demonstração, sem autenticação real.
Não alterar a infraestrutura do backend a partir desta entrega.

## O que foi preparado
Faturas por ciclo, pagamentos parciais/totais, estorno, histórico, ajuste justificado,
limite comprometido em ciclos futuros, parcelas com centavos exatos, CSV corrigido,
tratamento de erro da página, cliente HTTP e cache restrito a arquivos públicos.

## Limites
Não há pagamento bancário, IA externa, upload persistente ou confirmação de assinatura pelo servidor.
Leia todas as pendências conhecidas e roteiro de homologação em docs/HANDOFF.md.

## Atualização mobile
Menu inferior com acesso aos módulos, transações em cards, formulários com rolagem e áreas seguras para celular. Validação visual em aparelhos reais ainda pendente.
