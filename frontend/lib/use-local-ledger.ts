"use client"
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import { toast } from "sonner"
import type { Account, InvoicePayment, LocalLedger, Transaction } from "./models"
import { migrateLedger, normalizeBalances } from "./invoice-ledger"
const KEY = "synch-cash-ledger-v2"
const read = <T,>(key: string, fallback: T): T => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback }
export function useLocalLedger(seedAccounts: Account[], seedItems: Transaction[]) {
  const loadFailed = useRef(false)
  const [ledger, setLedger] = useState<LocalLedger>(() => {
    if (typeof window === "undefined") return migrateLedger(seedAccounts, seedItems, [])
    try {
      const saved = read<LocalLedger | null>(KEY, null)
      if (saved?.version === 2) return normalizeBalances(saved)
      return migrateLedger(read("synch-cash-accounts", seedAccounts), read("synch-cash-transactions", seedItems), read<InvoicePayment[]>("synch-cash-invoice-payments-v1", []))
    } catch { loadFailed.current = true; return migrateLedger(seedAccounts, seedItems, []) }
  })
  const latest = useRef(ledger), serialized = useRef<string | null>(null)
  useEffect(() => { try { serialized.current = localStorage.getItem(KEY) } catch { loadFailed.current = true } if (loadFailed.current) toast.error("Não foi possível ler seus dados locais. Nenhum registro será sobrescrito; preserve uma cópia e recarregue.") }, [])
  // One device-local write commits balances, invoice history and transactions together.
  const commit = useCallback((change: (current: LocalLedger) => LocalLedger): boolean => {
    try {
      if (loadFailed.current) throw new Error("Armazenamento indisponível. Seus registros originais foram preservados.")
      const disk = localStorage.getItem(KEY)
      if (disk !== serialized.current) throw new Error("Os dados mudaram em outra aba. Recarregue antes de continuar.")
      const next = normalizeBalances(change(latest.current)), raw = JSON.stringify(next)
      localStorage.setItem(KEY, raw)
      serialized.current = raw; latest.current = next; setLedger(next)
      return true
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar neste dispositivo."); return false }
  }, [])
  const setItems = useCallback((action: SetStateAction<Transaction[]>) => {
    commit(current => {
      const next = typeof action === "function" ? action(current.items) : action
      for (const item of current.items.filter(i => i.invoicePaymentId)) {
        if (JSON.stringify(next.find(i => i.id === item.id)) !== JSON.stringify(item)) throw new Error("Pagamentos são protegidos. Use Estornar em Contas e cartões.")
      }
      return { ...current, items: next }
    })
  }, [commit])
  const setAccounts = useCallback((action: SetStateAction<Account[]>) => {
    commit(current => {
      const next = typeof action === "function" ? action(current.accounts) : action
      for (const old of current.accounts) {
        const updated = next.find(a => a.id === old.id)
        if ((!updated || updated.type !== old.type) && (current.payments.some(p => p.cardId === old.id || p.sourceAccountId === old.id) || current.items.some(i => i.cardId === old.id || i.account === old.name))) throw new Error("Esta conta possui histórico. Preserve seu tipo e seus registros.")
      }
      const items = current.items.map(i => { const old = current.accounts.find(a => a.name === i.account), updated = next.find(a => a.id === old?.id); return updated ? { ...i, account: updated.name } : i })
      return { ...current, accounts: next, items }
    })
  }, [commit])
  return { ledger, commit, setItems, setAccounts }
}
