"use client"

import { useEffect, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts"
import { Bot, CalendarDays, Calculator, Check, CircleDollarSign, Clock3, CreditCard, Landmark, LayoutDashboard, Plus, ReceiptText, RefreshCcw, Settings, Sparkles, Target, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Account, GoalData, LocalLedger, RecurringData, Transaction, ViewKey } from "@/lib/models"
import { cycleDueIn, invoice } from "@/lib/invoice-ledger"
import { synchApi } from "@/lib/synch-api"

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const today = new Date()
const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
export type PlanKey = "gratis" | "synch_ia"

type CalendarEvent = { id: string; day: number; label: string; value: number; tone: "expense" | "income" | "card"; projected?: boolean }

// `day` vem do servidor; sem ele, o dia é o número no começo de `next` ("05 set").
const recurringDay = (rule: RecurringData) => rule.day ?? (Number.parseInt(rule.next) || 1)
const nameKey = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()

export function CalendarView({ items, accounts, ledger, recurring, hidden }: { items: Transaction[]; accounts: Account[]; ledger: LocalLedger; recurring: RecurringData[]; hidden: boolean }) {
  const [selected, setSelected] = useState(isoToday)
  const [year, month] = selected.split("-").map(Number), firstDay = new Date(year, month - 1, 1).getDay(), days = new Date(year, month, 0).getDate()
  const key = selected.slice(0, 7), rows = items.filter((item) => item.date.startsWith(key)), selectedRows = rows.filter((item) => item.date === selected)
  const cardBills: CalendarEvent[] = accounts.filter((account) => account.type === "Cartão de crédito" && account.dueDay).map((account) => { const bill = invoice(ledger, account, cycleDueIn(account, key)); return { id: `card-${account.id}`, day: Number(bill.dates?.due.slice(8) || account.dueDay), label: `Fatura ${account.name} • ${bill.status}`, value: bill.outstanding, tone: "card" as const } }).filter(bill => bill.value > 0)
  // Recorrência ativa vira previsão no dia dela. Só de hoje em diante (o que já passou está nas transações)
  // e só se o mês ainda não tem o lançamento dessa regra, para não contar a mesma cobrança duas vezes.
  const projected: CalendarEvent[] = recurring.filter((rule) => rule.active).flatMap((rule) => {
    const day = Math.min(recurringDay(rule), days), date = `${key}-${String(day).padStart(2, "0")}`
    const launched = rows.some((item) => item.recurring && item.type === rule.type && nameKey(item.description) === nameKey(rule.name))
    return date >= isoToday && !launched ? [{ id: `recurring-${rule.id}`, day, label: rule.name, value: rule.amount, tone: rule.type, projected: true }] : []
  })
  const events: CalendarEvent[] = [...rows.map((item) => ({ id: `tx-${item.id}`, day: Number(item.date.slice(8)), label: item.description, value: item.amount, tone: item.type })), ...cardBills, ...projected]
  const selectedProjected = projected.filter((event) => event.day === Number(selected.slice(8)))
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1))
  const moveMonth = (offset: number) => { const date = new Date(year, month - 1 + offset, 1); setSelected(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`) }
  const agendaSummary = `${selectedRows.length} movimentação${selectedRows.length === 1 ? "" : "ões"}${selectedProjected.length ? ` • ${selectedProjected.length} recorrente${selectedProjected.length === 1 ? "" : "s"} prevista${selectedProjected.length === 1 ? "" : "s"}` : ""}`
  return <div className="view-stack">
    <section className="surface finance-calendar">
      <div className="panel-title-row"><div><h2>Calendário financeiro</h2><p>Vencimentos, receitas, compras, faturas e recorrências no mesmo lugar</p></div><div className="calendar-nav"><button onClick={() => moveMonth(-1)} aria-label="Mês anterior">‹</button><strong>{monthName}</strong><button onClick={() => moveMonth(1)} aria-label="Próximo mês">›</button></div></div>
      <div className="calendar-legend"><span><i className="expense" /> Despesa</span><span><i className="income" /> Receita</span><span><i className="card" /> Fatura</span><span><i className="expense projected" /> Recorrente prevista</span></div>
      <div className="calendar-weekdays">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{Array.from({ length: firstDay }).map((_, index) => <i key={`empty-${index}`} />)}{Array.from({ length: days }, (_, index) => index + 1).map((day) => {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, dayEvents = events.filter((event) => event.day === day)
        return <button key={day} className={`${selected === date ? "selected" : ""} ${date === isoToday ? "today" : ""}`} onClick={() => setSelected(date)}><span>{day}</span><div>{dayEvents.slice(0, 3).map((event) => <i key={event.id} className={`${event.tone} ${event.projected ? "projected" : ""}`} title={event.projected ? `${event.label} • recorrente prevista` : event.label} />)}</div>{dayEvents.length > 3 && <small>+{dayEvents.length - 3}</small>}</button>
      })}</div>
    </section>
    <section className="calendar-side-grid">
      <article className="surface calendar-agenda">
        <div className="card-heading"><div><h2>Agenda de {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" }).format(new Date(`${selected}T12:00:00`))}</h2><p>{agendaSummary}</p></div></div>
        {selectedRows.map((item) => <div key={item.id}><span className={item.type}><ReceiptText /></span><div><strong>{item.description}</strong><small>{item.account} • {item.cardId ? "Na fatura" : item.status === "paid" ? "Pago" : "Pendente"}</small></div><strong>{hidden ? "R$ ••••" : money.format(item.amount)}</strong></div>)}
        {selectedProjected.map((event) => <div key={event.id}><span className={event.tone}><RefreshCcw /></span><div><strong>{event.label}</strong><small>Recorrente • Previsto</small></div><strong>{hidden ? "R$ ••••" : money.format(event.value)}</strong></div>)}
        {!selectedRows.length && !selectedProjected.length && <div className="calendar-empty"><CalendarDays /><p>Nenhuma movimentação neste dia.</p></div>}
      </article>
      <article className="surface calendar-recurring"><div className="card-heading"><div><h2>Próximas cobranças</h2><p>Despesas fixas e assinaturas</p></div></div>{recurring.filter((item) => item.active && item.type !== "income").slice(0, 5).map((item) => <div key={item.id}><Clock3 /><span><strong>{item.name}</strong><small>{item.next}</small></span><strong>{hidden ? "••••" : money.format(item.amount)}</strong></div>)}</article>
    </section>
  </div>
}

export function PlanningView({ items, accounts, goals, recurring, hidden }: { items: Transaction[]; accounts: Account[]; goals: GoalData[]; recurring: RecurringData[]; hidden: boolean }) {
  const assets = accounts.filter((account) => account.type !== "Cartão de crédito").reduce((sum, account) => sum + account.balance, 0) + goals.reduce((sum, goal) => sum + goal.saved, 0)
  const debts = accounts.filter((account) => account.type === "Cartão de crédito").reduce((sum, account) => sum + account.balance, 0), netWorth = assets - debts
  const currentKey = isoToday.slice(0, 7), current = items.filter((item) => item.date.startsWith(currentKey) && item.status === "paid" && item.kind !== "transfer"), income = current.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0), expenses = current.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0)
  const monthlyFixed = recurring.filter((item) => item.active && item.type !== "income").reduce((sum, item) => sum + item.amount, 0), balance = income - expenses, forecast = balance - monthlyFixed * .35
  const forecastData = Array.from({ length: 6 }, (_, index) => ({ label: `M${index + 1}`, value: Math.max(0, netWorth + forecast * index) }))
  const show = (value: number) => hidden ? "R$ ••••" : money.format(value)
  return <div className="view-stack"><section className="planning-kpis"><article className="surface"><span><Landmark /></span><div><small>Patrimônio líquido</small><strong>{show(netWorth)}</strong><p>{show(assets)} em ativos − {show(debts)} em dívidas</p></div></article><article className="surface"><span><TrendingUp /></span><div><small>Previsão no fim do mês</small><strong className={forecast >= 0 ? "positive" : "negative"}>{show(forecast)}</strong><p>Calculada pelo ritmo atual e despesas fixas</p></div></article><article className="surface"><span><Target /></span><div><small>Total guardado em metas</small><strong>{show(goals.reduce((sum, goal) => sum + goal.saved, 0))}</strong><p>{goals.length} objetivo{goals.length === 1 ? "" : "s"} em andamento</p></div></article></section><article className="surface net-worth-chart"><div className="card-heading"><div><h2>Evolução projetada</h2><p>Cenário para os próximos seis meses</p></div><span className="period-chip">Estimativa</span></div><div><ResponsiveContainer width="100%" height="100%"><AreaChart data={forecastData}><defs><linearGradient id="worthGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#35d168" stopOpacity={.28} /><stop offset="100%" stopColor="#35d168" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#1b211d" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#758078" }} /><YAxis hide={hidden} axisLine={false} tickLine={false} tick={{ fill: "#758078" }} /><ChartTooltip contentStyle={{ background: "#0b0d0f", border: "1px solid #282c31", borderRadius: 10 }} formatter={(value) => hidden ? "Oculto" : money.format(Number(value))} /><Area type="monotone" dataKey="value" stroke="#35d168" strokeWidth={2.5} fill="url(#worthGradient)" /></AreaChart></ResponsiveContainer></div></article></div>
}

export function SubscriptionView({ plan }: { plan: PlanKey }) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | undefined>()
  useEffect(() => { synchApi.getSubscription().then((data) => setCheckoutUrl(data.checkoutUrl)).catch(() => undefined) }, [])
  // O Synch IA é o único plano à venda: R$ 149,90 por ano, ou 12x de R$ 15,57 no parcelado. O Básico Vitalício só aparece como "plano atual" de quem ainda não assinou.
  const synchIa = { name: "Synch IA", description: "Controle com inteligência", price: "R$ 149,90", period: "/ano", installments: "R$ 15,57", features: ["Contas, cartões e parcelas ilimitados", "Relatórios completos e importação CSV", "Assistente por texto e voz"] }
  const current = plan === "synch_ia" ? synchIa : { name: "Básico Vitalício", description: "Controle essencial" }
  const subscribed = plan === "synch_ia"
  const upgrade = () => { if (checkoutUrl) window.open(checkoutUrl, "_blank", "noopener,noreferrer") }
  const confirmCancel = async () => {
    setCancelOpen(false)
    try { const result = await synchApi.cancelSubscription(); toast.info(result.message) }
    catch { toast.error("Não foi possível concluir. Tente novamente.") }
  }
  return <div className="view-stack"><section className="surface subscription-account-hero"><div><span>Plano atual</span><h2>{current.name}</h2><p>{current.description}</p></div><div><small>Próxima cobrança</small><strong>{subscribed ? "Renovação anual" : "Sem cobrança"}</strong><span>{subscribed ? `${synchIa.price}${synchIa.period}` : "R$ 0"}</span></div></section>{plan === "synch_ia" && <section className="surface usage-card"><div><span><Bot /></span><div><h3>Assistente Synch IA</h3><p>Texto e voz liberados neste plano, sem limite de mensagens.</p></div></div></section>}<section className="app-plan-grid single"><article className={`surface app-plan-card ${subscribed ? "current" : ""}`}><div><small>{subscribed ? "PLANO ATUAL" : "DISPONÍVEL"}</small><h3>{synchIa.name}</h3><p>{synchIa.description}</p><strong>{synchIa.price}<span>{synchIa.period}</span></strong><p className="app-plan-installments">ou 12x de <strong>{synchIa.installments}</strong></p></div><ul>{synchIa.features.map((feature) => <li key={feature}><Check />{feature}</li>)}</ul><Button className="primary-button" disabled={subscribed} onClick={upgrade}>{subscribed ? "Plano atual" : `Assinar ${synchIa.name}`}</Button></article></section><section className="account-billing-grid"><article className="surface billing-security"><CreditCard /><h3>Pagamento protegido pela Cakto</h3><p>Os dados do cartão não ficam armazenados no Synch Cash. O plano é liberado assim que a Cakto confirma o pagamento.</p>{subscribed && <Button variant="outline" onClick={() => setCancelOpen(true)}>Cancelar assinatura</Button>}</article></section><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="transaction-dialog"><AlertDialogHeader><AlertDialogTitle>Cancelar assinatura?</AlertDialogTitle><AlertDialogDescription>O cancelamento é feito diretamente com a Cakto, a plataforma de pagamento.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Manter plano</AlertDialogCancel><AlertDialogAction className="delete-button" onClick={confirmCancel}>Ver instruções</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
}

export function ImportReviewDialog({ open, setOpen, drafts, confirm }: { open: boolean; setOpen: (open: boolean) => void; drafts: Transaction[]; confirm: (selected: Transaction[]) => void }) {
  const [ignored, setIgnored] = useState<number[]>([])
  const selected = drafts.filter((item) => !ignored.includes(item.id))
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="transaction-dialog import-review-dialog sm:max-w-[820px]"><DialogHeader><DialogTitle>Revisar importação</DialogTitle><DialogDescription>Confira as movimentações reconhecidas antes de adicioná-las.</DialogDescription></DialogHeader><div className="import-summary"><span><strong>{drafts.length}</strong> reconhecidas</span><span><strong>{selected.length}</strong> selecionadas</span><span><strong>{drafts.length - selected.length}</strong> ignoradas</span></div><div className="import-review-list">{drafts.map((item) => <label key={item.id}><Checkbox checked={!ignored.includes(item.id)} onCheckedChange={(checked) => setIgnored((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><strong>{item.description}</strong><small>{item.date} • {item.account} • {item.category}</small></span><strong className={item.type}>{money.format(item.amount)}</strong></label>)}</div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button className="primary-button" disabled={!selected.length} onClick={() => { confirm(selected); setIgnored([]) }}><Check /> Importar {selected.length} movimentações</Button></DialogFooter></DialogContent></Dialog>
}

export function CommandPalette({ open, setOpen, navigate, newTransaction }: { open: boolean; setOpen: (open: boolean) => void; navigate: (view: ViewKey) => void; newTransaction: () => void }) {
  const go = (view: ViewKey) => { navigate(view); setOpen(false) }
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="command-dialog p-0 sm:max-w-[620px]" showCloseButton={false}><Command><CommandInput placeholder="Busque uma tela ou ação..." /><CommandList><CommandEmpty>Nenhum comando encontrado.</CommandEmpty><CommandGroup heading="Ações rápidas"><CommandItem onSelect={() => { newTransaction(); setOpen(false) }}><Plus />Nova transação<CommandShortcut>N</CommandShortcut></CommandItem><CommandItem onSelect={() => go("assistant")}><Sparkles />Conversar com a Synch IA<CommandShortcut>I</CommandShortcut></CommandItem><CommandItem onSelect={() => go("calendar")}><CalendarDays />Abrir calendário<CommandShortcut>C</CommandShortcut></CommandItem></CommandGroup><CommandGroup heading="Navegação"><CommandItem onSelect={() => go("overview")}><LayoutDashboard />Visão geral</CommandItem><CommandItem onSelect={() => go("transactions")}><ReceiptText />Transações</CommandItem><CommandItem onSelect={() => go("accounts")}><CreditCard />Contas e cartões</CommandItem><CommandItem onSelect={() => go("planning")}><TrendingUp />Planejamento</CommandItem><CommandItem onSelect={() => go("calculator")}><Calculator />Calculadora financeira</CommandItem><CommandItem onSelect={() => go("subscription")}><CircleDollarSign />Plano e assinatura</CommandItem><CommandItem onSelect={() => go("settings")}><Settings />Configurações</CommandItem></CommandGroup></CommandList></Command></DialogContent></Dialog>
}
