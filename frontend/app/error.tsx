"use client"
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#080b09", color: "#f4f6f4" }}><section style={{ maxWidth: 460 }} role="alert"><h1>Não foi possível abrir esta tela</h1><p>Tente novamente. Se o problema continuar, recarregue a página. Não apague os dados do navegador sem fazer uma cópia.</p><button onClick={reset} style={{ padding: "14px 22px", borderRadius: 12, background: "#22c55e", color: "#031207", border: 0, cursor: "pointer", fontWeight: 700 }}>Tentar novamente</button></section></main>
}
