import type { Account, GoalData, InvoiceAdjustment, InvoicePayment, Preferences, RecurringData, SynchBootstrap, Transaction } from "./models"

// Sem NEXT_PUBLIC_API_URL definida, o cliente assume a MESMA origem: em
// producao a Vercel roteia /api/* pro Flask, entao um caminho relativo
// "/api/v1/..." ja chega no lugar certo sem CORS nenhum. Em dev (dois
// servidores, :3000 e :5000) defina NEXT_PUBLIC_API_URL=http://localhost:5000/api
// no .env.local do front.
const envUrl = process.env.NEXT_PUBLIC_API_URL
const baseUrl = (envUrl !== undefined ? envUrl : "/api").replace(/\/$/, "")

export const backendConfig = {
  configured: true,
  connected: true,
  baseUrl,
} as const

export class SynchApiError extends Error {
  constructor(public status: number, message: string, public code = "API_ERROR", public requestId?: string) {
    super(message)
    this.name = "SynchApiError"
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!/^\/v1\//.test(path)) throw new SynchApiError(0, "Caminho de API inválido.", "INVALID_PATH")
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  if (init?.body && !isFormData) headers.set("Content-Type", "application/json")
  const controller = new AbortController()
  const abort = () => controller.abort()
  init?.signal?.addEventListener("abort", abort, { once: true })
  if (init?.signal?.aborted) abort()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string; code?: string } | null
      const fallback = response.status === 401 ? "Sua sessão expirou. Entre novamente." : response.status === 409 ? "Os dados foram atualizados. Recarregue antes de continuar." : response.status === 429 ? "Muitas solicitações. Aguarde antes de tentar novamente." : "Não foi possível concluir a solicitação."
      throw new SynchApiError(response.status, body?.message || fallback, body?.code, response.headers.get("X-Request-Id") || undefined)
    }
    if (response.status === 204) return undefined as T
    try { return await response.json() as T } catch { throw new SynchApiError(response.status, "A API devolveu uma resposta inválida.", "INVALID_RESPONSE") }
  } catch (error) {
    if (error instanceof SynchApiError) throw error
    if (controller.signal.aborted) throw new SynchApiError(0, timedOut ? "O servidor demorou para responder. Confira o resultado antes de repetir uma alteração." : "Solicitação cancelada.", timedOut ? "TIMEOUT" : "ABORTED")
    throw new SynchApiError(0, "Não foi possível alcançar o servidor. Verifique sua conexão.", "NETWORK_ERROR")
  } finally {
    clearTimeout(timer)
    init?.signal?.removeEventListener("abort", abort)
  }
}

export type NewTransaction = Omit<Transaction, "id"> & { installments?: number }
export type NewAccount = Omit<Account, "id" | "balance"> & { balance?: number }

