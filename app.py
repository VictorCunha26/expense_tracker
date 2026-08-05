import os
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, flash
from postgrest.exceptions import APIError
from connection import conectar, conectar_como_usuario, renovar_sessao
from collections import defaultdict 

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")


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
    for d in despesas:
        mes = d["data"][:7]
        totais_por_mes[mes] += float(d["valor"])
    resumo_mensal = sorted(totais_por_mes.items(), key=lambda item: item[0], reverse=True)

    totais_por_nome = defaultdict(float)
    for d in despesas:
        totais_por_nome[d["nome_despesa"]] += float(d["valor"])
    top_despesas = sorted(totais_por_nome.items(), key=lambda item: item[1], reverse=True)[:5]

    return render_template(
        "index.html",
        resultados=resultados,
        resumo=resumo,
        resumo_mensal=resumo_mensal,
        top_despesas=top_despesas,
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
