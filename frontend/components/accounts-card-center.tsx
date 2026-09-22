"use client"

import { FormEvent, useRef, useState } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts"
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Clock3, CreditCard, Download, Edit3, History, Landmark, Plus, ReceiptText, RotateCcw, Search, ShieldCheck, Trash2, TrendingUp, WalletCards } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { csvCell } from "@/lib/transaction-values"
import type { Account, InvoiceAdjustment, InvoicePayment, LocalLedger, Transaction } from "@/lib/models"
import type { NewAccount } from "@/lib/synch-api"
import { cash, cents, commitment, configured, invoice, localDate, newRecordKey, reconcileInvoice as previewReconcile, shiftMonth, validDate } from "@/lib/invoice-ledger"

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const today = new Date()
const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
const showDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", "")
const monthLabel = (value: string) => { const [year, month] = value.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" }).format(new Date(year, month - 1, 1)).replace(".", "") }
const monthAt = (origin: string, offset: number) => { const [year, month] = origin.split("-").map(Number), date = new Date(year, month - 1 + offset, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` }
const accountKey = (value: string) => value.toLowerCase().replace(/banco|cart[aã]o|cr[eé]dito/g, "").replace(/\s+/g, "").trim()

type Props = {
  accounts: Account[]
  items: Transaction[]
  invoicePayments: InvoicePayment[]
  invoiceAdjustments: InvoiceAdjustment[]
  hidden: boolean
  month: string
  newTransaction: (card?: Account, refund?: boolean) => void
  createAccount: (account: NewAccount) => Promise<Account | null>
  saveAccount: (account: Account) => Promise<Account | null>
  registerInvoicePayment: (cardId: number, cycle: string, payload: { sourceAccountId: number; amount: number; date: string; mode: "full" | "partial"; idempotencyKey: string }) => Promise<InvoicePayment | null>
  reverseInvoicePayment: (paymentId: number) => Promise<unknown>
  reconcileInvoice: (cardId: number, cycle: string, payload: { total: number; reason: string }) => Promise<InvoiceAdjustment | null>
}

type AccountDraft = {
  name: string
  type: Account["type"]
  balance: string
  creditLimit: string
  closingDay: string
  dueDay: string
  lastFour: string
  color: string
}

// Cores de cartão mais comuns: roxo (Nubank), laranja (Inter, Itaú), vermelho (Santander, Bradesco), azul (Caixa, Mercado Pago),
// verde (PicPay, Sicredi), amarelo (Banco do Brasil, Will), rosa, grafite (cartões pretos) e prata (Platinum).
const cardColors = [
  { name: "Roxo", hex: "#8b5cf6" }, { name: "Laranja", hex: "#f97316" }, { name: "Vermelho", hex: "#ef4444" },
  { name: "Azul", hex: "#3b82f6" }, { name: "Verde", hex: "#22c55e" }, { name: "Amarelo", hex: "#eab308", light: true },
  { name: "Rosa", hex: "#ec4899" }, { name: "Grafite", hex: "#6b7280" }, { name: "Prata", hex: "#cbd5e1", light: true },
]

const blankDraft: AccountDraft = { name: "", type: "Conta corrente", balance: "", creditLimit: "", closingDay: "", dueDay: "", lastFour: "", color: cardColors[0].hex }

export function AccountsCardCenter({ accounts, items, invoicePayments, invoiceAdjustments, hidden, month, newTransaction, createAccount, saveAccount: saveAccountApi, registerInvoicePayment, reverseInvoicePayment, reconcileInvoice: reconcileInvoiceApi }: Props) {
  const payments = invoicePayments
  // Objeto no formato que as funcoes puras de lib/invoice-ledger.ts esperam --
  // usado so pra LER (fatura, limite comprometido, historico); toda escrita
  // vai pros callbacks acima, que chamam a API real.
  const ledger: LocalLedger = { version: 2, accounts, items, payments: invoicePayments, adjustments: invoiceAdjustments }
  const cards = accounts.filter((account) => account.type === "Cartão de crédito")
  const bankAccounts = accounts.filter((account) => account.type !== "Cartão de crédito")
  const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id || 0)
  const card = cards.find((item) => item.id === selectedCardId) || cards[0]
  const [query, setQuery] = useState("")
  const [payOpen, setPayOpen] = useState(false)
  const [paymentMode, setPaymentMode] = useState<"full" | "partial">("full")
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentAccount, setPaymentAccount] = useState(String(bankAccounts[0]?.id || ""))
  const [paymentDate, setPaymentDate] = useState(isoToday)
  const [paymentReview, setPaymentReview] = useState(false)
  const [reversing, setReversing] = useState<number | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<AccountDraft>(blankDraft)
  const [selectedCycle, setSelectedCycle] = useState<{ origin: string; value: string }>({ origin: month, value: month })
  const cycle = selectedCycle.origin === month ? selectedCycle.value : month
  const [historyFilter, setHistoryFilter] = useState("cycle")
  const [historyStatus, setHistoryStatus] = useState("all")
  const [reconcileOpen, setReconcileOpen] = useState(false)
  const [bankTotal, setBankTotal] = useState("")
  const [reason, setReason] = useState("")
  const [reconcileReview, setReconcileReview] = useState(false)
  const operation = useRef("")
  const bill = card ? invoice(ledger, card, cycle) : null
  const invoiceRows = [...(bill?.rows || [])].sort((a, b) => b.date.localeCompare(a.date))
  const cardPayments = payments.filter(p => p.cardId === card?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const paidTotal = bill?.paid || 0, grossInvoice = bill?.gross || 0, invoiceTotal = bill?.outstanding || 0, adjustment = bill?.adjustment || 0
  const committed = card ? commitment(ledger, card, cycle) : { used: 0, available: 0, future: 0, overdue: 0 }
  const projected = committed.used, available = committed.available
  const usedPercent = card?.creditLimit ? Math.min(100, projected / card.creditLimit * 100) : 0
  const invoiceFiltered = invoiceRows.filter((item) => `${item.description} ${item.merchant || ""} ${item.category}`.toLowerCase().includes(query.toLowerCase()))
  const history = Array.from({ length: 6 }, (_, index) => shiftMonth(cycle, index - 5)).map(key => ({ key, month: monthLabel(key), total: card ? invoice(ledger, card, key).gross : 0 }))
  const previous = history.at(-2)?.total || 0
  const variation = previous ? Math.round((grossInvoice - previous) / previous * 100) : null
  const source = bankAccounts.find((account) => String(account.id) === paymentAccount)
  const amountToPay = paymentMode === "full" ? invoiceTotal : cash(cents(Number(paymentAmount.replace(/\./g, "").replace(",", ".")))) || 0
  const canPay = Boolean(source && card && configured(card) && validDate(paymentDate) && paymentDate <= localDate() && Number.isFinite(amountToPay) && amountToPay > 0 && cents(amountToPay) <= cents(invoiceTotal) && cents(source.balance) >= cents(amountToPay))
  const historyPayments = cardPayments.filter(p => (historyFilter === "all" || p.cycle === cycle) && (historyStatus === "all" || p.status === historyStatus))
  const adjustments = ledger.adjustments.filter(a => a.cardId === card?.id && (historyFilter === "all" || a.cycle === cycle)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const targetTotal = Number(bankTotal.replace(/\./g, "").replace(",", "."))
  const reconcileDifference = cash(cents(targetTotal) - cents(grossInvoice))
  const show = (value: number) => hidden ? "R$ ••••" : money.format(value)
  // Crédito de estorno (fatura negativa) e pagamento a mais são coisas diferentes de "pago".
  const refundCredit = Math.max(0, -grossInvoice), overpaid = Math.max(0, paidTotal - Math.max(0, grossInvoice))
  // Um cartão com cor fora da paleta (cadastrado antes) mantém a cor dele como opção selecionada.
  const colorOptions: Array<{ name: string; hex: string; light?: boolean }> = cardColors.some((option) => option.hex === draft.color.toLowerCase()) ? cardColors : [{ name: "Cor atual", hex: draft.color.toLowerCase() }, ...cardColors]

  const openEditor = (account?: Account, type?: Account["type"]) => {
    setEditingId(account?.id || null)
    setDraft(account ? { name: account.name, type: account.type, balance: String(account.balance).replace(".", ","), creditLimit: String(account.creditLimit || "").replace(".", ","), closingDay: String(account.closingDay || ""), dueDay: String(account.dueDay || ""), lastFour: account.lastFour || "", color: account.color } : { ...blankDraft, type: type || "Conta corrente" })
    setEditorOpen(true)
  }

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault()
    const balance = Number(draft.balance.replace(/\./g, "").replace(",", ".")), limit = Number(draft.creditLimit.replace(/\./g, "").replace(",", "."))
    if (!draft.name.trim() || !Number.isFinite(balance) || balance < 0) return toast.error("Informe o nome e o valor atual.")
    if (draft.type === "Cartão de crédito" && (!Number.isFinite(limit) || limit <= 0)) return toast.error("Informe um limite válido para o cartão.")
    const previousAccount = accounts.find((account) => account.id === editingId)
    if (accounts.some(a => a.id !== editingId && a.name.trim().toLowerCase() === draft.name.trim().toLowerCase())) return toast.error("Use um nome diferente para cada conta ou cartão.")
    if (draft.type === "Cartão de crédito" && [draft.closingDay, draft.dueDay].some(v => !Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 31)) return toast.error("Informe fechamento e vencimento entre 1 e 31.")
    if (previousAccount && previousAccount.type !== draft.type) return toast.error("Crie outra conta para mudar o tipo. O histórico será preservado.")
    if (previousAccount && payments.some(p => p.cardId === editingId) && (previousAccount.closingDay !== Number(draft.closingDay) || previousAccount.dueDay !== Number(draft.dueDay))) return toast.error("Este cartão já tem pagamentos. Preserve as datas para não deslocar faturas registradas.")

    const common = {
      name: draft.name.trim(), type: draft.type,
      detail: previousAccount?.detail || "Atualizado agora",
      color: draft.type === "Cartão de crédito" ? draft.color : previousAccount?.color || "#22c55e",
      creditLimit: draft.type === "Cartão de crédito" ? limit : undefined,
      closingDay: draft.type === "Cartão de crédito" ? Number(draft.closingDay) : undefined,
      dueDay: draft.type === "Cartão de crédito" ? Number(draft.dueDay) : undefined,
      lastFour: draft.lastFour.replace(/\D/g, "").slice(-4) || undefined,
    }
    const saved = previousAccount
      ? await saveAccountApi({ ...previousAccount, ...common, balance: draft.type === "Cartão de crédito" ? previousAccount.balance : balance })
      : await createAccount({ ...common, balance: draft.type === "Cartão de crédito" ? undefined : balance })
    if (!saved) return
    if (saved.type === "Cartão de crédito") setSelectedCardId(saved.id)
    setEditorOpen(false)
    toast.success(editingId ? "Dados atualizados." : "Conta adicionada.")
  }

  const validatePayment = () => {
    if (!canPay) return toast.error("Revise o valor, a data, as datas do cartão e o saldo da conta.")
    setPaymentReview(true)
  }

  const registerPayment = async () => {
    if (!card || !source || !canPay || !operation.current) return
    const result = await registerInvoicePayment(card.id, cycle, { sourceAccountId: source.id, amount: amountToPay, date: paymentDate, mode: paymentMode, idempotencyKey: operation.current })
    if (!result) return
    operation.current = ""
    setPayOpen(false)
    setPaymentReview(false)
    setPaymentMode("full")
    setPaymentAmount("")
    toast.success(`Pagamento de ${money.format(amountToPay)} registrado com sucesso.`)
  }

  // Estornar apaga o pagamento e o gasto dele na hora: a fatura volta a ficar em aberto e o saldo da conta é recalculado.
  // Registro que já estava estornado (do modelo antigo, que mantinha o histórico) usa a mesma rota, que leva junto o gasto e o movimento inverso.
  const removePayment = async (payment: InvoicePayment) => {
    if (reversing !== null) return
    setReversing(payment.id)
    const result = await reverseInvoicePayment(payment.id)
    setReversing(null)
    if (result !== null) toast.success(payment.status === "active" ? `Pagamento estornado. ${show(payment.amount)} voltaram para a fatura que fecha em ${monthLabel(payment.cycle)} e o gasto foi apagado.` : "Registro estornado excluído.")
  }

  const exportInvoice = () => {
    if (!card) return
    const cell = csvCell
    const rows = invoiceRows.map((item) => [item.date, cell(item.description), cell(item.category), item.status, (item.type === "income" ? -item.amount : item.amount).toFixed(2)].join(";"))
    if (adjustment !== 0) rows.push([`${cycle}-01`, "Ajustes do ciclo", "Fatura", "confirmado", adjustment.toFixed(2)].join(";"))
    const blob = new Blob([["Data;Descrição;Categoria;Status;Valor", ...rows].join("\n")], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), anchor = document.createElement("a")
    anchor.href = url; anchor.download = `fatura-${card.name.toLowerCase().replace(/\s+/g, "-")}-${cycle}.csv`; anchor.click(); URL.revokeObjectURL(url)
    toast.success("Fatura exportada.")
  }

  return <div className="view-stack card-center-v2">
    {!card ? <section className="surface cards-empty-state"><CreditCard /><h2>Adicione seu primeiro cartão</h2><p>Cadastre limite, fechamento e vencimento.</p><Button onClick={() => openEditor(undefined, "Cartão de crédito")}>Adicionar cartão</Button></section> : <>
    <section className="surface invoice-cycle-toolbar">
      <div><small>Fatura que fecha em</small><h2>{monthLabel(cycle)}</h2></div>
      <div className="invoice-cycle-controls"><Button variant="outline" aria-label="Fatura anterior" onClick={() => setSelectedCycle({ origin: month, value: shiftMonth(cycle, -1) })}><ArrowLeft /></Button><label><span className="sr-only">Ciclo da fatura</span><Input type="month" value={cycle} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setSelectedCycle({ origin: month, value: e.target.value }) }} /></label><Button variant="outline" aria-label="Próxima fatura" onClick={() => setSelectedCycle({ origin: month, value: shiftMonth(cycle, 1) })}><ArrowRight /></Button></div>
      <span className={`invoice-state ${bill?.status === "Vencida" ? "late" : bill?.status === "Paga" ? "settled" : ""}`}>{configured(card) ? bill?.status : "Configuração pendente"}</span>
    </section>
    <section className="card-command-grid card-command-grid-v2">
      <article className="surface credit-card-visual credit-card-visual-v2" style={{ "--card-accent": card.color } as React.CSSProperties}>
        <div className="credit-card-top"><span><CreditCard /> {card.name}</span><button onClick={() => openEditor(card)}><Edit3 /> Editar</button></div>
        <div className="card-brand-row"><div className="credit-chip" /><span>{card.lastFour ? "CARTÃO CADASTRADO" : "FINAL NÃO INFORMADO"}</span></div>
        <p>•••• •••• •••• {card.lastFour || "••••"}</p>
        <div><span>Fatura atual<strong>{show(invoiceTotal)}</strong></span><span>Limite disponível<strong>{show(available)}</strong></span></div>
      </article>
      <article className="surface card-control-panel card-control-panel-v2">
        <div className="panel-title-row"><div><h2>Central do cartão</h2><p>Ciclo que fecha em {monthLabel(cycle)}</p></div><Select value={String(card.id)} onValueChange={(value) => setSelectedCardId(Number(value))}><SelectTrigger className="card-selector"><SelectValue /></SelectTrigger><SelectContent>{cards.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
        {(!card.closingDay || !card.dueDay || !card.lastFour) && <button className="card-date-warning" onClick={() => openEditor(card)}><Clock3 /><span><strong>Finalize a configuração do cartão</strong><small>Adicione final, fechamento e vencimento para cálculos mais precisos.</small></span><span className="warning-action">Configurar <ArrowRight /></span></button>}
        <div className="card-metrics card-metrics-v2"><div><span>Em aberto</span><strong>{show(invoiceTotal)}</strong><small>{paidTotal > 0 ? `${show(paidTotal)} já registrado` : `${invoiceRows.length} compra${invoiceRows.length === 1 ? "" : "s"} + ajustes`}</small></div><div><span>Limite utilizado</span><strong>{Math.round(usedPercent)}%</strong><Progress value={usedPercent} /></div><div><span>Fechamento</span><strong>{bill?.dates ? showDate(bill.dates.closing) : "Definir"}</strong><small>{bill?.dates ? "Compras até o fechamento" : "Data pendente"}</small></div><div><span>Vencimento</span><strong>{bill?.dates ? showDate(bill.dates.due) : "Definir"}</strong><small>{bill?.dates ? "Data cadastrada por você" : "Data pendente"}</small></div></div>
        <div className="card-limit-line"><span><i style={{ width: `${usedPercent}%` }} /></span><small>{hidden ? "Valores ocultos" : `${money.format(projected)} utilizados de ${money.format(card.creditLimit || 0)}`}</small></div>
        <div className="card-primary-actions"><Button className="primary-button" disabled={invoiceTotal <= 0 || !configured(card)} onClick={() => { setPaymentAccount(String(bankAccounts[0]?.id || "")); setPaymentDate(localDate()); setPaymentMode("full"); setPaymentAmount(""); setPaymentReview(false); operation.current = newRecordKey(); setPayOpen(true) }}><Check /> {invoiceTotal <= 0 ? (paidTotal > 0 ? "Fatura paga" : "Sem saldo a pagar") : "Registrar pagamento"}</Button><Button variant="outline" onClick={exportInvoice}><Download /> Exportar</Button></div>
      </article>
    </section>

    <section className="invoice-balance-breakdown">
      <article className="surface"><small>Total deste ciclo</small><strong>{show(grossInvoice)}</strong><span>{refundCredit > 0 ? "Crédito de estorno: abate as próximas faturas" : "Compras + ajustes − estornos"}</span></article>
      <article className="surface"><small>Pago neste ciclo</small><strong>{show(paidTotal)}</strong><span>{overpaid > 0 ? `Pago a mais: ${show(overpaid)}` : "Registros confirmados por você"}</span></article>
      <article className="surface"><small>Faturas futuras</small><strong>{show(committed.future)}</strong><span>Também comprometem seu limite</span></article>
      <article className="surface"><small>Total vencido</small><strong>{show(committed.overdue)}</strong><span>Somente valores ainda em aberto</span></article>
    </section>
    <p className="invoice-method-note">Cada fatura leva o mês em que fecha. Compras até o dia do fechamento entram nela, mesmo que você já tenha pago; só o que passar do fechamento vai para a próxima fatura. Se o banco lançar diferente, confira na conciliação. O limite é uma estimativa local, sem consulta ao banco.</p>


    <section className="invoice-workspace">
      <article className="surface invoice-items invoice-items-v2">
        <div className="panel-title-row"><div><h2>Compras da fatura</h2><p>Composição de {show(grossInvoice)} em {monthLabel(cycle)}</p></div><div className="panel-actions"><Button variant="outline" onClick={() => newTransaction(card, true)}><RotateCcw /> Lançar estorno</Button><Button variant="outline" onClick={() => newTransaction(card)}><Plus /> Adicionar compra</Button></div></div>
        <div className="invoice-toolbar"><div><Search /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar compra ou categoria" /></div></div>
        <div className="invoice-list-head"><span>Compra</span><span>Valor</span></div>
        <div className="invoice-scroll-list">{invoiceFiltered.map((item) => <div className="invoice-row-v2" key={item.id}><span className="invoice-merchant-icon">{(item.merchant || item.description).charAt(0).toUpperCase()}</span><span><strong>{item.merchant || item.description}</strong><small>{showDate(item.date)} • {item.category}{/\(\d+\/\d+\)/.test(item.description) ? " • Parcelada" : ""}</small></span><strong>{show(item.type === "income" ? -item.amount : item.amount)}</strong></div>)}{adjustment !== 0 && !query && <div className="invoice-row-v2 reconciled"><span className="invoice-merchant-icon"><ReceiptText /></span><span><strong>Ajustes do ciclo</strong><small>Conciliado • justificativas no histórico abaixo</small></span><strong>{show(adjustment)}</strong></div>}{!invoiceFiltered.length && adjustment === 0 && <div className="invoice-empty-v2"><ReceiptText /><strong>Nenhuma compra encontrada</strong><p>Registre uma compra ou altere os filtros.</p></div>}</div>
        <div className="invoice-total-row"><span><small>{invoiceRows.length} lançamento{invoiceRows.length === 1 ? "" : "s"} • total {show(grossInvoice)}</small><strong>{paidTotal > 0 ? `Em aberto após ${show(paidTotal)} pago` : "Total em aberto"}</strong></span><strong>{show(invoiceTotal)}</strong></div>
      </article>
      <article className="surface card-history-panel card-history-panel-v2"><div className="panel-title-row"><div><h2>Evolução da fatura</h2><p>Últimos seis meses</p></div><span className={`variation-badge ${variation !== null && variation > 0 ? "up" : "down"}`}><TrendingUp /> {variation === null ? "Sem comparação" : `${variation > 0 ? "+" : ""}${variation}%`}</span></div><div className="card-history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={history} margin={{ top: 12, right: 4, left: -6 }}><CartesianGrid stroke="#1b211d" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#78827a", fontSize: 12 }} /><YAxis hide={hidden} axisLine={false} tickLine={false} width={52} tick={{ fill: "#667068", fontSize: 11 }} tickFormatter={(value) => Math.abs(value) >= 1000 ? `R${(value / 1000).toFixed(1)}k` : `R${value}`} /><ChartTooltip cursor={{ fill: "#ffffff05" }} contentStyle={{ background: "#0b0d0f", border: "1px solid #2b332d", borderRadius: 10 }} formatter={(value) => hidden ? "Oculto" : money.format(Number(value))} /><Bar dataKey="total" name="Fatura" fill={card.color} radius={[7, 7, 2, 2]} /></BarChart></ResponsiveContainer></div><div className="chart-caption"><span><i style={{ background: card.color }} /> Fatura mensal</span><strong>Média: {show(history.reduce((sum, item) => sum + item.total, 0) / history.length)}</strong></div></article>
    </section>

    <section className="surface invoice-reconciliation">
      <div><small>Conferência manual</small><h2>Os valores batem com o banco?</h2><p>Compare o total da fatura antes dos pagamentos. Uma diferença vira um ajuste identificado, sem apagar compras.</p></div>
      <Button variant="outline" disabled={!configured(card)} onClick={() => { setBankTotal(String(grossInvoice).replace(".", ",")); setReason(""); setReconcileReview(false); setReconcileOpen(true) }}>Conciliar fatura</Button>
    </section>
    <section className="surface invoice-payment-history">
      <div className="panel-title-row"><div><h2>Histórico da fatura</h2><p>Pagamentos e ajustes registrados nesta fatura.</p></div>
        <div className="invoice-history-filters">
          <Select value={historyFilter} onValueChange={setHistoryFilter}><SelectTrigger aria-label="Filtrar ciclo do histórico"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cycle">Este ciclo</SelectItem><SelectItem value="all">Todos os ciclos</SelectItem></SelectContent></Select>
          <Select value={historyStatus} onValueChange={setHistoryStatus}><SelectTrigger aria-label="Filtrar status do histórico"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os registros</SelectItem><SelectItem value="active">Ativos</SelectItem><SelectItem value="reversed">Estornados</SelectItem></SelectContent></Select>
        </div>
      </div>
      <div className="payment-history-list">{historyPayments.map(payment => <article className="payment-history-row" key={payment.id}>
        <span className={`payment-history-icon ${payment.status}`}><ReceiptText /></span><span><strong>{payment.mode === "full" ? "Pagamento total" : "Pagamento parcial"}</strong><small>{showDate(payment.date)} • {payment.sourceAccountName} • {monthLabel(payment.cycle)}{payment.status === "reversed" && payment.reversedAt ? ` • estornado em ${showDate(payment.reversedAt.slice(0, 10))}` : ""}</small></span>
        <strong>{show(payment.amount)}</strong><span className={`payment-record-status ${payment.status}`}>{payment.status === "active" ? "Registrado" : "Estornado"}</span>
        <button disabled={reversing !== null} onClick={() => removePayment(payment)}>{payment.status === "active" ? <><RotateCcw /> {reversing === payment.id ? "Estornando..." : "Estornar"}</> : <><Trash2 /> {reversing === payment.id ? "Excluindo..." : "Excluir"}</>}</button>
      </article>)}
      {adjustments.filter(a => historyStatus === "all" || a.status === historyStatus).map(a => <article className="invoice-adjustment-row" key={a.id}><ReceiptText /><div><strong>Ajuste • {monthLabel(a.cycle)}</strong><p>{a.reason}</p><small>{showDate(a.createdAt.slice(0, 10))} • preservado no histórico</small></div><strong>{show(a.amount)}</strong></article>)}
      {!historyPayments.length && !adjustments.some(a => historyStatus === "all" || a.status === historyStatus) && <div className="payment-history-empty"><History /><strong>Nenhum registro neste filtro</strong><p>Pagamentos e ajustes aparecerão aqui.</p></div>}</div>
    </section>
    <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}><DialogContent className="transaction-dialog"><DialogHeader><DialogTitle>{reconcileReview ? "Confirmar ajuste da fatura" : "Conciliar com a fatura do banco"}</DialogTitle><DialogDescription>{card.name} • {monthLabel(cycle)}. Não há conexão bancária.</DialogDescription></DialogHeader>
      {!reconcileReview ? <><label className="field"><span>Total da fatura no banco (antes dos pagamentos)</span><Input inputMode="decimal" value={bankTotal} onChange={e => setBankTotal(e.target.value)} /></label><label className="field"><span>Justificativa do ajuste</span><Input maxLength={240} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: tarifa que não havia sido registrada" /></label></> : <div className="payment-review-grid"><span><small>Total atual</small><strong>{show(grossInvoice)}</strong></span><span><small>Total informado</small><strong>{show(targetTotal)}</strong></span><span><small>Ajuste identificado</small><strong>{show(reconcileDifference)}</strong></span><span><small>Em aberto depois</small><strong>{show(targetTotal - paidTotal)}</strong></span><p>{reason}</p></div>}
      <p className="payment-safety-note">O ajuste altera o valor a pagar e o limite estimado. Não cria uma nova compra nos relatórios. Cadastre despesas identificadas como compras para categorizá-las.</p>
      <DialogFooter><Button variant="outline" onClick={() => reconcileReview ? setReconcileReview(false) : setReconcileOpen(false)}>{reconcileReview ? "Voltar" : "Cancelar"}</Button><Button onClick={async () => { if (!reconcileReview) { try { previewReconcile(ledger, card.id, cycle, targetTotal, reason); setReconcileReview(true) } catch (e) { toast.error(e instanceof Error ? e.message : "Revise os valores.") } } else { const result = await reconcileInvoiceApi(card.id, cycle, { total: targetTotal, reason }); if (result) { setReconcileOpen(false); toast.success("Ajuste registrado no histórico.") } } }}>{reconcileReview ? "Confirmar ajuste" : "Revisar ajuste"}</Button></DialogFooter>
    </DialogContent></Dialog>
    </>}

    <AccountsGrid accounts={accounts} hidden={hidden} edit={openEditor} add={() => openEditor()} />

    {card && <><Dialog open={payOpen} onOpenChange={(open) => { setPayOpen(open); if (!open) setPaymentReview(false) }}><DialogContent className="transaction-dialog payment-dialog sm:max-w-[620px]"><DialogHeader><DialogTitle>{paymentReview ? "Confirme o registro" : `Registrar pagamento do ${card.name}`}</DialogTitle><DialogDescription>{paymentReview ? "Confira os dados finais. Você poderá estornar o registro depois." : "Informe como a fatura foi paga para atualizar seu controle financeiro."}</DialogDescription></DialogHeader>{paymentReview ? <div className="payment-review"><span className="payment-review-icon"><ShieldCheck /></span><div className="payment-review-amount"><small>Valor a registrar</small><strong>{show(amountToPay)}</strong><span>{paymentMode === "full" ? "Pagamento total" : "Pagamento parcial"} • ciclo {monthLabel(cycle)}</span></div><div className="payment-review-grid"><span><small>Cartão</small><strong>{card.name}</strong></span><span><small>Conta de origem</small><strong>{source?.name}</strong></span><span><small>Data</small><strong>{showDate(paymentDate)}</strong></span><span><small>Saldo após</small><strong>{source ? show(source.balance - amountToPay) : "—"}</strong></span></div><p><AlertTriangle /> Este registro organiza os saldos dentro do Synch Cash. Ele não realiza pagamento ou transferência no seu banco.</p></div> : <><div className="payment-summary"><span><small>Valor em aberto</small><strong>{show(invoiceTotal)}</strong></span><span><small>Vencimento</small><strong>{card.dueDay ? `Dia ${card.dueDay}` : "Não definido"}</strong></span></div><div className="payment-mode"><button type="button" className={paymentMode === "full" ? "active" : ""} onClick={() => setPaymentMode("full")}><Check /> Pagamento total<strong>{show(invoiceTotal)}</strong></button><button type="button" className={paymentMode === "partial" ? "active" : ""} onClick={() => setPaymentMode("partial")}><ReceiptText /> Pagamento parcial<strong>Escolher valor</strong></button></div>{paymentMode === "partial" && <label className="field"><span>Valor do pagamento</span><Input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></label>}<div className="payment-fields"><label className="field"><span>Conta de origem</span><Select value={paymentAccount} onValueChange={setPaymentAccount}><SelectTrigger><SelectValue placeholder="Escolha uma conta" /></SelectTrigger><SelectContent>{bankAccounts.map((account) => <SelectItem key={account.id} value={String(account.id)}>{account.name} • {show(account.balance)}</SelectItem>)}</SelectContent></Select></label><label className="field"><span>Data do pagamento</span><Input type="date" value={paymentDate} max={localDate()} onChange={(event) => setPaymentDate(event.target.value)} /></label></div>{source && <div className={`payment-balance-preview ${source.balance < amountToPay ? "danger" : ""}`}><ShieldCheck /><span><strong>Saldo após o registro</strong><small>{source.balance < amountToPay ? "Saldo insuficiente" : `${source.name}: ${show(source.balance - amountToPay)}`}</small></span></div>}<p className="payment-safety-note"><ShieldCheck /> O Synch registra o pagamento para fins de controle. A quitação real continua sendo feita no aplicativo do banco.</p></>}<DialogFooter>{paymentReview ? <><Button variant="outline" onClick={() => setPaymentReview(false)}><ArrowLeft /> Voltar</Button><Button className="primary-button" disabled={!canPay} onClick={registerPayment}>Confirmar registro</Button></> : <><Button variant="outline" onClick={() => setPayOpen(false)}>Cancelar</Button><Button className="primary-button" onClick={validatePayment} disabled={!canPay}>Revisar pagamento</Button></>}</DialogFooter></DialogContent></Dialog>

    </>}
    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="transaction-dialog sm:max-w-[680px]"><DialogHeader><DialogTitle>{editingId ? "Editar conta ou cartão" : "Adicionar conta ou cartão"}</DialogTitle><DialogDescription>Esses dados deixam faturas, limites e previsões mais precisos.</DialogDescription></DialogHeader><form onSubmit={saveAccount} className="account-editor-form"><label className="field"><span>Nome</span><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ex.: Nubank" /></label><label className="field"><span>Tipo</span><Select value={draft.type} onValueChange={(type: Account["type"]) => setDraft({ ...draft, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Conta corrente">Conta corrente</SelectItem><SelectItem value="Cartão de crédito">Cartão de crédito</SelectItem><SelectItem value="Dinheiro">Dinheiro</SelectItem></SelectContent></Select></label><label className="field"><span>{draft.type === "Cartão de crédito" ? "Dívida total calculada (use Conciliar para ajustar)" : "Saldo atual"}</span><Input disabled={draft.type === "Cartão de crédito"} value={draft.balance} onChange={(event) => setDraft({ ...draft, balance: event.target.value })} inputMode="decimal" placeholder="0,00" /></label><label className="field"><span>Últimos 4 dígitos</span><Input value={draft.lastFour} onChange={(event) => setDraft({ ...draft, lastFour: event.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" placeholder="Ex.: 7721" /></label>{draft.type === "Cartão de crédito" && <><label className="field"><span>Limite total</span><Input value={draft.creditLimit} onChange={(event) => setDraft({ ...draft, creditLimit: event.target.value })} inputMode="decimal" placeholder="0,00" /></label><label className="field"><span>Dia do fechamento</span><Input type="number" min="1" max="31" value={draft.closingDay} onChange={(event) => setDraft({ ...draft, closingDay: event.target.value })} /></label><label className="field"><span>Dia do vencimento</span><Input type="number" min="1" max="31" value={draft.dueDay} onChange={(event) => setDraft({ ...draft, dueDay: event.target.value })} /></label><div className="field field-span-2" role="group" aria-label="Cor do cartão"><span>Cor do cartão</span><div className="card-color-options">{colorOptions.map((option) => { const selected = option.hex === draft.color.toLowerCase(); return <button key={option.hex} type="button" className={selected ? "selected" : ""} style={{ "--swatch": option.hex, "--ink": option.light ? "#111827" : "#ffffff" } as React.CSSProperties} aria-pressed={selected} aria-label={option.name} title={option.name} onClick={() => setDraft({ ...draft, color: option.hex })}>{selected && <Check />}</button> })}</div></div></>}<DialogFooter className="field-span-2"><Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancelar</Button><Button className="primary-button" type="submit">Salvar dados</Button></DialogFooter></form></DialogContent></Dialog>
  </div>
}

function AccountsGrid({ accounts, hidden, edit, add }: { accounts: Account[]; hidden: boolean; edit: (account: Account) => void; add: () => void }) {
  return <section className="accounts-grid compact-accounts accounts-grid-v2">{accounts.filter((account) => account.type !== "Cartão de crédito").map((account) => { const Icon = account.type === "Dinheiro" ? WalletCards : Landmark; return <article className="surface account-card" key={account.id}><div className="account-card-top"><span style={{ color: account.color, background: `${account.color}18` }}><Icon /></span><button onClick={() => edit(account)} aria-label={`Editar ${account.name}`}><Edit3 /></button></div><p>{account.type}</p><h3>{account.name}</h3><strong>{hidden ? "R$ ••••" : money.format(account.balance)}</strong><small>{account.detail}{account.lastFour ? ` • Final ${account.lastFour}` : ""}</small></article> })}<button className="surface add-account-card" onClick={add}><Plus /><strong>Adicionar conta</strong><span>Conecte seus saldos ao planejamento</span></button></section>
}
