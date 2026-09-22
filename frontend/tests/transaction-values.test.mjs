import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import ts from "typescript"
const source = await readFile(new URL("../lib/transaction-values.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { addCalendarMonths, installmentAmounts, csvCell, parseCsv, parseCsvAmount } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
test("installments preserve every cent and month-end dates", () => {
  assert.deepEqual(installmentAmounts(100, 3), [33.34, 33.33, 33.33])
  assert.equal(installmentAmounts(89.99, 12).reduce((sum, n) => sum + Math.round(n * 100), 0), 8999)
  for (const count of [0, 1.5, 121, NaN]) assert.throws(() => installmentAmounts(100, count))
  assert.throws(() => installmentAmounts(0.01, 2))
  assert.equal(addCalendarMonths("2026-01-31", 1), "2026-02-28")
  assert.equal(addCalendarMonths("2028-01-31", 1), "2028-02-29")
  assert.equal(addCalendarMonths("2026-12-31", 1), "2027-01-31")
})
test("CSV roundtrip preserves commas, quotes, lines and decimals", () => {
  const row = ['Compra; com "aspas"\ne linha', "Alimentação", "2026-09-17", "expense", "Conta, teste", "paid", "149.90"]
  const text = "\uFEFFDescrição;Categoria;Data;Tipo;Conta;Status;Valor\r\n" + row.map(csvCell).join(";")
  assert.deepEqual(parseCsv(text)[1], row)
  assert.equal(parseCsvAmount(parseCsv(text)[1][6]), 149.9)
  assert.equal(parseCsvAmount("R$ 1.234,56"), 1234.56)
  assert.equal(parseCsvAmount("149.90"), 149.9)
  assert.ok(Number.isNaN(parseCsvAmount("")))
  assert.match(csvCell("=SUM(A1)"), /'=SUM/)
  assert.throws(() => parseCsv('A;B\n"incompleto;1'), /incompleto/)
})
