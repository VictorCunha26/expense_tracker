export type ViewKey = "overview" | "transactions" | "calendar" | "categories" | "accounts" | "recurring" | "goals" | "planning" | "calculator" | "reports" | "assistant" | "subscription" | "settings"

export type Transaction = {
  id: number
  description: string
  category: string
  date: string
  amount: number
  type: "expense" | "income"
  account: string
  status: "paid" | "pending"
  notes?: string
  recurring?: boolean
  merchant?: string
  paymentMethod?: string
  kind?: "purchase" | "refund" | "transfer"
  receiptName?: string
  qualityResolved?: boolean
  transferPairId?: number
  cardId?: number
  invoiceCycle?: string
  invoicePaymentId?: number
  split?: Array<{ category: string; amount: number }>
}

export type Account = {
  id: number
  name: string
  type: "Conta corrente" | "Cartão de crédito" | "Dinheiro"
  balance: number
  detail: string
  color: string
  creditLimit?: number
  closingDay?: number
  dueDay?: number
  lastFour?: string
}

export type InvoicePayment = {
  id: number
  transactionId: number
  reversalTransactionId?: number
  cardId: number
  cardName: string
  cycle: string
  sourceAccountId: number
  sourceAccountName: string
  amount: number
  date: string
  mode: "full" | "partial"
  status: "active" | "reversed"
  createdAt: string
  reversedAt?: string
  idempotencyKey: string
}

export type InvoiceAdjustment = { id: string; cardId: number; cycle: string; amount: number; reason: string; createdAt: string; status: "active" | "reversed"; reversedAt?: string }
export type LocalLedger = { version: 2; accounts: Account[]; items: Transaction[]; payments: InvoicePayment[]; adjustments: InvoiceAdjustment[] }

export type GoalData = { id: number; name: string; saved: number; target: number; deadline: string; color: string }
export type RecurringData = { id: number; name: string; category: string; amount: number; type: "expense" | "income"; next: string; active: boolean; day?: number }
export type Preferences = { name: string; email: string; notifications: boolean; weekly: boolean }

export type AssistantProposal =
  | { kind: "transactions"; confidence: number; drafts: Array<{ description: string; amount: number; type: "expense" | "income"; category: string; date: string; account: string; status: "paid" | "pending"; installments: number; recurring: boolean }> }
  | { kind: "budget"; confidence: number; category: string; amount: number }
  | { kind: "goal"; confidence: number; name: string; amount: number; deadline?: string }
  | { kind: "recurring"; confidence: number; name: string; category: string; amount: number; type: "expense" | "income"; day: number }

export type AssistantRequest = {
  message: string
  history: Array<{ role: "user" | "assistant"; text: string }>
  source: "text" | "voice"
  month: string
  hidden: boolean
  pendingAction: object | null
  lastUndo: string | null
}

export type AssistantReply = { conversationId: string; answer: string; action: AssistantProposal | null; decision: "confirm" | "cancel" | "undo" | null }

export type SynchBootstrap = {
  transactions: Transaction[]
  accounts: Account[]
  invoicePayments?: InvoicePayment[]
  invoiceAdjustments?: InvoiceAdjustment[]
  budgets: Record<string, number>
  recurring: RecurringData[]
  goals: GoalData[]
  preferences: Preferences
  categories?: string[]
}
