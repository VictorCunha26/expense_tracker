import Link from "next/link"
import { CircleCheck, Clock3, ShieldCheck, XCircle } from "lucide-react"

type Status = "success" | "pending" | "declined"

const content = {
  success: { icon: CircleCheck, eyebrow: "Retorno do checkout", title: "Pagamento recebido", description: "Assim que a Cakto confirmar o pagamento, crie sua conta com o mesmo e-mail usado na compra. Este retorno do checkout, sozinho, não comprova o pagamento.", action: "Criar minha conta" },
  pending: { icon: Clock3, eyebrow: "Pagamento em análise", title: "Estamos aguardando a confirmação", description: "Alguns meios de pagamento podem levar alguns minutos para serem aprovados. Você pode voltar ao painel enquanto a Cakto conclui a análise.", action: "Voltar ao painel" },
  declined: { icon: XCircle, eyebrow: "Pagamento não concluído", title: "Revise o status da sua compra", description: "Consulte o status na Cakto antes de tentar novamente. Se a compra foi recusada, revise os dados ou escolha outro meio de pagamento.", action: "Voltar ao início" },
} as const

export function PaymentStatusPage({ status }: { status: Status }) {
  const item = content[status], Icon = item.icon
  return <main className={`payment-status-page ${status}`}><section><div className="payment-brand"><img src="/synch-cash-logo.png" alt="Synch Cash" /></div><span className="payment-status-icon"><Icon /></span><small>{item.eyebrow}</small><h1>{item.title}</h1><p>{item.description}</p><div className="payment-status-actions"><Link className="payment-primary" href="/">{item.action}</Link><a href="mailto:suporte@synchcash.com.br">Falar com o suporte</a></div><div className="payment-security"><ShieldCheck /><span><strong>Pagamento protegido</strong><small>Processado com segurança pela Cakto</small></span></div></section></main>
}
