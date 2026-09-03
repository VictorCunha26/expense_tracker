import csv
import io
import math
import os
import unicodedata
import uuid
from collections import defaultdict
from datetime import date, timedelta
from functools import wraps

from flask import (
    Flask, Response, flash, redirect, render_template, request, session, url_for
)

from connection import conectar, conectar_como_usuario, renovar_sessao

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")

MESES_PT = {
    1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
    5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
    9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
}
MESES_CURTO = {
    1: "jan", 2: "fev", 3: "mar", 4: "abr", 5: "mai", 6: "jun",
    7: "jul", 8: "ago", 9: "set", 10: "out", 11: "nov", 12: "dez",
}

CATEGORIAS = ["Moradia", "Alimentação", "Transporte", "Lazer", "Assinaturas", "Receita", "Outros"]
CATEGORIAS_DESPESA = [c for c in CATEGORIAS if c != "Receita"]

# Cores fixas por categoria: o donut, os badges e a lista de orcamentos
# precisam usar exatamente o mesmo tom pro usuario ligar uma coisa na outra.
CORES = {
    "Moradia": "#16a34a", "Alimentação": "#f59e0b", "Transporte": "#3b82f6",
    "Lazer": "#8b5cf6", "Assinaturas": "#06b6d4", "Outros": "#64748b",
    "Receita": "#22c55e",
}
COR_PADRAO = "#64748b"

TIPOS_CONTA = ["Conta corrente", "Cartão de crédito", "Dinheiro"]

ORCAMENTOS_PADRAO = {
    "Moradia": 1600, "Alimentação": 1100, "Transporte": 650,
    "Lazer": 450, "Assinaturas": 300, "Outros": 900,
}

# Titulo e subtitulo da topbar por tela -- fica aqui pra nao repetir
# o texto em cada template.
TITULOS = {
    "overview": ("Visão geral", "Aqui está seu resumo financeiro"),
    "transactions": ("Transações", "Acompanhe todas as entradas e saídas"),
    "accounts": ("Contas e cartões", "Seus saldos em um só lugar"),
    "budgets": ("Orçamentos", "Planeje seus limites mensais"),
    "recurring": ("Recorrentes", "Controle o que se repete todo mês"),
    "goals": ("Metas", "Acompanhe seus objetivos financeiros"),
    "reports": ("Relatórios", "Entenda a evolução do seu dinheiro"),
    "assistant": ("Assistente financeiro", "Insights calculados pelos seus dados"),
    "settings": ("Configurações", "Gerencie seu perfil e preferências"),
}


# ------------------------------------------------------------------
# Formatacao
# ------------------------------------------------------------------

@app.template_filter("brl")
def brl(valor):
    """Formata em real brasileiro: 1234.5 -> R$ 1.234,50."""
    try:
        valor = float(valor or 0)
    except (TypeError, ValueError):
        valor = 0.0
    inteiro, centavos = f"{abs(valor):.2f}".split(".")
    # Agrupa o milhar de tras pra frente e devolve com ponto.
    grupos = []
    while len(inteiro) > 3:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    grupos.insert(0, inteiro)
    sinal = "-" if valor < 0 else ""
    return f"{sinal}R$ {'.'.join(grupos)},{centavos}"


@app.template_filter("data_br")
def data_br(valor):
    """Mostra so dia/mes/ano, sem hora."""
    if not valor:
        return ""
    try:
        ano, mes, dia = str(valor)[:10].split("-")
        return f"{dia}/{mes}/{ano}"
    except Exception:
        return valor


@app.template_filter("data_curta")
def data_curta(valor):
    """'26 ago', ou 'Hoje' quando for o dia corrente -- igual ao painel do zip."""
    if not valor:
        return ""
    texto = str(valor)[:10]
    if texto == date.today().isoformat():
        return "Hoje"
    try:
        _, mes, dia = texto.split("-")
        return f"{int(dia)} {MESES_CURTO[int(mes)]}"
    except Exception:
        return texto


def _numero(texto, padrao=0.0):
    """Le valor digitado em pt-BR ('1.234,56') ou em formato cru ('1234.56')."""
    if texto is None:
        return padrao
    texto = str(texto).strip().replace("R$", "").replace(" ", "")
    if not texto:
        return padrao
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return padrao


def _cor(categoria):
    return CORES.get(categoria, COR_PADRAO)


def _chave_conta(nome):
    """Nome de conta normalizado para comparacao.

    Transacao guarda o nome da conta como texto. Se a comparacao for exata,
    qualquer diferenca invisivel quebra o vinculo e a compra deixa de ser
    reconhecida como do cartao -- passando a contar em 'Gastos no mes' na
    hora, em vez de esperar a fatura.

    NFC importa: "Itau" com acento pode vir precomposto (u+0301 -> \u00fa) ou
    decomposto (u + acento combinante). Os dois parecem iguais na tela e sao
    strings diferentes pro Python.
    """
    return unicodedata.normalize("NFC", (nome or "").strip()).casefold()


# ------------------------------------------------------------------
# Geometria dos graficos
#
# Nao existe biblioteca de grafico aqui: o servidor devolve as
# coordenadas prontas e o template so desenha o SVG. E o mesmo caminho
# que o projeto ja usava, so que agora cobre area, donut e barras.
# ------------------------------------------------------------------

def _grafico_area(rotulos, valores, largura=640, altura=220, pad_x=18, pad_y=20):
    """Linha + area preenchida. 'rotulos' vira o texto do tooltip de cada ponto."""
    if not valores:
        return None
    if len(valores) == 1:
        valores = [valores[0], valores[0]]
        rotulos = [rotulos[0], rotulos[0]]

    minimo, maximo = min(valores), max(valores)
    faixa = (maximo - minimo) or (maximo or 1)
    passo = (largura - pad_x * 2) / (len(valores) - 1)
    base_y = altura - pad_y

    pontos = []
    for i, v in enumerate(valores):
        x = pad_x + i * passo
        y = pad_y + (altura - pad_y * 2) * (1 - (v - minimo) / faixa)
        pontos.append({"x": round(x, 1), "y": round(y, 1), "valor": v, "rotulo": rotulos[i]})

    linha = " ".join(f"{p['x']},{p['y']}" for p in pontos)
    area = (
        f"M{pontos[0]['x']},{base_y} "
        + " ".join(f"L{p['x']},{p['y']}" for p in pontos)
        + f" L{pontos[-1]['x']},{base_y} Z"
    )
    return {
        "pontos": pontos, "linha": linha, "area": area,
        "largura": largura, "altura": altura, "base_y": base_y,
        "maximo": maximo, "total": sum(valores),
    }


def _donut(itens, raio=74):
    """Arcos do donut por categoria, em stroke-dasharray/dashoffset.
    'itens' e uma lista de (nome, total) ja ordenada."""
    if not itens:
        return None
    circunferencia = 2 * math.pi * raio
    total_geral = sum(total for _, total in itens) or 1
    segmentos = []
    acumulado = 0.0
    for nome, total in itens:
        pct = total / total_geral * 100
        comprimento = (pct / 100) * circunferencia
        segmentos.append({
            "nome": nome, "valor": total, "pct": pct, "cor": _cor(nome),
            "dasharray": f"{comprimento:.2f} {(circunferencia - comprimento):.2f}",
            "dashoffset": round(-acumulado, 2),
        })
        acumulado += comprimento
    return {"segmentos": segmentos, "raio": raio, "circunferencia": round(circunferencia, 2)}


def _grafico_barras(dados, largura=680, altura=300, pad_x=26, pad_y=22):
    """Barras pareadas (receita x despesa) por mes, pro relatorio."""
    if not dados:
        return None
    maximo = max(max(d["receitas"], d["despesas"]) for d in dados) or 1
    area_util = altura - pad_y * 2
    base_y = altura - pad_y
    largura_grupo = (largura - pad_x * 2) / len(dados)
    largura_barra = min(22, largura_grupo / 3)

    grupos = []
    for i, d in enumerate(dados):
        centro = pad_x + largura_grupo * (i + 0.5)
        barras = []
        for chave, cor in (("receitas", "#22c55e"), ("despesas", "#374151")):
            valor = d[chave]
            alt = (valor / maximo) * area_util
            deslocamento = -largura_barra - 2 if chave == "receitas" else 2
            barras.append({
                "x": round(centro + deslocamento, 1),
                "y": round(base_y - alt, 1),
                "altura": round(max(alt, 1), 1),
                "largura": round(largura_barra, 1),
                "cor": cor,
                "valor": valor,
                "rotulo": "Receitas" if chave == "receitas" else "Despesas",
            })
        grupos.append({"mes": d["mes"], "x": round(centro, 1), "barras": barras})

    # Quatro linhas-guia horizontais, com o valor em 'k' na lateral.
    grade = []
    for i in range(5):
        valor = maximo * i / 4
        grade.append({
            "y": round(base_y - area_util * i / 4, 1),
            "rotulo": f"{round(valor / 1000, 1):g}k" if maximo >= 1000 else f"{valor:.0f}",
        })

    return {
        "grupos": grupos, "grade": grade, "largura": largura,
        "altura": altura, "base_y": base_y, "pad_x": pad_x,
    }