export const synchApi = {
  bootstrap: (signal?: AbortSignal) => request<SynchBootstrap & { plan: "gratis" | "synch_ia" }>("/v1/bootstrap", { signal }),

  signIn: (email: string, password: string, remember = true) => request<{ user: Preferences }>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember }) }),
  signUp: (name: string, email: string, password: string) => request<{ user: Preferences; needsEmailConfirmation?: boolean }>("/v1/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  signOut: () => request<void>("/v1/auth/logout", { method: "POST" }),
  forgotPassword: (email: string) => request<{ message: string }>("/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  changePassword: (newPassword: string) => request<void>("/v1/auth/password", { method: "PUT", body: JSON.stringify({ newPassword }) }),
  exchangeResetCode: (code: string) => request<{ accessToken: string; refreshToken: string }>("/v1/auth/reset-password/exchange", { method: "POST", body: JSON.stringify({ code }) }),
  confirmResetPassword: (accessToken: string, refreshToken: string, newPassword: string) => request<{ message: string }>("/v1/auth/reset-password/confirm", { method: "POST", body: JSON.stringify({ accessToken, refreshToken, newPassword }) }),

  createTransaction: (transaction: NewTransaction) => request<Transaction[]>("/v1/transactions", { method: "POST", body: JSON.stringify(transaction) }),
  saveTransaction: (transaction: Transaction) => request<Transaction>(`/v1/transactions/${transaction.id}`, { method: "PUT", body: JSON.stringify(transaction) }),
  deleteTransaction: (id: number) => request<void>(`/v1/transactions/${id}`, { method: "DELETE" }),

  createAccount: (account: NewAccount) => request<Account>("/v1/accounts", { method: "POST", body: JSON.stringify(account) }),
  saveAccount: (account: Account) => request<Account>(`/v1/accounts/${account.id}`, { method: "PUT", body: JSON.stringify(account) }),
  deleteAccount: (id: number) => request<void>(`/v1/accounts/${id}`, { method: "DELETE" }),

  createCategory: (name: string) => request<{ name: string }>("/v1/categories", { method: "POST", body: JSON.stringify({ name }) }),
  renameCategory: (name: string, newName: string) => request<{ name: string }>("/v1/categories", { method: "PUT", body: JSON.stringify({ name, newName }) }),
  deleteCategory: (name: string) => request<void>(`/v1/categories?name=${encodeURIComponent(name)}`, { method: "DELETE" }),

  saveBudgets: (budgets: Record<string, number>) => request<Record<string, number>>("/v1/budgets", { method: "PUT", body: JSON.stringify(budgets) }),

  createRecurring: (item: Omit<RecurringData, "id" | "next">) => request<RecurringData>("/v1/recurring", { method: "POST", body: JSON.stringify(item) }),
  saveRecurring: (item: RecurringData) => request<RecurringData>(`/v1/recurring/${item.id}`, { method: "PUT", body: JSON.stringify(item) }),
  deleteRecurring: (id: number) => request<void>(`/v1/recurring/${id}`, { method: "DELETE" }),

  createGoal: (goal: Omit<GoalData, "id">) => request<GoalData>("/v1/goals", { method: "POST", body: JSON.stringify(goal) }),
  saveGoal: (goal: GoalData) => request<GoalData>(`/v1/goals/${goal.id}`, { method: "PUT", body: JSON.stringify(goal) }),
  deleteGoal: (id: number) => request<void>(`/v1/goals/${id}`, { method: "DELETE" }),

  savePreferences: (preferences: Preferences) => request<Preferences>("/v1/preferences", { method: "PUT", body: JSON.stringify(preferences) }),

  createTransfer: (payload: { fromAccountId: number; toAccountId: number; amount: number; date: string; description?: string }) =>
    request<{ debit: Transaction; credit: Transaction }>("/v1/transfers", { method: "POST", body: JSON.stringify(payload) }),

  getInvoicePayments: (cardId: number, cycle: string) => request<InvoicePayment[]>(`/v1/cards/${cardId}/invoices/${cycle}/payments`),
  registerInvoicePayment: (cardId: number, cycle: string, payload: { sourceAccountId: number; amount: number; date: string; mode: "full" | "partial"; idempotencyKey: string }) =>
    request<InvoicePayment>(`/v1/cards/${cardId}/invoices/${cycle}/payments`, { method: "POST", body: JSON.stringify(payload) }),
  // Estornar apaga o pagamento e o gasto dele: resposta 204, sem corpo.
  reverseInvoicePayment: (paymentId: number) => request<void>(`/v1/invoice-payments/${paymentId}/reverse`, { method: "POST" }),
  reconcileInvoice: (cardId: number, cycle: string, payload: { total: number; reason: string }) =>
    request<InvoiceAdjustment>(`/v1/cards/${cardId}/invoices/${cycle}/adjustments`, { method: "POST", body: JSON.stringify(payload) }),

  uploadReceipt: (transactionId: number, file: File) => {
    const form = new FormData()
    form.append("file", file)
    return request<{ receiptUrl: string }>(`/v1/transactions/${transactionId}/receipts`, { method: "POST", body: form, headers: {} })
  },
  importTransactions: (transactions: NewTransaction[]) =>
    request<Transaction[]>("/v1/transactions/imports", { method: "POST", body: JSON.stringify({ transactions }) }),

  getDataQualityIssues: () => request<Array<{ id: string; type: string; transactionId: number; message: string }>>("/v1/data-quality/issues"),
  resolveDataIssue: (issueId: string) => request<void>(`/v1/data-quality/issues/${issueId}/resolve`, { method: "POST", body: JSON.stringify({}) }),

  getSubscription: () => request<{ plan: "gratis" | "synch_ia"; planName: string; status: string; renewalAt?: string; checkoutUrl?: string }>("/v1/billing/subscription"),
  cancelSubscription: () => request<{ message: string }>("/v1/billing/subscription/cancel", { method: "POST" }),

  sendAssistantMessage: (message: string, conversationId?: string) => request<{ conversationId: string; answer: string }>("/v1/assistant/messages", { method: "POST", body: JSON.stringify({ message, conversationId }) }),
}
