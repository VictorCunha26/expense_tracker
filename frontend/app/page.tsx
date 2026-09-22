"use client"

import { addCalendarMonths, installmentAmounts, csvCell, parseCsv, parseCsvAmount } from "@/lib/transaction-values"
import { Dispatch, FormEvent, SetStateAction, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts"
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, Bot, BrainCircuit, Calculator, CalendarDays,
  ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, CreditCard, Database, Download, Ellipsis, Eye, EyeOff,
  FileChartColumn, Gauge, Goal, Home, Landmark, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  AudioLines, Lightbulb, Mail, LockKeyhole, Mic, Pencil, PiggyBank, Plus, ReceiptText, RefreshCcw, RotateCcw, Search, Send, Settings, ShieldCheck,
  Sparkles, Square, Target, Trash2, TrendingDown, TrendingUp, Upload, UserRound, Volume2, VolumeX, WalletCards, X, Zap, Moon,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Toaster } from "@/components/ui/sonner"
import { CalendarView, CommandPalette, ImportReviewDialog, PlanningView, SubscriptionView } from "@/components/advanced-finance"
import { AccountsCardCenter } from "@/components/accounts-card-center"
import { FinancialCalculator } from "@/components/financial-calculator"
import { synchApi, SynchApiError, type NewTransaction } from "@/lib/synch-api"
import { CategoriesContext, categoryColor, systemCategories, useCategories } from "@/lib/categories"
import { useSynchData, type Plan } from "@/lib/use-synch-data"
import { cardCycles, cash, cents, invoice, isAnalytical, purchaseCycle, shiftMonth } from "@/lib/invoice-ledger"
import type { Account, GoalData, LocalLedger, Preferences, RecurringData, Transaction, ViewKey } from "@/lib/models"

type MonthKey = string
type FormState = { description: string; category: string; date: string; amount: string; type: "expense" | "income"; account: string; status: "paid" | "pending"; notes: string; installments: string; recurring: boolean; mode: "transaction" | "transfer"; transferAccount: string; splitEnabled: boolean; splitCategory: string; splitAmount: string; receiptName: string }
type VoiceDraft = { description: string; amount: string; type: "expense" | "income"; category: string; date: string; account: string; status: "paid" | "pending"; installments?: number; recurring?: boolean; confidence?: number }
type AssistantMessage = { id: number; role: "user" | "assistant"; text: string; source?: "text" | "voice"; time: string }
type AssistantActivity = { id: number; label: string; detail: string; time: string; status: "done" | "undone" }
type AssistantAction =
  | { id: number; kind: "transactions"; source: string; confidence: number; drafts: VoiceDraft[] }
  | { id: number; kind: "budget"; source: string; confidence: number; category: string; amount: number }
  | { id: number; kind: "goal"; source: string; confidence: number; name: string; amount: number }
  | { id: number; kind: "recurring"; source: string; confidence: number; name: string; category: string; amount: number }
type AssistantUndo =
  | { kind: "transactions"; label: string; transactionIds: number[]; recurringIds: number[] }
  | { kind: "budget"; label: string; category: string; previous?: number }
  | { kind: "goal"; label: string; id: number }
  | { kind: "recurring"; label: string; id: number }
type VoiceRecognitionEvent = { results: ArrayLike<{ 0: { transcript: string; confidence?: number }; isFinal: boolean }> }
type VoiceRecognitionError = { error: string }
type VoiceRecognition = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives?: number; start: () => void; stop: () => void; abort: () => void; onstart: (() => void) | null; onend: (() => void) | null; onresult: ((event: VoiceRecognitionEvent) => void) | null; onerror: ((event: VoiceRecognitionError) => void) | null }
type VoiceRecognitionConstructor = new () => VoiceRecognition

const currentDate = new Date()
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const monthKeyAt = (offset: number) => { const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1); return isoDate(date).slice(0, 7) }
const dateAt = (offset: number, day: number) => { const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, day); return isoDate(date) }
const monthOptions = Array.from({ length: 6 }, (_, index) => monthKeyAt(-index))
const monthLabel = (value: string, short = false) => { const [year, month] = value.split("-").map(Number); return new Intl.DateTimeFormat("pt-BR", short ? { month: "short" } : { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1)).replace(/^./, (letter) => letter.toUpperCase()).replace(".", "") }
const monthLabels = Object.fromEntries(monthOptions.map((key) => [key, monthLabel(key)])) as Record<string, string>
const seedTransactions: Transaction[] = [
  { id: 1, description: "Supermercado", merchant: "Supermercado Central", paymentMethod: "Débito", category: "Alimentação", date: dateAt(0, 1), amount: 286.4, type: "expense", account: "Banco Inter", status: "paid" },
  { id: 2, description: "Netflix", merchant: "Netflix.com", paymentMethod: "Crédito", category: "Assinaturas", date: dateAt(0, 1), amount: 55.9, type: "expense", account: "Nubank", status: "paid", recurring: true },
  { id: 3, description: "Salário", category: "Receita", date: dateAt(0, 1), amount: 4800, type: "income", account: "Banco Inter", status: "paid" },
  { id: 4, description: "Uber", merchant: "Uber *Trip", paymentMethod: "Crédito", category: "Transporte", date: dateAt(0, 1), amount: 42.7, type: "expense", account: "Nubank", status: "paid" },
  { id: 5, description: "Aluguel", category: "Moradia", date: dateAt(0, 1), amount: 1420, type: "expense", account: "Banco Inter", status: "paid", recurring: true },
  { id: 6, description: "Restaurante", category: "Alimentação", date: dateAt(0, 1), amount: 126.5, type: "expense", account: "Nubank", status: "paid" },
  { id: 7, description: "Delivery", category: "Alimentação", date: dateAt(0, 1), amount: 429.2, type: "expense", account: "Nubank", status: "paid" },
  { id: 8, description: "Combustível", category: "Transporte", date: dateAt(0, 1), amount: 379.1, type: "expense", account: "Banco Inter", status: "paid" },
  { id: 9, description: "Cinema e lazer", category: "Lazer", date: dateAt(0, 1), amount: 263.6, type: "expense", account: "Nubank", status: "paid" },
  { id: 10, description: "Internet", category: "Assinaturas", date: dateAt(0, 1), amount: 153.1, type: "expense", account: "Banco Inter", status: "paid", recurring: true },
  { id: 11, description: "Ajuste mensal", category: "Outros", date: dateAt(0, 1), amount: 1, type: "expense", account: "Carteira", status: "paid" },
  { id: 12, description: "Fatura do cartão", category: "Outros", date: dateAt(0, 5), amount: 540, type: "expense", account: "Nubank", status: "pending" },
  { id: 13, description: "Energia", category: "Moradia", date: dateAt(0, 8), amount: 120, type: "expense", account: "Banco Inter", status: "pending" },
  { id: 14, description: "Plano de celular", category: "Assinaturas", date: dateAt(0, 10), amount: 120, type: "expense", account: "Banco Inter", status: "pending" },
  { id: 15, description: "Spotify", merchant: "Spotify Curitiba", paymentMethod: "Crédito", category: "Assinaturas", date: dateAt(0, 12), amount: 23.9, type: "expense", account: "Nubank", status: "paid", recurring: true },
  { id: 16, description: "Estorno Uber", merchant: "Uber *Trip", paymentMethod: "Crédito", category: "Transporte", date: dateAt(0, 3), amount: 18.5, type: "income", account: "Nubank", status: "paid", kind: "refund" },
  { id: 101, description: "Salário", category: "Receita", date: dateAt(-1, 20), amount: 4800, type: "income", account: "Banco Inter", status: "paid" },
  { id: 102, description: "Aluguel", category: "Moradia", date: dateAt(-1, 5), amount: 1420, type: "expense", account: "Banco Inter", status: "paid" },
  { id: 103, description: "Compras do mês", category: "Alimentação", date: dateAt(-1, 16), amount: 1109, type: "expense", account: "Nubank", status: "paid" },
  { id: 104, description: "Transporte e lazer", category: "Transporte", date: dateAt(-1, 23), amount: 900, type: "expense", account: "Nubank", status: "paid" },
  { id: 111, description: "Salário", category: "Receita", date: dateAt(-2, 20), amount: 4800, type: "income", account: "Banco Inter", status: "paid" },
  { id: 112, description: "Aluguel", category: "Moradia", date: dateAt(-2, 5), amount: 1420, type: "expense", account: "Banco Inter", status: "paid" },
  { id: 113, description: "Despesas gerais", category: "Alimentação", date: dateAt(-2, 18), amount: 1260, type: "expense", account: "Nubank", status: "paid" },
  { id: 114, description: "Viagem curta", category: "Lazer", date: dateAt(-2, 25), amount: 800, type: "expense", account: "Nubank", status: "paid" },
]
const seedAccounts: Account[] = [
  { id: 1, name: "Banco Inter", type: "Conta corrente", balance: 6842.5, detail: "Conta principal", lastFour: "4832", color: "#22c55e" },
  { id: 2, name: "Nubank", type: "Cartão de crédito", balance: 540, detail: "Cartão principal", creditLimit: 4500, closingDay: 28, dueDay: 5, lastFour: "7721", color: "#8b5cf6" },
  { id: 3, name: "Carteira", type: "Dinheiro", balance: 350, detail: "Dinheiro disponível", color: "#f59e0b" },
]
const seedGoals: GoalData[] = [
  { id: 1, name: "Reserva de emergência", saved: 7800, target: 15000, deadline: "Dezembro 2026", color: "#22c55e" },
  { id: 2, name: "Viagem", saved: 2350, target: 6000, deadline: "Janeiro 2027", color: "#3b82f6" },
  { id: 3, name: "Notebook novo", saved: 1900, target: 8500, deadline: "Março 2027", color: "#8b5cf6" },
]
const seedRecurring: RecurringData[] = [
  { id: 1, name: "Aluguel", category: "Moradia", amount: 1420, type: "expense", next: "05 set", active: true },
  { id: 2, name: "Netflix", category: "Assinaturas", amount: 55.9, type: "expense", next: "25 set", active: true },
  { id: 3, name: "Internet", category: "Assinaturas", amount: 153.1, type: "expense", next: "10 set", active: true },
  { id: 4, name: "Academia", category: "Lazer", amount: 119.9, type: "expense", next: "12 set", active: false },
]
const seedBudgets: Record<string, number> = { Moradia: 1600, Alimentação: 1100, Transporte: 650, Lazer: 450, Assinaturas: 300, Outros: 900 }
const defaultForm: FormState = { description: "", category: "Alimentação", date: isoDate(currentDate), amount: "", type: "expense", account: "Banco Inter", status: "paid", notes: "", installments: "1", recurring: false, mode: "transaction", transferAccount: "Nubank", splitEnabled: false, splitCategory: "Outros", splitAmount: "", receiptName: "" }
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const shortDate = (value: string) => value === isoDate(currentDate) ? "Hoje" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", "")
const accountDetail = (account: Account) => account.type === "Cartão de crédito"
  ? [`Final ${account.lastFour || "não informado"}`, account.closingDay ? `Fecha dia ${account.closingDay}` : null, account.dueDay ? `Vence dia ${account.dueDay}` : null].filter(Boolean).join(" • ")
  : [account.detail, account.lastFour ? `Final ${account.lastFour}` : null].filter(Boolean).join(" • ")
const subscribeAuth = (callback: () => void) => { window.addEventListener("synch-cash-auth-change", callback); window.addEventListener("storage", callback); return () => { window.removeEventListener("synch-cash-auth-change", callback); window.removeEventListener("storage", callback) } }
const getAuthSnapshot = () => localStorage.getItem("synch-cash-auth") === "active" || sessionStorage.getItem("synch-cash-auth") === "active"
const getClientSnapshot = () => true
const getServerSnapshot = () => false
const noopSubscribe = () => () => {}

function useMotionEffects(view: ViewKey, month: MonthKey) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const targets = Array.from(document.querySelectorAll<HTMLElement>(".main-content .surface, .main-content .recurring-list article"))
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (!entry.isIntersecting) return; entry.target.classList.add("is-visible"); observer.unobserve(entry.target) }), { threshold: .08, rootMargin: "0px 0px -24px" })
    targets.forEach((element, index) => { element.classList.remove("is-visible"); element.classList.add("js-reveal"); element.style.setProperty("--reveal-delay", `${Math.min(index * 42, 294)}ms`); observer.observe(element) })
    const press = (event: PointerEvent) => { const button = (event.target as Element | null)?.closest("button"); if (!button) return; button.classList.remove("js-pressed"); window.requestAnimationFrame(() => button.classList.add("js-pressed")); window.setTimeout(() => button.classList.remove("js-pressed"), 260) }
    document.addEventListener("pointerdown", press)
    return () => { observer.disconnect(); document.removeEventListener("pointerdown", press) }
  }, [view, month])
}

function useStoredState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial
    const stored = localStorage.getItem(key)
    if (!stored) return initial
    try { return JSON.parse(stored) as T } catch { return initial }
  })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)) }, [key, value])
  return [value, setValue]
}

const navItems: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Visão geral", icon: LayoutDashboard }, { key: "transactions", label: "Transações", icon: ArrowDownLeft },
  { key: "calendar", label: "Calendário", icon: CalendarDays }, { key: "categories", label: "Categorias", icon: ChartNoAxesCombined }, { key: "accounts", label: "Contas e cartões", icon: CreditCard },
  { key: "recurring", label: "Recorrentes", icon: RefreshCcw }, { key: "goals", label: "Metas", icon: Target },
  { key: "planning", label: "Planejamento", icon: TrendingUp }, { key: "calculator", label: "Calculadora financeira", icon: Calculator },
  { key: "reports", label: "Relatórios", icon: FileChartColumn }, { key: "assistant", label: "Assistente financeiro", icon: Sparkles },
  { key: "subscription", label: "Plano e assinatura", icon: WalletCards }, { key: "settings", label: "Configurações", icon: Settings },
]

// O segundo grupo da sidebar começa no Assistente; achar pelo nome evita que remover um item do menu desloque a divisão.
const intelligenceStart = navItems.findIndex((item) => item.key === "assistant")

function Brand() { return <div className="brand-lockup"><span className="brand-logo-frame"><img className="brand-logo" src="/synch-cash-logo.png" alt="Synch Cash" /></span></div> }

function AppSidebar({ current, navigate, name, email, logout }: { current: ViewKey; navigate: (key: ViewKey) => void; name: string; email: string; logout: () => void }) {
  const { setOpenMobile } = useSidebar()
  const menu = (items: typeof navItems) => <SidebarMenu className="sidebar-menu-list">{items.map((item) => { const Icon = item.icon; return <SidebarMenuItem key={item.key}><SidebarMenuButton isActive={current === item.key} tooltip={item.label} className="sidebar-nav-button" onClick={() => { navigate(item.key); setOpenMobile(false) }}><Icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem> })}</SidebarMenu>
  return <Sidebar collapsible="icon" className="synch-sidebar"><SidebarHeader className="sidebar-header"><Brand /></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel className="sidebar-section-label">Gestão financeira</SidebarGroupLabel><SidebarGroupContent>{menu(navItems.slice(0, intelligenceStart))}</SidebarGroupContent></SidebarGroup><SidebarGroup className="sidebar-secondary-group"><SidebarGroupLabel className="sidebar-section-label">Inteligência e conta</SidebarGroupLabel><SidebarGroupContent>{menu(navItems.slice(intelligenceStart))}</SidebarGroupContent></SidebarGroup></SidebarContent><SidebarFooter className="sidebar-footer"><div className="sidebar-sync-status"><span><ShieldCheck /></span><div><strong>Dados protegidos</strong><small>Salvos neste dispositivo</small></div></div><DropdownMenu><DropdownMenuTrigger asChild><button className="profile-card"><span className="profile-avatar">{name.charAt(0).toUpperCase() || "G"}</span><span className="profile-copy"><strong>{name}</strong><small>{email}</small></span><ChevronDown size={16} /></button></DropdownMenuTrigger><DropdownMenuContent side="top" align="start" className="dark-menu w-56"><DropdownMenuLabel>Minha conta</DropdownMenuLabel><DropdownMenuItem onClick={() => { navigate("subscription"); setOpenMobile(false) }}><WalletCards /> Plano e assinatura</DropdownMenuItem><DropdownMenuItem onClick={() => { navigate("settings"); setOpenMobile(false) }}><UserRound /> Perfil</DropdownMenuItem><DropdownMenuItem onClick={() => { navigate("settings"); setOpenMobile(false) }}><ShieldCheck /> Segurança</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={logout}><LogOut /> Sair</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarFooter></Sidebar>
}

function Badge({ category }: { category: string }) { const color = categoryColor(category); return <span className="category-badge" style={{ color, borderColor: color + "55", background: color + "12" }}>{category}</span> }
function Kpi({ label, value, meta, tone, icon: Icon }: { label: string; value: string; meta: string; tone: string; icon: typeof WalletCards }) { return <article className={`surface kpi-card kpi-${tone}`}><div className="kpi-content"><div className="kpi-label"><i />{label}</div><strong className={`kpi-value ${tone}`}>{value}</strong><span className="kpi-meta">{meta}</span></div><div className={`kpi-icon ${tone}`}><Icon /></div></article> }