def _minigrafico(valores, largura=132, altura=52, pad=5):
    """Sparkline dos cards de KPI."""
    if not valores:
        return ""
    if len(valores) == 1:
        y = altura / 2
        return f"{pad},{y} {largura - pad},{y}"
    minimo, maximo = min(valores), max(valores)
    faixa = (maximo - minimo) or 1
    passo = (largura - pad * 2) / (len(valores) - 1)
    return " ".join(
        f"{pad + i * passo:.1f},{altura - pad - ((v - minimo) / faixa) * (altura - pad * 2):.1f}"
        for i, v in enumerate(valores)
    )


# ------------------------------------------------------------------
# Sessao / Supabase
# ------------------------------------------------------------------

def obter_supabase():
    """Retorna um cliente autenticado, renovando o token se estiver expirado."""
    supabase = conectar_como_usuario(session["access_token"])
    try:
        # Testa se o token ainda e valido com uma chamada leve.
        supabase.auth.get_user(session["access_token"])
    except Exception:
        try:
            nova_sessao = renovar_sessao(session["refresh_token"])
            session["access_token"] = nova_sessao.access_token
            session["refresh_token"] = nova_sessao.refresh_token
            supabase = conectar_como_usuario(session["access_token"])
        except Exception:
            session.clear()
            return None
    return supabase


def login_necessario(f):
    @wraps(f)
    def decorada(*args, **kwargs):
        if "access_token" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorada


def _lancar_recorrentes(supabase):
    """Cria em Transações as recorrências cujo dia do mês já chegou.

    Não existe cron aqui (o deploy é serverless), então a geração acontece
    quando a pessoa abre o app -- uma vez por dia, marcada na sessão.

    Idempotência vem de recorrente_id: se já existe lançamento daquela regra
    no mês, não cria outro. Sem isso cada visita duplicaria a conta.

    O status depende de onde a cobrança cai:
      - cartão  -> 'pago', porque a compra já entrou na fatura; quem se paga
                   depois é a fatura, não o lançamento;
      - conta ou dinheiro -> 'pendente', porque sai do saldo e o app não tem
                   como saber se o débito realmente aconteceu.
    """
    hoje = date.today()
    mes = hoje.strftime("%Y-%m")

    regras = [r for r in _recorrentes(supabase) if r.get("ativo")]
    if not regras:
        return 0

    ja_lancadas = {
        d.get("recorrente_id") for d in (
            supabase.table("despesas").select("recorrente_id, data")
            .eq("user_id", _uid()).gte("data", f"{mes}-01").execute().data or []
        ) if d.get("recorrente_id")
    }
    cartoes = {
        _chave_conta(c["nome"]) for c in _contas(supabase)
        if c.get("tipo") == "Cartão de crédito"
    }

    novas = []
    for r in regras:
        if r["id"] in ja_lancadas:
            continue
        dia = max(1, min(int(r.get("dia") or 1), _ultimo_dia_do_mes(mes)))
        if hoje.day < dia:
            continue

        no_cartao = _chave_conta(r.get("conta")) in cartoes
        novas.append({
            "user_id": _uid(),
            "nome_despesa": r["nome"],
            "descricao": "Lançamento automático",
            "categoria": r.get("categoria") or "Outros",
            "tipo": r.get("tipo") or "despesa",
            "conta": r.get("conta"),
            "status": "pago" if no_cartao else "pendente",
            "valor": float(r.get("valor") or 0),
            "data": f"{mes}-{dia:02d}",
            "recorrente": True,
            "recorrente_id": r["id"],
        })

    if novas:
        supabase.table("despesas").insert(novas).execute()
    return len(novas)


def com_supabase(f):
    """Injeta o cliente autenticado como 1o argumento e trata sessao expirada
    num lugar so, em vez de repetir o mesmo if em cada rota."""
    @wraps(f)
    @login_necessario
    def decorada(*args, **kwargs):
        supabase = obter_supabase()
        if supabase is None:
            flash("Sua sessão expirou. Faça login novamente.")
            return redirect(url_for("login"))

        # Uma vez por dia por sessao: sem cron, e aqui que as recorrencias
        # viram lancamento. Falhar nisso nao pode impedir a tela de abrir.
        hoje = date.today().isoformat()
        if request.method == "GET" and session.get("recorrentes_em") != hoje:
            session["recorrentes_em"] = hoje
            try:
                criadas = _lancar_recorrentes(supabase)
                if criadas:
                    flash(f"{criadas} recorrência{'s' if criadas > 1 else ''} "
                          f"lançada{'s' if criadas > 1 else ''} automaticamente.")
            except Exception:
                session.pop("recorrentes_em", None)

        return f(supabase, *args, **kwargs)
    return decorada


def _uid():
    return session["user_id"]


# ------------------------------------------------------------------
# Leitura de dados
# ------------------------------------------------------------------

def _transacoes(supabase):
    resposta = (
        supabase.table("despesas").select("*")
        .eq("user_id", _uid()).order("data", desc=True).execute()
    )
    return resposta.data or []


def _contas(supabase):
    resposta = supabase.table("contas").select("*").eq("user_id", _uid()).order("id").execute()
    return resposta.data or []


def _faturas(supabase):
    resposta = supabase.table("faturas").select("*").eq("user_id", _uid()).execute()
    return resposta.data or []


# ------------------------------------------------------------------
# Ciclo do cartao
#
# A fatura nao e um valor digitado: ela e a soma do que foi lancado no
# cartao dentro do ciclo. O ciclo vai do dia seguinte ao fechamento ate
# o fechamento do mes -- compra feita depois do fechamento ja cai na
# fatura do mes que vem, que e como cartao funciona de verdade.
# ------------------------------------------------------------------

def _mes_da_fatura(data_iso, fechamento):
    """Em qual fatura (YYYY-MM) a compra cai."""
    ano, mes, dia = int(data_iso[:4]), int(data_iso[5:7]), int(data_iso[8:10])
    if dia > fechamento:
        return _somar_meses(date(ano, mes, 1), 1).strftime("%Y-%m")
    return f"{ano:04d}-{mes:02d}"


def _vencimento_da_fatura(mes, fechamento, vencimento):
    """Data em que a fatura daquele mes vence. Quando o dia do vencimento
    e menor ou igual ao do fechamento, ele cai no mes seguinte
    (fecha 28/08, vence 10/09)."""
    base = date(int(mes[:4]), int(mes[5:7]), 1)
    if vencimento <= fechamento:
        base = _somar_meses(base, 1)
    dia = min(vencimento, _ultimo_dia_do_mes(base.strftime("%Y-%m")))
    return date(base.year, base.month, dia)


def _saldos(lista_contas, transacoes, registros, mes):
    """Saldo de cada conta ate o fim do mes exibido.

    O campo 'saldo' do cadastro e o saldo INICIAL; em cima dele entra tudo
    que ja aconteceu ate o mes exibido -- acumulado, nunca so o mes. Se
    contasse apenas o mes corrente, o saldo voltaria ao valor cadastrado a
    cada virada e as saidas anteriores sumiriam.

    Tudo e calculado na hora: nada e gravado em contas.saldo. Isso mantem o
    pagamento da fatura e a despesa comum sob a mesma regra, e faz reabrir
    uma fatura devolver o valor sem precisar de compensacao.
    """
    saldos = {}
    for c in lista_contas:
        if c.get("tipo") == "Cartão de crédito":
            continue

        total = float(c.get("saldo") or 0)
        chave = _chave_conta(c["nome"])
        for t in transacoes:
            if _chave_conta(t.get("conta")) != chave or t.get("status") != "pago":
                continue
            if not t.get("data") or t["data"][:7] > mes:
                continue
            total += -_valor(t) if _e_despesa(t) else _valor(t)

        # O pagamento da fatura ja e uma transacao nesta conta, somada no
        # laco acima -- descontar tambem pelo registro tiraria em dobro.
        saldos[c["id"]] = total
    return saldos


def _pago_por_fatura(transacoes):
    """Quanto ja foi pago em cada fatura, somando as transacoes de quitacao.

    Fonte unica: quem manda e o lancamento em Transacoes, nao um campo
    separado. O campo 'valor_pago' da tabela existia em paralelo e podia
    divergir -- uma fatura marcada com valor pago sem nenhuma transacao
    correspondente fazia compras contarem como gasto sem ninguem ter pago.
    """
    total = defaultdict(float)
    for t in transacoes:
        if t.get("fatura_id"):
            total[t["fatura_id"]] += _valor(t)
    return total


