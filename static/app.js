/* ==========================================================
   Synch Cash — interações do painel

   Sem framework: os diálogos são <dialog> nativos, os menus são
   <details>, e os filtros vão por formulário GET. Este arquivo cobre
   só o que precisa de JS de verdade — preencher formulários de edição,
   tooltip dos gráficos e ocultar valores.
   ========================================================== */

(() => {
  "use strict"

  const $ = (seletor, raiz = document) => raiz.querySelector(seletor)
  const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor))

  /* ---------------------------------------------------------
     Diálogos
     --------------------------------------------------------- */

  const abrir = (id) => {
    const dialogo = document.getElementById(id)
    if (dialogo && !dialogo.open) dialogo.showModal()
    return dialogo
  }

  document.addEventListener("click", (evento) => {
    const gatilho = evento.target.closest("[data-abrir]")
    if (gatilho) {
      abrir(gatilho.dataset.abrir)
      return
    }
    if (evento.target.closest("[data-fechar]")) {
      evento.target.closest("dialog")?.close()
    }
  })

  // Clicar no fundo escuro fecha: o <dialog> recebe o clique quando ele
  // cai fora da caixa, então basta comparar o alvo com o próprio diálogo.
  $$("dialog.modal").forEach((dialogo) => {
    dialogo.addEventListener("click", (evento) => {
      if (evento.target === dialogo) dialogo.close()
    })
  })

  /* ---------------------------------------------------------
     Menus <details>: fecham ao clicar fora ou apertar Esc
     --------------------------------------------------------- */

  document.addEventListener("click", (evento) => {
    $$("details.menu[open]").forEach((menu) => {
      if (!menu.contains(evento.target)) menu.open = false
    })
  })

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") $$("details.menu[open]").forEach((m) => { m.open = false })
  })

  /* ---------------------------------------------------------
     Modal de transação: novo x editar
     --------------------------------------------------------- */

  const formTransacao = $("#form-transacao")

  const definirTipo = (tipo) => {
    $("#campo-tipo").value = tipo
    $$(".type-toggle button").forEach((botao) => {
      botao.classList.toggle("active", botao.dataset.tipo === tipo)
      botao.classList.toggle(tipo, botao.dataset.tipo === tipo)
    })
    // Receita não se divide em parcelas nem escolhe categoria de gasto.
    if (tipo === "receita") $("#campo-categoria").value = "Receita"
    $("#campo-parcelas-wrap").style.display = tipo === "receita" ? "none" : ""
  }

  $$(".type-toggle button").forEach((botao) => {
    botao.addEventListener("click", () => definirTipo(botao.dataset.tipo))
  })

  const prepararNova = () => {
    if (!formTransacao) return
    formTransacao.reset()
    $("#campo-id").value = ""
    $("#titulo-transacao").textContent = "Nova transação"
    $("#rotulo-salvar").textContent = "Adicionar transação"
    $("#campo-parcelas").disabled = false
    definirTipo("despesa")
  }

  $$("[data-abrir='modal-transacao']").forEach((botao) => {
    botao.addEventListener("click", prepararNova)
  })

  document.addEventListener("click", (evento) => {
    const item = evento.target.closest("[data-editar]")
    if (!item || !formTransacao) return

    const d = item.dataset
    $("#campo-id").value = d.id
    $("#campo-nome").value = d.nome
    $("#campo-valor").value = String(d.valor).replace(".", ",")
    $("#campo-data").value = d.data
    $("#campo-categoria").value = d.categoria
    $("#campo-conta").value = d.conta
    $("#campo-status").value = d.status
    $("#campo-descricao").value = d.descricao
    $("#campo-recorrente").checked = d.recorrente === "1"
    definirTipo(d.tipo)

    // Editar mexe numa linha só; mudar o número de parcelas aqui
    // reescreveria um lançamento que já existe.
    $("#campo-parcelas").value = "1"
    $("#campo-parcelas").disabled = true

    $("#titulo-transacao").textContent = "Editar transação"
    $("#rotulo-salvar").textContent = "Salvar alterações"
    item.closest("details.menu")?.removeAttribute("open")
    abrir("modal-transacao")
  })

  /* ---------------------------------------------------------
     Exclusão: um único diálogo serve todas as telas
     --------------------------------------------------------- */

  document.addEventListener("click", (evento) => {
    const gatilho = evento.target.closest("[data-excluir]")
    if (!gatilho) return

    const d = gatilho.dataset
    const form = $("#form-excluir")
    form.action = d.acao
    // A rota de transações espera 'id_despesa'; as demais, 'id'.
    $("#excluir-id").value = d.campo === "id" ? d.id : ""
    $("#excluir-id-despesa").value = d.campo === "id_despesa" ? d.id : ""
    $("#titulo-excluir").textContent = d.titulo || "Excluir?"
    $("#texto-excluir").textContent = d.texto || "Esta ação não pode ser desfeita."

    gatilho.closest("details.menu")?.removeAttribute("open")
    abrir("modal-excluir")
  })

  /* ---------------------------------------------------------
     Contas, orçamentos e metas
     --------------------------------------------------------- */

  // Cartão troca o campo de saldo pelos dias do ciclo: o valor da fatura
  // é calculado pelos lançamentos, então não existe saldo pra digitar.
  const ajustarTipoConta = () => {
    const tipo = $("#conta-tipo")
    if (!tipo) return
    const cartao = tipo.value === "Cartão de crédito"
    $("#campo-saldo").hidden = cartao
    $("#conta-saldo").disabled = cartao
    $("#campo-ciclo").hidden = !cartao
    $("#dica-cartao").hidden = !cartao
    const rotulo = $("#campo-saldo span")
    if (rotulo) rotulo.textContent = tipo.value === "Dinheiro" ? "Valor inicial em espécie" : "Saldo inicial"
  }
  $("#conta-tipo")?.addEventListener("change", ajustarTipoConta)

  $$("[data-nova-conta]").forEach((botao) => {
    botao.addEventListener("click", () => {
      $("#conta-id").value = ""
      $("#conta-nome").value = ""
      $("#conta-saldo").value = ""
      $("#conta-detalhe").value = ""
      $("#conta-fechamento").value = "28"
      $("#conta-vencimento").value = "10"
      $("#titulo-conta").textContent = "Nova conta ou cartão"
      ajustarTipoConta()
    })
  })

  /* ---------------------------------------------------------
     Fatura do cartão
     --------------------------------------------------------- */

  document.addEventListener("click", (evento) => {
    const item = evento.target.closest("[data-pagar-fatura]")
    if (!item) return
    const d = item.dataset
    $("#fatura-conta-id").value = d.id
    $("#fatura-mes").value = d.mes
    $("#fatura-valor").value = d.valor
    $("#fatura-nome").textContent = d.nome
    $("#fatura-vence").textContent = d.vence
    $("#fatura-total").textContent = d.valorTexto
    avisarSaldoInsuficiente()
    abrir("modal-fatura")
  })

  // Avisa antes de confirmar que a conta escolhida vai ficar negativa.
  const avisarSaldoInsuficiente = () => {
    const origem = $("#fatura-origem")
    const dica = $("#dica-saldo")
    if (!origem || !dica) return
    const saldo = parseFloat(origem.selectedOptions[0]?.dataset.saldo || "0")
    dica.hidden = saldo >= parseFloat($("#fatura-valor").value || "0")
  }
  $("#fatura-origem")?.addEventListener("change", avisarSaldoInsuficiente)

  document.addEventListener("click", (evento) => {
    const item = evento.target.closest("[data-reabrir]")
    if (!item) return
    $("#reabrir-conta-id").value = item.dataset.id
    $("#reabrir-mes").value = item.dataset.mes
    $("#form-reabrir").submit()
  })

  document.addEventListener("click", (evento) => {
    const item = evento.target.closest("[data-editar-conta]")
    if (!item) return
    const d = item.dataset
    $("#conta-id").value = d.id
    $("#conta-nome").value = d.nome
    $("#conta-tipo").value = d.tipo
    $("#conta-saldo").value = String(d.saldo).replace(".", ",")
    $("#conta-detalhe").value = d.detalhe
    $("#conta-cor").value = d.cor
    $("#conta-fechamento").value = d.fechamento || "28"
    $("#conta-vencimento").value = d.vencimento || "10"
    $("#titulo-conta").textContent = d.tipo === "Cartão de crédito" ? "Editar cartão" : "Editar conta"
    ajustarTipoConta()
    item.closest("details.menu")?.removeAttribute("open")
    abrir("modal-conta")
  })

  document.addEventListener("click", (evento) => {
    const item = evento.target.closest("[data-editar-orcamento]")
    if (!item) return
    $("#orcamento-categoria").value = item.dataset.categoria
    $("#orcamento-categoria-rotulo").textContent = item.dataset.categoria
    $("#orcamento-limite").value = String(item.dataset.limite).replace(".", ",")
    abrir("modal-orcamento")
  })

  document.addEventListener("click", (evento) => {
    const item = evento.target.closest("[data-aportar]")
    if (!item) return
    $("#aporte-id").value = item.dataset.id
    $("#aporte-nome").textContent = item.dataset.nome
    item.closest("details.menu")?.removeAttribute("open")
    abrir("modal-aporte")
  })

  /* ---------------------------------------------------------
     Assistente: chips preenchem e enviam a pergunta
     --------------------------------------------------------- */

  $$("[data-sugestao]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const campo = $("#pergunta")
      campo.value = chip.dataset.sugestao
      campo.form.submit()
    })
  })

  // Conversa longa: começa já no fim.
  const chat = $("#chat")
  if (chat) chat.scrollTop = chat.scrollHeight

  /* ---------------------------------------------------------
     Ocultar valores (o "olho" da topbar)
     --------------------------------------------------------- */

  const botaoOlho = $("#alternar-valores")
  const CHAVE = "synch-cash-ocultar"
  const ICONE_OLHO = botaoOlho ? botaoOlho.innerHTML : ""
  const ICONE_OLHO_FECHADO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`

  const aplicarOcultacao = (oculto) => {
    $$(".valor").forEach((elemento) => {
      if (!elemento.dataset.original) elemento.dataset.original = elemento.textContent
      elemento.textContent = oculto ? "R$ ••••" : elemento.dataset.original
    })
    if (!botaoOlho) return
    botaoOlho.setAttribute("aria-pressed", String(oculto))
    botaoOlho.setAttribute("aria-label", oculto ? "Mostrar valores" : "Ocultar valores")
    // Troca o ícone entre olho aberto e olho cortado.
    botaoOlho.innerHTML = oculto ? ICONE_OLHO_FECHADO : ICONE_OLHO
  }

  if (botaoOlho) {
    let oculto = localStorage.getItem(CHAVE) === "1"
    if (oculto) aplicarOcultacao(true)
    botaoOlho.addEventListener("click", () => {
      oculto = !oculto
      localStorage.setItem(CHAVE, oculto ? "1" : "0")
      aplicarOcultacao(oculto)
    })
  }

  /* ---------------------------------------------------------
     Tooltip dos gráficos
     --------------------------------------------------------- */

  const tooltip = $("#tooltip")

  const mostrarTooltip = (evento, alvo) => {
    if (!tooltip) return
    tooltip.innerHTML = `<span>${alvo.dataset.rotulo}</span><strong>${alvo.dataset.valor}</strong>`
    tooltip.classList.add("visivel")
    // Segue o cursor, mas sem escapar pela direita da janela.
    const largura = tooltip.offsetWidth
    const x = Math.min(evento.clientX + 14, window.innerWidth - largura - 10)
    tooltip.style.left = `${x}px`
    tooltip.style.top = `${evento.clientY - 46}px`
  }

  const esconderTooltip = () => tooltip?.classList.remove("visivel")

  document.addEventListener("mousemove", (evento) => {
    const alvo = evento.target.closest("[data-valor][data-rotulo]")
    if (alvo) mostrarTooltip(evento, alvo)
    else esconderTooltip()
  })
  document.addEventListener("mouseleave", esconderTooltip)
  window.addEventListener("scroll", esconderTooltip, { passive: true })

  /* ---------------------------------------------------------
     Sidebar no celular
     --------------------------------------------------------- */

  const sidebar = $("#sidebar")
  const botaoMenu = $("#abrir-menu")
  let fundo = null

  const fecharSidebar = () => {
    sidebar?.classList.remove("aberta")
    botaoMenu?.setAttribute("aria-expanded", "false")
    fundo?.remove()
    fundo = null
  }

  botaoMenu?.addEventListener("click", () => {
    const aberta = sidebar.classList.toggle("aberta")
    botaoMenu.setAttribute("aria-expanded", String(aberta))
    if (aberta) {
      fundo = document.createElement("div")
      fundo.className = "sidebar-backdrop"
      fundo.addEventListener("click", fecharSidebar)
      document.body.appendChild(fundo)
    } else {
      fecharSidebar()
    }
  })

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") fecharSidebar()
  })

  /* ---------------------------------------------------------
     Avisos somem sozinhos
     --------------------------------------------------------- */

  $$(".toast").forEach((aviso, indice) => {
    setTimeout(() => {
      aviso.classList.add("saindo")
      aviso.addEventListener("animationend", () => aviso.remove())
    }, 4000 + indice * 350)
  })
})()
