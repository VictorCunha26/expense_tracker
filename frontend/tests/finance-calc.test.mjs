import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import ts from "typescript"
const source = await readFile(new URL("../lib/finance-calc.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { parseDecimal, isValidRate, monthlyRate, annualRate, periodMonths, compoundGrowth, requiredContribution, installmentPayment, impliedMonthlyRate } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
const near = (actual, expected, tolerance = 0.005) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} não está a ${tolerance} de ${expected}`)

test("parseDecimal lê o formato brasileiro sem confundir milhar com decimal", () => {
  assert.equal(parseDecimal("1.234,56"), 1234.56)
  assert.equal(parseDecimal("R$ 2.400"), 2400)
  assert.equal(parseDecimal("0,9"), 0.9)
  assert.equal(parseDecimal("0.9"), 0.9)
  assert.equal(parseDecimal("215"), 215)
  for (const invalid of ["", "abc", "-5", "1,2,3", "12a"]) assert.ok(Number.isNaN(parseDecimal(invalid)), invalid)
})

test("taxa anual vira mensal por juros compostos e volta", () => {
  near(monthlyRate(12, "year"), 0.009489, 1e-6)
  assert.equal(monthlyRate(1.5, "month"), 0.015)
  near(annualRate(monthlyRate(12, "year")), 0.12, 1e-12)
  assert.equal(periodMonths(2, "years"), 24)
  assert.equal(periodMonths(18, "months"), 18)
  assert.ok(isValidRate(0, "month") && isValidRate(12, "year"))
  for (const [percent, unit] of [[-1, "month"], [NaN, "month"], [101, "month"], [1001, "year"]]) assert.equal(isValidRate(percent, unit), false)
})

test("juros compostos: só o valor inicial e com aportes", () => {
  near(compoundGrowth(1000, 0, 0.01, 12).final, 1126.83)
  const withContributions = compoundGrowth(1000, 100, 0.01, 12)
  near(withContributions.final, 2395.08)
  assert.equal(withContributions.invested, 2200)
  near(withContributions.interest, 195.08)
  assert.equal(withContributions.series.length, 13)
  assert.deepEqual(withContributions.series[0], { month: 0, invested: 1000, balance: 1000 })
  assert.equal(compoundGrowth(500, 100, 0, 10).final, 1500)
})

test("aporte necessário é o inverso do crescimento", () => {
  const target = compoundGrowth(1000, 250, 0.008, 36).final
  near(requiredContribution(target, 1000, 0.008, 36), 250, 1e-6)
  near(requiredContribution(12000, 0, 0, 24), 500, 1e-9)
  assert.equal(requiredContribution(1000, 5000, 0.01, 12), 0)
})

test("parcela pela Tabela Price e juros embutidos no parcelado", () => {
  near(installmentPayment(10000, 0.02, 12), 945.6)
  near(installmentPayment(1200, 0, 12), 100, 1e-9)
  near(impliedMonthlyRate(10000, installmentPayment(10000, 0.02, 12), 12), 0.02, 1e-9)
  assert.equal(impliedMonthlyRate(1200, 100, 12), 0)
  assert.equal(impliedMonthlyRate(1300, 100, 12), 0)
  near(impliedMonthlyRate(100, 110, 1), 0.1, 1e-9)
})