def _efetivados(lista_contas, registros, transacoes):
    """Mapa id_transacao -> quanto dela ja saiu do bolso.

    Fora do cartao: o valor inteiro, se estiver paga.

    No cartao, quem libera e a fatura -- e ela pode estar paga so em parte.
    Antes bastava a fatura estar marcada como paga pra TODAS as compras do
    ciclo contarem, inclusive as lancadas depois do pagamento. Agora o valor
    pago e distribuido pelas compras em ordem de data: o que passa do que foi
    quitado nao conta, porque esse dinheiro ainda nao saiu da conta.
    """
    cartoes = {
        _chave_conta(c["nome"]): (c["id"], int(c.get("fechamento") or 28))
        for c in lista_contas if c.get("tipo") == "Cartão de crédito"
    }
    pago_por_fatura = _pago_por_fatura(transacoes)
    pago_do_ciclo = {
        (r.get("conta_id"), r.get("mes")): pago_por_fatura.get(r.get("id"), 0.0)
        for r in registros
    }

    resultado, por_ciclo = {}, defaultdict(list)
    for t in transacoes:
        # Quitacao de fatura nao e gasto novo: as compras e que contam.
        if not _e_despesa(t) or t.get("fatura_id"):
            resultado[t["id"]] = 0.0
            continue
        cartao = cartoes.get(_chave_conta(t.get("conta")))
        if not cartao:
            resultado[t["id"]] = _valor(t) if t.get("status") == "pago" else 0.0
            continue
        if not t.get("data"):
            resultado[t["id"]] = 0.0
            continue
        id_cartao, fechamento = cartao
        por_ciclo[(id_cartao, _mes_da_fatura(t["data"], fechamento))].append(t)

    for chave, itens in por_ciclo.items():
        restante = pago_do_ciclo.get(chave, 0.0)
        for t in sorted(itens, key=lambda x: ((x.get("data") or ""), x["id"])):
            usado = min(_valor(t), max(0.0, restante))
            resultado[t["id"]] = usado
            restante -= usado

    return resultado


def _montar_faturas(transacoes, lista_contas, registros, mes):
    """Uma fatura por cartao no mes selecionado, com valor calculado,
    data de vencimento e situacao de pagamento."""
    por_conta = {r["conta_id"]: r for r in registros if r.get("mes") == mes}
    nomes = {c["id"]: c["nome"] for c in lista_contas}
    pago_por_fatura = _pago_por_fatura(transacoes)
    hoje = date.today()

    faturas = []
    for c in lista_contas:
        if c.get("tipo") != "Cartão de crédito":
            continue

        fechamento = int(c.get("fechamento") or 28)
        vencimento = int(c.get("vencimento") or 10)

        chave = _chave_conta(c["nome"])
        do_cartao = [
            t for t in transacoes
            if _chave_conta(t.get("conta")) == chave and t.get("data")
        ]
        # Receita lancada no cartao e estorno: abate da fatura em vez de somar.
        def total(lista):
            return sum(_valor(t) if _e_despesa(t) else -_valor(t) for t in lista)

        itens = [t for t in do_cartao if _mes_da_fatura(t["data"], fechamento) == mes]
        seguinte = _somar_meses(date(int(mes[:4]), int(mes[5:7]), 1), 1).strftime("%Y-%m")
        itens_seguinte = [t for t in do_cartao if _mes_da_fatura(t["data"], fechamento) == seguinte]

        registro = por_conta.get(c["id"]) or {}
        valor = total(itens)
        # Quanto ja foi quitado desta fatura. Compra nova no mesmo ciclo
        # depois de pagar deixa uma diferenca -- e so ela que falta pagar.
        pago_valor = pago_por_fatura.get(registro.get("id"), 0.0)
        restante = round(valor - pago_valor, 2)
        pago = registro.get("status") == "pago" and restante <= 0
        vence = _vencimento_da_fatura(mes, fechamento, vencimento)

        # A fatura do mes M fecha no dia 'fechamento' do proprio M. Enquanto
        # nao fecha ela ainda esta recebendo compras -- pagar nao faz sentido,
        # o valor ainda vai mudar.
        dia_fecha = min(fechamento, _ultimo_dia_do_mes(mes))
        data_fechamento = date(int(mes[:4]), int(mes[5:7]), dia_fecha)
        fechada = hoje > data_fechamento

        faturas.append({
            "conta": c,
            "valor": valor,
            "itens": len(itens),
            # O que ja passou do fechamento e caiu na proxima fatura. Sem
            # mostrar isso, a compra "some" e parece que nao foi lancada.
            "proximo_valor": total(itens_seguinte),
            "proximo_itens": len(itens_seguinte),
            "proximo_mes": seguinte,
            "status": "pago" if pago else "pendente",
            "pago_valor": pago_valor,
            "restante": max(0.0, restante),
            "parcial": pago_valor > 0 and restante > 0,
            "pago_com": registro.get("pago_com"),
            "pago_com_nome": nomes.get(registro.get("pago_com"), "conta removida"),
            "valor_pago": pago_valor,
            "vence": vence,
            "vence_texto": f"{vence.day:02d}/{vence.month:02d}",
            "fechada": fechada,
            "fecha_texto": f"{dia_fecha:02d}/{int(mes[5:7]):02d}",
            # Fatura sem gasto nao vence nem atrasa: nao ha o que pagar.
            "atrasada": (not pago) and restante > 0 and vence < hoje,
            "fechamento": fechamento,
            "vencimento": vencimento,
        })
    return faturas


def _orcamentos(supabase):
    """Devolve {categoria: limite}. Na primeira visita cria os limites padrao,
    senao a tela de orcamentos abriria vazia e sem nada pra editar."""
    resposta = supabase.table("orcamentos").select("*").eq("user_id", _uid()).execute()
    linhas = resposta.data or []
    if not linhas:
        novos = [
            {"user_id": _uid(), "categoria": c, "limite": limite}
            for c, limite in ORCAMENTOS_PADRAO.items()
        ]
        supabase.table("orcamentos").insert(novos).execute()
        linhas = novos
    return {l["categoria"]: float(l["limite"]) for l in linhas}


def _recorrentes(supabase):
    resposta = supabase.table("recorrentes").select("*").eq("user_id", _uid()).order("id").execute()
    return resposta.data or []


def _metas(supabase):
    resposta = supabase.table("metas").select("*").eq("user_id", _uid()).order("id").execute()
    return resposta.data or []


def _preferencias(supabase):
    resposta = supabase.table("preferencias").select("*").eq("user_id", _uid()).execute()
    linhas = resposta.data or []
    if linhas:
        return linhas[0]
    # Primeiro acesso: cria a linha com o nome derivado do e-mail.
    padrao = {
        "user_id": _uid(),
        "nome": (session.get("email") or "").split("@")[0].title() or "Usuário",
        "notificacoes": True, "tema_escuro": True,
        "resumo_semanal": True, "onboarding": False,
    }
    try:
        supabase.table("preferencias").insert(padrao).execute()
    except Exception:
        pass
    return padrao


def _mes_atual():
    return date.today().strftime("%Y-%m")


def _mes_selecionado():
    """Mes que o painel esta mostrando -- vem SEMPRE da URL.

    Antes ficava guardado na sessao, e isso tornava o mes pegajoso: bastava
    abrir um link de outro mes (o aviso de proxima fatura, por exemplo) pra
    o app inteiro travar naquele mes, em todas as telas, sem voltar sozinho.
    Quem abrisse o painel depois disso veria o mes errado e acharia que os
    lancamentos novos sumiram. Com o mes na URL, abrir o app sempre cai no
    mes corrente e o botao voltar funciona.
    """
    mes = request.args.get("mes") or ""
    if len(mes) == 7 and mes[4] == "-":
        try:
            ano, numero = int(mes[:4]), int(mes[5:7])
        except ValueError:
            return _mes_atual()
        if 2000 <= ano <= 2100 and 1 <= numero <= 12:
            return mes
    return _mes_atual()


def _meses_disponiveis(transacoes):
    """Ultimos 12 meses com movimentacao, mais o mes corrente e o selecionado
    -- assim o seletor nunca fica sem a opcao que esta ativa."""
    meses = {t["data"][:7] for t in transacoes if t.get("data")}
    meses.add(date.today().strftime("%Y-%m"))
    meses.add(_mes_selecionado())
    ordenados = sorted(meses, reverse=True)[:12]
    return [
        {"valor": m, "rotulo": f"{MESES_PT[int(m[5:7])]} {m[:4]}"}
        for m in ordenados
    ]


def _do_mes(transacoes, mes):
    return [t for t in transacoes if (t.get("data") or "")[:7] == mes]


def _valor(t):
    return float(t.get("valor") or 0)


def _e_despesa(t):
    return t.get("tipo", "despesa") != "receita"