function ConfirmDeleteDialog({ target, label, description, close, confirm }: { target: boolean; label: string; description: string; close: () => void; confirm: () => void }) {
  return <AlertDialog open={target} onOpenChange={(open) => !open && close()}><AlertDialogContent className="transaction-dialog"><AlertDialogHeader><AlertDialogTitle>Excluir {label}?</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="delete-button" onClick={confirm}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function TransactionModal({ open, setOpen, form, setForm, editing, submit, accountNames, cardNames }: { open: boolean; setOpen: (v: boolean) => void; form: FormState; setForm: (v: FormState) => void; editing: number | null; submit: (e: FormEvent<HTMLFormElement>) => void; accountNames: string[]; cardNames: string[] }) {
  const categories = useCategories()
  const onCard = form.mode === "transaction" && cardNames.includes(form.account)
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="transaction-dialog sm:max-w-[680px]"><DialogHeader><DialogTitle>{editing ? "Editar transação" : "Nova transação"}</DialogTitle><DialogDescription>Registre uma movimentação com todos os detalhes importantes.</DialogDescription></DialogHeader><form onSubmit={submit} className="transaction-form">
    <div className="movement-tabs field-span-2"><button type="button" className={form.mode === "transaction" ? "active" : ""} onClick={() => setForm({ ...form, mode: "transaction" })}><ReceiptText /> Receita ou despesa</button><button type="button" className={form.mode === "transfer" ? "active" : ""} onClick={() => setForm({ ...form, mode: "transfer", type: "expense", category: "Outros", description: form.description || "Transferência" })}><RefreshCcw /> Transferência</button></div>
    {form.mode === "transaction" && <div className="type-toggle"><button type="button" className={form.type === "expense" ? "active expense" : ""} onClick={() => setForm({ ...form, type: "expense" })}><ArrowUpRight /> {onCard ? "Compra" : "Despesa"}</button><button type="button" className={form.type === "income" ? "active income" : ""} onClick={() => setForm({ ...form, type: "income", category: "Receita" })}><ArrowDownLeft /> {onCard ? "Estorno" : "Receita"}</button></div>}
    {onCard && form.type === "income" && <p className="refund-hint field-span-2">O estorno abate a fatura do cartão e devolve o valor ao limite.</p>}
    <label className="field field-span-2"><span>Descrição</span><Input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex.: Supermercado" /></label>
    <label className="field"><span>Valor total</span><Input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="R$ 0,00" /></label>
    <label className="field"><span>Data</span><Input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
    {form.mode === "transaction" && <label className="field"><span>Categoria</span><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></label>}
    <label className="field"><span>{form.mode === "transfer" ? "Conta de origem" : "Conta ou cartão"}</span><Select value={form.account} onValueChange={(v) => setForm({ ...form, account: v, status: cardNames.includes(v) ? "paid" : form.status })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{accountNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></label>
    {form.mode === "transfer" ? <label className="field"><span>Conta de destino</span><Select value={form.transferAccount} onValueChange={(v) => setForm({ ...form, transferAccount: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{accountNames.filter((name) => name !== form.account).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></label> : <><label className="field"><span>Status</span>{onCard ? <Select value="paid" disabled><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="paid">Na fatura</SelectItem></SelectContent></Select> : <Select value={form.status} onValueChange={(v: "paid" | "pending") => setForm({ ...form, status: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="paid">Pago</SelectItem><SelectItem value="pending">Pendente</SelectItem></SelectContent></Select>}</label><label className="field"><span>Parcelas</span><Select value={form.installments} onValueChange={(v) => setForm({ ...form, installments: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4, 5, 6, 10, 12, 18, 24].map((n) => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}</SelectContent></Select></label></>}
    <label className="field field-span-2"><span>Observações</span><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Informação opcional" /></label>
    {form.mode === "transaction" && <><label className="recurring-option field-span-2"><span><RefreshCcw /><span><strong>Repetir mensalmente</strong><small>Cria uma regra em despesas recorrentes</small></span></span><Switch checked={form.recurring} onCheckedChange={(v) => setForm({ ...form, recurring: v })} /></label><label className="recurring-option field-span-2"><span><ChartNoAxesCombined /><span><strong>Dividir entre categorias</strong><small>Separe parte do valor em outra categoria</small></span></span><Switch checked={form.splitEnabled} onCheckedChange={(v) => setForm({ ...form, splitEnabled: v })} /></label>{form.splitEnabled && <div className="split-fields field-span-2"><label className="field"><span>Segunda categoria</span><Select value={form.splitCategory} onValueChange={(v) => setForm({ ...form, splitCategory: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.filter((category) => category !== form.category && category !== "Receita").map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></label><label className="field"><span>Valor da divisão</span><Input value={form.splitAmount} onChange={(event) => setForm({ ...form, splitAmount: event.target.value })} inputMode="decimal" placeholder="R$ 0,00" /></label></div>}</>}
    <label className="receipt-upload field-span-2"><input hidden type="file" accept="image/*,.pdf" onChange={(event) => setForm({ ...form, receiptName: event.target.files?.[0]?.name || "" })} /><Upload /><span><strong>{form.receiptName || "Anexar comprovante"}</strong><small>{form.receiptName ? "Arquivo pronto para salvar" : "Imagem ou PDF de até 10 MB"}</small></span>{form.receiptName && <Check />}</label>
    <DialogFooter className="field-span-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" className="primary-button"><Check /> {editing ? "Salvar alterações" : "Adicionar transação"}</Button></DialogFooter>
  </form></DialogContent></Dialog>
}

function TransactionTable({ rows, compact, edit, requestDelete, hidden }: { rows: Transaction[]; compact?: boolean; edit: (item: Transaction) => void; requestDelete: (item: Transaction) => void; hidden?: boolean }) {
  return <Table className={`mobile-transaction-table ${compact ? "compact" : ""}`}><TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Categoria</TableHead>{!compact && <TableHead>Conta e pagamento</TableHead>}<TableHead>Data</TableHead>{!compact && <TableHead>Status</TableHead>}<TableHead className="text-right">Valor</TableHead><TableHead className="w-10" /></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell><div className="transaction-name"><span className={`transaction-icon ${item.type}`}>{item.kind === "refund" ? <RotateCcw /> : item.type === "income" ? <ArrowDownLeft /> : <ReceiptText />}</span><span><strong>{item.description}</strong><small>{item.merchant || item.notes || "Lançamento manual"}{item.kind === "refund" ? " • Estorno" : item.receiptName ? " • Com comprovante" : ""}</small></span></div></TableCell><TableCell><Badge category={item.category} /></TableCell>{!compact && <TableCell className="muted-cell"><span className="transaction-account"><strong>{item.account}</strong><small>{item.paymentMethod || "Conta"}</small></span></TableCell>}<TableCell className="muted-cell">{shortDate(item.date)}</TableCell>{!compact && <TableCell><span className={`status ${item.cardId ? "paid" : item.status}`}>{item.cardId ? "Na fatura" : item.status === "paid" ? "Pago" : "Pendente"}</span></TableCell>}<TableCell className={`amount-cell ${item.type}`}>{hidden ? "R$ ••••" : `${item.type === "expense" ? "− " : "+ "}${money.format(item.amount)}`}</TableCell><TableCell className="transaction-row-actions"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações de ${item.description}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="dark-menu"><DropdownMenuItem onClick={() => edit(item)}><Pencil /> Editar detalhes</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => requestDelete(item)}><Trash2 /> Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table>
}

function Overview({ items, ledger, budgets, navigate, edit, requestDelete, hidden }: { items: Transaction[]; ledger: LocalLedger; budgets: Record<string, number>; navigate: (v: ViewKey) => void; edit: (i: Transaction) => void; requestDelete: (i: Transaction) => void; hidden: boolean }) {
  const expenses = items.filter((i) => i.type === "expense" && i.status === "paid"), spent = expenses.reduce((t, i) => t + i.amount, 0)
  const income = items.filter((i) => i.type === "income" && i.status === "paid").reduce((t, i) => t + i.amount, 0), pending = items.filter((i) => i.type === "expense" && i.status === "pending").reduce((t, i) => t + i.amount, 0)
  const budget = Object.values(budgets).reduce((a, b) => a + b, 0), remaining = budget - spent, balance = ledger.accounts.filter((account) => account.type !== "Cartão de crédito").reduce((sum, account) => sum + account.balance, 0)
  const cards = ledger.accounts.filter((account) => account.type === "Cartão de crédito")
  // Próxima fatura a pagar de cada cartão: o primeiro ciclo que ainda tem valor em aberto (inclui uma fatura vencida).
  const nextBills = cards.flatMap((card) => { const bill = cardCycles(ledger, card).map((cycle) => invoice(ledger, card, cycle)).find((item) => item.outstanding > 0); return bill ? [bill] : [] })
  const invoiceDue = cash(nextBills.reduce((sum, bill) => sum + cents(bill.outstanding), 0)), invoiceOverdue = nextBills.some((bill) => bill.status === "Vencida"), invoiceDueDate = nextBills.flatMap((bill) => bill.dates ? [bill.dates.due] : []).sort()[0]
  const invoiceMeta = !cards.length ? "Nenhum cartão cadastrado" : !nextBills.length ? "Nenhuma fatura em aberto" : invoiceDueDate ? `${invoiceOverdue ? "Venceu" : "Vence"} em ${invoiceDueDate.slice(8, 10)}/${invoiceDueDate.slice(5, 7)}` : "Informe fechamento e vencimento do cartão"
  const show = (value: number) => hidden ? "R$ ••••" : money.format(value)
  const totals = expenses.reduce<Record<string, number>>((r, i) => ({ ...r, [i.category]: (r[i.category] || 0) + i.amount }), {})
  const categoryData = Object.entries(totals).map(([name, value]) => ({ name, value, color: categoryColor(name) })).sort((a, b) => b.value - a.value)
  const lineData = Array.from({ length: 31 }, (_, index) => ({ day: index + 1, total: expenses.filter((i) => Number(i.date.slice(8)) <= index + 1).reduce((sum, i) => sum + i.amount, 0) }))
  const budgetUse = budget ? Math.min(100, spent / budget * 100) : 0, healthScore = Math.max(35, Math.min(96, Math.round(100 - budgetUse * .45 - (pending > 0 ? 5 : 0) + (income > spent ? 8 : 0)))), topCategory = categoryData[0]?.name || "Sem categoria"
  return <div className="view-stack"><section className="surface overview-hero"><div className="overview-hero-copy"><span className="overview-eyebrow"><Sparkles /> Resumo inteligente do período</span><h2>{remaining >= 0 ? "Seu mês está sob controle." : "Seu orçamento precisa de atenção."}</h2><p>{remaining >= 0 ? <>Você ainda tem <strong>{show(remaining)}</strong> disponíveis. A maior concentração de gastos está em <strong>{topCategory}</strong>.</> : <>O orçamento foi ultrapassado em <strong>{show(Math.abs(remaining))}</strong>. Revise seus limites e despesas recorrentes.</>}</p><div className="overview-hero-actions"><Button className="primary-button" onClick={() => navigate("categories")}><Gauge /> Revisar orçamento</Button><button onClick={() => navigate("reports")}>Abrir relatório <ArrowRight /></button></div></div><div className="health-card"><div className="health-ring" style={{ "--score": `${healthScore * 3.6}deg` } as React.CSSProperties}><span><strong>{healthScore}</strong><small>/100</small></span></div><div><span>Saúde financeira</span><strong>{healthScore >= 75 ? "Muito boa" : healthScore >= 55 ? "Estável" : "Em atenção"}</strong><small>Calculada com orçamento, saldo e pendências</small></div></div></section><section className="kpi-grid"><Kpi label="Saldo disponível" value={show(balance)} meta="Atualizado agora" tone="positive" icon={WalletCards} /><Kpi label="Gastos no mês" value={show(spent)} meta="Comparação mensal ativa" tone="neutral" icon={TrendingDown} /><Kpi label="Fatura do cartão" value={show(invoiceDue)} meta={invoiceMeta} tone={invoiceDue > 0 ? (invoiceOverdue ? "neutral" : "warning") : "positive"} icon={CreditCard} /><Kpi label="Contas pendentes" value={show(pending)} meta={`${items.filter((i) => i.status === "pending").length} contas para pagar`} tone="warning" icon={ReceiptText} /></section>
    <section className="charts-grid"><article className="surface chart-card"><div className="card-heading"><div><h2>Gastos ao longo do mês</h2><p>Acumulado das despesas pagas</p></div><span className="period-chip">Mensal <ChevronDown /></span></div><div className="line-chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={lineData} margin={{ top: 14, right: 8, left: -18 }}><defs><linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} /><stop offset="100%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#1b1e22" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#737a84", fontSize: 11 }} ticks={[1, 5, 10, 15, 20, 25, 31]} /><YAxis hide={hidden} axisLine={false} tickLine={false} tick={{ fill: "#737a84", fontSize: 11 }} tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`} /><ChartTooltip contentStyle={{ background: "#0b0d0f", border: "1px solid #282c31", borderRadius: 10 }} formatter={(v) => hidden ? "Oculto" : money.format(Number(v))} /><Area type="monotone" dataKey="total" stroke="#22c55e" strokeWidth={2.5} fill="url(#spendGradient)" /></AreaChart></ResponsiveContainer></div></article>
    <article className="surface chart-card"><div className="card-heading"><div><h2>Gastos por categoria</h2><p>Distribuição do período</p></div><span className="period-chip">Categorias <ChevronDown /></span></div><div className="category-chart-content"><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={1.5} stroke="none">{categoryData.map((e) => <Cell key={e.name} fill={e.color} />)}</Pie><ChartTooltip contentStyle={{ background: "#0b0d0f", border: "1px solid #282c31", borderRadius: 10 }} formatter={(v) => hidden ? "Oculto" : money.format(Number(v))} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{show(spent)}</strong><span>Total de gastos</span></div></div><div className="category-list">{categoryData.slice(0, 5).map((c) => <div key={c.name}><span><i style={{ background: c.color }} />{c.name}</span><strong>{hidden ? "••••" : money.format(c.value)}</strong><small>{spent ? Math.round(c.value / spent * 100) : 0}%</small></div>)}</div></div></article></section>
    <section className="bottom-grid"><article className="surface budget-card"><div className="card-heading"><div><h2>Orçamento mensal</h2><p>Limite total definido</p></div><strong className="positive">{budget ? Math.round(spent / budget * 100) : 0}% utilizado</strong></div><p className="budget-total"><strong>{show(spent)}</strong> de {show(budget)}</p><Progress value={budget ? spent / budget * 100 : 0} className="budget-progress" /><div className="budget-scale"><span>R$ 0</span><span>50%</span><span>100%</span></div><div className="insight-box"><span><TrendingUp /></span><p>Você ainda pode gastar <strong>{show(Math.max(0, remaining))}</strong> neste período.<small>{remaining >= 0 ? "Mantenha o bom controle!" : "Seu limite foi ultrapassado."}</small></p></div></article>
    <article className="surface recent-card"><div className="card-heading recent-heading"><div><h2>Últimas transações</h2><p>Movimentações mais recentes</p></div><button onClick={() => navigate("transactions")}>Ver todas <ArrowRight /></button></div><TransactionTable rows={[...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)} compact edit={edit} requestDelete={requestDelete} hidden={hidden} /></article></section></div>
}

function TransactionsView({ items, query, setQuery, edit, requestDelete, exportCsv, importCsv, hidden }: { items: Transaction[]; query: string; setQuery: (v: string) => void; edit: (i: Transaction) => void; requestDelete: (i: Transaction) => void; exportCsv: () => void; importCsv: (file: File) => void; hidden: boolean }) {
  const categories = useCategories()
  const [type, setType] = useState("all"), [status, setStatus] = useState("all"), [category, setCategory] = useState("all"), [account, setAccount] = useState("all"), [sort, setSort] = useState("recent")
  const accounts = Array.from(new Set(items.map((item) => item.account)))
  const rows = items.filter((i) => `${i.description} ${i.merchant || ""} ${i.category} ${i.account}`.toLowerCase().includes(query.toLowerCase()) && (type === "all" || i.type === type) && (status === "all" || i.status === status) && (category === "all" || i.category === category) && (account === "all" || i.account === account)).sort((a, b) => sort === "value" ? b.amount - a.amount : sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date))
  const activeFilters = [type, status, category, account].filter((value) => value !== "all").length + (query ? 1 : 0)
  const clearFilters = () => { setQuery(""); setType("all"); setStatus("all"); setCategory("all"); setAccount("all"); setSort("recent") }
  return <div className="view-stack"><section className="surface transactions-panel"><div className="panel-title-row"><div><h2>Explorador de transações</h2><p>{rows.length} movimentações encontradas com busca por estabelecimento, conta e categoria</p></div><div className="panel-actions"><input id="csv-import" hidden type="file" accept=".csv,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) importCsv(file); e.target.value = "" }} /><Button variant="outline" onClick={() => document.getElementById("csv-import")?.click()}><Upload /> Importar</Button><Button variant="outline" onClick={exportCsv}><Download /> Exportar</Button></div></div><div className="filters-row advanced-filters"><div className="search-field"><Search /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar estabelecimento, categoria ou conta..." /></div><Select value={account} onValueChange={setAccount}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as contas</SelectItem>{accounts.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as categorias</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os tipos</SelectItem><SelectItem value="expense">Despesas</SelectItem><SelectItem value="income">Receitas e estornos</SelectItem></SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os status</SelectItem><SelectItem value="paid">Pagos</SelectItem><SelectItem value="pending">Pendentes</SelectItem></SelectContent></Select><Select value={sort} onValueChange={setSort}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">Mais recentes</SelectItem><SelectItem value="oldest">Mais antigas</SelectItem><SelectItem value="value">Maior valor</SelectItem></SelectContent></Select></div><div className="filter-summary"><span>{activeFilters ? `${activeFilters} filtro${activeFilters > 1 ? "s" : ""} ativo${activeFilters > 1 ? "s" : ""}` : "Mostrando todas as movimentações"}</span>{activeFilters > 0 && <button onClick={clearFilters}>Limpar filtros</button>}</div>{rows.length ? <TransactionTable rows={rows} edit={edit} requestDelete={requestDelete} hidden={hidden} /> : <div className="empty-state"><Search /><h3>Nenhuma transação encontrada</h3><p>Altere a busca ou os filtros selecionados.</p><Button variant="outline" onClick={clearFilters}>Limpar filtros</Button></div>}</section></div>
}


function CategoriesView({ items, month, budgets, hidden, createCategory, renameCategory, deleteCategory, saveBudget }: { items: Transaction[]; month: MonthKey; budgets: Record<string, number>; hidden: boolean; createCategory: (name: string) => Promise<{ name: string } | null>; renameCategory: (name: string, newName: string) => Promise<{ name: string } | null>; deleteCategory: (name: string) => Promise<unknown>; saveBudget: (name: string, limit: number) => Promise<unknown> }) {
  const categories = useCategories()
  const [expanded, setExpanded] = useState<string | null>(null), [dialogOpen, setDialogOpen] = useState(false), [original, setOriginal] = useState<string | undefined>(), [newName, setNewName] = useState(""), [budgetText, setBudgetText] = useState(""), [saving, setSaving] = useState(false), [deleting, setDeleting] = useState<string | null>(null)
  const [year, monthNumber] = month.split("-").map(Number), previousDate = new Date(year, monthNumber - 2, 1), previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`
  const currentRows = items.filter((item) => item.type === "expense" && item.kind !== "transfer" && item.status === "paid" && item.date.startsWith(month)), previousRows = items.filter((item) => item.type === "expense" && item.kind !== "transfer" && item.status === "paid" && item.date.startsWith(previousKey))
  const total = currentRows.reduce((sum, item) => sum + item.amount, 0)
  // Categorias cadastradas mais qualquer categoria que ainda tenha gasto ou orçamento, para o total sempre fechar com os cartões.
  const names = [...categories.filter((name) => name !== "Receita"), ...Array.from(new Set([...currentRows.map((item) => item.category), ...Object.keys(budgets)])).filter((name) => name && name !== "Receita" && !categories.includes(name))]
  const rows = names.map((name) => { const matches = currentRows.filter((item) => item.category === name), value = matches.reduce((sum, item) => sum + item.amount, 0), previous = previousRows.filter((item) => item.category === name).reduce((sum, item) => sum + item.amount, 0), variation = previous ? Math.round((value - previous) / previous * 100) : value ? 100 : 0; return { name, matches, value, previous, variation, limit: budgets[name] || 0 } }).sort((a, b) => b.value - a.value)
  const totalBudget = rows.reduce((sum, row) => sum + row.limit, 0)
  // "Outros" é categoria do sistema: não muda de nome nem sai, mas o orçamento dela pode ser ajustado.
  const locked = original !== undefined && systemCategories.includes(original)
  const openDialog = (name?: string) => { setOriginal(name); setNewName(name || ""); setBudgetText(name && budgets[name] ? String(budgets[name]).replace(".", ",") : ""); setDialogOpen(true) }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const clean = locked ? original! : newName.trim().replace(/\s+/g, " ")
    if (!clean) return toast.error("Informe o nome da categoria.")
    const limit = budgetText.trim() ? parseCsvAmount(budgetText) : undefined
    if (limit !== undefined && !(limit > 0)) return toast.error("Informe um limite válido.")
    const created = original === undefined, renamed = !created && clean !== original, budgetChanged = limit !== undefined && limit !== (budgets[original ?? ""] || 0)
    if (!created && !renamed && !budgetChanged) { setDialogOpen(false); return }
    if ((created || renamed) && categories.some((name) => name !== original && normalizeSpeech(name) === normalizeSpeech(clean))) return toast.error("Já existe uma categoria com esse nome.")
    setSaving(true)
    let done: unknown = true
    if (created) done = await createCategory(clean)
    else if (renamed) done = await renameCategory(original!, clean)
    if (done && budgetChanged) done = await saveBudget(clean, limit!)
    setSaving(false)
    if (!done) return
    if (renamed && expanded === original) setExpanded(clean)
    setDialogOpen(false); toast.success(created ? "Categoria criada." : renamed ? "Categoria atualizada." : "Orçamento atualizado.")
  }
  const confirmDelete = async () => { if (!deleting) return; const target = deleting; setDeleting(null); const ok = await deleteCategory(target); if (ok !== null) toast.success("Categoria excluída.") }
  const affected = deleting ? items.filter((item) => item.category === deleting).length : 0
  return <div className="view-stack"><section className="surface category-overview"><div className="panel-title-row"><div><h2>Análise por categoria</h2><p>Cada real da conta, com comparação ao mês anterior, detalhes das compras e o orçamento de cada categoria</p></div><div className="panel-actions"><span className="period-chip"><CalendarDays /> {monthLabels[month] || monthLabel(month)}</span><Button className="primary-button" onClick={() => openDialog()}><Plus /> Nova categoria</Button></div></div><div className="category-summary"><div><span>Total analisado</span><strong>{hidden ? "R$ ••••" : money.format(total)}</strong></div><div><span>Orçamento do mês</span><strong>{totalBudget ? (hidden ? "R$ ••••" : money.format(totalBudget)) : "Não definido"}</strong>{totalBudget > 0 && <small>{Math.round(total / totalBudget * 100)}% utilizado</small>}</div><div><span>Categorias ativas</span><strong>{rows.filter((row) => row.value > 0).length}</strong></div><div><span>Compras no período</span><strong>{currentRows.length}</strong></div></div></section><section className="category-detail-grid">{rows.map((row) => {
    const share = total ? Math.round(row.value / total * 100) : 0, isOpen = expanded === row.name, editable = categories.includes(row.name) && !systemCategories.includes(row.name), usage = row.limit ? row.value / row.limit * 100 : 0
    return <article className={`surface category-detail-card ${isOpen ? "expanded" : ""}`} key={row.name}><div className="category-card-head"><button className="category-card-button" onClick={() => setExpanded(isOpen ? null : row.name)} aria-expanded={isOpen}><span className="category-card-icon" style={{ color: categoryColor(row.name), background: `${categoryColor(row.name)}18` }}><ChartNoAxesCombined /></span><span className="category-card-copy"><small>{row.variation > 0 ? `+${row.variation}%` : `${row.variation}%`} vs. mês passado</small><strong>{row.name}</strong></span><ChevronDown className="category-card-chevron" /></button>{editable && <><Button size="icon" variant="ghost" className="category-edit" aria-label={`Editar categoria ${row.name}`} onClick={() => openDialog(row.name)}><Pencil /></Button><Button size="icon" variant="ghost" className="category-remove" aria-label={`Excluir categoria ${row.name}`} onClick={() => setDeleting(row.name)}><Trash2 /></Button></>}</div><div className="category-card-metrics"><div><span>Total</span><strong>{hidden ? "••••" : money.format(row.value)}</strong></div><div><span>Participação</span><strong>{share}%</strong></div><div><span>Compras</span><strong>{row.matches.length}</strong></div></div><Progress value={share} className="category-share-progress" />
      <div className="category-budget"><div className="category-budget-head"><span>Orçamento mensal</span><button onClick={() => openDialog(row.name)}>{row.limit ? "Editar limite" : "Definir limite"}</button></div>{row.limit ? <><div className="category-budget-values"><strong>{hidden ? "••••" : money.format(row.value)}</strong><small>de {hidden ? "••••" : money.format(row.limit)}</small></div><Progress value={Math.min(100, usage)} className={`category-progress ${usage > 85 ? "danger-progress" : ""}`} /><div className="budget-row-meta"><span>{Math.round(usage)}% utilizado</span><span>{hidden ? "Oculto" : row.value > row.limit ? `${money.format(row.value - row.limit)} acima do limite` : `${money.format(row.limit - row.value)} disponível`}</span></div></> : <p>Sem limite definido para esta categoria.</p>}</div>
      {isOpen && <div className="category-card-details">{row.matches.length ? row.matches.slice(0, 5).map((item) => <div key={item.id}><span><strong>{item.description}</strong><small>{shortDate(item.date)} • {item.account}</small></span><strong>{hidden ? "••••" : money.format(item.amount)}</strong></div>) : <p>Nenhum gasto nesta categoria no período.</p>}</div>}</article>
  })}</section><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="transaction-dialog"><DialogHeader><DialogTitle>{original ? "Editar categoria" : "Nova categoria"}</DialogTitle><DialogDescription>{locked ? "Esta é uma categoria do sistema: só o orçamento mensal pode ser alterado." : original ? "As movimentações, recorrências e o orçamento dessa categoria passam a usar o novo nome." : "Crie uma categoria para organizar suas movimentações e, se quiser, já defina quanto pode gastar nela por mês."}</DialogDescription></DialogHeader><form className="simple-form" onSubmit={save}><label className="field"><span>Nome da categoria</span><Input required autoFocus={!locked} disabled={locked} maxLength={40} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ex.: Investimentos" /></label><label className="field"><span>Orçamento mensal (opcional)</span><Input autoFocus={locked} inputMode="decimal" value={budgetText} onChange={(event) => setBudgetText(event.target.value)} placeholder="0,00" /></label><DialogFooter><Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button className="primary-button" type="submit" disabled={saving}>{saving ? "Salvando..." : original ? "Salvar alterações" : "Criar categoria"}</Button></DialogFooter></form></DialogContent></Dialog><ConfirmDeleteDialog target={Boolean(deleting)} label="esta categoria" description={`“${deleting || "Categoria"}” será removida. ${affected ? `${affected} movimentaç${affected === 1 ? "ão passa" : "ões passam"} para “Outros”` : "Nenhuma movimentação usa essa categoria"}; as recorrências dela também passam para “Outros” e o orçamento dessa categoria é apagado.`} close={() => setDeleting(null)} confirm={confirmDelete} /></div>
}

function RecurringView({ recurring, setRecurring, items, hidden }: { recurring: RecurringData[]; setRecurring: Dispatch<SetStateAction<RecurringData[]>>; items: Transaction[]; hidden: boolean }) {
  const categories = useCategories()
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [category, setCategory] = useState("Assinaturas"), [amount, setAmount] = useState(""), [day, setDay] = useState(String(Math.min(28, currentDate.getDate()))), [deleting, setDeleting] = useState<RecurringData | null>(null)
  const save = (e: FormEvent) => { e.preventDefault(); const value = Number(amount.replace(",", ".")), dayNumber = Math.floor(Number(day)); if (!name.trim() || !Number.isFinite(value)) return toast.error("Preencha os dados da recorrência."); if (!(dayNumber >= 1 && dayNumber <= 28)) return toast.error("Informe um dia do mês entre 1 e 28."); setRecurring((r) => [...r, { id: Date.now(), name: name.trim(), category, amount: value, type: "expense", next: "Próximo mês", active: true, day: dayNumber }]); setOpen(false); setName(""); setAmount(""); toast.success("Recorrência criada.") }
  // Custo é o que sai do bolso: recorrência de receita (salário, aluguel recebido) aparece na lista, mas não entra nas contas.
  const expenses = recurring.filter((item) => item.type !== "income"), active = expenses.filter((item) => item.active), monthly = active.reduce((sum, item) => sum + item.amount, 0), annual = monthly * 12, average = active.length ? monthly / active.length : 0
  const known = new Set(recurring.map((item) => item.name.toLowerCase())), suggestion = items.find((item) => item.type === "expense" && (item.recurring || item.category === "Assinaturas") && !known.has(item.description.toLowerCase()))
  const byCategory = Object.entries(active.reduce<Record<string, number>>((result, item) => ({ ...result, [item.category]: (result[item.category] || 0) + item.amount }), {})).sort((a, b) => b[1] - a[1])
  return <div className="view-stack"><section className="subscription-kpis"><article className="surface"><span>Serviços ativos</span><strong>{active.length}</strong><small>{expenses.length - active.length} pausado{expenses.length - active.length === 1 ? "" : "s"}</small></article><article className="surface"><span>Custo mensal</span><strong>{hidden ? "R$ ••••" : money.format(monthly)}</strong><small>Média de {hidden ? "••••" : money.format(average)} por serviço</small></article><article className="surface"><span>Custo anual</span><strong>{hidden ? "R$ ••••" : money.format(annual)}</strong><small>Projeção dos próximos 12 meses</small></article></section>{suggestion && <section className="surface subscription-suggestion"><span><Sparkles /></span><div><small>Sugestão encontrada</small><strong>{suggestion.description} parece ser uma assinatura</strong><p>{hidden ? "Valor oculto" : money.format(suggestion.amount)} em {suggestion.account}. Confirme para acompanhar como recorrência.</p></div><Button variant="outline" onClick={() => { setRecurring((all) => [...all, { id: Date.now(), name: suggestion.description, category: suggestion.category, amount: suggestion.amount, type: "expense", next: "Próximo mês", active: true, day: Math.min(28, Number(suggestion.date.slice(8)) || 1) }]); toast.success("Assinatura adicionada ao acompanhamento.") }}><Check /> Confirmar assinatura</Button></section>}<section className="subscription-layout"><article className="surface recurring-panel"><div className="panel-title-row"><div><h2>Assinaturas e serviços</h2><p>Próximas cobranças, cartão usado e custo mensal</p></div><Button className="primary-button" onClick={() => setOpen(true)}><Plus /> Nova recorrência</Button></div>{recurring.length ? <div className="recurring-list subscription-list">{recurring.map((r) => <article key={r.id}><span className="recurring-icon"><RefreshCcw /></span><div className="recurring-main"><strong>{r.name}</strong><Badge category={r.category} /></div><div><span>{r.type === "income" ? "Próximo recebimento" : "Próxima cobrança"}</span><strong>{r.next}</strong></div><strong>{hidden ? "R$ ••••" : `${r.type === "income" ? "+ " : ""}${money.format(r.amount)}/mês`}</strong><div className="row-actions"><Switch checked={r.active} onCheckedChange={(isActive) => setRecurring((all) => all.map((item) => item.id === r.id ? { ...item, active: isActive } : item))} /><Button size="icon" variant="ghost" aria-label={`Excluir ${r.name}`} onClick={() => setDeleting(r)}><Trash2 /></Button></div></article>)}</div> : <div className="empty-state"><RefreshCcw /><h3>Nenhuma recorrência cadastrada</h3><p>Adicione contas e assinaturas que se repetem todos os meses.</p></div>}</article><aside className="surface subscription-distribution"><div className="card-heading"><div><h2>Distribuição mensal</h2><p>Onde estão seus custos fixos</p></div></div><div>{byCategory.map(([label, value]) => <article key={label}><span><i style={{ background: categoryColor(label) }} />{label}</span><strong>{hidden ? "••••" : money.format(value)}</strong><Progress value={monthly ? value / monthly * 100 : 0} /></article>)}</div><div className="subscription-tip"><Lightbulb /><p>Revisar assinaturas pouco usadas pode liberar dinheiro para suas metas.</p></div></aside></section><Dialog open={open} onOpenChange={setOpen}><DialogContent className="transaction-dialog"><DialogHeader><DialogTitle>Nova recorrência</DialogTitle><DialogDescription>Cadastre uma cobrança que se repete todos os meses.</DialogDescription></DialogHeader><form className="simple-form" onSubmit={save}><label className="field"><span>Nome</span><Input required value={name} onChange={(e) => setName(e.target.value)} /></label><label className="field"><span>Categoria</span><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{categories.filter((c) => c !== "Receita").map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></label><label className="field"><span>Valor mensal</span><Input required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><label className="field"><span>Dia do mês da cobrança (1 a 28)</span><Input required type="number" min={1} max={28} inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} /></label><DialogFooter><Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancelar</Button><Button className="primary-button" type="submit">Criar recorrência</Button></DialogFooter></form></DialogContent></Dialog><ConfirmDeleteDialog target={Boolean(deleting)} label="esta recorrência" description={`“${deleting?.name || "Recorrência"}” deixará de aparecer nos próximos lançamentos.`} close={() => setDeleting(null)} confirm={() => { if (!deleting) return; setRecurring((all) => all.filter((item) => item.id !== deleting.id)); setDeleting(null); toast.success("Recorrência excluída.") }} /></div>
}

function GoalsView({ goals, setGoals, hidden }: { goals: GoalData[]; setGoals: Dispatch<SetStateAction<GoalData[]>>; hidden: boolean }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [saved, setSaved] = useState(""), [target, setTarget] = useState(""), [deadline, setDeadline] = useState(""), [deleting, setDeleting] = useState<GoalData | null>(null)
  const save = (e: FormEvent) => { e.preventDefault(); const s = Number(saved.replace(",", ".")), t = Number(target.replace(",", ".")); if (!name.trim() || !Number.isFinite(s) || !Number.isFinite(t) || t <= 0) return toast.error("Preencha os dados da meta."); setGoals((g) => [...g, { id: Date.now(), name: name.trim(), saved: s, target: t, deadline: deadline || "Sem prazo", color: "#22c55e" }]); setOpen(false); setName(""); setSaved(""); setTarget(""); setDeadline(""); toast.success("Meta criada.") }
  return <div className="view-stack"><section className="goals-grid">{goals.map((g) => { const p = Math.min(100, g.saved / g.target * 100); return <article className="surface goal-card" key={g.id}><div className="goal-card-top"><div className="goal-icon" style={{ color: g.color, background: g.color + "14" }}><Goal /></div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações de ${g.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="dark-menu"><DropdownMenuItem onClick={() => { const add = Math.min(g.target - g.saved, 100); if (add <= 0) return toast.info("Esta meta já foi concluída."); setGoals((all) => all.map((item) => item.id === g.id ? { ...item, saved: item.saved + add } : item)); toast.success(`${money.format(add)} adicionados à meta.`) }}><PiggyBank /> Adicionar R$ 100</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setDeleting(g)}><Trash2 /> Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><p>{g.deadline}</p><h3>{g.name}</h3><strong>{hidden ? "R$ ••••" : money.format(g.saved)} <small>de {hidden ? "••••" : money.format(g.target)}</small></strong><Progress value={p} className="goal-progress" /><div><span>{Math.round(p)}% concluído</span><span>{hidden ? "Valores ocultos" : `Faltam ${money.format(Math.max(0, g.target - g.saved))}`}</span></div></article> })}<button className="surface add-goal" onClick={() => setOpen(true)}><Plus /><strong>Criar nova meta</strong><span>Transforme seus planos em objetivos reais</span></button></section>{goals.length === 0 && <div className="surface empty-state"><Target /><h3>Nenhuma meta criada</h3><p>Crie uma meta para acompanhar seu progresso financeiro.</p></div>}<Dialog open={open} onOpenChange={setOpen}><DialogContent className="transaction-dialog"><DialogHeader><DialogTitle>Nova meta financeira</DialogTitle><DialogDescription>Defina um objetivo, valor e prazo.</DialogDescription></DialogHeader><form className="simple-form" onSubmit={save}><label className="field"><span>Nome da meta</span><Input required value={name} onChange={(e) => setName(e.target.value)} /></label><div className="form-grid"><label className="field"><span>Valor já guardado</span><Input required value={saved} onChange={(e) => setSaved(e.target.value)} inputMode="decimal" /></label><label className="field"><span>Valor objetivo</span><Input required value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" /></label></div><label className="field"><span>Prazo</span><Input value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="Ex.: Dezembro 2027" /></label><DialogFooter><Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancelar</Button><Button className="primary-button" type="submit">Criar meta</Button></DialogFooter></form></DialogContent></Dialog><ConfirmDeleteDialog target={Boolean(deleting)} label="esta meta" description={`“${deleting?.name || "Meta"}” e seu progresso serão removidos.`} close={() => setDeleting(null)} confirm={() => { if (!deleting) return; setGoals((all) => all.filter((item) => item.id !== deleting.id)); setDeleting(null); toast.success("Meta excluída.") }} /></div>
}

function ReportsView({ items, exportCsv, hidden }: { items: Transaction[]; exportCsv: () => void; hidden: boolean }) {
  const show = (value: number) => hidden ? "R$ ••••" : money.format(value)
  const reportData = [...monthOptions].reverse().map((key) => { const rows = items.filter((item) => item.date.startsWith(key) && item.status === "paid" && item.kind !== "transfer"); return { month: monthLabel(key, true), income: rows.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0), expenses: rows.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0) } })
  const income = reportData.reduce((sum, row) => sum + row.income, 0), expenses = reportData.reduce((sum, row) => sum + row.expenses, 0), saved = income - expenses
  const previous = reportData.at(-2)?.expenses || 0, current = reportData.at(-1)?.expenses || 0, variation = previous ? Math.round((current - previous) / previous * 100) : 0
  const shareReport = async () => { const text = `Resumo Synch Cash: ${money.format(income)} em receitas, ${money.format(expenses)} em despesas e ${money.format(saved)} de resultado em seis meses.`; if (navigator.share) await navigator.share({ title: "Resumo financeiro — Synch Cash", text }).catch(() => undefined); else { await navigator.clipboard.writeText(text); toast.success("Resumo copiado para compartilhar.") } }
  return <div className="view-stack"><section className="report-kpis"><article className="surface"><span>Receitas em 6 meses</span><strong>{show(income)}</strong><small><TrendingUp /> Calculado pelas movimentações</small></article><article className="surface"><span>Despesas em 6 meses</span><strong>{show(expenses)}</strong><small className={variation <= 0 ? "positive" : "negative"}><TrendingDown /> {variation > 0 ? "+" : ""}{variation}% no mês atual</small></article><article className="surface"><span>Economia acumulada</span><strong className={saved >= 0 ? "positive" : "negative"}>{show(saved)}</strong><small>{income ? Math.round(saved / income * 100) : 0}% das receitas</small></article></section><section className="surface report-chart-card printable-report"><div className="panel-title-row"><div><h2>Receitas x despesas</h2><p>Comparativo calculado dos últimos seis meses</p></div><div className="panel-actions"><Button variant="outline" onClick={shareReport}><Send /> Compartilhar</Button><Button variant="outline" onClick={() => window.print()}><FileChartColumn /> Salvar PDF</Button><Button variant="outline" onClick={exportCsv}><Download /> CSV</Button></div></div>{items.length ? <div className="report-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={reportData}><CartesianGrid stroke="#1b1e22" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#777e87" }} /><YAxis hide={hidden} axisLine={false} tickLine={false} tick={{ fill: "#777e87" }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} /><ChartTooltip contentStyle={{ background: "#0b0d0f", border: "1px solid #282c31", borderRadius: 10 }} formatter={(value) => hidden ? "Oculto" : money.format(Number(value))} /><Bar dataKey="income" name="Receitas" fill="#22c55e" radius={[5, 5, 0, 0]} /><Bar dataKey="expenses" name="Despesas" fill="#374151" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="empty-state"><FileChartColumn /><h3>Ainda não há dados para o relatório</h3><p>As análises aparecerão após o primeiro lançamento.</p></div>}</section></div>
}

const spokenNumbers: Record<string, number> = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 }
const normalizeSpeech = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
const parseAssistantAmount = (text: string) => {
  const normalized = normalizeSpeech(text)
  const numeric = normalized.match(/r\$\s*(\d[\d.,]*)/i) || normalized.match(/(\d[\d.,]*)\s*(?:reais?|real)\b/i) || normalized.match(/\b(\d+(?:[.,]\d{1,2})?)\b/)
  if (numeric) {
    const raw = numeric[1]
    const value = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? Number(raw.replace(/\./g, "")) : Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  const beforeCurrency = normalized.split(/\breais?\b/)[0].split(/\s+/).slice(-12)
  let total = 0, current = 0, found = false
  beforeCurrency.forEach((word) => {
    if (word === "e") return
    if (word === "mil") { total += Math.max(1, current) * 1000; current = 0; found = true; return }
    if (spokenNumbers[word] !== undefined) { current += spokenNumbers[word]; found = true }
  })
  return found ? total + current : 0
}
const assistantDate = (text: string) => {
  const normalized = normalizeSpeech(text), date = new Date()
  if (normalized.includes("anteontem")) date.setDate(date.getDate() - 2)
  else if (normalized.includes("ontem")) date.setDate(date.getDate() - 1)
  else if (normalized.includes("amanha")) date.setDate(date.getDate() + 1)
  const fullDate = normalized.match(/\b(\d{1,2})[\/]([01]?\d)(?:[\/](\d{2,4}))?\b/)
  if (fullDate) { date.setDate(Number(fullDate[1])); date.setMonth(Number(fullDate[2]) - 1); if (fullDate[3]) date.setFullYear(Number(fullDate[3].length === 2 ? `20${fullDate[3]}` : fullDate[3])) }
  else { const day = normalized.match(/\bdia\s+(\d{1,2})\b/); if (day) date.setDate(Number(day[1])) }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
const assistantCategory = (text: string, type: "expense" | "income") => {
  if (type === "income") return "Receita"
  const normalized = normalizeSpeech(text)
  if (/(mercado|supermercado|restaurante|delivery|ifood|lanche|comida|padaria|almoco|jantar)/.test(normalized)) return "Alimentação"
  if (/(uber|\b99\b|combustivel|gasolina|posto|onibus|metro|transporte|estacionamento|pedagio)/.test(normalized)) return "Transporte"
  if (/(aluguel|condominio|energia|luz|agua|casa|moradia)/.test(normalized)) return "Moradia"
  if (/(netflix|spotify|internet|assinatura|celular|prime|disney|software)/.test(normalized)) return "Assinaturas"
  if (/(cinema|academia|viagem|lazer|jogo|show|passeio)/.test(normalized)) return "Lazer"
  return "Outros"
}
const assistantDescription = (text: string, type: "expense" | "income", category: string) => {
  const normalized = normalizeSpeech(text)
  const names: [RegExp, string][] = [[/supermercado/, "Supermercado"], [/mercado/, "Mercado"], [/restaurante|almoco|jantar/, "Restaurante"], [/ifood|delivery/, "Delivery"], [/netflix/, "Netflix"], [/spotify/, "Spotify"], [/academia/, "Academia"], [/aluguel/, "Aluguel"], [/uber/, "Uber"], [/gasolina|combustivel|posto/, "Combustível"], [/salario/, "Salário"], [/freelance/, "Freelance"], [/internet/, "Internet"], [/energia|luz/, "Energia"], [/farmacia|remedio/, "Farmácia"], [/cinema/, "Cinema"]]
  return names.find(([pattern]) => pattern.test(normalized))?.[1] || (type === "income" ? "Receita" : category)
}
const inferAssistantDraft = (text: string, accountNames: string[]): VoiceDraft => {
  const normalized = normalizeSpeech(text)
  const type: "expense" | "income" = /(recebi|ganhei|entrou|entrada|salario|renda|freelance|pagamento recebido|vendi)/.test(normalized) ? "income" : "expense"
  const category = assistantCategory(text, type)
  const account = accountNames.find((name) => { const normalizedName = normalizeSpeech(name); return normalized.includes(normalizedName) || normalizedName.split(" ").some((part) => part.length > 3 && normalized.includes(part)) }) || accountNames[0] || "Carteira"
  const installmentMatch = normalized.match(/(?:em\s+)?(\d+)\s*(?:x|vezes|parcelas)/)
  const amount = parseAssistantAmount(text)
  const explicitSignals = [amount > 0, category !== "Outros", accountNames.some((name) => normalized.includes(normalizeSpeech(name))), /(hoje|ontem|amanha|dia\s+\d)/.test(normalized)]
  return { description: assistantDescription(text, type, category), amount: amount ? String(amount).replace(".", ",") : "", type, category, date: assistantDate(text), account, status: /(pendente|a pagar|vencimento|vence)/.test(normalized) ? "pending" : "paid", installments: installmentMatch ? Math.max(1, Number(installmentMatch[1])) : 1, recurring: /(recorrente|todo mes|mensal|assinatura fixa)/.test(normalized), confidence: 72 + explicitSignals.filter(Boolean).length * 6 }
}
const splitAssistantTransactions = (text: string) => normalizeSpeech(text).split(/\s+(?:e tambem|e depois|depois|e)\s+(?=(?:(?:gastei|paguei|comprei|recebi|ganhei|entrou)\s+)?(?:r\$\s*)?\d)/i).map((part) => part.trim()).filter(Boolean)
// Uma frase por vez (com uma pausa curta entre elas) soa muito mais natural do que jogar o texto
// inteiro pro navegador de uma vez: cada engine de voz tende a "achatar" a entonação num bloco só.
const splitSentences = (text: string) => text.match(/[^.!?]+[.!?]*(?:\s+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [text]

function AssistantExperience({ items, budgets, hidden, setItems, setBudgets, recurring, setRecurring, goals, setGoals, accounts, month, userName }: { items: Transaction[]; budgets: Record<string, number>; hidden: boolean; setItems: Dispatch<SetStateAction<Transaction[]>>; setBudgets: Dispatch<SetStateAction<Record<string, number>>>; recurring: RecurringData[]; setRecurring: Dispatch<SetStateAction<RecurringData[]>>; goals: GoalData[]; setGoals: Dispatch<SetStateAction<GoalData[]>>; accounts: Account[]; month: MonthKey; userName: string }) {
  const categories = useCategories()
  // O assistente deduz categorias por palavras-chave com nomes fixos ("Alimentação", "Moradia"...); se a pessoa renomeou ou excluiu uma delas, cai em "Outros".
  const knownCategory = (name: string) => categories.includes(name) ? name : "Outros"
  const knownDraft = (draft: VoiceDraft): VoiceDraft => ({ ...draft, category: knownCategory(draft.category) })
  const firstName = userName.trim().split(/\s+/)[0] || "você", hour = new Date().getHours(), greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"
  const initialMessages: AssistantMessage[] = [{ id: 1, role: "assistant", text: `${greeting}, ${firstName}! Eu sou a Synch, sua assistente financeira. Pode conversar comigo naturalmente — eu posso explicar seus números, tirar dúvidas e preparar ações para você confirmar. Como posso ajudar agora?`, time: "Agora" }]
  const [conversation, setConversation] = useStoredState<AssistantMessage[]>("synch-cash-assistant-history-v4", initialMessages)
  const [message, setMessage] = useState(""), [pending, setPending] = useState<AssistantAction | null>(null), [processing, setProcessing] = useState(false)
  const [listening, setListening] = useState(false), [speaking, setSpeaking] = useState(false), [voiceSupported] = useState(() => { if (typeof window === "undefined") return false; const w = window as typeof window & { SpeechRecognition?: VoiceRecognitionConstructor; webkitSpeechRecognition?: VoiceRecognitionConstructor }; return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition) }), [voiceTranscript, setVoiceTranscript] = useState("")
  const [voiceConfidence, setVoiceConfidence] = useState<number | null>(null), [voiceError, setVoiceError] = useState("")
  const [voiceOutput, setVoiceOutput] = useStoredState("synch-cash-assistant-speech", true), [voiceStyle, setVoiceStyle] = useStoredState("synch-cash-voice-style", "natural"), [voiceId, setVoiceId] = useStoredState("synch-cash-voice-id", "auto")
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>(() => typeof window === "undefined" ? [] : window.speechSynthesis?.getVoices() || [])
  const [lastUndo, setLastUndo] = useState<AssistantUndo | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 1000), [voiceMode, setVoiceMode] = useState(false), [voiceSeconds, setVoiceSeconds] = useState(0)
  const [activity, setActivity] = useStoredState<AssistantActivity[]>("synch-cash-assistant-activity-v1", [])
  const recognitionRef = useRef<VoiceRecognition | null>(null), utteranceRef = useRef<SpeechSynthesisUtterance | null>(null), messagesEndRef = useRef<HTMLDivElement | null>(null), idCounterRef = useRef(100000), speakTokenRef = useRef(0)
  const nextId = () => { idCounterRef.current += 1; return idCounterRef.current }
  const accountNames = accounts.map((account) => account.name)
  const currentItems = items.filter((item) => item.date.startsWith(month) && item.kind !== "transfer"), expenses = currentItems.filter((item) => item.type === "expense" && item.status === "paid"), incomes = currentItems.filter((item) => item.type === "income" && item.status === "paid")
  const spent = expenses.reduce((sum, item) => sum + item.amount, 0), income = incomes.reduce((sum, item) => sum + item.amount, 0), totalBudget = Object.values(budgets).reduce((sum, value) => sum + value, 0)
  const categoryTotals = expenses.reduce<Record<string, number>>((result, item) => ({ ...result, [item.category]: (result[item.category] || 0) + item.amount }), {}), top = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]
  const previousDate = new Date(`${month}-01T12:00:00`); previousDate.setMonth(previousDate.getMonth() - 1); const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`
  const previousSpent = items.filter((item) => item.date.startsWith(previousKey) && item.type === "expense" && item.status === "paid" && item.kind !== "transfer").reduce((sum, item) => sum + item.amount, 0)
  const formatValue = (value: number) => hidden ? "valor oculto" : money.format(value)
  const nowLabel = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  const speechReadyText = (text: string) => text
    .replace(/R\$\s*([\d.]+),([0-9]{2})/g, (_, whole: string, cents: string) => `${Number(whole.replace(/\./g, ""))} reais${cents !== "00" ? ` e ${Number(cents)} centavos` : ""}`)
    .replace(/(\d+)%/g, "$1 por cento").replace(/\bPIX\b/gi, "pícs").replace(/[“”]/g, "")
    // travessão e aspas de vírgula soam como um tropeço na maioria das vozes -- uma vírgula real da uma pausa natural.
    .replace(/[–—]/g, ",").replace(/•|→/g, ", ").replace(/\s+/g, " ").trim()
  // "Melhor disponível": prioriza vozes que o proprio nome ja avisa que sao de qualidade (neural/online,
  // enhanced/premium) antes das vozes do sistema (em geral mais robóticas, tipo eSpeak/SAPI clássico).
  const preferredVoice = () => {
    const portuguese = availableVoices.filter((voice) => /^pt(-|_)/i.test(voice.lang))
    if (voiceId !== "auto") return availableVoices.find((voice) => voice.voiceURI === voiceId) || portuguese[0]
    const priority = [/neural|online.*natural|natural.*online/i, /enhanced|premium/i, /google.*portugu/i, /luciana/i, /francisca/i, /thalita/i, /maria/i, /antonio/i, /microsoft.*portugu/i]
    return priority.map((pattern) => portuguese.find((voice) => pattern.test(voice.name))).find(Boolean) || portuguese.find((voice) => /pt[-_]br/i.test(voice.lang)) || portuguese[0]
  }
  const stopSpeaking = () => { speakTokenRef.current += 1; window.speechSynthesis?.cancel(); utteranceRef.current = null; setSpeaking(false) }
  // Fala frase por frase (não o texto inteiro de uma vez): dá uma pausa curta e uma variação pequena
  // de ritmo/tom entre elas, porque ninguém fala duas frases seguidas com a entonação idêntica -- é
  // essa repetição perfeita que faz a voz do navegador parecer robótica mesmo numa voz boa.
  const speak = (text: string, force = false) => {
    if ((!voiceOutput && !force) || !("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    const token = ++speakTokenRef.current
    const base = voiceStyle === "calm" ? { rate: .92, pitch: 1.03 } : voiceStyle === "direct" ? { rate: 1.08, pitch: .97 } : { rate: 1, pitch: 1 }
    const voice = preferredVoice(), sentences = splitSentences(speechReadyText(text))
    const speakAt = (index: number) => {
      if (token !== speakTokenRef.current) return
      if (index >= sentences.length) { utteranceRef.current = null; setSpeaking(false); return }
      try {
        const utterance = new SpeechSynthesisUtterance(sentences[index])
        utterance.lang = "pt-BR"
        utterance.rate = Math.min(1.3, Math.max(.7, base.rate + (Math.random() - .5) * .06))
        utterance.pitch = Math.min(1.6, Math.max(.6, base.pitch + (Math.random() - .5) * .08))
        utterance.volume = 1
        if (voice) utterance.voice = voice
        utterance.onstart = () => setSpeaking(true)
        utterance.onerror = () => { if (token === speakTokenRef.current) { utteranceRef.current = null; setSpeaking(false) } }
        utterance.onend = () => { if (token === speakTokenRef.current) window.setTimeout(() => speakAt(index + 1), index + 1 < sentences.length ? 120 : 0) }
        utteranceRef.current = utterance
        window.speechSynthesis.speak(utterance)
      } catch { if (token === speakTokenRef.current) { utteranceRef.current = null; setSpeaking(false) } } // navegador recusou a voz escolhida -- para em silêncio em vez de travar a conversa
    }
    speakAt(0)
  }
  const assistantReply = (text: string) => { const id = nextId(); setConversation((current) => [...current, { id, role: "assistant" as const, text, time: nowLabel() }].slice(-50)); speak(text) }
  const userMessage = (text: string, source: "text" | "voice") => { const id = nextId(); setConversation((current) => [...current, { id, role: "user" as const, text, source, time: nowLabel() }].slice(-50)) }

  useEffect(() => { const loadVoices = () => setAvailableVoices(window.speechSynthesis?.getVoices() || []); window.speechSynthesis?.addEventListener("voiceschanged", loadVoices); return () => { recognitionRef.current?.abort(); window.speechSynthesis?.cancel(); window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices) } }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }) }, [conversation, pending, processing, listening])
  useEffect(() => { if (!listening) return; const timer = window.setInterval(() => setVoiceSeconds((value) => value + 1), 1000); return () => window.clearInterval(timer) }, [listening])

  const analyticalAnswer = (question: string) => {
    const normalized = normalizeSpeech(question), pendingTransactions = currentItems.filter((item) => item.status === "pending"), pendingTotal = pendingTransactions.reduce((sum, item) => sum + item.amount, 0), balance = income - spent
    const activeRecurring = recurring.filter((item) => item.active && item.type !== "income"), recurringTotal = activeRecurring.reduce((sum, item) => sum + item.amount, 0)
    const specificCategory = categories.find((category) => category !== "Receita" && normalized.includes(normalizeSpeech(category)))
    const largestExpense = [...expenses].sort((a, b) => b.amount - a.amount)[0], lastMovement = [...currentItems].sort((a, b) => b.date.localeCompare(a.date))[0]
    const latestDay = Math.max(1, ...currentItems.map((item) => Number(item.date.slice(8)))), daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate(), projectedSpend = spent / latestDay * daysInMonth
    if (/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite)(\b|[!.?,])/.test(normalized)) return `${greeting}, ${firstName}! Que bom falar com você. Estou por aqui para organizar suas finanças sem complicação. Quer consultar alguma conta, entender seus gastos ou registrar algo?`
    if (/(tudo bem|como voce esta|como vai)/.test(normalized)) return `Tudo bem, ${firstName}! Obrigada por perguntar. E com você? Se quiser, podemos conversar normalmente ou olhar juntos alguma parte das suas finanças.`
    if (/(obrigad|valeu|perfeito|entendi)/.test(normalized)) return `Por nada, ${firstName}! Fico feliz em ajudar. Pode continuar falando comigo quando quiser.`
    if (/(nao funciona|nao entendeu|resposta errada|voce errou|esta errado)/.test(normalized)) return `Poxa, ${firstName}, sinto muito por isso. Quero corrigir com você. Me diga qual informação ficou errada ou repita o pedido com o nome da conta, valor ou período, e eu tento novamente.`
    if (/(preocupad|ansioso|ansiedade|sem dinheiro|apertado|dificuldade)/.test(normalized)) return `Entendo, ${firstName}. Questões financeiras realmente podem pesar. Vamos olhar isso com calma e sem julgamento. Posso começar mostrando suas contas pendentes ou onde existe mais espaço para economizar.`
    if (/(me ajuda|preciso de ajuda|por onde comec)/.test(normalized)) return `Claro, ${firstName}. Vamos por partes. Primeiro posso conferir quanto entrou e saiu neste mês; depois identificamos o que pode ser ajustado e definimos uma meta possível. Quer começar pelo resumo do mês?`
    const namedAccount = accounts.find((account) => normalized.includes(normalizeSpeech(account.name)))
    const creditAccount = namedAccount?.type === "Cartão de crédito" ? namedAccount : accounts.find((account) => account.type === "Cartão de crédito")
    if (/(cartao|credito|limite|fatura)/.test(normalized) && creditAccount) {
      const fallbackLimit = creditAccount.detail.match(/limite\s+r\$\s*([\d.,]+)/i), limit = creditAccount.creditLimit || (fallbackLimit ? parseAssistantAmount(`R$ ${fallbackLimit[1]}`) : 0), available = limit ? Math.max(0, limit - creditAccount.balance) : 0
      const closing = creditAccount.closingDay, due = creditAccount.dueDay
      if (/(fecha|fechamento|melhor dia|vence|vencimento)/.test(normalized)) return closing ? `O ${creditAccount.name} fecha no dia ${closing}${due ? ` e vence no dia ${due}` : ""}. Em geral, compras feitas após o fechamento entram na próxima fatura; confirme a regra do banco antes de decidir.` : `A data de fechamento do ${creditAccount.name} ainda não foi cadastrada.`
      if (/(disponivel|resta|sobrou|ainda tenho|posso gastar|limite)/.test(normalized)) return limit ? `Claro, ${firstName}. No ${creditAccount.name}, seu limite total é ${formatValue(limit)}. Como o total comprometido em todas as faturas é de ${formatValue(creditAccount.balance)}, você ainda tem ${formatValue(available)} disponível. Quer que eu confira também quanto desse limite já foi utilizado em porcentagem?` : `Encontrei o total comprometido do ${creditAccount.name}, em ${formatValue(creditAccount.balance)}, mas o limite total ainda não foi informado. Se você cadastrar esse limite, consigo calcular o disponível certinho.`
      if (/(fatura|gastei|usado|utilizado)/.test(normalized)) return `O total comprometido do ${creditAccount.name} está em ${formatValue(creditAccount.balance)}${limit ? `, usando ${Math.round(creditAccount.balance / limit * 100)}% do limite. Veja a fatura de cada mês em Contas e cartões` : ""}.`
      return `Seu cartão ${creditAccount.name} tem um total comprometido de ${formatValue(creditAccount.balance)}${limit ? ` e ${formatValue(available)} disponíveis` : ""}.`
    }
    if (/(posso comprar|cabe no cartao|simule|vale a pena comprar)/.test(normalized)) {
      const purchase = parseAssistantAmount(question), card = accounts.find((account) => account.type === "Cartão de crédito"), limit = card?.creditLimit || 0, available = card && limit ? Math.max(0, limit - card.balance) : 0
      if (!purchase) return `Consigo simular com os dados cadastrados. Diga o valor da compra, por exemplo: “posso comprar algo de 800 reais?”`
      if (!card || !limit) return `A compra é de ${formatValue(purchase)}, mas preciso que o limite do cartão esteja cadastrado para comparar com segurança.`
      return `${purchase <= available ? "A compra cabe" : "A compra não cabe"} no limite disponível cadastrado do ${card.name}. Valor da compra: ${formatValue(purchase)}; limite disponível: ${formatValue(available)}. Isso verifica apenas o limite, não se a compra é adequada para o seu orçamento.`
    }
    if (namedAccount && /(saldo|quanto tenho|disponivel|dinheiro)/.test(normalized)) return `${namedAccount.name} possui ${formatValue(namedAccount.balance)} registrados como saldo atual. ${accountDetail(namedAccount)}.`
    if (/(minhas contas|saldos das contas|quanto tenho nas contas)/.test(normalized)) { const bankAccounts = accounts.filter((account) => account.type !== "Cartão de crédito"), total = bankAccounts.reduce((sum, account) => sum + account.balance, 0); return `Somando ${bankAccounts.map((account) => account.name).join(" e ")}, você tem ${formatValue(total)}. ${bankAccounts.map((account) => `${account.name}: ${formatValue(account.balance)}`).join("; ")}.` }
    if (/(quanto entrou|receita|recebi|ganhei no mes)/.test(normalized)) return `As receitas confirmadas de ${monthLabels[month]} somam ${formatValue(income)}, distribuídas em ${incomes.length} movimentação${incomes.length === 1 ? "" : "ões"}.`
    if (/(ultima movimentacao|ultimo lancamento|ultima transacao)/.test(normalized)) return lastMovement ? `A movimentação mais recente é “${lastMovement.description}”, de ${formatValue(lastMovement.amount)}, em ${shortDate(lastMovement.date)}, pela conta ${lastMovement.account}.` : "Ainda não há movimentações neste período."
    if (/(maior compra|maior despesa|gasto mais alto)/.test(normalized)) return largestExpense ? `Sua maior despesa individual foi “${largestExpense.description}”, no valor de ${formatValue(largestExpense.amount)}, pela conta ${largestExpense.account}.` : "Ainda não há despesas pagas neste período."
    if (/(assinatura mais cara|recorrencia mais cara|servico mais caro)/.test(normalized)) { const largest = [...activeRecurring].sort((a, b) => b.amount - a.amount)[0]; return largest ? `Sua assinatura ativa mais cara é ${largest.name}, por ${formatValue(largest.amount)} ao mês. Juntas, as recorrências cadastradas somam ${formatValue(recurringTotal)} por mês.` : "Você ainda não cadastrou assinaturas ou despesas recorrentes ativas." }
    if (/(duplicad|cobranca repetida|lancamento repetido)/.test(normalized)) { const duplicates = currentItems.filter((item, index, all) => all.findIndex((other) => other.id !== item.id && normalizeSpeech(other.description) === normalizeSpeech(item.description) && other.amount === item.amount && other.date === item.date) < index); return duplicates.length ? `Encontrei ${duplicates.length} possível${duplicates.length === 1 ? "" : "is"} duplicidade${duplicates.length === 1 ? "" : "s"}. Abra Transações para revisar antes de excluir qualquer lançamento.` : "Não encontrei duplicidades exatas neste período. Ainda assim, vale revisar lançamentos com descrições diferentes e valores iguais." }
    if (/(patrimonio|bens menos dividas)/.test(normalized)) { const assets = accounts.filter((account) => account.type !== "Cartão de crédito").reduce((sum, account) => sum + account.balance, 0) + goals.reduce((sum, goal) => sum + goal.saved, 0), debts = accounts.filter((account) => account.type === "Cartão de crédito").reduce((sum, account) => sum + account.balance, 0); return `Seu patrimônio líquido estimado no Synch Cash é ${formatValue(assets - debts)}: ${formatValue(assets)} em contas e metas, menos ${formatValue(debts)} em faturas cadastradas.` }
    if (/(transferencia|transferir)/.test(normalized)) return "Posso ajudar a organizar a transferência. Use Nova transação e escolha a opção Transferência; o Synch criará a saída e a entrada pareadas sem contar o valor como gasto."
    if (specificCategory && /(quanto|gastei|total|resumo)/.test(normalized)) { const value = categoryTotals[specificCategory] || 0, budget = budgets[specificCategory] || 0; return `Em ${specificCategory}, você gastou ${formatValue(value)} neste período${budget ? ` de um orçamento de ${formatValue(budget)}, restando ${formatValue(Math.max(0, budget - value))}` : ""}.` }
    if (/(compar|mes passado|anterior)/.test(normalized)) { const difference = spent - previousSpent, direction = difference > 0 ? "aumentaram" : "diminuíram"; return previousSpent ? `${firstName}, comparei os dois períodos: suas despesas ${direction} ${Math.abs(Math.round(difference / previousSpent * 100))}%. Foram ${formatValue(spent)} agora e ${formatValue(previousSpent)} no mês anterior. ${difference > 0 ? "Vale a pena verificarmos qual categoria puxou esse aumento." : "Boa notícia: você conseguiu reduzir seus gastos."}` : "Ainda não encontrei dados suficientes do mês anterior para fazer uma comparação segura. Assim que houver mais movimentações, eu consigo comparar para você." }
    if (/(previs|projec|fim do mes|ritmo)/.test(normalized)) return currentItems.length ? `Usando somente o ritmo dos lançamentos cadastrados até o dia ${latestDay}, a projeção simples de despesas para o mês é ${formatValue(projectedSpend)}. É uma estimativa e pode mudar com contas futuras ou registros ainda não adicionados.` : "Ainda não há dados suficientes para projetar o fechamento do mês."
    if (/(media|por dia|diaria)/.test(normalized)) return `A média registrada é de ${formatValue(spent / latestDay)} por dia até o último lançamento do período. Em ${expenses.length} despesas pagas, o valor médio por despesa foi ${formatValue(expenses.length ? spent / expenses.length : 0)}.`
    if (/(saldo|sobrou|restou|resultado)/.test(normalized)) return `Fiz as contas, ${firstName}: entraram ${formatValue(income)} e saíram ${formatValue(spent)} no período. Isso deixa um resultado de ${formatValue(balance)}. ${balance >= 0 ? "Você terminou no positivo." : "O resultado está negativo; podemos olhar juntos onde reduzir."}`
    if (/(pendente|a pagar|venc)/.test(normalized)) return pendingTransactions.length ? `Você tem ${pendingTransactions.length} lançamentos pendentes, somando ${formatValue(pendingTotal)}: ${pendingTransactions.slice(0, 4).map((item) => `${item.description}, ${formatValue(item.amount)}`).join("; ")}.` : "Não há lançamentos pendentes neste período."
    if (/(mais gast|maior gasto|categoria)/.test(normalized)) return top ? `Encontrei, ${firstName}: ${top[0]} foi sua maior categoria, com ${formatValue(top[1])}. Isso representa ${spent ? Math.round(top[1] / spent * 100) : 0}% das despesas do mês. Quer que eu mostre uma sugestão de economia para essa categoria?` : "Ainda não há despesas suficientes neste período para identificar uma categoria principal. Quando você adicionar mais movimentações, eu analiso para você."
    if (/(econom|reduzir|cortar)/.test(normalized)) { const suggestion = top ? Math.round(top[1] * .1) : 0; return top ? `A melhor oportunidade está em ${top[0]}. Uma redução de 10% liberaria aproximadamente ${formatValue(suggestion)}. Você ainda tem ${formatValue(Math.max(0, totalBudget - spent))} do orçamento geral.` : "Adicione mais movimentações para eu encontrar oportunidades reais de economia." }
    if (/(quanto.*gastar|orcamento|limite)/.test(normalized)) return `Você usou ${totalBudget ? Math.round(spent / totalBudget * 100) : 0}% do orçamento e ainda pode gastar ${formatValue(Math.max(0, totalBudget - spent))} sem ultrapassar o limite planejado.`
    if (/(recorrente|assinatura)/.test(normalized)) return activeRecurring.length ? `Você possui ${activeRecurring.length} recorrências ativas, somando ${formatValue(recurringTotal)} por mês: ${activeRecurring.map((item) => `${item.name}, ${formatValue(item.amount)}`).join("; ")}.` : "Você não possui recorrências ativas. Posso preparar uma se você disser o nome e o valor mensal."
    if (/(meta|objetivo)/.test(normalized)) { const active = [...goals].sort((a, b) => a.saved / a.target - b.saved / b.target)[0]; return active ? `A meta que mais precisa de atenção é “${active.name}”. Ela está em ${Math.round(active.saved / active.target * 100)}% e faltam ${formatValue(active.target - active.saved)}.` : "Você ainda não tem metas cadastradas. Posso criar uma se disser o nome e o valor desejado." }
    return `Quero te ajudar, ${firstName}, mas não entendi completamente esse pedido. Você pode explicar de outro jeito? Por exemplo: “quanto tenho no cartão?”, “onde gastei mais?” ou “registre 50 reais no mercado”.`
  }

  const createAction = (text: string) => {
    const normalized = normalizeSpeech(text), amount = parseAssistantAmount(text)
    if (pending && /(confirma|confirmar|pode salvar|pode fazer|salvar)/.test(normalized)) { confirmPending(); return }
    if (pending && /(cancela|cancelar|esquece|nao salva)/.test(normalized)) { setPending(null); assistantReply("Ação cancelada. Nenhum dado foi alterado."); return }
    if (pending && /(na verdade|corrig|altere|mude|troque)/.test(normalized)) {
      if (pending.kind === "transactions") { const category = knownCategory(assistantCategory(text, pending.drafts[0].type)); setPending({ ...pending, drafts: pending.drafts.map((draft, index) => index ? draft : { ...draft, amount: amount ? String(amount).replace(".", ",") : draft.amount, category: category !== "Outros" ? category : draft.category, description: category !== "Outros" ? assistantDescription(text, draft.type, category) : draft.description, account: accountNames.find((name) => normalized.includes(normalizeSpeech(name))) || draft.account }) }); assistantReply("Entendi a correção e atualizei a prévia. Confira os dados antes de confirmar."); return }
    }
    const category = categories.find((item) => normalized.includes(normalizeSpeech(item))) || knownCategory(assistantCategory(text, "expense"))
    if (/(defin|crie|ajuste|mude).*(orcamento|limite)/.test(normalized) && amount > 0) { setPending({ id: nextId(), kind: "budget", source: text, confidence: category === "Outros" ? 80 : 96, category, amount }); assistantReply(`Preparei um novo limite de ${money.format(amount)} para ${category}. Confirme para eu atualizar o orçamento.`); return }
    if (/(crie|criar|nova|quero).*(meta|objetivo)/.test(normalized) && amount > 0) { const match = normalized.match(/(?:meta|objetivo)(?:\s+de|\s+para)?\s+(.+?)(?:\s+(?:de|no valor|valendo|em)\s+(?:r\$|\d)|$)/), name = match?.[1]?.replace(/\buma\b/g, "").trim() || "Nova meta"; setPending({ id: nextId(), kind: "goal", source: text, confidence: match ? 94 : 82, name: name.charAt(0).toUpperCase() + name.slice(1), amount }); assistantReply(`A meta “${name}” foi preparada com objetivo de ${money.format(amount)}. Posso criar?`); return }
    if (/(recorrente|todo mes|mensal)/.test(normalized) && amount > 0 && /(crie|cadastre|adicione|marque|pago|paguei)/.test(normalized)) { const draft = knownDraft(inferAssistantDraft(text, accountNames)); setPending({ id: nextId(), kind: "recurring", source: text, confidence: draft.category === "Outros" ? 84 : 96, name: draft.description, category: draft.category, amount }); assistantReply(`Identifiquei uma recorrência mensal de ${money.format(amount)} para ${draft.description}. Confirme para cadastrar.`); return }
    const transactionIntent = /(gastei|paguei|comprei|recebi|ganhei|entrou|entrada|vendi|custou|lance|registre|adicione)/.test(normalized)
    if (transactionIntent && amount > 0) { const drafts = splitAssistantTransactions(text).map((part) => knownDraft(inferAssistantDraft(part, accountNames))).filter((draft) => parseAssistantAmount(draft.amount) > 0), confidence = Math.round(drafts.reduce((sum, draft) => sum + (draft.confidence || 80), 0) / Math.max(1, drafts.length)); setPending({ id: nextId(), kind: "transactions", source: text, confidence, drafts }); assistantReply(`Entendi ${drafts.length === 1 ? "uma movimentação" : `${drafts.length} movimentações`}. Organizei os dados abaixo para sua revisão.`); return }
    assistantReply(analyticalAnswer(text))
  }

  const processInput = (text: string, source: "text" | "voice") => {
    const clean = text.trim(); if (!clean || processing) return
    userMessage(clean, source); setProcessing(true); setMessage("")
    window.setTimeout(() => { createAction(clean); setProcessing(false); setVoiceTranscript("") }, 520)
  }
  const startVoice = async () => {
    if (listening) return recognitionRef.current?.stop()
    const w = window as typeof window & { SpeechRecognition?: VoiceRecognitionConstructor; webkitSpeechRecognition?: VoiceRecognitionConstructor }, Recognition = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Recognition) return toast.error("O reconhecimento de voz não está disponível neste navegador.")
    setVoiceMode(true); setVoiceError(""); setVoiceConfidence(null); setVoiceSeconds(0); setVoiceTranscript("")
    if (navigator.mediaDevices?.getUserMedia) {
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); stream.getTracks().forEach((track) => track.stop()) }
      catch { setVoiceMode(false); setVoiceError("O acesso ao microfone foi bloqueado."); return toast.error("Autorize o microfone nas configurações do navegador para conversar com a Synch.") }
    }
    let captured = "", confidenceTotal = 0, confidenceCount = 0
    const recognition = new Recognition(); recognition.lang = "pt-BR"; recognition.interimResults = true; recognition.continuous = false; recognition.maxAlternatives = 3
    recognition.onstart = () => { stopSpeaking(); setVoiceError(""); setListening(true) }
    recognition.onresult = (event) => {
      const results = Array.from(event.results); captured = results.map((result) => result[0]?.transcript || "").join(" ").replace(/\s+/g, " ").trim()
      results.forEach((result) => { const confidence = result[0]?.confidence || 0; if (confidence > 0) { confidenceTotal += confidence; confidenceCount += 1 } })
      setVoiceTranscript(captured); if (confidenceCount) setVoiceConfidence(Math.round(confidenceTotal / confidenceCount * 100))
    }
    recognition.onerror = (event) => {
      setListening(false)
      const messages: Record<string, string> = { "not-allowed": "O microfone está bloqueado. Autorize o acesso no navegador.", "audio-capture": "Não encontrei um microfone disponível.", "no-speech": "Não ouvi nenhuma fala. Aproxime-se do microfone e tente novamente.", network: "A transcrição do navegador ficou indisponível. Verifique sua conexão." }
      const error = messages[event.error] || "Não consegui transcrever com clareza. Tente falar um pouco mais devagar."
      setVoiceError(error); toast.error(error)
    }
    recognition.onend = () => { setListening(false); recognitionRef.current = null; if (!captured && !voiceError) setVoiceError("Não ouvi nenhuma fala. Toque em gravar novamente para tentar.") }
    recognitionRef.current = recognition; try { recognition.start() } catch { toast.error("Não foi possível iniciar o microfone.") }
  }
  const confirmVoiceInput = () => { const transcript = voiceTranscript.trim(); if (!transcript) return; setVoiceMode(false); setVoiceError(""); processInput(transcript, "voice") }
  const cancelVoiceInput = () => { recognitionRef.current?.abort(); recognitionRef.current = null; setListening(false); setVoiceMode(false); setVoiceTranscript(""); setVoiceSeconds(0); setVoiceConfidence(null); setVoiceError("") }
  const updateDraft = (index: number, patch: Partial<VoiceDraft>) => { if (pending?.kind !== "transactions") return; setPending({ ...pending, drafts: pending.drafts.map((draft, position) => position === index ? { ...draft, ...patch } : draft) }) }
  const confirmPending = () => {
    if (!pending) return
    if (pending.kind === "transactions") {
      const created: Transaction[] = [], createdRecurring: RecurringData[] = []
      try {
        for (const draft of pending.drafts) {
          const value = parseAssistantAmount(draft.amount), parts = draft.installments || 1
          if (!draft.description.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw new Error("Revise a descrição e a data.")
          const amounts = installmentAmounts(value, parts)
          const card = accounts.find(a => a.name === draft.account && a.type === "Cartão de crédito")
          amounts.forEach((amount, index) => created.push({
            id: nextId(), description: parts > 1 ? `${draft.description.trim()} (${index + 1}/${parts})` : draft.description.trim(),
            category: draft.category, date: addCalendarMonths(draft.date, index), amount, type: draft.type,
            account: draft.account, status: draft.status, recurring: draft.recurring, cardId: card?.id,
            invoiceCycle: card?.closingDay && card?.dueDay ? shiftMonth(purchaseCycle(card, draft.date), index) : undefined,
            paymentMethod: card ? "Crédito" : "Conta", notes: `Criado pelo Assistente Synch: “${pending.source}”`
          }))
          if (draft.recurring) createdRecurring.push({ id: nextId(), name: draft.description, category: draft.category, amount: value, type: draft.type, next: "Próximo mês", active: true })
        }
      } catch (error) { return toast.error(error instanceof Error ? error.message : "Revise os dados antes de confirmar.") }
      if (!created.length) return toast.error("Revise os valores antes de confirmar.")
      setItems((all) => [...created, ...all]); if (createdRecurring.length) setRecurring((all) => [...createdRecurring, ...all]); setLastUndo({ kind: "transactions", label: `${created.length} lançamento${created.length > 1 ? "s" : ""}`, transactionIds: created.map((item) => item.id), recurringIds: createdRecurring.map((item) => item.id) }); assistantReply(`${created.length === 1 ? "Movimentação adicionada" : `${created.length} movimentações adicionadas`} com sucesso. Se precisar, você pode desfazer a ação.`)
    } else if (pending.kind === "budget") { const previous = budgets[pending.category]; setBudgets((all) => ({ ...all, [pending.category]: pending.amount })); setLastUndo({ kind: "budget", label: `Orçamento de ${pending.category}`, category: pending.category, previous }); assistantReply(`Orçamento de ${pending.category} atualizado para ${money.format(pending.amount)}.`)
    } else if (pending.kind === "goal") { const goal: GoalData = { id: nextId(), name: pending.name, saved: 0, target: pending.amount, deadline: "Sem prazo", color: "#22c55e" }; setGoals((all) => [...all, goal]); setLastUndo({ kind: "goal", label: `Meta ${pending.name}`, id: goal.id }); assistantReply(`Meta “${pending.name}” criada com objetivo de ${money.format(pending.amount)}.`)
    } else { const item: RecurringData = { id: nextId(), name: pending.name, category: pending.category, amount: pending.amount, type: "expense", next: "Próximo mês", active: true }; setRecurring((all) => [item, ...all]); setLastUndo({ kind: "recurring", label: `Recorrência ${pending.name}`, id: item.id }); assistantReply(`Recorrência “${pending.name}” cadastrada por ${money.format(pending.amount)} ao mês.`) }
    const label = pending.kind === "transactions" ? `${pending.drafts.length} movimentação${pending.drafts.length > 1 ? "ões" : ""}` : pending.kind === "budget" ? `Orçamento de ${pending.category}` : pending.kind === "goal" ? `Meta ${pending.name}` : `Recorrência ${pending.name}`
    const activityId = nextId(); setActivity((current) => [{ id: activityId, label, detail: "Confirmado pelo usuário", time: nowLabel(), status: "done" as const }, ...current].slice(0, 8))
    setPending(null); toast.success("Ação executada pelo Assistente Synch.")
  }
  const undoLast = () => {
    if (!lastUndo) return
    if (lastUndo.kind === "transactions") { setItems((all) => all.filter((item) => !lastUndo.transactionIds.includes(item.id))); setRecurring((all) => all.filter((item) => !lastUndo.recurringIds.includes(item.id))) }
    else if (lastUndo.kind === "budget") setBudgets((all) => { const copy = { ...all }; if (lastUndo.previous === undefined) delete copy[lastUndo.category]; else copy[lastUndo.category] = lastUndo.previous; return copy })
    else if (lastUndo.kind === "goal") setGoals((all) => all.filter((item) => item.id !== lastUndo.id))
    else setRecurring((all) => all.filter((item) => item.id !== lastUndo.id))
    setActivity((current) => current.map((item, index) => index === 0 ? { ...item, detail: "Ação desfeita", status: "undone" } : item))
    assistantReply(`Desfiz: ${lastUndo.label}.`); setLastUndo(null); toast.success("Última ação desfeita.")
  }
  const clearConversation = () => { const clean = [initialMessages[0]]; setConversation(clean); setPending(null); setLastUndo(null); stopSpeaking(); toast.success("Conversa limpa.") }
  const submit = (event: FormEvent) => { event.preventDefault(); processInput(message, "text") }
  const statusLabel = listening ? "Ouvindo você" : speaking ? "Falando com você" : processing ? "Analisando intenção" : pending ? "Aguardando confirmação" : "Pronto para ajudar"
  const pendingItems = currentItems.filter((item) => item.status === "pending")
  const budgetAvailable = Math.max(0, totalBudget - spent)
  const proactiveTitle = pendingItems.length ? `${pendingItems.length} conta${pendingItems.length > 1 ? "s" : ""} aguardando atenção` : top ? `${top[0]} lidera seus gastos` : "Seu período está organizado"
  const proactiveText = pendingItems.length ? `${formatValue(pendingItems.reduce((sum, item) => sum + item.amount, 0))} pendentes neste período.` : top ? `${Math.round(top[1] / Math.max(1, spent) * 100)}% das despesas estão nessa categoria.` : "Continue registrando para receber alertas personalizados."
  const responseLabel = (text: string) => /(cartao|limite|fatura|conta|saldo)/i.test(text) ? "Contas e cartões" : /(orcamento|gastar|econom)/i.test(text) ? "Planejamento" : /(meta|objetivo)/i.test(text) ? "Metas" : /(compar|mes|periodo)/i.test(text) ? "Análise do período" : "Synch Intelligence"
  const quickPrompts = [
    { label: top ? `Entender ${top[0]}` : "Analisar gastos", prompt: "Onde estou gastando mais?", instant: true },
    { label: pendingItems.length ? "Ver pendências" : "Registrar despesa", prompt: pendingItems.length ? "Quais contas estão pendentes?" : "Gastei 89 reais no mercado hoje pelo Nubank", instant: pendingItems.length },
    { label: "Comparar meses", prompt: "Compare meus gastos com o mês anterior", instant: true },
    { label: goals.length ? "Revisar minhas metas" : "Criar uma meta", prompt: goals.length ? "Qual meta devo priorizar?" : "Crie uma meta de viagem de 5.000 reais", instant: goals.length },
  ]
  const accountUsage = expenses.reduce<Record<string, number>>((result, item) => ({ ...result, [item.account]: (result[item.account] || 0) + 1 }), {})
  const favoriteAccount = Object.entries(accountUsage).sort((a, b) => b[1] - a[1])[0]?.[0] || accounts[0]?.name || "Não definida"

  return <div className={`assistant-v3 ${panelOpen ? "panel-open" : "panel-closed"}`}>
    <aside className="surface assistant-context-panel" aria-label="Contexto financeiro">
      <button className="assistant-panel-close" onClick={() => setPanelOpen(false)} aria-label="Recolher painel"><ChevronLeft /></button>
      <div className="assistant-core"><span><BrainCircuit /></span><i /><div><small>Synch Intelligence</small><strong>Contexto financeiro</strong><p>Dados importantes para esta conversa.</p></div></div>
      <div className="assistant-status-card"><div><span className={listening || processing || speaking ? "active" : ""}><i /></span><div><small>Status da Synch</small><strong>{statusLabel}</strong></div></div><b>{pending ? `${pending.confidence}% de confiança` : speaking ? "Voz ativa" : "Contexto ativo"}</b></div>
      <div className="assistant-context-chips"><span><CalendarDays />{monthLabels[month]}</span><span><Database />{currentItems.length} movimentações</span><span><CreditCard />{accounts.length} contas</span></div>
      <article className="assistant-proactive-card"><span><Lightbulb /></span><div><small>Alerta inteligente</small><strong>{proactiveTitle}</strong><p>{proactiveText}</p><button onClick={() => processInput(pendingItems.length ? "Quais contas estão pendentes?" : "Como posso economizar na minha maior categoria?", "text")}>Analisar agora <ArrowRight /></button></div></article>
      <div className="assistant-live-insights"><span>Visão rápida</span><article><div><small>Resultado atual</small><strong className={income - spent >= 0 ? "positive" : "negative"}>{formatValue(income - spent)}</strong></div><ChartNoAxesCombined /></article><article><div><small>Maior categoria</small><strong>{top?.[0] || "Sem dados"}</strong></div><span>{top ? `${Math.round(top[1] / Math.max(1, spent) * 100)}%` : "—"}</span></article><article><div><small>Orçamento disponível</small><strong>{formatValue(budgetAvailable)}</strong></div><Target /></article></div>
      <div className="assistant-memory-card"><span><Sparkles /></span><div><small>Contexto lembrado</small><strong>{firstName} • {monthLabels[month]}</strong><p>Conta mais usada: {favoriteAccount}</p></div></div>
      <div className="assistant-preferences">
        <span><div>{voiceOutput ? <Volume2 /> : <VolumeX />}<div><strong>Respostas faladas</strong><small>Voz brasileira do seu dispositivo</small></div></div><Switch checked={voiceOutput} onCheckedChange={(value) => { setVoiceOutput(value); if (!value) stopSpeaking() }} /></span>
        {voiceOutput && <div className="assistant-voice-settings">
          <label><small>Estilo</small><Select value={voiceStyle} onValueChange={setVoiceStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="natural">Natural</SelectItem><SelectItem value="calm">Calma</SelectItem><SelectItem value="direct">Objetiva</SelectItem></SelectContent></Select></label>
          <label><small>Voz</small><Select value={voiceId} onValueChange={setVoiceId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Melhor disponível</SelectItem>{availableVoices.filter((voice) => /^pt(-|_)/i.test(voice.lang)).slice(0, 10).map((voice) => <SelectItem key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</SelectItem>)}</SelectContent></Select></label>
          <div className="voice-device-quality"><i /><span><strong>{preferredVoice()?.name || "Voz padrão do navegador"}</strong><small>Ritmo e pronúncia ajustados para português</small></span></div>
          <button onClick={() => speaking ? stopSpeaking() : speak(`${greeting}, ${firstName}. Estou pronta para ajudar com suas finanças.`, true)}>{speaking ? <Square /> : <Volume2 />} {speaking ? "Interromper voz" : "Ouvir amostra"}</button>
        </div>}
        {lastUndo && <button onClick={undoLast}><RefreshCcw /> Desfazer: {lastUndo.label}</button>}
      </div>
      {activity.length > 0 && <div className="assistant-activity"><span>Histórico de ações</span>{activity.slice(0, 3).map((item) => <article key={item.id} className={item.status}><CircleCheck /><div><strong>{item.label}</strong><small>{item.detail} • {item.time}</small></div></article>)}</div>}
    </aside>

    <section className="surface assistant-chat-v3">
      <header className="assistant-chat-header"><button className="assistant-panel-toggle" onClick={() => setPanelOpen((value) => !value)} aria-label={panelOpen ? "Recolher contexto" : "Abrir contexto"}>{panelOpen ? <ChevronLeft /> : <ChevronRight />}</button><div className="chat-heading"><span><Bot /></span><div><h2>Synch <b className="voice-beta">Voice</b></h2><p>Conversa financeira acolhedora, contextual e segura</p></div><i /></div>{speaking && <button className="assistant-speaking-pill" onClick={stopSpeaking}><AudioLines /> Falando <Square /></button>}<button onClick={clearConversation} aria-label="Limpar conversa"><Trash2 /></button></header>
      <div className="assistant-active-context"><span><CalendarDays />{monthLabels[month]}</span><span><WalletCards />{accounts[0]?.name || "Contas"}</span><span><ShieldCheck />Confirmação ativa</span></div>
      <div className="chat-messages assistant-thread assistant-thread-v3" aria-live="polite">
        {conversation.length <= 1 && <div className="assistant-welcome"><span><Sparkles /></span><small>{greeting}, {firstName}</small><h3>O que vamos organizar hoje?</h3><p>Pergunte sobre seu dinheiro do seu jeito ou peça uma ação. Eu preparo tudo e você confirma antes de qualquer alteração.</p><div>{quickPrompts.slice(0, 3).map((item) => <button key={item.label} onClick={() => item.instant ? processInput(item.prompt, "text") : setMessage(item.prompt)}>{item.label}<ArrowRight /></button>)}</div></div>}
        {conversation.map((item) => <div key={item.id} className={`assistant-thread-row ${item.role}`}><div className={item.role === "user" ? "user-message" : "assistant-message"}>{item.role === "assistant" && <div className="assistant-response-head"><span><Sparkles /></span><strong>{responseLabel(item.text)}</strong><small>Agora</small></div>}{item.source === "voice" && <Mic />}<span className="assistant-message-copy">{item.text}</span><small>{item.time}</small>{item.role === "assistant" && <div className="assistant-response-source"><Database /> Baseado em {currentItems.length} movimentações de {monthLabels[month]}</div>}{item.role === "assistant" && voiceOutput && <button className={`message-speak ${speaking ? "is-speaking" : ""}`} onClick={() => speaking ? stopSpeaking() : speak(item.text, true)} aria-label={speaking ? "Interromper resposta" : "Ouvir resposta novamente"}>{speaking ? <Square /> : <Volume2 />}</button>}</div></div>)}
        {processing && <div className="assistant-thinking"><span /><span /><span /><small>Conferindo seu contexto e preparando uma resposta...</small></div>}
        {pending && <div className="assistant-action-card"><div className="assistant-action-head"><span><Sparkles /></span><div><small>Ação preparada</small><strong>{pending.kind === "transactions" ? `${pending.drafts.length} movimentação${pending.drafts.length > 1 ? "ões" : ""} identificada${pending.drafts.length > 1 ? "s" : ""}` : pending.kind === "budget" ? "Atualizar orçamento" : pending.kind === "goal" ? "Criar meta financeira" : "Criar recorrência"}</strong></div><b>{pending.confidence}%</b></div><div className="assistant-action-summary"><span><Database /> Origem: sua solicitação</span><span><ShieldCheck /> Nenhuma alteração realizada ainda</span></div>{pending.kind === "transactions" ? <div className="assistant-draft-list">{pending.drafts.map((draft, index) => <article key={index}><div className="assistant-draft-number">{index + 1}</div><div className="assistant-draft-fields"><Input value={draft.description} onChange={(event) => updateDraft(index, { description: event.target.value })} aria-label="Descrição" /><Input value={draft.amount} onChange={(event) => updateDraft(index, { amount: event.target.value })} aria-label="Valor" /><Select value={draft.category} onValueChange={(value) => updateDraft(index, { category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select><Select value={draft.account} onValueChange={(value) => updateDraft(index, { account: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{accountNames.map((account) => <SelectItem key={account} value={account}>{account}</SelectItem>)}</SelectContent></Select></div><div className="assistant-draft-meta"><span>{draft.type === "income" ? "Receita" : "Despesa"}</span><span>{shortDate(draft.date)}</span>{(draft.installments || 1) > 1 && <span>{draft.installments}x</span>}{draft.recurring && <span>Recorrente</span>}</div></article>)}</div> : <div className="assistant-simple-action"><span>{pending.kind === "budget" ? <ChartNoAxesCombined /> : pending.kind === "goal" ? <Target /> : <RefreshCcw />}</span><div><small>{pending.kind === "budget" ? pending.category : pending.kind === "goal" ? pending.name : `${pending.name} • ${pending.category}`}</small><strong>{money.format(pending.amount)}</strong>{pending.kind === "budget" && <p>Antes: {budgets[pending.category] ? money.format(budgets[pending.category]) : "não definido"} → Depois: {money.format(pending.amount)}</p>}{pending.kind === "recurring" && <p>Cobrança mensal ativa</p>}</div></div>}<div className="assistant-action-footer"><button onClick={() => { setPending(null); assistantReply("Tudo bem, cancelei a ação. Nenhum dado foi alterado.") }}>Cancelar</button><button className="confirm" onClick={confirmPending}><Check /> Confirmar e executar</button></div><p><ShieldCheck /> Você mantém o controle: revise os dados antes de confirmar.</p></div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="assistant-prompt-suggestions">{quickPrompts.map((item) => <button key={item.label} onClick={() => item.instant ? processInput(item.prompt, "text") : setMessage(item.prompt)}>{item.label}</button>)}</div>
      <form className="chat-input assistant-composer" onSubmit={submit}><div><Input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Converse comigo ou peça uma ação..." disabled={processing} /><small>Ex.: “Synch, quanto gastei com alimentação e o que vence agora?”</small></div><button type="button" className={`voice-button ${listening ? "active" : ""}`} onClick={startVoice} disabled={!voiceSupported || processing} aria-label="Abrir conversa por voz"><Mic /></button><Button type="submit" aria-label="Enviar mensagem" size="icon" disabled={processing || !message.trim()}><Send /></Button></form>
      <small className="assistant-disclaimer"><ShieldCheck /> A Synch usa os dados deste dispositivo e sempre pede confirmação antes de agir.</small>
    </section>

    {voiceMode && <div className="assistant-voice-overlay" role="dialog" aria-modal="true" aria-label="Conversa por voz">
      <button className="voice-overlay-close" onClick={cancelVoiceInput} aria-label="Fechar modo de voz"><X /></button>
      <div className="voice-session-brand"><span><AudioLines /></span><div><strong>Synch Voice</strong><small>Conversa financeira por áudio</small></div><b><i /> Português (Brasil)</b></div>
      <div className={`voice-orb-stage ${listening ? "listening" : voiceError && !voiceTranscript ? "error" : "review"}`}>
        <div className="voice-orb-rings"><span /><span /><span /><i>{voiceError && !voiceTranscript ? <X /> : <Mic />}</i></div>
        <small>{listening ? "Estou ouvindo" : voiceError && !voiceTranscript ? "Não consegui ouvir" : "Confira o que entendi"}</small>
        <strong>{listening ? "Pode falar naturalmente" : voiceError && !voiceTranscript ? "Vamos tentar novamente" : "Sua transcrição está pronta"}</strong>
        <span className="voice-timer"><Clock3 />{String(Math.floor(voiceSeconds / 60)).padStart(2, "0")}:{String(voiceSeconds % 60).padStart(2, "0")}</span>
      </div>
      <div className="voice-overlay-wave" aria-hidden="true">{Array.from({ length: 34 }).map((_, index) => <i key={index} style={{ animationDelay: `${index * 32}ms` }} />)}</div>
      <div className="voice-transcript-editor">
        <div className="voice-transcript-head"><small>Transcrição em tempo real</small>{voiceConfidence !== null && <span className={voiceConfidence >= 75 ? "high" : "low"}><i />{voiceConfidence}% de clareza</span>}</div>
        <textarea value={voiceTranscript} onChange={(event) => { setVoiceTranscript(event.target.value); setVoiceError("") }} placeholder={listening ? "Fale normalmente. O texto aparecerá aqui..." : "Edite a transcrição antes de enviar..."} disabled={listening} />
        {voiceError ? <p className="voice-inline-error"><X />{voiceError}</p> : <p className="voice-listening-tip"><Mic /> Fale valores e nomes de contas com calma. Você poderá corrigir o texto.</p>}
      </div>
      <div className="voice-overlay-actions">{listening ? <><button className="voice-cancel" onClick={cancelVoiceInput}><X /> Cancelar</button><button className="voice-stop" onClick={() => recognitionRef.current?.stop()}><Square /> Parar e revisar</button></> : <><button className="voice-cancel" onClick={startVoice}><RotateCcw /> Gravar novamente</button><button className="voice-confirm" onClick={confirmVoiceInput} disabled={!voiceTranscript.trim()}><Send /> Enviar para Synch</button></>}</div>
      <p><ShieldCheck /> A transcrição não altera seus dados. Qualquer ação financeira ainda exigirá confirmação.</p>
    </div>}
  </div>
}

function SettingsView({ prefs, setPrefs, plan, savePreferences }: { prefs: Preferences; setPrefs: Dispatch<SetStateAction<Preferences>>; plan: Plan; savePreferences: (p: Preferences) => Promise<Preferences | null> }) {
  const [saving, setSaving] = useState(false), [passwordOpen, setPasswordOpen] = useState(false), [newPassword, setNewPassword] = useState(""), [confirmPassword, setConfirmPassword] = useState(""), [changingPassword, setChangingPassword] = useState(false)
  const save = async () => { setSaving(true); await savePreferences(prefs); setSaving(false) }
  const changePassword = async () => {
    if (newPassword.length < 6) return toast.error("A nova senha precisa ter pelo menos 6 caracteres.")
    if (newPassword !== confirmPassword) return toast.error("As senhas não coincidem.")
    setChangingPassword(true)
    try { await synchApi.changePassword(newPassword); toast.success("Senha atualizada."); setPasswordOpen(false); setNewPassword(""); setConfirmPassword("") }
    catch (error) { toast.error(error instanceof SynchApiError ? error.message : "Não foi possível atualizar a senha.") }
    finally { setChangingPassword(false) }
  }
  return <div className="settings-grid"><section className="surface settings-card"><div className="panel-title-row"><div><h2>Perfil</h2><p>Informações da sua conta</p></div></div><div className="profile-settings"><span className="large-avatar">{prefs.name.charAt(0) || "G"}</span><div><strong>{prefs.name}</strong><p>{plan === "synch_ia" ? "Plano Synch IA" : "Plano Básico Vitalício"}</p></div></div><div className="settings-fields"><label><span>Nome completo</span><Input value={prefs.name} onChange={(e) => setPrefs((p) => ({ ...p, name: e.target.value }))} /></label><label><span>E-mail</span><Input type="email" value={prefs.email} disabled /></label></div><div className="settings-actions"><Button className="primary-button" disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar alterações"}</Button><Button variant="outline" onClick={() => setPasswordOpen(true)}><LockKeyhole /> Alterar senha</Button></div></section><section className="surface settings-card"><div className="panel-title-row"><div><h2>Preferências</h2><p>Personalize sua experiência</p></div></div><div className="preference-list"><article><span><Bell /><div><strong>Notificações</strong><p>Alertas de orçamento e vencimentos</p></div></span><Switch checked={prefs.notifications} onCheckedChange={(value) => setPrefs((current) => ({ ...current, notifications: value }))} /></article><article><span><Moon /><div><strong>Aparência Synch</strong><p>Tema escuro oficial, otimizado para leitura</p></div></span><span className="settings-fixed-badge">Ativo</span></article><article><span><ShieldCheck /><div><strong>Resumo semanal</strong><p>Análise toda segunda-feira</p></div></span><Switch checked={prefs.weekly} onCheckedChange={(value) => setPrefs((current) => ({ ...current, weekly: value }))} /></article></div></section><Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent className="transaction-dialog"><DialogHeader><DialogTitle>Alterar senha</DialogTitle><DialogDescription>A nova senha é validada e salva no Supabase Auth.</DialogDescription></DialogHeader><div className="simple-form"><label className="field"><span>Nova senha</span><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label><label className="field"><span>Confirmar nova senha</span><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label></div><DialogFooter><Button variant="outline" onClick={() => setPasswordOpen(false)}>Cancelar</Button><Button className="primary-button" disabled={changingPassword} onClick={changePassword}>{changingPassword ? "Salvando..." : "Atualizar senha"}</Button></DialogFooter></DialogContent></Dialog></div>
}

function MobileNav({ view, navigate, newItem }: { view: ViewKey; navigate: (v: ViewKey) => void; newItem: () => void }) {
  const { setOpenMobile } = useSidebar()
  const items: { key: ViewKey; label: string; icon: typeof Home }[] = [{ key: "overview", label: "Início", icon: Home }, { key: "transactions", label: "Transações", icon: ReceiptText }, { key: "assistant", label: "Synch IA", icon: Sparkles }]
  const navButton = (item: typeof items[number]) => { const Icon = item.icon; return <button key={item.key} aria-current={view === item.key ? "page" : undefined} className={view === item.key ? "active" : ""} onClick={() => { navigate(item.key); window.scrollTo({ top: 0 }) }}><Icon /><span>{item.label}</span></button> }
  return <nav className="mobile-bottom-nav" aria-label="Navegação principal">{items.slice(0, 2).map(navButton)}<button className="mobile-add" onClick={newItem} aria-label="Nova transação"><Plus /><span>Novo</span></button>{navButton(items[2])}<button onClick={() => setOpenMobile(true)} aria-label="Abrir todos os módulos"><Menu /><span>Menu</span></button></nav>
}


function LoginScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login"), [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [remember, setRemember] = useState(true), [showPassword, setShowPassword] = useState(false), [loading, setLoading] = useState(false)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error("Digite um e-mail válido.")
    if (mode === "forgot") {
      setLoading(true)
      try { const result = await synchApi.forgotPassword(email.trim()); toast.success(result.message) }
      catch (error) { toast.error(error instanceof SynchApiError ? error.message : "Não foi possível enviar o e-mail.") }
      finally { setLoading(false) }
      return
    }
    if (mode === "register" && name.trim().length < 3) return toast.error("Informe seu nome completo.")
    if (password.length < 6) return toast.error("A senha precisa ter pelo menos 6 caracteres.")
    if (mode === "register" && password !== confirmation) return toast.error("As senhas não coincidem.")
    setLoading(true)
    try {
      if (mode === "register") {
        const result = await synchApi.signUp(name.trim(), email.trim(), password)
        if (result.needsEmailConfirmation) { toast.success("Conta criada! Verifique seu e-mail para confirmar antes de entrar."); setMode("login"); return }
      } else {
        await synchApi.signIn(email.trim(), password, remember)
        await onAuthenticated()
        toast.success("Bem-vindo de volta!")
      }
    } catch (error) {
      toast.error(error instanceof SynchApiError ? error.message : "Não foi possível concluir.")
    } finally {
      setLoading(false)
    }
  }
  const heading = mode === "login" ? ["Bem-vindo de volta", "Acesse sua conta para continuar cuidando do seu dinheiro."] : mode === "register" ? ["Crie sua conta", "Comece a organizar sua vida financeira em poucos minutos."] : ["Recuperar acesso", "Informe seu e-mail para receber as instruções de recuperação."]
  return <main className="login-page"><section className="login-story" aria-label="Apresentação Synch Cash"><div className="login-story-inner"><Brand /><div className="login-message"><span className="login-eyebrow"><i /> Controle financeiro inteligente</span><h1>Clareza para cada <em>decisão financeira.</em></h1><p>Organize gastos, acompanhe metas e entenda para onde seu dinheiro está indo — tudo em um só lugar.</p></div><div className="login-preview" aria-label="Prévia do resumo financeiro"><div className="login-preview-head"><span>Saldo disponível</span><span className="login-live"><i /> Atualizado agora</span></div><strong>R$ 6.842,50</strong><small><TrendingUp /> 12,4% em relação ao mês passado</small><div className="login-chart"><span style={{ height: "34%" }} /><span style={{ height: "48%" }} /><span style={{ height: "39%" }} /><span style={{ height: "60%" }} /><span style={{ height: "52%" }} /><span style={{ height: "76%" }} /><span style={{ height: "67%" }} /><span style={{ height: "89%" }} /><span style={{ height: "82%" }} /><span style={{ height: "100%" }} /></div><div className="login-preview-footer"><span><i className="expense-dot" /> Despesas <strong>R$ 3.158</strong></span><span><i className="income-dot" /> Receitas <strong>R$ 4.800</strong></span></div></div><div className="login-trust"><span><ShieldCheck /> Dados protegidos</span><span><Check /> Controle simples e completo</span></div></div></section><section className="login-access"><div className="login-access-inner"><div className="login-mobile-brand"><Brand /></div><div className="login-form-heading"><span className="login-welcome-icon"><LockKeyhole /></span><h2>{heading[0]}</h2><p>{heading[1]}</p></div>{mode !== "forgot" && <div className="auth-mode-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Entrar</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Criar conta</button></div>}<form className="login-form" onSubmit={submit}>{mode === "register" && <label className="login-field"><span>Nome completo</span><div><UserRound /><Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" autoFocus /></div></label>}<label className="login-field"><span>E-mail</span><div><Mail /><Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="seu@email.com" autoFocus={mode !== "register"} /></div></label>{mode !== "forgot" && <label className="login-field"><span>Senha</span><div><LockKeyhole /><Input type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>}{mode === "register" && <label className="login-field"><span>Confirmar senha</span><div><LockKeyhole /><Input type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repita a senha" /></div></label>}{mode === "login" && <div className="login-options"><label><Checkbox checked={remember} onCheckedChange={(value) => setRemember(Boolean(value))} /> Lembrar de mim</label><button type="button" onClick={() => setMode("forgot")}>Esqueci minha senha</button></div>}{mode === "forgot" && <button type="button" className="auth-back-button" onClick={() => setMode("login")}><ChevronLeft /> Voltar para o login</button>}<Button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? <><span className="login-spinner" /> Aguarde...</> : <>{mode === "login" ? "Entrar" : mode === "register" ? "Criar minha conta" : "Enviar instruções"} <ArrowRight /></>}</Button></form><div className="login-security"><ShieldCheck /><span><strong>Dados protegidos</strong><small>Sua sessão é autenticada pelo Supabase Auth e mantida em um cookie seguro.</small></span></div><p className="login-legal">Ao continuar, você concorda com os Termos de Uso e a Política de Privacidade.</p></div></section><Toaster position="bottom-right" /></main>
}

export default function HomePage() {
  const [view, setView] = useState<ViewKey>("overview"), [month, setMonth] = useState<MonthKey>(monthKeyAt(0)), [query, setQuery] = useState(""), [hidden, setHidden] = useState(false)
  const sync = useSynchData(() => setView("subscription"))
  const { status, transactions: items, accounts, budgets, recurring, goals, preferences: prefs, plan, invoicePayments, invoiceAdjustments, categories: categoryNames } = sync
  const ledger: LocalLedger = { version: 2, accounts, items, payments: invoicePayments, adjustments: invoiceAdjustments }
  const setPrefs = (action: SetStateAction<Preferences>) => { const next = typeof action === "function" ? (action as (p: Preferences) => Preferences)(prefs) : action; sync.savePreferences(next) }
  const setBudgets = (action: SetStateAction<Record<string, number>>) => { const next = typeof action === "function" ? (action as (p: Record<string, number>) => Record<string, number>)(budgets) : action; sync.saveBudgets(next) }
  const setRecurring = (action: SetStateAction<RecurringData[]>) => {
    const next = typeof action === "function" ? (action as (p: RecurringData[]) => RecurringData[])(recurring) : action
    const nextIds = new Set(next.map((r) => r.id))
    next.forEach((item) => {
      const before = recurring.find((r) => r.id === item.id)
      if (!before) sync.createRecurring({ name: item.name, category: item.category, amount: item.amount, type: item.type, active: item.active, day: item.day })
      else if (before.name !== item.name || before.category !== item.category || before.amount !== item.amount || before.active !== item.active) sync.saveRecurring(item)
    })
    recurring.forEach((item) => { if (!nextIds.has(item.id)) sync.deleteRecurring(item.id) })
  }
  const setGoals = (action: SetStateAction<GoalData[]>) => {
    const next = typeof action === "function" ? (action as (p: GoalData[]) => GoalData[])(goals) : action
    const nextIds = new Set(next.map((g) => g.id))
    next.forEach((item) => {
      const before = goals.find((g) => g.id === item.id)
      if (!before) sync.createGoal({ name: item.name, saved: item.saved, target: item.target, deadline: item.deadline, color: item.color })
      else if (before.name !== item.name || before.saved !== item.saved || before.target !== item.target || before.deadline !== item.deadline) sync.saveGoal(item)
    })
    goals.forEach((item) => { if (!nextIds.has(item.id)) sync.deleteGoal(item.id) })
  }
  const setItemsFromChildren = (action: SetStateAction<Transaction[]>) => {
    const next = typeof action === "function" ? (action as (p: Transaction[]) => Transaction[])(items) : action
    const nextIds = new Set(next.map((i) => i.id))
    next.forEach((item) => {
      const before = items.find((i) => i.id === item.id)
      if (!before) { const { id: droppedId, ...rest } = item; void droppedId; sync.createTransaction({ ...rest, installments: 1 } as NewTransaction) }
      else if (JSON.stringify(before) !== JSON.stringify(item)) sync.updateTransaction(item)
    })
    items.forEach((item) => { if (!nextIds.has(item.id)) sync.deleteTransaction(item.id) })
  }
  const [modalOpen, setModalOpen] = useState(false), [editing, setEditing] = useState<number | null>(null), [form, setForm] = useState<FormState>(defaultForm), [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  const [commandOpen, setCommandOpen] = useState(false), [importOpen, setImportOpen] = useState(false), [importDrafts, setImportDrafts] = useState<Transaction[]>([]), [online, setOnline] = useState(true)
  useMotionEffects(view, month)
  // Quem não tem Synch IA nunca chega a ver o chat do Assistente -- nem uma prévia bloqueada: o redirecionamento
  // acontece antes de renderizar a tela, então some pra quem não pagou e só volta a aparecer depois da assinatura
  // confirmada. Espera `status === "authenticated"` pra não julgar pelo plano padrão ("gratis") antes do bootstrap
  // real carregar (ex.: um link direto ?view=assistant, que muda a view antes dos dados chegarem).
  useEffect(() => {
    if (view === "assistant" && plan !== "synch_ia" && status === "authenticated") {
      toast.info("O Assistente financeiro (texto e voz) é exclusivo do plano Synch IA. Assine para liberar o chat.")
      setView("subscription")
    }
  }, [view, plan, status])
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    updateOnline(); window.addEventListener("online", updateOnline); window.addEventListener("offline", updateOnline)
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined)
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true) } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "n" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); newItem() } }
    window.addEventListener("keydown", shortcut)
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); window.removeEventListener("keydown", shortcut) }
  }, [month, accounts])
  const logout = async () => { await sync.signOut(); setView("overview"); toast.success("Você saiu da sua conta.") }
  const monthItems = items.filter((i) => i.date.startsWith(month))
  const newItem = () => { setEditing(null); setForm({ ...defaultForm, category: categoryNames.includes(defaultForm.category) ? defaultForm.category : categoryNames.find((name) => name !== "Receita") || "Outros", date: month === monthKeyAt(0) ? isoDate(currentDate) : `${month}-01`, account: accounts[0]?.name || "Carteira", transferAccount: accounts[1]?.name || accounts[0]?.name || "Carteira" }); setModalOpen(true) }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), requestedView = params.get("view") as ViewKey | null
    if (requestedView && navItems.some((item) => item.key === requestedView)) setView(requestedView)
    if (params.get("action") === "new") newItem()
  }, [])
  const edit = (i: Transaction) => { if (i.invoicePaymentId) { toast.info("Use Estornar em Contas e cartões para corrigir um pagamento."); setView("accounts"); return } setEditing(i.id); setForm({ description: i.description, category: i.category, date: i.date, amount: String(i.amount).replace(".", ","), type: i.type, account: i.account, status: i.status, notes: i.notes || "", installments: "1", recurring: Boolean(i.recurring), mode: i.kind === "transfer" ? "transfer" : "transaction", transferAccount: accounts.find((account) => account.name !== i.account)?.name || i.account, splitEnabled: Boolean(i.split?.length), splitCategory: i.split?.[1]?.category || "Outros", splitAmount: i.split?.[1] ? String(i.split[1].amount).replace(".", ",") : "", receiptName: i.receiptName || "" }); setModalOpen(true) }
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const total = parseCsvAmount(form.amount), parts = Math.min(120, Math.max(1, Math.floor(Number(form.installments) || 1)))

    if (form.mode !== "transfer") { try { installmentAmounts(total, parts) } catch (error) { return toast.error((error as Error).message) } }
    if (!form.description.trim() || !Number.isFinite(total) || total <= 0) return toast.error("Preencha uma descrição e um valor válido.")
    if (form.mode === "transfer" && form.account === form.transferAccount) return toast.error("Escolha contas diferentes para a transferência.")
    const splitValue = form.splitEnabled ? Number(form.splitAmount.replace(/\./g, "").replace(",", ".")) : 0
    if (form.splitEnabled && (!Number.isFinite(splitValue) || splitValue <= 0 || splitValue >= total)) return toast.error("O valor da divisão deve ser maior que zero e menor que o total.")

    // Compra no cartão nunca fica pendente: a pendência é a fatura, não a compra.
    const onCard = accounts.find((a) => a.name === form.account)?.type === "Cartão de crédito" && form.mode !== "transfer"
    const status = onCard ? "paid" : form.status
    let result: unknown = null
    if (editing) {
      const current = items.find((i) => i.id === editing)
      if (!current) return
      result = await sync.updateTransaction({ ...current, description: form.description.trim(), category: form.category, date: form.date, amount: total, type: form.type, account: form.account, status, notes: form.notes, recurring: form.recurring, kind: form.mode === "transfer" ? "transfer" : current.kind, receiptName: form.receiptName || undefined })
      if (result) toast.success("Movimentação atualizada.")
    } else if (form.mode === "transfer") {
      const fromAccount = accounts.find((a) => a.name === form.account), toAccount = accounts.find((a) => a.name === form.transferAccount)
      if (!fromAccount || !toAccount) return toast.error("Contas inválidas para a transferência.")
      result = await sync.createTransfer({ fromAccountId: fromAccount.id, toAccountId: toAccount.id, amount: total, date: form.date, description: form.description.trim() })
      if (result) toast.success("Transferência registrada sem alterar seus gastos.")
    } else {
      result = await sync.createTransaction({ description: form.description.trim(), category: form.category, date: form.date, amount: total, type: form.type, account: form.account, status, notes: form.notes, recurring: form.recurring, receiptName: form.receiptName || undefined, installments: parts })
      const cycle = Array.isArray(result) ? (result as Transaction[])[0]?.invoiceCycle : undefined
      const invoiceMonth = cycle ? monthLabel(cycle).toLowerCase() : ""
      if (result) toast.success(onCard && form.type === "income" ? `Estorno lançado. ${money.format(total)} voltaram para a fatura${invoiceMonth ? ` que fecha em ${invoiceMonth}` : " do cartão"}.` : `${parts > 1 ? `${parts} parcelas adicionadas.` : "Transação adicionada."}${invoiceMonth ? ` Entra na fatura que fecha em ${invoiceMonth}.` : ""}`)
    }
    if (result) setModalOpen(false)
  }
  const confirmDelete = async () => { if (!deleteTarget) return; if (deleteTarget.invoicePaymentId) { setDeleteTarget(null); setView("accounts"); toast.info("O histórico de pagamentos é protegido. Use Estornar."); return } const deleted = deleteTarget; setDeleteTarget(null); const ok = await sync.deleteTransaction(deleted.id); if (ok !== null) toast.success("Transação excluída.") }
  const exportCsv = () => { const rows = monthItems.map((i) => [i.description, i.category, i.date, i.type, i.account, i.status, i.amount.toFixed(2)].map(csvCell).join(";")); const blob = new Blob(["\uFEFF" + ["Descrição;Categoria;Data;Tipo;Conta;Status;Valor", ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `synch-cash-${month}.csv`; a.click(); URL.revokeObjectURL(url); toast.success("Relatório exportado.") }
  const importCsv = async (file: File) => {
    const text = await file.text(), parsed: Transaction[] = [], base = Date.now()
    if (file.name.toLowerCase().endsWith(".ofx") || /<OFX>/i.test(text)) {
      const blocks = text.split(/<STMTTRN>/i).slice(1)
      blocks.forEach((block, index) => { const amountRaw = block.match(/<TRNAMT>([^<\r\n]+)/i)?.[1], dateRaw = block.match(/<DTPOSTED>(\d{8})/i)?.[1], description = block.match(/<(?:MEMO|NAME)>([^<\r\n]+)/i)?.[1]?.trim(); const signed = Number(amountRaw); if (description && dateRaw && Number.isFinite(signed)) parsed.push({ id: base + index, description, merchant: description, category: signed >= 0 ? "Receita" : "Outros", date: `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`, type: signed >= 0 ? "income" : "expense", account: accounts[0]?.name || "Carteira", status: "paid", amount: Math.abs(signed) }) })
    } else {
      try {
        parseCsv(text).slice(1).forEach((cells, index) => {
          const [description, category, date, type, account, status, value] = cells
          const amount = parseCsvAmount(value || "")
          const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
          if (description && validDate && Number.isFinite(amount) && amount > 0) parsed.push({ id: base + index, description, category: categoryNames.includes(category) ? category : "Outros", date, type: type === "income" ? "income" : "expense", account: account || accounts[0]?.name || "Carteira", status: status === "pending" ? "pending" : "paid", amount })
        })
      } catch (error) { return toast.error(error instanceof Error ? error.message : "Não foi possível ler o CSV.") }
    }
    if (!parsed.length) return toast.error("Não foi possível reconhecer transações nesse arquivo.")
    setImportDrafts(parsed); setImportOpen(true)
  }
  const analysisMonthItems = monthItems.filter(isAnalytical)
  const titles: Record<ViewKey, [string, string]> = {
    overview: [`Olá, ${prefs.name.split(" ")[0] || "Gustavo"}`, "Aqui está seu resumo financeiro"],
    transactions: ["Transações", "Acompanhe todas as entradas e saídas"],
    categories: ["Categorias", "Para onde seu dinheiro vai e quanto você pode gastar em cada categoria"],
    accounts: ["Contas e cartões", "Saldos, faturas e limites em um só lugar"],
    recurring: ["Assinaturas", "Acompanhe serviços e despesas recorrentes"],
    calendar: ["Calendário financeiro", "Vencimentos e movimentações organizados por data"],
    planning: ["Planejamento", "Patrimônio, previsão e decisões futuras"],
    calculator: ["Calculadora financeira", "Simule juros, parcelas e metas antes de decidir"],
    goals: ["Metas", "Acompanhe seus objetivos financeiros"],
    reports: ["Relatórios", "Entenda a evolução do seu dinheiro"],
    assistant: ["Assistente financeiro", "Insights calculados pelos seus dados"],
    subscription: ["Plano e assinatura", "Gerencie seu acesso e utilização"],
    settings: ["Configurações", "Gerencie seu perfil e preferências"],
  }
  const content = {
    overview: <Overview items={analysisMonthItems} ledger={ledger} budgets={budgets} navigate={setView} edit={edit} requestDelete={setDeleteTarget} hidden={hidden} />,
    transactions: <TransactionsView items={monthItems} query={query} setQuery={setQuery} edit={edit} requestDelete={setDeleteTarget} exportCsv={exportCsv} importCsv={importCsv} hidden={hidden} />,
    categories: <CategoriesView items={items.filter(isAnalytical)} month={month} budgets={budgets} saveBudget={(name, limit) => sync.saveBudgets({ [name]: limit })} hidden={hidden} createCategory={sync.createCategory} renameCategory={sync.renameCategory} deleteCategory={sync.deleteCategory} />,
    accounts: <AccountsCardCenter accounts={accounts} items={items} invoicePayments={invoicePayments} invoiceAdjustments={invoiceAdjustments} hidden={hidden} month={month} newTransaction={(card, refund) => { newItem(); if (card) setForm(current => ({ ...current, account: card.name, ...(refund ? { type: "income" as const, category: "Receita" } : {}) })) }} createAccount={sync.createAccount} saveAccount={sync.saveAccount} registerInvoicePayment={sync.registerInvoicePayment} reverseInvoicePayment={sync.reverseInvoicePayment} reconcileInvoice={sync.reconcileInvoice} />,
    recurring: <RecurringView recurring={recurring} setRecurring={setRecurring} items={items} hidden={hidden} />,
    calendar: <CalendarView items={items} accounts={accounts} ledger={ledger} recurring={recurring} hidden={hidden} />,
    planning: <PlanningView items={items} accounts={accounts} goals={goals} recurring={recurring} hidden={hidden} />,
    calculator: <FinancialCalculator />,
    goals: <GoalsView goals={goals} setGoals={setGoals} hidden={hidden} />,
    reports: <ReportsView items={items.filter(isAnalytical)} exportCsv={exportCsv} hidden={hidden} />,
    assistant: <AssistantExperience items={items} budgets={budgets} hidden={hidden} setItems={setItemsFromChildren} setBudgets={setBudgets} recurring={recurring} setRecurring={setRecurring} goals={goals} setGoals={setGoals} accounts={accounts} month={month} userName={prefs.name} />,
    subscription: <SubscriptionView plan={plan} />,
    settings: <SettingsView prefs={prefs} setPrefs={setPrefs} plan={plan} savePreferences={sync.savePreferences} />,
  }[view]
  if (status === "loading") return <div className="auth-loading"><div className="auth-loading-logo"><img src="/synch-cash-logo.png" alt="Synch Cash" /></div><span /></div>
  if (status === "unauthenticated") return <LoginScreen onAuthenticated={sync.refresh} />
  if (status === "error") return <div className="auth-loading"><div className="auth-loading-logo"><img src="/synch-cash-logo.png" alt="Synch Cash" /></div><Button variant="outline" onClick={() => sync.refresh()}>Tentar novamente</Button></div>
  const pendingCount = monthItems.filter((item) => item.status === "pending").length
  return <CategoriesContext.Provider value={categoryNames}><SidebarProvider style={{ "--sidebar-width": "272px" } as React.CSSProperties}>
    <AppSidebar current={view} navigate={setView} name={prefs.name} email={prefs.email} logout={logout} />
    <SidebarInset className="app-shell">
      <header className="topbar">
        <div className="topbar-title"><SidebarTrigger aria-label="Abrir menu" className="sidebar-toggle-button"><Menu /></SidebarTrigger><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div></div>
        <div className="topbar-actions">
          <Select value={month} onValueChange={setMonth}><SelectTrigger aria-label="Selecionar mês" className="period-selector"><CalendarDays /><SelectValue /></SelectTrigger><SelectContent>{monthOptions.map((key) => <SelectItem key={key} value={key}>{monthLabels[key]}</SelectItem>)}</SelectContent></Select>
          <button className="global-search command-trigger" onClick={() => setCommandOpen(true)}><Search /><span>Buscar ou executar ação</span><kbd>Ctrl K</kbd></button>
          <Button size="icon" variant="ghost" className="notification-button" onClick={() => setHidden((value) => !value)} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}>{hidden ? <EyeOff /> : <Eye />}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="notification-button" aria-label="Abrir notificações"><Bell />{pendingCount > 0 && <i />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="dark-menu notification-menu"><DropdownMenuLabel>Notificações</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setView("calendar")}><ReceiptText /><span><strong>{pendingCount} contas pendentes</strong><small>Confira os próximos vencimentos</small></span></DropdownMenuItem><DropdownMenuItem onClick={() => setView("accounts")}><CreditCard /><span><strong>Fatura do cartão</strong><small>Veja o fechamento e limite disponível</small></span></DropdownMenuItem><DropdownMenuItem onClick={() => setView("goals")}><Target /><span><strong>Metas em andamento</strong><small>Acompanhe seu progresso</small></span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <Button className="primary-button new-transaction-button" onClick={newItem}><Plus /> Nova transação</Button>
        </div>
      </header>
      {!online && <div className="offline-banner"><Database /> Você está offline. As alterações continuarão salvas neste dispositivo e poderão ser sincronizadas pelo backend depois.</div>}
      <main className="main-content">{content}</main>
      <MobileNav view={view} navigate={setView} newItem={newItem} />
    </SidebarInset>
    <TransactionModal open={modalOpen} setOpen={setModalOpen} form={form} setForm={setForm} editing={editing} submit={submit} accountNames={accounts.map((account) => account.name)} cardNames={accounts.filter((account) => account.type === "Cartão de crédito").map((account) => account.name)} />
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(value) => !value && setDeleteTarget(null)}><AlertDialogContent className="transaction-dialog"><AlertDialogHeader><AlertDialogTitle>Excluir esta transação?</AlertDialogTitle><AlertDialogDescription>“{deleteTarget?.description}” será removida. Você poderá desfazer logo depois.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="delete-button" onClick={confirmDelete}>Excluir transação</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <ImportReviewDialog open={importOpen} setOpen={setImportOpen} drafts={importDrafts} confirm={async (selected) => { setImportOpen(false); await sync.importTransactions(selected.map(({ id: droppedId, ...rest }) => { void droppedId; return rest as NewTransaction })) }} />
    <CommandPalette open={commandOpen} setOpen={setCommandOpen} navigate={setView} newTransaction={newItem} />
    <Toaster position="bottom-right" />
  </SidebarProvider></CategoriesContext.Provider>
}
