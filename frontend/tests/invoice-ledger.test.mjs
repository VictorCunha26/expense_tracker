import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import ts from "typescript"
const source = await readFile(new URL("../lib/invoice-ledger.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { purchaseCycle, cycleDates, cycleDueIn, migrateLedger, invoice, commitment, recordPayment, reversePayment, reconcileInvoice, isAnalytical, normalizeBalances } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
const card = { id: 1, name: "Cartão teste", type: "Cartão de crédito", balance: 0, creditLimit: 2000, closingDay: 10, dueDay: 20, color: "#22c55e", detail: "Teste" }
const bank = { id: 2, name: "Conta teste", type: "Conta corrente", balance: 1000, color: "#22c55e", detail: "Teste" }
const purchase = (id, amount, date) => ({ id, amount, date, account: card.name, category: "Outros", description: "Compra teste", type: "expense", status: "paid" })
const fixture = () => migrateLedger([card, bank], [purchase(10, 300, "2026-09-05"), purchase(11, 200, "2026-09-11")], [], "2026-09-17")
const input = (amount, key = "one") => ({ cardId: 1, cycle: "2026-09", sourceAccountId: 2, amount, mode: "partial", date: "2026-09-16", idempotencyKey: key })
test("closing boundary, year rollover, short February and closing-month convention", () => {
  assert.equal(purchaseCycle(card, "2026-09-10"), "2026-09")
  assert.equal(purchaseCycle(card, "2026-09-11"), "2026-10")
  assert.equal(purchaseCycle({ ...card, closingDay: 25, dueDay: 5 }, "2026-12-26"), "2027-01")
  assert.deepEqual(cycleDates({ ...card, closingDay: 31, dueDay: 5 }, "2026-03"), { closing: "2026-03-31", due: "2026-04-05" })
  assert.deepEqual(cycleDates({ ...card, closingDay: 31, dueDay: 5 }, "2026-02"), { closing: "2026-02-28", due: "2026-03-05" })
})
test("due date in the same month or in the month after closing", () => {
  assert.deepEqual(cycleDates(card, "2026-09"), { closing: "2026-09-10", due: "2026-09-20" })
  const nubank = { ...card, closingDay: 28, dueDay: 5 }
  assert.deepEqual(cycleDates(nubank, "2026-09"), { closing: "2026-09-28", due: "2026-10-05" })
  assert.equal(cycleDueIn(nubank, "2026-10"), "2026-09")
  assert.equal(cycleDueIn(card, "2026-09"), "2026-09")
  assert.equal(cycleDueIn({ ...card, closingDay: undefined }, "2026-09"), "2026-09")
})
test("an invoice only closes after the closing day, so it is not overdue before its real due date", () => {
  const nubank = { ...card, closingDay: 28, dueDay: 5 }, ledger = migrateLedger([nubank, bank], [purchase(20, 100, "2026-09-03"), purchase(21, 50, "2026-09-10")], [], "2026-09-21")
  assert.equal(invoice(ledger, nubank, "2026-09", "2026-09-21").status, "Aberta")
  assert.equal(invoice(ledger, nubank, "2026-09", "2026-09-28").status, "Aberta")
  assert.equal(invoice(ledger, nubank, "2026-09", "2026-09-29").status, "Fechada")
  assert.equal(invoice(ledger, nubank, "2026-09", "2026-10-05").status, "Fechada")
  assert.equal(invoice(ledger, nubank, "2026-09", "2026-10-06").status, "Vencida")
  assert.equal(commitment(ledger, nubank, "2026-09").overdue, 0)
})
test("a paid invoice reopens for purchases inside the closing window and only later ones go to the next invoice", () => {
  const paid = recordPayment(fixture(), { ...input(300, "full"), mode: "full" })
  assert.equal(invoice(paid, card, "2026-09", "2026-09-16").status, "Paga")
  const withInside = { ...paid, items: [purchase(30, 40, "2026-09-10"), ...paid.items] }
  assert.equal(purchaseCycle(card, "2026-09-10"), "2026-09")
  assert.equal(invoice(withInside, card, "2026-09", "2026-09-16").outstanding, 40)
  assert.equal(invoice(withInside, card, "2026-09", "2026-09-16").status, "Parcialmente paga")
  const withLate = { ...paid, items: [purchase(31, 40, "2026-09-11"), ...paid.items] }
  assert.equal(invoice(withLate, card, "2026-09", "2026-09-16").outstanding, 0)
  assert.equal(invoice(withLate, card, "2026-10", "2026-09-16").gross, 240)
})
const refund = (id, amount, date) => ({ id, amount, date, account: card.name, category: "Receita", description: "Estorno teste", type: "income", status: "paid", kind: "refund", cardId: card.id })
test("a refund on the card lowers its invoice and gives the value back to the limit", () => {
  const items = [purchase(10, 300, "2026-09-05"), purchase(11, 200, "2026-09-11")]
  const without = migrateLedger([card, bank], items, [], "2026-09-17"), withRefund = migrateLedger([card, bank], [...items, refund(12, 100, "2026-09-08")], [], "2026-09-17")
  assert.equal(invoice(without, card, "2026-09").outstanding, 300)
  assert.equal(invoice(withRefund, card, "2026-09").outstanding, 200)
  assert.equal(commitment(without, card, "2026-09").used, 500)
  assert.equal(commitment(withRefund, card, "2026-09").used, 400)
  assert.equal(normalizeBalances(withRefund).accounts.find(a => a.id === 1).balance, 400)
  // a refund dated after the closing day goes to the next invoice, like a purchase would
  const late = migrateLedger([card, bank], [...items, refund(13, 50, "2026-09-12")], [], "2026-09-17")
  assert.equal(invoice(late, card, "2026-09").outstanding, 300)
  assert.equal(invoice(late, card, "2026-10").outstanding, 150)
})
test("a refund that lands in an invoice with no purchases still gives its value back to the limit", () => {
  // closing day 10: a refund dated 09-12 belongs to the October invoice, which has no purchases
  const ledger = migrateLedger([card, bank], [purchase(10, 300, "2026-09-05"), refund(12, 50, "2026-09-12")], [], "2026-09-17")
  assert.equal(invoice(ledger, card, "2026-09").outstanding, 300)
  assert.equal(invoice(ledger, card, "2026-10").gross, -50)
  assert.equal(invoice(ledger, card, "2026-10").outstanding, 0)
  assert.equal(commitment(ledger, card, "2026-09").used, 250)
  assert.equal(commitment(ledger, card, "2026-09").available, 1750)
  // a credit bigger than everything owed never makes the used limit negative
  const big = migrateLedger([card, bank], [purchase(10, 300, "2026-09-05"), refund(12, 500, "2026-09-12")], [], "2026-09-17")
  assert.equal(commitment(big, card, "2026-09").used, 0)
  assert.equal(commitment(big, card, "2026-09").available, 2000)
})
test("total future commitment is independent of the selected invoice", () => {
  const ledger = fixture()
  assert.equal(invoice(ledger, card, "2026-09").gross, 300)
  assert.equal(invoice(ledger, card, "2026-10").gross, 200)
  assert.equal(commitment(ledger, card, "2026-09").used, 500)
  assert.equal(commitment(ledger, card, "2026-09").future, 200)
  assert.equal(commitment(ledger, card, "2026-10").used, 500)
})
test("partial, full, duplicate, reload and reversal preserve the ledger", () => {
  const initial = fixture(), partial = recordPayment(initial, input(100))
  assert.equal(invoice(partial, card, "2026-09").outstanding, 200)
  assert.equal(invoice(partial, card, "2026-09", "2026-09-17").status, "Parcialmente paga")
  assert.equal(partial.accounts.find(a => a.id === 2).balance, 900)
  assert.throws(() => recordPayment(partial, input(100)), /já foi processado/)
  const paid = recordPayment(partial, { ...input(200, "two"), mode: "full" })
  const restored = normalizeBalances(JSON.parse(JSON.stringify(paid)))
  assert.equal(invoice(restored, card, "2026-09").status, "Paga")
  assert.equal(commitment(restored, card, "2026-09").used, 200)
  assert.equal(restored.items.filter(isAnalytical).reduce((s, i) => s + i.amount, 0), 500)
  const reversed = reversePayment(restored, restored.payments[0].id)
  assert.equal(invoice(reversed, card, "2026-09").outstanding, 200)
  assert.equal(reversed.accounts.find(a => a.id === 2).balance, 900)
  assert.throws(() => reversePayment(reversed, restored.payments[0].id), /já foi estornado/)
  assert.equal(invoice(reversed, card, "2026-10").outstanding, 200)
})
test("invalid date, insufficient balance, zero and overpayment are rejected", () => {
  for (const amount of [0, -1, 301, Infinity, NaN]) assert.throws(() => recordPayment(fixture(), input(amount)))
  assert.throws(() => recordPayment(fixture(), { ...input(100), date: "2026-02-30" }))
  assert.throws(() => recordPayment(fixture(), { ...input(100), date: "2099-01-01" }))
  const low = { ...fixture(), accounts: [card, { ...bank, balance: 10 }] }
  assert.throws(() => recordPayment(low, input(100)), /Saldo insuficiente/)
})
test("reconciliation retains reasons and does not affect other cycles", () => {
  const adjusted = reconcileInvoice(fixture(), 1, "2026-09", 320, "Tarifa do banco")
  assert.equal(invoice(adjusted, card, "2026-09").gross, 320)
  assert.equal(invoice(adjusted, card, "2026-10").gross, 200)
  assert.equal(adjusted.adjustments[0].reason, "Tarifa do banco")
  const second = reconcileInvoice(adjusted, 1, "2026-09", 300, "Correção da tarifa")
  assert.equal(second.adjustments.length, 2)
  assert.equal(invoice(second, card, "2026-09").gross, 300)
})
test("opening balance is imported only once and status follows actual dates", () => {
  const migrated = migrateLedger([{ ...card, balance: 540 }, bank], [], [], "2026-09-17")
  assert.equal(invoice(migrated, card, "2026-09").gross, 540)
  assert.equal(invoice(migrated, card, "2026-10").gross, 0)
  assert.equal(invoice(migrated, card, "2026-09", "2026-09-09").status, "Aberta")
  assert.equal(invoice(migrated, card, "2026-09", "2026-09-17").status, "Fechada")
  assert.equal(invoice(migrated, card, "2026-09", "2026-09-21").status, "Vencida")
})