def _contexto_base(supabase, tela, transacoes=None, preferencias=None):
    """Tudo que o layout (sidebar, topbar, modal de nova transacao) precisa,
    em qualquer tela."""
    transacoes = _transacoes(supabase) if transacoes is None else transacoes
    preferencias = _preferencias(supabase) if preferencias is None else preferencias
    mes = _mes_selecionado()
    mes_atual = _mes_atual()
    do_mes = _do_mes(transacoes, mes)
    titulo, subtitulo = TITULOS[tela]

    # Data que o formulario de nova transacao ja vem preenchida: hoje quando
    # o mes exibido e o corrente, senao o dia 1 do mes que esta na tela --
    # senao o lancamento nasce fora do mes que o usuario esta olhando.
    hoje = date.today()
    data_padrao = hoje.isoformat() if mes == mes_atual else f"{mes}-01"

    return {
        "tela": tela,
        "titulo": titulo,
        "subtitulo": subtitulo,
        "mes": mes,
        "mes_atual": mes_atual,
        # Vai nos links de navegacao pra o mes escolhido acompanhar a troca
        # de tela. None no mes corrente, pra URL ficar limpa.
        "mes_url": None if mes == mes_atual else mes,
        "outros_filtros": {k: v for k, v in request.args.items() if k != "mes"},
        "mes_rotulo": f"{MESES_PT[int(mes[5:7])]} {mes[:4]}",
        "meses": _meses_disponiveis(transacoes),
        "email": session.get("email"),
        "preferencias": preferencias,
        "categorias": CATEGORIAS,
        "categorias_despesa": CATEGORIAS_DESPESA,
        "tipos_conta": TIPOS_CONTA,
        "cores": CORES,
        # Receita nao entra em cartao de credito, entao o modal precisa
        # saber o tipo de cada conta -- nao so o nome.
        "contas_modal": [
            {"nome": c["nome"], "cartao": c.get("tipo") == "Cartão de crédito"}
            for c in _contas(supabase)
        ],
        "hoje": data_padrao,
        "pendentes": sum(1 for t in do_mes if t.get("status") == "pendente"),
    }


# ------------------------------------------------------------------
# Autenticacao
# ------------------------------------------------------------------

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form["email"]
        senha = request.form["senha"]

        supabase = conectar()
        try:
            resposta = supabase.auth.sign_in_with_password({
                "email": email,
                "password": senha,
            })
        except Exception:
            flash("E-mail ou senha inválidos.")
            return redirect(url_for("login"))

        session["access_token"] = resposta.session.access_token
        session["refresh_token"] = resposta.session.refresh_token
        session["user_id"] = resposta.user.id
        session["email"] = resposta.user.email

        return redirect(url_for("index"))

    return render_template("login.html")


@app.route("/cadastro", methods=["GET", "POST"])
def cadastro():
    if request.method == "POST":
        email = request.form["email"]
        senha = request.form["senha"]

        supabase = conectar()
        try:
            supabase.auth.sign_up({"email": email, "password": senha})
        except Exception as erro:
            flash(f"Não foi possível criar a conta: {erro}")
            return redirect(url_for("cadastro"))

        flash("Conta criada! Verifique seu e-mail para confirmar antes de entrar.")
        return redirect(url_for("login"))

    return render_template("cadastro.html")


