// Matemática da Calculadora financeira: funções puras, sem React. Nada é arredondado
// no meio das contas; quem exibe formata em centavos.

export type RateUnit = "month" | "year"
export type PeriodUnit = "months" | "years"
export type GrowthPoint = { month: number; invested: number; balance: number }

export const maxPeriodMonths = 1200

/** Aceita "1.234,56", "R$ 2.400", "0,9" e "0.9"; o que não for número (ou for negativo) vira NaN. */
export function parseDecimal(text: string): number {
  const raw = text.trim().replace(/R\$\s*/g, "").replace(/\s/g, "")
  if (!raw) return NaN
  // Com vírgula o ponto é milhar ("1.234,56"); sem vírgula só é milhar em grupos de três ("2.400"), então "0.9" segue sendo 0,9.
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

/** Taxa em % (ao mês ou ao ano) válida para os cálculos: sem negativos e sem valores que estourariam a conta. */
export const isValidRate = (percent: number, unit: RateUnit) => Number.isFinite(percent) && percent >= 0 && percent <= (unit === "year" ? 1000 : 100)

/** Taxa mensal equivalente, como fração (0,01 = 1%). Taxa anual vira mensal por juros compostos, não por divisão por 12. */
export const monthlyRate = (percent: number, unit: RateUnit) => unit === "year" ? (1 + percent / 100) ** (1 / 12) - 1 : percent / 100

export const annualRate = (monthly: number) => (1 + monthly) ** 12 - 1

export const periodMonths = (value: number, unit: PeriodUnit) => Math.round(unit === "years" ? value * 12 : value)

/** Saldo mês a mês: o saldo rende e o aporte entra no fim de cada mês. */
export function compoundGrowth(initial: number, monthly: number, rate: number, months: number) {
  const series: GrowthPoint[] = [{ month: 0, invested: initial, balance: initial }]
  let balance = initial
  for (let month = 1; month <= months; month++) {
    balance = balance * (1 + rate) + monthly
    series.push({ month, invested: initial + monthly * month, balance })
  }
  const invested = initial + monthly * months
  return { final: balance, invested, interest: balance - invested, series }
}

/** Aporte mensal (no fim de cada mês) para o valor inicial mais os aportes chegarem a `target`. Zero se o inicial já chega lá sozinho. */
export function requiredContribution(target: number, initial: number, rate: number, months: number) {
  const gap = target - initial * (1 + rate) ** months
  if (gap <= 0) return 0
  return rate === 0 ? gap / months : gap * rate / ((1 + rate) ** months - 1)
}

/** Parcela fixa (Tabela Price) de `principal` em `count` parcelas mensais com juros `rate`. */
export const installmentPayment = (principal: number, rate: number, count: number) => rate === 0 ? principal / count : principal * rate / (1 - (1 + rate) ** -count)

/** Juros mensais embutidos em pagar `count` parcelas de `payment` por algo que custa `cashPrice` à vista. Zero se o parcelado não custa mais. */
export function impliedMonthlyRate(cashPrice: number, payment: number, count: number) {
  if (payment * count <= cashPrice) return 0
  // O valor presente das parcelas cai conforme a taxa sobe: bisseção até ele igualar o preço à vista.
  let low = 0, high = 10
  for (let step = 0; step < 100; step++) {
    const mid = (low + high) / 2
    if (payment * (1 - (1 + mid) ** -count) / mid > cashPrice) low = mid
    else high = mid
  }
  return (low + high) / 2
}
