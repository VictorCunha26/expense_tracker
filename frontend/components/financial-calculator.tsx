"use client"

import { useState, type ReactNode } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts"
import { Landmark, PiggyBank, ReceiptText, TrendingUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { annualRate, compoundGrowth, impliedMonthlyRate, installmentPayment, isValidRate, maxPeriodMonths, monthlyRate, parseDecimal, periodMonths, requiredContribution, type GrowthPoint, type PeriodUnit, type RateUnit } from "@/lib/finance-calc"

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
const percent = (fraction: number) => `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fraction * 100)}%`
const maxParts = 480

type ToolKey = "compound" | "goal" | "financing" | "cash"
const tools: { key: ToolKey; label: string; hint: string; icon: typeof TrendingUp }[] = [
  { key: "compound", label: "Juros compostos", hint: "Quanto seu dinheiro rende com aportes mensais", icon: TrendingUp },
  { key: "goal", label: "Meta de economia", hint: "Quanto guardar por mês para chegar lá", icon: PiggyBank },
  { key: "financing", label: "Parcelas com juros", hint: "Valor da parcela e custo total do financiamento", icon: Landmark },
  { key: "cash", label: "À vista ou parcelado", hint: "Descubra os juros escondidos no parcelamento", icon: ReceiptText },
]

function MoneyField({ label, value, setValue, hint }: { label: string; value: string; setValue: (value: string) => void; hint?: string }) {
  return <label className="field"><span>{label}</span><Input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0,00" />{hint && <small className="calc-hint">{hint}</small>}</label>
}

function CountField({ label, value, setValue, max }: { label: string; value: string; setValue: (value: string) => void; max: number }) {
  return <label className="field"><span>{label}</span><Input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="12" /><small className="calc-hint">De 1 a {max}</small></label>
}

function RateField({ label, value, setValue, unit, setUnit }: { label: string; value: string; setValue: (value: string) => void; unit: RateUnit; setUnit: (unit: RateUnit) => void }) {
  const parsed = parseDecimal(value)
  return <div className="field" role="group" aria-label={label}><span>{label}</span><div className="calc-unit-row"><Input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0,00" aria-label={`${label}, valor`} /><Select value={unit} onValueChange={(next) => setUnit(next as RateUnit)}><SelectTrigger className="w-full" aria-label={`${label}, período`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="month">% ao mês</SelectItem><SelectItem value="year">% ao ano</SelectItem></SelectContent></Select></div>{unit === "year" && isValidRate(parsed, unit) && <small className="calc-hint">Equivale a {percent(monthlyRate(parsed, unit))} ao mês</small>}</div>
}

function PeriodField({ label, value, setValue, unit, setUnit }: { label: string; value: string; setValue: (value: string) => void; unit: PeriodUnit; setUnit: (unit: PeriodUnit) => void }) {
  return <div className="field" role="group" aria-label={label}><span>{label}</span><div className="calc-unit-row"><Input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="12" aria-label={`${label}, valor`} /><Select value={unit} onValueChange={(next) => setUnit(next as PeriodUnit)}><SelectTrigger className="w-full" aria-label={`${label}, unidade`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="months">meses</SelectItem><SelectItem value="years">anos</SelectItem></SelectContent></Select></div><small className="calc-hint">Até {maxPeriodMonths / 12} anos</small></div>
}

function ToolLayout({ title, description, fields, result }: { title: string; description: string; fields: ReactNode; result: ReactNode }) {
  return <div className="calc-grid"><section className="surface calc-form"><div className="card-heading"><div><h2>{title}</h2><p>{description}</p></div></div><div className="calc-fields">{fields}</div></section><section className="surface calc-result" aria-live="polite">{result}</section></div>
}

const Empty = ({ children }: { children: ReactNode }) => <div className="calc-empty"><p>{children}</p></div>
const Headline = ({ label, value, note }: { label: string; value: string; note?: string }) => <div className="calc-headline"><small>{label}</small><strong>{value}</strong>{note && <p>{note}</p>}</div>
const Stats = ({ items }: { items: [string, string][] }) => <div className="calc-stats">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>

function GrowthChart({ series, months }: { series: GrowthPoint[]; months: number }) {
  const inYears = months > 24, step = inYears ? 12 * Math.ceil(months / 12 / 8) : Math.max(1, Math.ceil(months / 8))
  const ticks = Array.from({ length: Math.floor(months / step) + 1 }, (_, index) => index * step)
  const monthLabel = (month: number) => inYears ? `${month / 12} ${month === 12 ? "ano" : "anos"}` : `${month} ${month === 1 ? "mês" : "meses"}`
  return <div className="calc-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ top: 10, right: 8, left: -6 }}><defs><linearGradient id="calcBalanceGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#35d168" stopOpacity={.28} /><stop offset="100%" stopColor="#35d168" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#1b211d" vertical={false} /><XAxis dataKey="month" ticks={ticks} tickFormatter={(month) => month === 0 ? "Início" : inYears ? `${month / 12}a` : `${month}m`} axisLine={false} tickLine={false} tick={{ fill: "#758078", fontSize: 11 }} /><YAxis width={84} tickFormatter={(value) => `R$ ${compact.format(value)}`} axisLine={false} tickLine={false} tick={{ fill: "#758078", fontSize: 11 }} /><ChartTooltip contentStyle={{ background: "#0b0d0f", border: "1px solid #282c31", borderRadius: 10 }} labelFormatter={(month) => monthLabel(Number(month))} formatter={(value) => money.format(Number(value))} /><Area type="monotone" dataKey="invested" name="Total investido" stroke="#64748b" strokeWidth={2} fill="none" /><Area type="monotone" dataKey="balance" name="Saldo com juros" stroke="#35d168" strokeWidth={2.5} fill="url(#calcBalanceGradient)" /></AreaChart></ResponsiveContainer></div>
}

function CompoundTool() {
  const [initial, setInitial] = useState("1000"), [monthly, setMonthly] = useState("300"), [rate, setRate] = useState("0,8"), [rateUnit, setRateUnit] = useState<RateUnit>("month"), [period, setPeriod] = useState("5"), [periodUnit, setPeriodUnit] = useState<PeriodUnit>("years")
  const start = parseDecimal(initial), contribution = parseDecimal(monthly), rateValue = parseDecimal(rate), months = periodMonths(parseDecimal(period), periodUnit)
  const valid = Number.isFinite(start) && Number.isFinite(contribution) && isValidRate(rateValue, rateUnit) && months >= 1 && months <= maxPeriodMonths
  const growth = valid ? compoundGrowth(start, contribution, monthlyRate(rateValue, rateUnit), months) : null
  return <ToolLayout title="Juros compostos" description="Veja o efeito dos juros sobre juros ao longo do tempo. Os aportes entram no fim de cada mês." fields={<><MoneyField label="Valor inicial" value={initial} setValue={setInitial} /><MoneyField label="Aporte mensal" value={monthly} setValue={setMonthly} /><RateField label="Taxa de juros" value={rate} setValue={setRate} unit={rateUnit} setUnit={setRateUnit} /><PeriodField label="Período" value={period} setValue={setPeriod} unit={periodUnit} setUnit={setPeriodUnit} /></>} result={growth ? <><Headline label="Valor acumulado" value={money.format(growth.final)} note={growth.invested ? `Seu dinheiro rendeu ${percent(growth.interest / growth.invested)} sobre o total investido.` : undefined} /><Stats items={[["Total investido", money.format(growth.invested)], ["Juros ganhos", money.format(growth.interest)]]} /><GrowthChart series={growth.series} months={months} /></> : <Empty>Preencha os campos com valores válidos para ver a projeção.</Empty>} />
}

function GoalTool() {
  const [target, setTarget] = useState("20000"), [initial, setInitial] = useState("0"), [rate, setRate] = useState("0,7"), [rateUnit, setRateUnit] = useState<RateUnit>("month"), [period, setPeriod] = useState("2"), [periodUnit, setPeriodUnit] = useState<PeriodUnit>("years")
  const goal = parseDecimal(target), start = parseDecimal(initial), rateValue = parseDecimal(rate), months = periodMonths(parseDecimal(period), periodUnit)
  const valid = goal > 0 && Number.isFinite(start) && isValidRate(rateValue, rateUnit) && months >= 1 && months <= maxPeriodMonths
  const perMonth = valid ? requiredContribution(goal, start, monthlyRate(rateValue, rateUnit), months) : 0
  const invested = start + perMonth * months
  return <ToolLayout title="Meta de economia" description="Descubra quanto guardar por mês para juntar o valor que você quer no prazo que escolheu." fields={<><MoneyField label="Valor da meta" value={target} setValue={setTarget} /><MoneyField label="Quanto você já tem" value={initial} setValue={setInitial} /><RateField label="Rentabilidade" value={rate} setValue={setRate} unit={rateUnit} setUnit={setRateUnit} /><PeriodField label="Prazo" value={period} setValue={setPeriod} unit={periodUnit} setUnit={setPeriodUnit} /></>} result={valid ? <><Headline label="Guarde por mês" value={money.format(perMonth)} note={perMonth === 0 ? "O que você já tem rende o suficiente para chegar à meta sem novos aportes." : `Durante ${months} ${months === 1 ? "mês" : "meses"}, sempre no fim do mês.`} /><Stats items={[["Total que você guarda", money.format(invested)], ["Juros que ajudam", money.format(Math.max(0, goal - invested))]]} /></> : <Empty>Preencha os campos com valores válidos. A meta precisa ser maior que zero.</Empty>} />
}

function FinancingTool() {
  const [price, setPrice] = useState("2400"), [down, setDown] = useState("0"), [rate, setRate] = useState("1,99"), [parts, setParts] = useState("12")
  const total = parseDecimal(price), downPayment = parseDecimal(down), rateValue = parseDecimal(rate), count = Math.round(parseDecimal(parts))
  const financed = total - downPayment
  const valid = total > 0 && downPayment >= 0 && financed > 0 && isValidRate(rateValue, "month") && count >= 1 && count <= maxParts
  const payment = valid ? installmentPayment(financed, monthlyRate(rateValue, "month"), count) : 0
  const interest = payment * count - financed
  return <ToolLayout title="Parcelas com juros" description="Calcule a parcela fixa (Tabela Price) e quanto os juros custam no final." fields={<><MoneyField label="Valor da compra" value={price} setValue={setPrice} /><MoneyField label="Entrada" value={down} setValue={setDown} hint="Opcional. Não entra nos juros." /><label className="field"><span>Juros ao mês (%)</span><Input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="0,00" /></label><CountField label="Número de parcelas" value={parts} setValue={setParts} max={maxParts} /></>} result={valid ? <><Headline label="Valor da parcela" value={money.format(payment)} note={`${count}x de ${money.format(payment)}`} /><Stats items={[["Valor financiado", money.format(financed)], ["Total pago", money.format(downPayment + payment * count)], ["Juros pagos", money.format(interest)], ["Juros sobre o financiado", percent(interest / financed)]]} /></> : <Empty>Preencha os campos com valores válidos. A entrada precisa ser menor que o valor da compra.</Empty>} />
}

function CashTool() {
  const [price, setPrice] = useState("2400"), [parts, setParts] = useState("12"), [payment, setPayment] = useState("215")
  const cash = parseDecimal(price), installment = parseDecimal(payment), count = Math.round(parseDecimal(parts))
  const valid = cash > 0 && installment > 0 && count >= 1 && count <= maxParts
  const rate = valid ? impliedMonthlyRate(cash, installment, count) : 0, paid = installment * count, extra = paid - cash
  return <ToolLayout title="À vista ou parcelado" description="Compare o preço à vista com o parcelado e veja quanto de juros está escondido nas parcelas." fields={<><MoneyField label="Preço à vista" value={price} setValue={setPrice} /><CountField label="Número de parcelas" value={parts} setValue={setParts} max={maxParts} /><MoneyField label="Valor de cada parcela" value={payment} setValue={setPayment} /></>} result={valid ? <><Headline label="Juros embutidos" value={rate > 0 ? `${percent(rate)} ao mês` : "Sem juros"} note={rate > 0 ? `Equivale a ${percent(annualRate(rate))} ao ano.` : "O parcelado não custa mais que o preço à vista."} /><Stats items={[["Total parcelado", money.format(paid)], [extra > 0 ? "Você paga a mais" : "Diferença para o à vista", money.format(Math.abs(extra))], ["Acréscimo sobre o à vista", percent(extra / cash)]]} /></> : <Empty>Preencha os campos com valores válidos para comparar.</Empty>} />
}

export function FinancialCalculator() {
  const [tool, setTool] = useState<ToolKey>("compound")
  const panels: Record<ToolKey, ReactNode> = { compound: <CompoundTool />, goal: <GoalTool />, financing: <FinancingTool />, cash: <CashTool /> }
  // Todas as ferramentas ficam montadas: trocar de aba não apaga o que foi digitado nas outras.
  return <div className="view-stack"><div className="calc-tabs" role="tablist" aria-label="Ferramentas da calculadora">{tools.map(({ key, label, hint, icon: Icon }) => <button key={key} id={`calc-tab-${key}`} role="tab" aria-selected={tool === key} aria-controls={`calc-panel-${key}`} className={tool === key ? "active" : ""} onClick={() => setTool(key)}><Icon /><span><strong>{label}</strong><small>{hint}</small></span></button>)}</div>{tools.map(({ key }) => <div key={key} id={`calc-panel-${key}`} role="tabpanel" aria-labelledby={`calc-tab-${key}`} hidden={tool !== key}>{panels[key]}</div>)}</div>
}
