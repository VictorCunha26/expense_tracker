# Validação da entrega — 17/09/2026

Ambiente usado: Linux, Node.js 24.19.0, Next.js 16.2.6 e dependências instaladas com versões correspondentes ao lockfile.

- `npm test`: 11 testes passaram, nenhum falhou. Cobertura: fechamento/vencimento, virada de ano, fevereiro, compromisso futuro, pagamento parcial/total, duplicidade, persistência serializada, estorno, validação de valor/data/saldo, ajustes, migração, centavos em parcelas, CSV e erros/transporte HTTP simulado.
- `npm run build`: concluído com sucesso; incluiu checagem de TypeScript e geração estática das páginas.
- Rotas geradas: `/`, `/login`, `/pagamento/pendente`, `/pagamento/recusado`, `/pagamento/sucesso` e página de não encontrado.
- Dependências do package.json conferidas com as entradas do package-lock.json.
- Exportação sem node_modules, build, segredos, repositório Git, worker/D1 ou rota temporária de QA.

Limites da validação: não houve instalação limpa em Windows ou deploy na Vercel nesta entrega. Não foi concluído teste visual interativo do ZIP em navegador/celular; o roteiro está em HANDOFF.md. Os testes HTTP usam respostas simuladas e não acessam backend real. A página publicada anteriormente não foi atualizada por esta exportação.
