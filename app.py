import os
import math
from datetime import date
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, flash
from postgrest.exceptions import APIError
from connection import conectar, conectar_como_usuario, renovar_sessao
from collections import defaultdict

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")

MESES_PT = {
    1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
    5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
    9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
}


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


def _sparkline(valores, largura=132, altura=52, pad=5):
    """Converte uma lista de numeros numa string de pontos SVG (polyline),
    normalizada dentro do viewBox, pra desenhar os mini-graficos dos cards."""
    if not valores:
        return ""
    if len(valores) == 1:
        y = altura / 2
        return f"{pad},{y} {largura - pad},{y}"
    minimo, maximo = min(valores), max(valores)
    faixa = (maximo - minimo) or 1
    passo = (largura - pad * 2) / (len(valores) - 1)
    pontos = []
    for i, v in enumerate(valores):
        x = pad + i * passo
        y = altura - pad - ((v - minimo) / faixa) * (altura - pad * 2)
        pontos.append(f"{x:.1f},{y:.1f}")
    return " ".join(pontos)


def _variacao_percentual(valores):
    """% de variacao do ultimo valor em relacao ao penultimo. None se nao da pra calcular."""
    if len(valores) < 2 or not valores[-2]:
        return None
    return (valores[-1] - valores[-2]) / valores[-2] * 100


def _tendencia(valores, mais_e_pior=False):
    """Monta o selo de variacao (seta + classe de cor) de um card.
    mais_e_pior=True inverte as cores: pra gastos, subir e ruim (laranja) e
    cair e bom (verde) -- o oposto de um dashboard de receita comum."""
    pct = _variacao_percentual(valores)
    if pct is None:
        return {"pct": None, "seta": "", "classe": "trend-neutral"}
    if abs(pct) < 0.005:
        return {"pct": 0, "seta": "•", "classe": "trend-neutral"}
    subiu = pct > 0
    bom = (not subiu) if mais_e_pior else subiu
    return {
        "pct": abs(pct),
        "seta": "▲" if subiu else "▼",
        "classe": "trend-good" if bom else "trend-bad",
    }


def _grafico_area(rotulos, valores, largura=640, altura=200, pad_x=16, pad_y=18):
    """Monta a linha/area do grafico grande (Resumo por Despesa) ja em
    coordenadas SVG, pra nao precisar de matematica pesada no template.
    'rotulos' e generico -- pode ser nome de despesa, mes, etc."""
    if not valores:
        return None
    if len(valores) == 1:
        valores = [valores[0], valores[0]]
        rotulos = [rotulos[0], rotulos[0]]
    minimo, maximo = min(valores), max(valores)
    faixa = (maximo - minimo) or (maximo or 1)
    n = len(valores)
    passo = (largura - pad_x * 2) / (n - 1)
    base_y = altura - pad_y
    pontos = []
    for i, v in enumerate(valores):
        x = pad_x + i * passo
        y = pad_y + (altura - pad_y * 2) * (1 - (v - minimo) / faixa)
        pontos.append({"x": round(x, 1), "y": round(y, 1), "valor": v, "rotulo": rotulos[i]})
    linha = " ".join(f"{p['x']},{p['y']}" for p in pontos)
    area = f"M{pontos[0]['x']},{base_y} " + " ".join(f"L{p['x']},{p['y']}" for p in pontos) + f" L{pontos[-1]['x']},{base_y} Z"
    return {
        "pontos": pontos,
        "linha": linha,
        "area": area,
        "largura": largura,
        "altura": altura,
        "base_y": base_y,
        "total": sum(valores),
        "media": sum(valores) / len(valores),
    }


def _tons(n, matiz=36, saturacao=82, luz_min=38, luz_max=62):
    """Gera n tons de uma unica cor (laranja), do mais forte (primeira
    despesa, a de maior valor) ao mais claro -- usado no grafico 'Despesas
    por Nome'. Faixa de luminosidade deliberadamente estreita (38-62%) pra
    nenhum tom ficar fraco/pastel demais e sumir no fundo escuro."""
    if n <= 0:
        return []
    if n == 1:
        return [f"hsl({matiz}, {saturacao}%, {luz_min}%)"]
    passo = (luz_max - luz_min) / (n - 1)
    return [f"hsl({matiz}, {saturacao}%, {round(luz_min + passo * i)}%)" for i in range(n)]


def _segmentos_donut(itens, cores, raio=74):
    """Monta os arcos do donut 'Despesas por Nome' em coordenadas SVG
    (stroke-dasharray/dashoffset), um segmento por despesa, ja com nome/
    valor/% prontos pra tooltip no hover."""
    if not itens:
        return None
    circunferencia = 2 * math.pi * raio
    total_geral = sum(total for _, total in itens) or 1
    segmentos = []
    acumulado = 0.0
    for i, (nome, total) in enumerate(itens):
        pct = total / total_geral * 100
        comprimento = (pct / 100) * circunferencia
        segmentos.append({
            "nome": nome,
            "valor": total,
            "pct": pct,
            "cor": cores[i],
            "dasharray": f"{comprimento:.2f} {(circunferencia - comprimento):.2f}",
            "dashoffset": round(-acumulado, 2),
        })
        acumulado += comprimento
    return {"segmentos": segmentos, "raio": raio, "circunferencia": round(circunferencia, 2)}


def obter_supabase():
    """retorna um cliente autenticado, renovando um token se estiver expirado."""
    supabase = conectar_como_usuario(session["access_token"])
    try: 
        #testa se o token ainda é válido com uma chave leve 
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


