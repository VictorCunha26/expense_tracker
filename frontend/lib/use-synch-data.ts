"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { synchApi, SynchApiError, type NewAccount, type NewTransaction } from "./synch-api"
import { defaultCategories } from "./categories"
import type { Account, GoalData, InvoiceAdjustment, InvoicePayment, Preferences, RecurringData, Transaction } from "./models"

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error"
export type Plan = "gratis" | "synch_ia"

type SynchData = {
  transactions: Transaction[]
  accounts: Account[]
  invoicePayments: InvoicePayment[]
  invoiceAdjustments: InvoiceAdjustment[]
  budgets: Record<string, number>
  recurring: RecurringData[]
  goals: GoalData[]
  preferences: Preferences
  categories: string[]
  plan: Plan
}

const empty: SynchData = {
  transactions: [], accounts: [], invoicePayments: [], invoiceAdjustments: [],
  budgets: {}, recurring: [], goals: [],
  preferences: { name: "", email: "", notifications: true, weekly: true },
  categories: defaultCategories,
  plan: "gratis",
}

// Fonte unica dos dados reais: carrega tudo de /v1/bootstrap uma vez, e toda
// mutacao (criar transacao, pagar fatura, etc.) e seguida de um refresh --
// nunca aplicamos o efeito localmente por cima, pra nao duplicar calculo que
// o servidor ja fez (ver docs/BACKEND_INTEGRATION.md do design original).
// `onPlanLimit` é chamado quando o servidor recusa uma ação por causa do plano (403 PLAN_LIMIT) --
// o app leva o usuário pra tela de assinatura, com o motivo exato já explicado no toast.
export function useSynchData(onPlanLimit?: () => void) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [data, setData] = useState<SynchData>(empty)
  const loadingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const boot = await synchApi.bootstrap()
      setData({
        transactions: boot.transactions,
        accounts: boot.accounts,
        invoicePayments: boot.invoicePayments || [],
        invoiceAdjustments: boot.invoiceAdjustments || [],
        budgets: boot.budgets,
        recurring: boot.recurring,
        goals: boot.goals,
        preferences: boot.preferences,
        categories: boot.categories?.length ? boot.categories : defaultCategories,
        plan: boot.plan,
      })
      setStatus("authenticated")
    } catch (error) {
      if (error instanceof SynchApiError && error.status === 401) {
        setStatus("unauthenticated")
        return
      }
      setStatus("error")
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar seus dados.")
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const guard = useCallback(async <T,>(action: () => Promise<T>, successMessage?: string): Promise<T | null> => {
    try {
      const result = await action()
      if (successMessage) toast.success(successMessage)
      await refresh()
      return result
    } catch (error) {
      if (error instanceof SynchApiError && error.status === 401) {
        setStatus("unauthenticated")
        return null
      }
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a ação.")
      if (error instanceof SynchApiError && error.code === "PLAN_LIMIT") onPlanLimit?.()
      return null
    }
  }, [refresh, onPlanLimit])

  return {
    status,
    setUnauthenticated: () => setStatus("unauthenticated"),
    ...data,
    refresh,

    createTransaction: (t: NewTransaction) => guard(() => synchApi.createTransaction(t)),
    updateTransaction: (t: Transaction) => guard(() => synchApi.saveTransaction(t)),
    deleteTransaction: (id: number) => guard(() => synchApi.deleteTransaction(id)),

    createAccount: (a: NewAccount) => guard(() => synchApi.createAccount(a)),
    saveAccount: (a: Account) => guard(() => synchApi.saveAccount(a)),
    deleteAccount: (id: number) => guard(() => synchApi.deleteAccount(id)),

    createCategory: (name: string) => guard(() => synchApi.createCategory(name)),
    renameCategory: (name: string, newName: string) => guard(() => synchApi.renameCategory(name, newName)),
    deleteCategory: (name: string) => guard(() => synchApi.deleteCategory(name)),

    saveBudgets: (b: Record<string, number>) => guard(() => synchApi.saveBudgets(b)),

    createRecurring: (r: Omit<RecurringData, "id" | "next">) => guard(() => synchApi.createRecurring(r)),
    saveRecurring: (r: RecurringData) => guard(() => synchApi.saveRecurring(r)),
    deleteRecurring: (id: number) => guard(() => synchApi.deleteRecurring(id)),

    createGoal: (g: Omit<GoalData, "id">) => guard(() => synchApi.createGoal(g)),
    saveGoal: (g: GoalData) => guard(() => synchApi.saveGoal(g)),
    deleteGoal: (id: number) => guard(() => synchApi.deleteGoal(id)),

    savePreferences: (p: Preferences) => guard(() => synchApi.savePreferences(p)),

    createTransfer: (payload: { fromAccountId: number; toAccountId: number; amount: number; date: string; description?: string }) =>
      guard(() => synchApi.createTransfer(payload)),

    registerInvoicePayment: (cardId: number, cycle: string, payload: { sourceAccountId: number; amount: number; date: string; mode: "full" | "partial"; idempotencyKey: string }) =>
      guard(() => synchApi.registerInvoicePayment(cardId, cycle, payload)),
    reverseInvoicePayment: (paymentId: number) => guard(() => synchApi.reverseInvoicePayment(paymentId)),
    reconcileInvoice: (cardId: number, cycle: string, payload: { total: number; reason: string }) =>
      guard(() => synchApi.reconcileInvoice(cardId, cycle, payload)),

    importTransactions: (items: NewTransaction[]) => guard(() => synchApi.importTransactions(items), `${items.length} movimentações importadas.`),

    signOut: async () => {
      try { await synchApi.signOut() } catch { /* mesmo se falhar, esvazia a sessao local */ }
      setData(empty)
      setStatus("unauthenticated")
    },
  }
}

export type SynchDataHook = ReturnType<typeof useSynchData>