@app.route("/esqueci-senha", methods=["GET", "POST"])
def esqueci_senha():
    if request.method == "POST":
        email = (request.form.get("email") or "").strip()
        if email:
            supabase = conectar()
            try:
                supabase.auth.reset_password_for_email(
                    email, {"redirect_to": url_for("login", _external=True)}
                )
            except Exception:
                pass  # nao revela se o e-mail existe ou nao

        # Mensagem igual sempre que o e-mail exista ou nao -- evita que
        # alguem descubra quais e-mails estao cadastrados por tentativa.
        flash("Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.")
        return redirect(url_for("login"))

    return render_template("esqueci_senha.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ------------------------------------------------------------------
# Visao geral
# ------------------------------------------------------------------

@app.route("/")
@com_supabase
def index(supabase):
    transacoes = _transacoes(supabase)
    orcamentos = _orcamentos(supabase)
    contas = _contas(supabase)
    mes = _mes_selecionado()
    do_mes = _do_mes(transacoes, mes)

    cartoes = {_chave_conta(c["nome"]) for c in contas if c.get("tipo") == "Cartão de crédito"}
    no_cartao = lambda t: _chave_conta(t.get("conta")) in cartoes

    registros_fatura = _faturas(supabase)
    efetivado = _efetivados(contas, registros_fatura, transacoes)
    quanto = lambda t: efetivado.get(t["id"], 0.0)

    # No cartao o gasto so entra na medida em que a fatura e paga.
    pagas = [t for t in do_mes if quanto(t) > 0]
    gasto = sum(quanto(t) for t in do_mes)
    # O que esta no cartao e ainda nao foi quitado, pra explicar a diferenca.
    aguardando_fatura = sum(
        _valor(t) - quanto(t) for t in do_mes
        if _e_despesa(t) and no_cartao(t)
    )
    receita = sum(_valor(t) for t in do_mes if not _e_despesa(t) and t.get("status") == "pago")

    # Conta pendente = boleto que sai da conta. O que esta no cartao nao
    # entra aqui: ele e cobrado junto, na fatura.
    pendente = sum(
        _valor(t) for t in do_mes
        if _e_despesa(t) and t.get("status") == "pendente" and not no_cartao(t)
    )
    qtd_pendentes = sum(
        1 for t in do_mes if t.get("status") == "pendente" and not no_cartao(t)
    )

    orcamento_total = sum(orcamentos.values())
    restante = orcamento_total - gasto

    # Saldo disponivel: compra no cartao NAO sai da conta na hora -- ela
    # engorda a fatura, e o desconto acontece quando a fatura e paga.
    # Descontar aqui contaria o mesmo gasto duas vezes.
    saldo = sum(_saldos(contas, transacoes, registros_fatura, mes).values())

    faturas = _montar_faturas(transacoes, contas, registros_fatura, mes)
    faturas_abertas = [f for f in faturas if f["status"] == "pendente" and f["valor"] > 0]
    fatura_total = sum(f["valor"] for f in faturas_abertas)
    # A proxima que vence manda no texto do card: e a informacao acionavel.
    proxima = min(faturas_abertas, key=lambda f: f["vence"]) if faturas_abertas else None

    # Donut por categoria (so despesas pagas).
    por_categoria = defaultdict(float)
    for t in pagas:
        por_categoria[t.get("categoria") or "Outros"] += quanto(t)
    ordenadas = sorted(por_categoria.items(), key=lambda i: i[1], reverse=True)
    donut = _donut(ordenadas)
    top_categoria = ordenadas[0][0] if ordenadas else "Sem categoria"

    # Saude financeira: resume o mes num numero so, a partir do uso do
    # orcamento, de contas pendentes e de a receita cobrir o gasto.
    uso_orcamento = min(100, (gasto / orcamento_total * 100)) if orcamento_total else 0
    saude_score = max(35, min(96, round(
        100 - uso_orcamento * 0.45
        - (5 if qtd_pendentes else 0)
        + (8 if receita > gasto else 0)
    )))
    saude_label = "Muito boa" if saude_score >= 75 else "Estável" if saude_score >= 55 else "Em atenção"

    lista_categorias = [
        {
            "nome": nome, "valor": valor, "cor": _cor(nome),
            "pct": (valor / gasto * 100) if gasto else 0,
        }
        for nome, valor in ordenadas[:5]
    ]

    # Linha do mes: gasto acumulado dia a dia.
    ultimo_dia = _ultimo_dia_do_mes(mes)
    acumulado, soma = [], 0.0
    por_dia = defaultdict(float)
    for t in pagas:
        por_dia[int(t["data"][8:10])] += quanto(t)
    for dia in range(1, ultimo_dia + 1):
        soma += por_dia.get(dia, 0.0)
        acumulado.append(soma)
    grafico = _grafico_area(
        [f"Dia {d}" for d in range(1, ultimo_dia + 1)], acumulado
    )

    recentes = sorted(do_mes, key=lambda t: (t.get("data") or ""), reverse=True)[:4]

    contexto = _contexto_base(supabase, "overview", transacoes)
    contexto.update({
        "saldo": saldo, "gasto": gasto, "receita": receita, "pendente": pendente,
        "orcamento_total": orcamento_total, "restante": restante,
        "fatura_total": fatura_total,
        "faturas_abertas": len(faturas_abertas),
        "tem_cartao": any(c.get("tipo") == "Cartão de crédito" for c in contas),
        "proxima_fatura": proxima,
        "qtd_pendentes": qtd_pendentes,
        "aguardando_fatura": aguardando_fatura,
        "pct_orcamento": (gasto / orcamento_total * 100) if orcamento_total else 0,
        "pct_restante": (max(0, restante) / orcamento_total * 100) if orcamento_total else 0,
        "donut": donut, "lista_categorias": lista_categorias,
        "grafico": grafico, "recentes": recentes,
        "top_categoria": top_categoria,
        "saude_score": saude_score, "saude_label": saude_label,
    })
    return render_template("overview.html", **contexto)


def _ultimo_dia_do_mes(mes):
    ano, m = int(mes[:4]), int(mes[5:7])
    if m == 12:
        return 31
    return (date(ano, m + 1, 1) - timedelta(days=1)).day


# ------------------------------------------------------------------
# Transacoes
# ------------------------------------------------------------------

@app.route("/transacoes")
@com_supabase
def transacoes(supabase):
    todas = _transacoes(supabase)
    do_mes = _do_mes(todas, _mes_selecionado())

    busca = (request.args.get("q") or "").strip().lower()
    tipo = request.args.get("tipo") or "todos"
    status = request.args.get("status") or "todos"
    categoria = request.args.get("categoria") or "todas"

    linhas = []
    for t in do_mes:
        texto = f"{t.get('nome_despesa','')} {t.get('categoria','')} {t.get('conta','')}".lower()
        if busca and busca not in texto:
            continue
        if tipo != "todos" and t.get("tipo", "despesa") != tipo:
            continue
        if status != "todos" and t.get("status", "pago") != status:
            continue
        if categoria != "todas" and t.get("categoria") != categoria:
            continue
        linhas.append(t)
    linhas.sort(key=lambda t: (t.get("data") or ""), reverse=True)

    # Conta que nao existe mais deixa a transacao orfa: ela para de ser
    # reconhecida como do cartao e passa a contar como gasto na hora.
    conhecidas = {_chave_conta(c["nome"]) for c in _contas(supabase)}
    for t in linhas:
        t["conta_orfa"] = bool(t.get("conta")) and _chave_conta(t["conta"]) not in conhecidas

    contexto = _contexto_base(supabase, "transactions", todas)
    contexto.update({
        "linhas": linhas,
        "filtros": {"q": busca, "tipo": tipo, "status": status, "categoria": categoria},
    })
    return render_template("transacoes.html", **contexto)


@app.route("/transacao/salvar", methods=["POST"])
@com_supabase
def salvar_transacao(supabase):
    id_transacao = request.form.get("id_despesa")
    nome = (request.form.get("nome_despesa") or "").strip()
    total = _numero(request.form.get("valor"))
    parcelas = max(1, int(_numero(request.form.get("parcelas"), 1)))
    data_base = request.form.get("data") or date.today().isoformat()

    if not nome or total <= 0:
        flash("Informe uma descrição e um valor válido.")
        return _voltar()

    tipo = "receita" if request.form.get("tipo") == "receita" else "despesa"
    categoria = request.form.get("categoria") or "Outros"
    conta = request.form.get("conta") or None

    # O formulario ja filtra as opcoes, mas a regra tem que valer aqui: o
    # que chega por POST nao passou necessariamente pela tela.
    if tipo == "receita":
        categoria = "Receita"
        parcelas = 1
        # Receita nao cai em cartao de credito -- cartao e divida, nao entrada.
        if conta and _chave_conta(conta) in {
            _chave_conta(c["nome"]) for c in _contas(supabase)
            if c.get("tipo") == "Cartão de crédito"
        }:
            conta = None
    elif categoria == "Receita":
        categoria = "Outros"

    campos = {
        "nome_despesa": nome,
        "descricao": (request.form.get("descricao") or "").strip(),
        "categoria": categoria,
        "tipo": tipo,
        "conta": conta,
        "status": "pendente" if request.form.get("status") == "pendente" else "pago",
        "recorrente": request.form.get("recorrente") == "on",
    }

    if id_transacao:
        supabase.table("despesas").update({**campos, "valor": total, "data": data_base}) \
            .eq("id", id_transacao).eq("user_id", _uid()).execute()
        # Marcar "repetir mensalmente" ao EDITAR tambem tem que criar a regra.
        # Antes esse caminho retornava antes do bloco que a cria, entao a
        # opcao so tinha efeito no momento de cadastrar a transacao.
        criada = _criar_recorrente(supabase, campos, total, data_base)
        flash("Transação atualizada. Recorrência criada." if criada else "Transação atualizada.")
        return _voltar()

    novas = _parcelas(campos, nome, total, parcelas, data_base)
    supabase.table("despesas").insert(novas).execute()

    # "Repetir mensalmente" tambem cria a regra na tela de recorrentes.
    _criar_recorrente(supabase, campos, novas[0]["valor"], data_base)

    flash(_confirmacao_lancamento(supabase, campos["conta"], data_base, parcelas))
    return _voltar()


def _criar_recorrente(supabase, campos, valor, data_base):
    """Cria a regra em Recorrentes quando 'repetir mensalmente' esta marcado.

    Vale pra despesa e pra receita. Nao duplica: marcar de novo a mesma
    transacao (ou reeditar) nao gera uma segunda regra igual.
    """
    if not campos.get("recorrente"):
        return False

    chave = _chave_conta(campos.get("conta"))
    ja_existe = any(
        r.get("nome") == campos["nome_despesa"] and _chave_conta(r.get("conta")) == chave
        for r in _recorrentes(supabase)
    )
    if ja_existe:
        return False

    try:
        dia = max(1, min(28, int(data_base[8:10])))
    except (ValueError, TypeError):
        dia = 1

    supabase.table("recorrentes").insert({
        "user_id": _uid(),
        "nome": campos["nome_despesa"],
        "categoria": campos["categoria"],
        "tipo": campos["tipo"],
        "conta": campos["conta"],
        "valor": valor,
        "dia": dia,
        "ativo": True,
    }).execute()
    return True


def _parcelas(campos, nome, total, parcelas, data_base):
    """Monta as linhas de uma compra parcelada: uma por mes, todas com o
    mesmo grupo_parcela pra dar pra achar a compra inteira depois."""
    grupo = str(uuid.uuid4()) if parcelas > 1 else None
    valor_parcela = round(total / parcelas, 2)
    return [
        {
            **campos,
            "nome_despesa": f"{nome} ({i + 1}/{parcelas})" if parcelas > 1 else nome,
            "valor": valor_parcela,
            "data": _somar_meses(data_base, i).isoformat(),
            "user_id": _uid(),
            "grupo_parcela": grupo,
            "parcela_atual": (i + 1) if parcelas > 1 else None,
            "parcela_total": parcelas if parcelas > 1 else None,
        }
        for i in range(parcelas)
    ]


def _confirmacao_lancamento(supabase, nome_conta, data_base, parcelas):
    """Mensagem do lancamento, dizendo onde ele foi parar.

    Duas coisas podem jogar o lancamento pra fora do mes que esta na tela:
    a data escolhida e o fechamento do cartao. Nos dois casos ele some da
    vista, e sem aviso parece que nao foi salvo."""
    base = f"{parcelas} parcelas adicionadas." if parcelas > 1 else "Transação adicionada."
    exibido = _mes_selecionado()
    nome_mes = lambda m: MESES_PT[int(m[5:7])].lower()

    cartao = next(
        (c for c in _contas(supabase)
         if c["nome"] == nome_conta and c.get("tipo") == "Cartão de crédito"),
        None,
    )

    if cartao:
        fechamento = int(cartao.get("fechamento") or 28)
        mes_fatura = _mes_da_fatura(data_base, fechamento)
        if mes_fatura != data_base[:7]:
            return (
                f"{base} A compra passou do fechamento (dia {fechamento}), "
                f"então entrou na fatura de {nome_mes(mes_fatura)} do {nome_conta}."
            )
        return f"{base} Entrou na fatura de {nome_mes(mes_fatura)} do {nome_conta}."

    if data_base[:7] != exibido:
        return (
            f"{base} A data é de {nome_mes(data_base[:7])}, "
            f"mas você está vendo {nome_mes(exibido)} — por isso ela não aparece na lista."
        )
    return base


@app.route("/transacao/deletar", methods=["POST"])
@com_supabase
def deletar_transacao(supabase):
    """Apaga a transacao. Se ela for parcela de uma compra, apaga a compra
    inteira -- as outras parcelas estao nos meses seguintes e ficariam
    orfas, obrigando a caçar uma por uma mes a mes.

    O grupo vem do banco, nao do formulario: assim o que e apagado depende
    da linha pedida, e nao de um valor que veio do cliente.
    """
    id_transacao = request.form["id_despesa"]

    linha = (
        supabase.table("despesas").select("grupo_parcela, fatura_id")
        .eq("id", id_transacao).eq("user_id", _uid()).execute().data
    )
    if not linha:
        flash("Transação não encontrada.")
        return _voltar()

    # Apagar um pagamento desconta so o valor dele do que ja foi quitado --
    # com pagamentos parciais, zerar tudo apagaria os outros pagamentos.
    id_fatura = linha[0].get("fatura_id")
    if id_fatura:
        valor = float(linha[0].get("valor") or 0)
        supabase.table("despesas").delete() \
            .eq("id", id_transacao).eq("user_id", _uid()).execute()

        # Sobrou algum outro pagamento nesta fatura? O total vem deles.
        restantes = (
            supabase.table("despesas").select("id")
            .eq("fatura_id", id_fatura).eq("user_id", _uid()).execute().data
        )
        if restantes:
            flash(f"Pagamento de {brl(valor)} desfeito.")
        else:
            supabase.table("faturas").update({
                "status": "pendente", "pago_com": None, "valor_pago": None, "pago_em": None,
            }).eq("id", id_fatura).eq("user_id", _uid()).execute()
            flash("Pagamento desfeito: a fatura voltou a ficar em aberto.")
        return _voltar()

    grupo = linha[0].get("grupo_parcela")

    if grupo:
        apagadas = supabase.table("despesas").delete() \
            .eq("grupo_parcela", grupo).eq("user_id", _uid()).execute()
        quantas = len(apagadas.data or [])
        flash(f"Compra parcelada excluída ({quantas} parcela{'s' if quantas != 1 else ''}).")
        return _voltar()

    supabase.table("despesas").delete() \
        .eq("id", id_transacao).eq("user_id", _uid()).execute()
    flash("Transação excluída.")
    return _voltar()


def _somar_meses(data_base, n):
    """Mesma data n meses a frente, encurtando o dia quando o mes destino
    for mais curto (31/01 + 1 mes -> 28 ou 29/02)."""
    if isinstance(data_base, str):
        try:
            ano, mes, dia = (int(p) for p in data_base[:10].split("-"))
            data_base = date(ano, mes, dia)
        except (ValueError, TypeError):
            # Data invalida no banco nao pode derrubar a tela inteira.
            data_base = date.today()
    mes = data_base.month - 1 + n
    ano = data_base.year + mes // 12
    mes = mes % 12 + 1
    bissexto = ano % 4 == 0 and (ano % 100 != 0 or ano % 400 == 0)
    ultimo = [31, 29 if bissexto else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]
    return date(ano, mes, min(data_base.day, ultimo))


def _voltar():
    """Volta pra tela de onde o formulario foi enviado, preservando os filtros."""
    destino = request.form.get("origem") or request.referrer or url_for("index")
    return redirect(destino)


# ------------------------------------------------------------------
# Contas e cartoes
# ------------------------------------------------------------------

@app.route("/contas")
@com_supabase
def contas(supabase):
    lista = _contas(supabase)
    transacoes = _transacoes(supabase)
    mes = _mes_selecionado()
    registros = _faturas(supabase)
    faturas = _montar_faturas(transacoes, lista, registros, mes)

    # Cartao nao guarda saldo: o que ele "tem" e a fatura em aberto.
    por_conta = {f["conta"]["id"]: f for f in faturas}
    saldos = _saldos(lista, transacoes, registros, mes)
    carteiras = [
        {**c, "saldo_atual": saldos.get(c["id"], 0)}
        for c in lista if c.get("tipo") != "Cartão de crédito"
    ]

    contexto = _contexto_base(supabase, "accounts", transacoes)
    contexto.update({
        "contas": lista, "faturas": por_conta, "carteiras": carteiras,
        "saldos": saldos,
        "total": sum(saldos.values()),
        "fatura_total": sum(f["valor"] for f in faturas if f["status"] == "pendente"),
    })
    return render_template("contas.html", **contexto)


@app.route("/conta/salvar", methods=["POST"])
@com_supabase
def salvar_conta(supabase):
    id_conta = request.form.get("id")
    nome = (request.form.get("nome") or "").strip()
    if not nome:
        flash("Informe o nome da conta.")
        return _voltar()

    tipo = request.form.get("tipo") or "Conta corrente"
    campos = {
        "nome": nome,
        "tipo": tipo,
        "detalhe": (request.form.get("detalhe") or "").strip() or "Atualizado agora",
        "cor": request.form.get("cor") or "#22c55e",
    }
    if tipo == "Cartão de crédito":
        # Cartao nao tem saldo digitado -- a fatura vem dos lancamentos.
        campos["saldo"] = 0
        campos["fechamento"] = max(1, min(28, int(_numero(request.form.get("fechamento"), 28))))
        campos["vencimento"] = max(1, min(28, int(_numero(request.form.get("vencimento"), 10))))
    else:
        campos["saldo"] = _numero(request.form.get("saldo"))
    if id_conta:
        # Renomear tem que arrastar as transacoes junto: elas guardam o NOME
        # da conta, entao o vinculo quebra e a compra deixa de ser vista como
        # do cartao -- passando a contar em "Gastos no mes" sem fatura paga.
        antes = (
            supabase.table("contas").select("nome")
            .eq("id", id_conta).eq("user_id", _uid()).execute().data
        )
        nome_antigo = antes[0]["nome"] if antes else None

        supabase.table("contas").update(campos).eq("id", id_conta).eq("user_id", _uid()).execute()

        movidas = 0
        if nome_antigo and nome_antigo != nome:
            alvo = supabase.table("despesas").update({"conta": nome}) \
                .eq("conta", nome_antigo).eq("user_id", _uid()).execute()
            movidas = len(alvo.data or [])
            supabase.table("recorrentes").update({"conta": nome}) \
                .eq("conta", nome_antigo).eq("user_id", _uid()).execute()

        flash(
            f"Conta atualizada. {movidas} transaç{'ões' if movidas != 1 else 'ão'} "
            f"repassada{'s' if movidas != 1 else ''} para o novo nome."
            if movidas else "Conta atualizada."
        )
    else:
        supabase.table("contas").insert({**campos, "user_id": _uid()}).execute()
        flash("Conta criada.")
    return _voltar()


@app.route("/conta/deletar", methods=["POST"])
@com_supabase
def deletar_conta(supabase):
    supabase.table("contas").delete().eq("id", request.form["id"]).eq("user_id", _uid()).execute()
    flash("Conta excluída.")
    return _voltar()


# ------------------------------------------------------------------
# Pagamento da fatura
#
# Pagar so mexe no saldo da conta de origem e marca a fatura. Nao cria
# transacao: os itens do cartao ja foram lancados um a um, entao gerar
# uma despesa "pagamento da fatura" contaria o mesmo gasto duas vezes.
# ------------------------------------------------------------------

@app.route("/fatura/pagar", methods=["POST"])
@com_supabase
def pagar_fatura(supabase):
    id_cartao = int(request.form["conta_id"])
    mes = request.form["mes"]
    origem = request.form.get("pago_com")
    valor = _numero(request.form.get("valor"))

    if not origem:
        flash("Escolha de qual conta o pagamento sai.")
        return _voltar()
    if valor <= 0:
        flash("Esta fatura não tem valor a pagar.")
        return _voltar()

    hoje = date.today().isoformat()

    # Nao acumula nada aqui: quem soma os pagamentos e a lista de transacoes
    # de quitacao. Guardar o total tambem no registro criaria duas versoes da
    # mesma verdade, que e o que gerava fatura "paga" sem lancamento nenhum.
    registro = supabase.table("faturas").upsert({
        "user_id": _uid(), "conta_id": id_cartao, "mes": mes,
        "status": "pago", "pago_com": int(origem), "pago_em": hoje,
    }, on_conflict="user_id,conta_id,mes").execute().data

    # O pagamento vira transacao: e ela que desconta o saldo da conta de
    # origem e da o registro visivel em Transacoes. Nao conta como gasto
    # novo -- as compras do cartao ja passam a contar com a fatura paga.
    nomes = {c["id"]: c["nome"] for c in _contas(supabase)}
    id_fatura = registro[0]["id"] if registro else None
    if id_fatura:
        supabase.table("despesas").insert({
            "user_id": _uid(),
            "nome_despesa": f"Fatura {nomes.get(id_cartao, 'do cartão')}",
            "descricao": f"Fatura de {MESES_PT[int(mes[5:7])].lower()}",
            "categoria": "Outros", "tipo": "despesa",
            "conta": nomes.get(int(origem)), "status": "pago",
            "valor": valor, "data": hoje,
            "recorrente": False, "fatura_id": id_fatura,
        }).execute()

    flash(f"{brl(valor)} pagos na fatura.")
    return _voltar()


@app.route("/fatura/reabrir", methods=["POST"])
@com_supabase
def reabrir_fatura(supabase):
    id_cartao, mes = request.form["conta_id"], request.form["mes"]

    # A transacao de quitacao sai junto: sem ela o saldo ficaria descontado
    # de uma fatura que voltou a estar em aberto.
    registro = (
        supabase.table("faturas").select("id")
        .eq("user_id", _uid()).eq("conta_id", id_cartao).eq("mes", mes).execute().data
    )
    if registro:
        supabase.table("despesas").delete() \
            .eq("fatura_id", registro[0]["id"]).eq("user_id", _uid()).execute()

    supabase.table("faturas").update({
        "status": "pendente", "pago_com": None, "valor_pago": None, "pago_em": None,
    }).eq("user_id", _uid()).eq("conta_id", id_cartao).eq("mes", mes).execute()

    flash("Fatura reaberta.")
    return _voltar()


# ------------------------------------------------------------------
# Orcamentos
# ------------------------------------------------------------------

@app.route("/orcamentos")
@com_supabase
def orcamentos(supabase):
    todas = _transacoes(supabase)
    do_mes = _do_mes(todas, _mes_selecionado())
    limites = _orcamentos(supabase)

    # Mesmo criterio da visao geral: no cartao so conta o que ja foi quitado.
    efetivado = _efetivados(_contas(supabase), _faturas(supabase), todas)

    linhas = []
    for nome, limite in sorted(limites.items()):
        gasto = sum(
            efetivado.get(t["id"], 0.0) for t in do_mes
            if t.get("categoria") == nome
        )
        pct = min(100, (gasto / limite * 100)) if limite else 0
        linhas.append({
            "nome": nome, "limite": limite, "gasto": gasto, "pct": pct,
            "disponivel": max(0, limite - gasto), "cor": _cor(nome),
        })

    contexto = _contexto_base(supabase, "budgets", todas)
    contexto["orcamentos"] = linhas
    return render_template("orcamentos.html", **contexto)


@app.route("/orcamento/salvar", methods=["POST"])
@com_supabase
def salvar_orcamento(supabase):
    categoria = request.form.get("categoria")
    limite = _numero(request.form.get("limite"))
    if not categoria or limite <= 0:
        flash("Informe um limite válido.")
        return _voltar()

    supabase.table("orcamentos").upsert(
        {"user_id": _uid(), "categoria": categoria, "limite": limite},
        on_conflict="user_id,categoria",
    ).execute()
    flash("Orçamento atualizado.")
    return _voltar()


# ------------------------------------------------------------------
# Recorrentes
# ------------------------------------------------------------------

@app.route("/recorrentes")
@com_supabase
def recorrentes(supabase):
    lista = _recorrentes(supabase)
    contas_lista = _contas(supabase)
    tipos = {_chave_conta(c["nome"]): c.get("tipo") for c in contas_lista}

    # Quais ja foram lancadas no mes corrente: sem isso, "proximo
    # lancamento" segue prometendo algo que ja aconteceu.
    mes_corrente = _mes_atual()
    lancadas = {
        d["recorrente_id"] for d in _transacoes(supabase)
        if d.get("recorrente_id") and (d.get("data") or "")[:7] == mes_corrente
    }

    for r in lista:
        r["lancada"] = r["id"] in lancadas
        r["proximo"] = _proximo_lancamento(int(r.get("dia") or 1))
        r["cor"] = _cor(r.get("categoria"))
        r["receita"] = r.get("tipo") == "receita"
        r["no_cartao"] = tipos.get(_chave_conta(r.get("conta"))) == "Cartão de crédito"
        # Conta apagada depois de criada a recorrencia: avisa em vez de
        # mostrar um nome que nao existe mais.
        r["conta_sumiu"] = bool(r.get("conta")) and _chave_conta(r["conta"]) not in tipos

    contexto = _contexto_base(supabase, "recurring")
    contexto["recorrentes"] = lista
    # Separadas por tipo pro select agrupar: cobranca no cartao cai na
    # fatura, cobranca em conta sai do saldo -- nao e a mesma coisa.
    contexto["carteiras"] = [c for c in contas_lista if c.get("tipo") != "Cartão de crédito"]
    contexto["cartoes"] = [c for c in contas_lista if c.get("tipo") == "Cartão de crédito"]
    return render_template("recorrentes.html", **contexto)


def _proximo_lancamento(dia):
    """Proxima data em que a recorrencia cai: ainda neste mes se o dia nao
    passou, senao no mes seguinte."""
    hoje = date.today()
    primeiro = date(hoje.year, hoje.month, 1)
    try:
        candidato = primeiro.replace(day=dia)
    except ValueError:
        # Dia que nao existe neste mes (ex.: 31 em fevereiro): usa o ultimo.
        candidato = _somar_meses(primeiro, 1) - timedelta(days=1)
    if candidato < hoje:
        candidato = _somar_meses(candidato, 1)
    return f"{candidato.day:02d} {MESES_CURTO[candidato.month]}"


@app.route("/recorrente/salvar", methods=["POST"])
@com_supabase
def salvar_recorrente(supabase):
    nome = (request.form.get("nome") or "").strip()
    valor = _numero(request.form.get("valor"))
    if not nome or valor <= 0:
        flash("Preencha os dados da recorrência.")
        return _voltar()

    tipo = "receita" if request.form.get("tipo") == "receita" else "despesa"
    supabase.table("recorrentes").insert({
        "user_id": _uid(), "nome": nome,
        "categoria": "Receita" if tipo == "receita" else (request.form.get("categoria") or "Assinaturas"),
        "tipo": tipo,
        "valor": valor,
        "conta": request.form.get("conta") or None,
        "dia": max(1, min(28, int(_numero(request.form.get("dia"), 1)))),
        "ativo": True,
    }).execute()
    flash("Recorrência criada.")
    return _voltar()


@app.route("/recorrente/alternar", methods=["POST"])
@com_supabase
def alternar_recorrente(supabase):
    supabase.table("recorrentes").update({"ativo": request.form.get("ativo") == "1"}) \
        .eq("id", request.form["id"]).eq("user_id", _uid()).execute()
    return _voltar()


@app.route("/recorrente/deletar", methods=["POST"])
@com_supabase
def deletar_recorrente(supabase):
    supabase.table("recorrentes").delete() \
        .eq("id", request.form["id"]).eq("user_id", _uid()).execute()
    flash("Recorrência removida.")
    return _voltar()


# ------------------------------------------------------------------
# Metas
# ------------------------------------------------------------------

@app.route("/metas")
@com_supabase
def metas(supabase):
    lista = _metas(supabase)
    for m in lista:
        guardado, alvo = float(m.get("guardado") or 0), float(m.get("alvo") or 0)
        m["pct"] = min(100, (guardado / alvo * 100)) if alvo else 0
        m["falta"] = max(0, alvo - guardado)

    contexto = _contexto_base(supabase, "goals")
    contexto["metas"] = lista
    return render_template("metas.html", **contexto)


@app.route("/meta/salvar", methods=["POST"])
@com_supabase
def salvar_meta(supabase):
    nome = (request.form.get("nome") or "").strip()
    alvo = _numero(request.form.get("alvo"))
    if not nome or alvo <= 0:
        flash("Preencha os dados da meta.")
        return _voltar()

    supabase.table("metas").insert({
        "user_id": _uid(), "nome": nome,
        "guardado": _numero(request.form.get("guardado")),
        "alvo": alvo,
        "prazo": (request.form.get("prazo") or "").strip() or "Sem prazo",
        "cor": request.form.get("cor") or "#22c55e",
    }).execute()
    flash("Meta criada.")
    return _voltar()


@app.route("/meta/aportar", methods=["POST"])
@com_supabase
def aportar_meta(supabase):
    id_meta = request.form["id"]
    aporte = _numero(request.form.get("valor"), 100)

    atual = supabase.table("metas").select("guardado, alvo") \
        .eq("id", id_meta).eq("user_id", _uid()).execute().data
    if not atual:
        return _voltar()

    guardado = float(atual[0].get("guardado") or 0)
    alvo = float(atual[0].get("alvo") or 0)
    # Nao deixa passar do alvo: um aporte maior que o que falta so completa.
    novo = min(alvo, guardado + aporte) if alvo else guardado + aporte

    supabase.table("metas").update({"guardado": novo}) \
        .eq("id", id_meta).eq("user_id", _uid()).execute()
    flash("Aporte registrado.")
    return _voltar()


@app.route("/meta/deletar", methods=["POST"])
@com_supabase
def deletar_meta(supabase):
    supabase.table("metas").delete().eq("id", request.form["id"]).eq("user_id", _uid()).execute()
    flash("Meta removida.")
    return _voltar()


# ------------------------------------------------------------------
# Relatorios
# ------------------------------------------------------------------

@app.route("/relatorios")
@com_supabase
def relatorios(supabase):
    todas = _transacoes(supabase)

    # Seis meses terminando no mes selecionado.
    mes = _mes_selecionado()
    referencia = date(int(mes[:4]), int(mes[5:7]), 1)
    janela = [_somar_meses(referencia, -i).strftime("%Y-%m") for i in range(5, -1, -1)]

    dados, receitas_total, despesas_total = [], 0.0, 0.0
    for m in janela:
        do_mes = _do_mes(todas, m)
        receitas = sum(_valor(t) for t in do_mes if not _e_despesa(t))
        despesas = sum(_valor(t) for t in do_mes if _e_despesa(t))
        receitas_total += receitas
        despesas_total += despesas
        dados.append({
            "mes": MESES_CURTO[int(m[5:7])].capitalize(),
            "receitas": receitas, "despesas": despesas,
        })

    economia = receitas_total - despesas_total
    contexto = _contexto_base(supabase, "reports", todas)
    contexto.update({
        "barras": _grafico_barras(dados),
        "receitas_total": receitas_total,
        "despesas_total": despesas_total,
        "economia": economia,
        "pct_economia": (economia / receitas_total * 100) if receitas_total else 0,
        # Sparklines dos KPIs, pra dar o formato da serie sem ler os numeros.
        "spark_receitas": _minigrafico([d["receitas"] for d in dados]),
        "spark_despesas": _minigrafico([d["despesas"] for d in dados]),
    })
    return render_template("relatorios.html", **contexto)


# ------------------------------------------------------------------
# Assistente
#
# Analise local por regras, sem chamar nenhum modelo externo: le as
# transacoes do mes e responde sobre o que ja esta no banco.
# ------------------------------------------------------------------

@app.route("/assistente", methods=["GET", "POST"])
@com_supabase
def assistente(supabase):
    todas = _transacoes(supabase)
    do_mes = _do_mes(todas, _mes_selecionado())
    limites = _orcamentos(supabase)

    efetivado = _efetivados(_contas(supabase), _faturas(supabase), todas)
    pagas = [t for t in do_mes if efetivado.get(t["id"], 0.0) > 0]
    gasto = sum(efetivado.get(t["id"], 0.0) for t in do_mes)
    orcamento_total = sum(limites.values())

    por_categoria = defaultdict(float)
    for t in pagas:
        por_categoria[t.get("categoria") or "Outros"] += efetivado.get(t["id"], 0.0)
    maior = max(por_categoria.items(), key=lambda i: i[1], default=None)

    conversa = session.get("conversa", [])
    if request.method == "POST":
        pergunta = (request.form.get("pergunta") or "").strip()
        if pergunta:
            conversa = conversa[-8:] + [
                {"quem": "usuario", "texto": pergunta},
                {"quem": "assistente", "texto": _responder(
                    pergunta, gasto, orcamento_total, maior, len(do_mes), _metas(supabase)
                )},
            ]
            session["conversa"] = conversa
        return redirect(url_for("assistente"))

    contexto = _contexto_base(supabase, "assistant", todas)
    contexto.update({
        "conversa": conversa,
        "gasto": gasto,
        "orcamento_total": orcamento_total,
        "dentro_do_orcamento": gasto <= orcamento_total,
        "maior_categoria": maior,
        "pct_maior": (maior[1] / gasto * 100) if maior and gasto else 0,
        "pct_disponivel": (
            (orcamento_total - gasto) / orcamento_total * 100
        ) if orcamento_total else 0,
    })
    return render_template("assistente.html", **contexto)


def _responder(pergunta, gasto, orcamento, maior, qtd, metas_usuario):
    texto = pergunta.lower()

    if "mais" in texto or "gast" in texto:
        if not maior:
            return "Ainda não há despesas suficientes neste mês para analisar."
        pct = round(maior[1] / gasto * 100) if gasto else 0
        return (
            f"{maior[0]} é sua maior categoria, com {brl(maior[1])}, "
            f"representando {pct}% das despesas do mês."
        )

    if "econom" in texto or "poupar" in texto:
        sobra = max(0, orcamento - gasto)
        alvo = maior[0] if maior else "a categoria mais frequente"
        return (
            f"Seu orçamento ainda tem {brl(sobra)} disponível. "
            f"Um corte de 10% em {alvo} já libera {brl((maior[1] * 0.1) if maior else 0)}."
        )

    if "meta" in texto:
        if not metas_usuario:
            return "Você ainda não cadastrou metas. Comece por uma reserva de emergência."
        pendente = min(
            metas_usuario,
            key=lambda m: (float(m.get("guardado") or 0) / (float(m.get("alvo") or 1) or 1)),
        )
        falta = max(0, float(pendente.get("alvo") or 0) - float(pendente.get("guardado") or 0))
        return (
            f"Priorize \"{pendente['nome']}\": faltam {brl(falta)} para concluir. "
            "Automatize um aporte logo depois da entrada da renda."
        )

    if "pendente" in texto or "conta" in texto:
        return "Confira a aba Transações filtrando por status Pendente para ver o que vence."

    pct = round(gasto / orcamento * 100) if orcamento else 0
    return (
        f"Analisei {qtd} movimentações deste mês. "
        f"Seu gasto atual utiliza {pct}% do orçamento planejado."
    )


@app.route("/assistente/limpar", methods=["POST"])
@login_necessario
def limpar_conversa():
    session.pop("conversa", None)
    return redirect(url_for("assistente"))


# ------------------------------------------------------------------
# Configuracoes
# ------------------------------------------------------------------

@app.route("/configuracoes")
@com_supabase
def configuracoes(supabase):
    return render_template("configuracoes.html", **_contexto_base(supabase, "settings"))


@app.route("/preferencias/salvar", methods=["POST"])
@com_supabase
def salvar_preferencias(supabase):
    # update, nao upsert: o upsert do PostgREST manda 'missing=null', entao
    # toda coluna fora do payload vira NULL no INSERT e as NOT NULL da tabela
    # estouram. _preferencias garante que a linha existe.
    _preferencias(supabase)
    supabase.table("preferencias").update({
        "nome": (request.form.get("nome") or "").strip() or "Usuário",
        "notificacoes": request.form.get("notificacoes") == "on",
        "tema_escuro": request.form.get("tema_escuro") == "on",
        "resumo_semanal": request.form.get("resumo_semanal") == "on",
    }).eq("user_id", _uid()).execute()
    flash("Preferências salvas.")
    return _voltar()


# ------------------------------------------------------------------
# CSV
# ------------------------------------------------------------------

@app.route("/exportar.csv")
@com_supabase
def exportar_csv(supabase):
    mes = _mes_selecionado()
    linhas = _do_mes(_transacoes(supabase), mes)

    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";")
    escritor.writerow(["Descrição", "Categoria", "Data", "Tipo", "Conta", "Status", "Valor"])
    for t in sorted(linhas, key=lambda t: (t.get("data") or "")):
        escritor.writerow([
            t.get("nome_despesa", ""), t.get("categoria", ""), (t.get("data") or "")[:10],
            t.get("tipo", "despesa"), t.get("conta") or "", t.get("status", "pago"),
            f"{_valor(t):.2f}".replace(".", ","),
        ])

    # BOM na frente: sem isso o Excel em pt-BR abre os acentos quebrados.
    return Response(
        "﻿" + buffer.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="synch-cash-{mes}.csv"'},
    )


