import type { Account, InvoicePayment, LocalLedger, Transaction } from "./models"

export const cents = (value: number) => Math.round(value * 100)
export const cash = (value: number) => value / 100
export const newRecordKey = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-")
export const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
export function shiftMonth(key: string, offset: number) {
  const [year, month] = key.split("-").map(Number), d = new Date(year, month - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
export function dayInMonth(key: string, day: number) {
  const [year, month] = key.split("-").map(Number)
  return `${key}-${String(Math.min(day, new Date(year, month, 0).getDate())).padStart(2, "0")}`
}
export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
export const configured = (card: Account) => Boolean(card.closingDay && card.dueDay)
// The cycle key is the month the invoice CLOSES, the same key the backend stores on purchases and payments.
// A purchase up to and including the closing day stays in that cycle, even if it was already paid;
// only what comes after the closing day goes to the next one.
export function purchaseCycle(card: Account, date: string) {
  const key = date.slice(0, 7)
  if (!configured(card)) return key
  return date <= dayInMonth(key, card.closingDay!) ? key : shiftMonth(key, 1)
}
// A due day at or before the closing day means the invoice is due in the month after it closes.
export const dueMonthShift = (card: Account) => card.dueDay! <= card.closingDay! ? 1 : 0
export function cycleDates(card: Account, cycle: string) {
  if (!configured(card)) return null
  return { closing: dayInMonth(cycle, card.closingDay!), due: dayInMonth(shiftMonth(cycle, dueMonthShift(card)), card.dueDay!) }
}
/** Cycle of the invoice that falls due in `month` (what a calendar month shows). */
export const cycleDueIn = (card: Account, month: string) => configured(card) ? shiftMonth(month, -dueMonthShift(card)) : month
export const isInvoiceMarker = (item: Transaction) => /^fatura do cart[aã]o$/i.test(item.description.trim()) && !item.paymentMethod
export const isAnalytical = (item: Transaction) => item.kind !== "transfer" && !item.invoicePaymentId && !isInvoiceMarker(item)
export const belongsToCard = (item: Transaction, card: Account) => item.cardId ? item.cardId === card.id : item.account === card.name
export function invoice(ledger: LocalLedger, card: Account, cycle: string, today = localDate()) {
  const rows = ledger.items.filter(item => belongsToCard(item, card) && isAnalytical(item) && (item.type === "expense" || item.kind === "refund") && (item.invoiceCycle || purchaseCycle(card, item.date)) === cycle)
  const purchases = rows.reduce((sum, item) => sum + (item.type === "income" ? -1 : 1) * cents(item.amount), 0)
  const adjustment = ledger.adjustments.filter(a => a.cardId === card.id && a.cycle === cycle && a.status === "active").reduce((sum, a) => sum + cents(a.amount), 0)
  const paid = ledger.payments.filter(p => p.cardId === card.id && p.cycle === cycle && p.status === "active").reduce((sum, p) => sum + cents(p.amount), 0)
  const gross = purchases + adjustment, outstanding = Math.max(0, gross - paid), credit = Math.max(0, paid - gross)
  const dates = cycleDates(card, cycle)
  const status = gross > 0 && outstanding === 0 ? "Paga" : dates && outstanding > 0 && today > dates.due ? "Vencida" : paid > 0 && outstanding > 0 ? "Parcialmente paga" : dates && today > dates.closing ? "Fechada" : "Aberta"
  return { rows, gross: cash(gross), purchases: cash(purchases), adjustment: cash(adjustment), paid: cash(paid), outstanding: cash(outstanding), credit: cash(credit), dates, status }
}
export function cardCycles(ledger: LocalLedger, card: Account) {
  return [...new Set([
    ...ledger.items.filter(i => belongsToCard(i, card) && isAnalytical(i)).map(i => i.invoiceCycle || purchaseCycle(card, i.date)),
    ...ledger.payments.filter(p => p.cardId === card.id).map(p => p.cycle),
    ...ledger.adjustments.filter(a => a.cardId === card.id).map(a => a.cycle),
  ])].sort()
}
export function commitment(ledger: LocalLedger, card: Account, cycle: string) {
  const bills = cardCycles(ledger, card).map(key => ({ key, ...invoice(ledger, card, key) }))
  // Crédito (estorno numa fatura ainda sem compras, ou pagamento a mais) abate o que se deve nas outras faturas:
  // o limite volta mesmo quando o estorno cai num ciclo vazio. Nunca fica abaixo de zero.
  const used = cash(Math.max(0, bills.reduce((sum, bill) => sum + cents(bill.gross) - cents(bill.paid), 0)))
  return { used, available: Math.max(0, cash(cents(card.creditLimit || 0) - cents(used))), future: cash(bills.filter(b => b.key > cycle).reduce((sum, b) => sum + cents(b.outstanding), 0)), overdue: cash(bills.filter(b => b.status === "Vencida").reduce((sum, b) => sum + cents(b.outstanding), 0)) }
}
export function normalizeBalances(ledger: LocalLedger): LocalLedger {
  return { ...ledger, accounts: ledger.accounts.map(a => a.type === "Cartão de crédito" ? { ...a, balance: commitment(ledger, a, localDate().slice(0, 7)).used } : a) }
}
// Import the old balance once, as a visible, cycle-bound adjustment. Never carry it into every month.
export function migrateLedger(accounts: Account[], items: Transaction[], payments: InvoicePayment[], today = localDate()): LocalLedger {
  const linked = items.map(i => { const payment = payments.find(p => p.transactionId === i.id || p.reversalTransactionId === i.id); return payment ? { ...i, invoicePaymentId: payment.id, kind: "transfer" as const } : i })
  const ledger: LocalLedger = { version: 2, accounts, items: linked, payments, adjustments: [] }
  for (const card of accounts.filter(a => a.type === "Cartão de crédito")) {
    const cycle = payments.find(p => p.cardId === card.id)?.cycle || today.slice(0, 7)
    const bill = invoice(ledger, card, cycle, today)
    const difference = Math.max(0, cents(card.balance) + cents(bill.paid) - cents(bill.gross))
    if (difference) ledger.adjustments.push({ id: `opening-${card.id}`, cardId: card.id, cycle, amount: cash(difference), reason: "Saldo importado da versão anterior. Confira com a fatura do banco.", status: "active", createdAt: `${today}T12:00:00.000Z` })
  }
  return normalizeBalances(ledger)
}
export type PaymentInput = { cardId: number; cycle: string; sourceAccountId: number; amount: number; date: string; mode: "full" | "partial"; idempotencyKey: string }
export function recordPayment(ledger: LocalLedger, input: PaymentInput, now = new Date().toISOString()): LocalLedger {
  if (ledger.payments.some(p => p.idempotencyKey === input.idempotencyKey)) throw new Error("Este registro já foi processado.")
  const card = ledger.accounts.find(a => a.id === input.cardId && a.type === "Cartão de crédito"), source = ledger.accounts.find(a => a.id === input.sourceAccountId && a.type !== "Cartão de crédito")
  if (!card || !source) throw new Error("Escolha um cartão e uma conta de origem válidos.")
  if (!configured(card)) throw new Error("Defina fechamento e vencimento antes de registrar o pagamento.")
  if (!validDate(input.date) || input.date > localDate()) throw new Error("Informe a data real do pagamento, até hoje.")
  const bill = invoice(ledger, card, input.cycle), amount = cents(input.amount)
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > cents(bill.outstanding)) throw new Error("O valor deve ser maior que zero e não ultrapassar o saldo da fatura.")
  if (input.mode === "full" && amount !== cents(bill.outstanding)) throw new Error("A fatura mudou. Revise o valor antes de confirmar.")
  if (amount > cents(source.balance)) throw new Error("Saldo insuficiente na conta de origem.")
  const id = Math.max(Date.now(), ...ledger.items.map(i => i.id + 2), ...ledger.payments.map(p => p.id + 2))
  const payment: InvoicePayment = { ...input, amount: cash(amount), id, transactionId: id + 1, cardName: card.name, sourceAccountName: source.name, status: "active", createdAt: now }
  return normalizeBalances({ ...ledger,
    accounts: ledger.accounts.map(a => a.id === source.id ? { ...a, balance: cash(cents(a.balance) - amount) } : a),
    payments: [payment, ...ledger.payments],
    items: [{ id: id + 1, invoicePaymentId: id, description: `Pagamento da fatura ${card.name} • ${input.cycle}`, category: "Outros", date: input.date, amount: cash(amount), type: "expense", account: source.name, status: "paid", kind: "transfer" }, ...ledger.items],
  })
}
export function reversePayment(ledger: LocalLedger, id: number, today = localDate()): LocalLedger {
  const payment = ledger.payments.find(p => p.id === id)
  if (!payment || payment.status !== "active") throw new Error("Este pagamento já foi estornado ou não existe.")
  const source = ledger.accounts.find(a => a.id === payment.sourceAccountId)
  if (!source) throw new Error("A conta de origem não foi encontrada. Restaure a conta antes de estornar.")
  const txId = Math.max(Date.now(), ...ledger.items.map(i => i.id + 2))
  return normalizeBalances({ ...ledger,
    accounts: ledger.accounts.map(a => a.id === source.id ? { ...a, balance: cash(cents(a.balance) + cents(payment.amount)) } : a),
    payments: ledger.payments.map(p => p.id === id ? { ...p, status: "reversed", reversedAt: new Date().toISOString(), reversalTransactionId: txId } : p),
    items: [{ id: txId, invoicePaymentId: id, description: `Estorno do pagamento ${payment.cardName}`, category: "Outros", date: today, amount: payment.amount, type: "income", account: source.name, status: "paid", kind: "transfer" }, ...ledger.items],
  })
}
export function reconcileInvoice(ledger: LocalLedger, cardId: number, cycle: string, bankTotal: number, reason: string): LocalLedger {
  const card = ledger.accounts.find(a => a.id === cardId)
  if (!card || !configured(card)) throw new Error("Configure as datas do cartão primeiro.")
  const bill = invoice(ledger, card, cycle), target = cents(bankTotal)
  if (!Number.isSafeInteger(target) || target < 0 || target < cents(bill.paid)) throw new Error("O total não pode ser negativo ou menor que o valor já pago. Revise os pagamentos primeiro.")
  if (reason.trim().length < 5) throw new Error("Explique o motivo do ajuste com pelo menos 5 caracteres.")
  const amount = target - cents(bill.gross)
  if (!amount) throw new Error("Os valores já estão conciliados.")
  return normalizeBalances({ ...ledger, adjustments: [{ id: newRecordKey(), cardId, cycle, amount: cash(amount), reason: reason.trim(), createdAt: new Date().toISOString(), status: "active" }, ...ledger.adjustments] })
}
