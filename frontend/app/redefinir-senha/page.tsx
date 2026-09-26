"use client"

import { FormEvent, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"
import { synchApi, SynchApiError } from "@/lib/synch-api"

type Status = "loading" | "ready" | "invalid" | "done"

export default function RedefinirSenhaPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status>("loading"), [invalidReason, setInvalidReason] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [refreshToken, setRefreshToken] = useState("")
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [showPassword, setShowPassword] = useState(false), [saving, setSaving] = useState(false)

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    // Os tokens do link não devem ficar na barra de endereço nem no histórico.
    if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname)
    const errorCode = fragment.get("error_code") || searchParams.get("error_code")
    if (errorCode) {
      setInvalidReason(errorCode === "otp_expired" ? "Este link já foi usado ou expirou. Cada link funciona uma vez só e vale por pouco tempo; peça um novo." : "O Supabase recusou este link. Peça um novo link de recuperação.")
      setStatus("invalid")
      return
    }
    const fragmentToken = fragment.get("access_token")
    if (fragmentToken) {
      setAccessToken(fragmentToken)
      setRefreshToken(fragment.get("refresh_token") || "")
      setStatus("ready")
      return
    }
    const code = searchParams.get("code"), tokenHash = searchParams.get("token_hash")
    if (code || tokenHash) {
      synchApi.exchangeResetCode(tokenHash ? { tokenHash } : { code: code! })
        .then((result) => { setAccessToken(result.accessToken); setRefreshToken(result.refreshToken); setStatus("ready") })
        .catch(() => setStatus("invalid"))
      return
    }
    setStatus("invalid")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < 6) return toast.error("A nova senha precisa ter pelo menos 6 caracteres.")
    if (password !== confirmation) return toast.error("As senhas não coincidem.")
    setSaving(true)
    try {
      await synchApi.confirmResetPassword(accessToken, refreshToken, password)
      setStatus("done")
      toast.success("Senha atualizada! Você já pode entrar.")
      window.setTimeout(() => router.push("/"), 1500)
    } catch (error) {
      toast.error(error instanceof SynchApiError ? error.message : "Não foi possível atualizar a senha.")
    } finally {
      setSaving(false)
    }
  }

  return <main className="login-page">
    <section className="login-access" style={{ width: "100%" }}>
      <div className="login-access-inner">
        <div className="login-mobile-brand"><div className="brand-lockup"><span className="brand-logo-frame"><img className="brand-logo" src="/synch-cash-logo.png" alt="Synch Cash" /></span></div></div>
        <div className="login-form-heading">
          <span className="login-welcome-icon"><LockKeyhole /></span>
          <h2>Redefinir senha</h2>
          <p>{status === "invalid" ? invalidReason || "O link é inválido ou expirou. Solicite a recuperação novamente." : status === "done" ? "Senha atualizada com sucesso." : "Escolha uma nova senha para sua conta."}</p>
        </div>
        {status === "ready" && <form className="login-form" onSubmit={submit}>
          <label className="login-field"><span>Nova senha</span><div><LockKeyhole /><Input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo de 6 caracteres" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          <label className="login-field"><span>Confirmar nova senha</span><div><LockKeyhole /><Input type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repita a senha" /></div></label>
          <Button className="primary-button login-submit" type="submit" disabled={saving}>{saving ? "Salvando..." : "Atualizar senha"}</Button>
        </form>}
        {status === "loading" && <div className="auth-loading-logo"><span /></div>}
        {(status === "invalid" || status === "done") && <Button className="primary-button login-submit" onClick={() => router.push("/")}>Voltar para o login</Button>}
        <div className="login-security"><ShieldCheck /><span><strong>Dados protegidos</strong><small>A troca de senha é validada pelo Supabase Auth.</small></span></div>
      </div>
    </section>
    <Toaster position="bottom-right" />
  </main>
}