@app.route("/login", methods=["GET", "POST"])    
def login():
    if request.method == "POST":
        email = request.form["email"]
        senha = request.form["senha"]

        supabase = conectar()
        try:
            resposta = supabase.auth.sign_in_with_password({
                "email": email,
                "password": senha
            })
        except Exception:
            flash("E-mail ou senha invalidos.")
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
            supabase.auth.sign_up({
                "email": email,
                "password": senha
            })
        except Exception as erro:
            flash(f"Nao foi possivel criar a conta: {erro}")
            return redirect(url_for("cadastro"))

        flash("Conta criada! Verifique seu e-mail para confirmar antes de entrar.")
        return redirect(url_for("login"))

    return render_template("cadastro.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login")) 

@app.route("/")
@login_necessario
def index():
    supabase = obter_supabase()

    if supabase is None:
        flash("Sua sessão expirou. Faça login novamente.")
        return redirect(url_for("login"))

    resposta = (
        supabase.table("despesas")
        .select("*")
        .eq("user_id", session["user_id"])
        .order("data", desc=True)
        .execute()
    )
    despesas = resposta.data

    resultados = [
        (d["id"], d["nome_despesa"], d["descricao"], float(d["valor"]), d["data"])
        for d in despesas
    ]

    total_qtd = len(despesas)
    total_valor = sum(float(d["valor"]) for d in despesas)
    resumo = (total_qtd, total_valor)

    totais_por_mes = defaultdict(float)
    contagem_por_mes = defaultdict(int)
    for d in despesas:
        mes = d["data"][:7]
        totais_por_mes[mes] += float(d["valor"])
        contagem_por_mes[mes] += 1

    totais_por_nome = defaultdict(float)
    for d in despesas:
        totais_por_nome[d["nome_despesa"]] += float(d["valor"])
    top_despesas = sorted(totais_por_nome.items(), key=lambda item: item[1], reverse=True)[:5]

    # Janela dos ultimos 6 meses (cronologica) pra alimentar os mini-graficos
    # dos cards de overview (essa comparacao continua sendo mes a mes).
    meses_recentes = sorted(totais_por_mes.keys())[-6:]
    valores_recentes = [totais_por_mes[m] for m in meses_recentes]
    contagens_recentes = [contagem_por_mes[m] for m in meses_recentes]
    medias_recentes = [
        (totais_por_mes[m] / contagem_por_mes[m]) if contagem_por_mes[m] else 0
        for m in meses_recentes
    ]

    overview = {
        "qtd": {"spark": _sparkline([float(c) for c in contagens_recentes]), "tendencia": _tendencia(contagens_recentes)},
        "valor": {"spark": _sparkline(valores_recentes), "tendencia": _tendencia(valores_recentes, mais_e_pior=True)},
        "media": {"spark": _sparkline(medias_recentes), "tendencia": _tendencia(medias_recentes, mais_e_pior=True)},
    }

    # Grafico grande do dashboard: TODAS as despesas do mes atual, na ordem
    # em que foram adicionadas (por id, nao por valor). Vira de mes o
    # grafico reinicia sozinho, porque so entram despesas com data no mes
    # corrente -- nao precisa de nenhuma logica extra de "reset".
    hoje = date.today()
    mes_atual = hoje.strftime("%Y-%m")
    despesas_do_mes = sorted(
        (d for d in despesas if d["data"][:7] == mes_atual),
        key=lambda d: d["id"],
    )
    grafico_despesas = _grafico_area(
        [d["nome_despesa"] for d in despesas_do_mes],
        [float(d["valor"]) for d in despesas_do_mes],
    )
    periodo_despesas = (
        (despesas_do_mes[0]["data"], despesas_do_mes[-1]["data"])
        if despesas_do_mes else None
    )
    mes_atual_nome = MESES_PT[hoje.month]

    cores_despesas = _tons(len(top_despesas))
    donut = _segmentos_donut(top_despesas, cores_despesas)

    return render_template(
        "index.html",
        resultados=resultados,
        resumo=resumo,
        overview=overview,
        grafico_despesas=grafico_despesas,
        periodo_despesas=periodo_despesas,
        mes_atual_nome=mes_atual_nome,
        donut=donut,
        email=session.get("email")
    )


@app.route("/adicionar", methods=["POST"])
@login_necessario
def adicionar():
    nome_despesa = request.form["nome_despesa"]
    descricao = request.form["descricao"]
    valor = request.form["valor"]

    supabase = obter_supabase()

    if supabase is None:
            flash("Sua sessão expirou. Faça login novamente.")
            return redirect(url_for("login"))
    
    supabase.table("despesas").insert({
        "nome_despesa": nome_despesa,
        "descricao": descricao,
        "valor": valor,
        "user_id": session["user_id"]
    }).execute()

    return redirect(url_for("index"))


@app.route("/atualizar", methods=["POST"])
@login_necessario
def atualizar_despesa():
    id_despesa = request.form["id_despesa"]
    nome_despesa = request.form["nome_despesa"]
    descricao = request.form["descricao"]
    valor = request.form["valor"]

    supabase = obter_supabase()
    if supabase is None:
            flash("Sua sessão expirou. Faça login novamente.")
            return redirect(url_for("login"))
    
    supabase.table("despesas").update({
        "nome_despesa": nome_despesa,
        "descricao": descricao,
        "valor": valor
    }).eq("id", id_despesa).eq("user_id", session["user_id"]).execute()

    return redirect(url_for("index"))


@app.route("/deletar", methods=["POST"])
@login_necessario
def deletar_despesa():
    id_despesa = request.form["id_despesa"]

    supabase = obter_supabase()
    if supabase is None:
            flash("Sua sessão expirou. Faça login novamente.")
            return redirect(url_for("login"))
    supabase.table("despesas").delete().eq("id", id_despesa).eq("user_id", session["user_id"]).execute()

    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(debug=True)