@app.route("/importar", methods=["POST"])
@com_supabase
def importar_csv(supabase):
    arquivo = request.files.get("arquivo")
    if not arquivo or not arquivo.filename:
        flash("Escolha um arquivo CSV.")
        return _voltar()

    conteudo = arquivo.read().decode("utf-8-sig", errors="replace")
    # Aceita ';' (padrao do Excel brasileiro) e ',' (exportacao generica).
    delimitador = ";" if conteudo.count(";") >= conteudo.count(",") else ","
    leitor = csv.reader(io.StringIO(conteudo), delimiter=delimitador)

    novas = []
    for i, coluna in enumerate(leitor):
        if i == 0 or len(coluna) < 3:
            continue
        nome = coluna[0].strip()
        valor = _numero(coluna[6] if len(coluna) > 6 else coluna[-1])
        data_linha = (coluna[2] or "").strip()[:10]
        if not nome or valor <= 0 or len(data_linha) != 10:
            continue
        categoria = coluna[1].strip() if len(coluna) > 1 else "Outros"
        novas.append({
            "user_id": _uid(), "nome_despesa": nome, "descricao": "",
            "categoria": categoria if categoria in CATEGORIAS else "Outros",
            "data": data_linha, "valor": valor,
            "tipo": "receita" if len(coluna) > 3 and coluna[3].strip() == "receita" else "despesa",
            "conta": coluna[4].strip() if len(coluna) > 4 else None,
            "status": "pendente" if len(coluna) > 5 and coluna[5].strip() == "pendente" else "pago",
            "recorrente": False,
        })

    if not novas:
        flash("Não foi possível reconhecer transações nesse arquivo.")
        return _voltar()

    supabase.table("despesas").insert(novas).execute()
    flash(f"{len(novas)} transações importadas.")
    return _voltar()


if __name__ == "__main__":
    app.run(debug=True)
