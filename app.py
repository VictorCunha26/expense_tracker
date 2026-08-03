from flask import Flask, render_template, request, redirect, url_for
from connection import conectar
from collections import defaultdict 


app = Flask(__name__)

@app.route("/")
def index():
    supabase = conectar()
    #.table("despesas") aponta para a tabela
    #.select("*") pede todas as colunas 
    #.order ("data", desc=True) ordena da mais recente para a mais antiga 
    #.execute() de fato dispara a requisição e traz resultado 

    resposta  = supabase.table("despesas").select("*").order("data", desc=True).execute()
    despesas  = resposta.data # lista de dicionários


    # O template espera "resultados" com lista de tuplas 
    # (id, nome, descricao, valor, data) -então convertemos aqui

    resultados = [
        (d["id"], d["nome_despesa"], d["descricao"], float(d["valor"]), d["data"])
        for d in despesas
    ]

    total_qtd = len(despesas)
    total_valor = sum(float(d["valor"]) for d in despesas)
    resumo = (total_qtd, total_valor)


    # Total por mês: agrupamento manual usando um dicionário
    # Um dicionário é uma estrutura de dados que guarda informações em pares de chave e valor
    # defaultdict(float) cria a chave com o valor 0.0 automaticamente na primeira vez que ela aparece
    # evitando checar "if not existe"

    totais_por_mes = defaultdict(float)
    for d in despesas:
        # a "data" vem como string tipo "2026-07-31T14:32:10+00:00"
        # [:7] pega só "2026-07", equivalente ao DATE_FORMAT(data, '%Y-%m')
        mes = d["data"][:7]
        totais_por_mes[mes] += float(d["valor"])

    # Oredena do mês mais recente para o mês mais antigo, igual o ORDER BY mes DESC
    resumo_mensal  = sorted(totais_por_mes.items(), key = lambda item: item[0], reverse = True) 

    totais_por_nome = defaultdict(float)
    for d in despesas: 
        totais_por_nome[d["nome_despesa"]] += float(d["valor"])

    top_despesas = sorted(totais_por_nome.items(), key = lambda item: item[1], reverse = True) 

    return render_template(
        "index.html",
        resultados=resultados,
        resumo=resumo,
        resumo_mensal=resumo_mensal,
        top_despesas=top_despesas
    )

@app.route("/adicionar", methods=["POST"])

def adicionar():
    nome_despesa = request.form["nome_despesa"]
    descricao = request.form["descricao"]
    valor = request.form["valor"]

    supabase  = conectar()

    supabase.table("despesas").insert({
        "nome_despesa": nome_despesa,
        "descricao": descricao,
        "valor": valor
    }).execute()

    return redirect(url_for("index"))

@app.route("/atualizar", methods=["POST"])

def atualizar_despesa():
    id_despesa = request.form["id_despesa"]
    nome_despesa = request.form["nome_despesa"]
    descricao = request.form["descricao"]
    valor = request.form["valor"]

    supabase  =  conectar()

    supabase.table("despesas").update({
        "nome_despesa": nome_despesa,
        "descricao": descricao,
        "valor": valor
    }).eq("id", id_despesa).execute()

    return redirect(url_for("index"))

@app.route("/deletar", methods = ["POST"])
def deletar_despesa():
    id_despesa  = request.form["id_despesa"]

    supabase =conectar()

    supabase.table("despesas").delete().eq("id", id_despesa).execute()
    return redirect(url_for("index"))

if __name__ == "__main__":
    app.run(debug = True)