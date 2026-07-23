from flask import Flask, render_template, request, redirect, url_for
from connection import conectar


app = Flask(__name__)

@app.route("/")
def index():
    conexao = conectar()
    cursor = conexao.cursor()

    # Lista de despesas
    cursor.execute("SELECT id, nome_despesa, descricao, valor, data FROM despesas")
    resultados = cursor.fetchall()

    # Total geral
    cursor.execute("SELECT COUNT(*), SUM(valor) FROM despesas")
    resumo = cursor.fetchone()
    if resumo is None:
        resumo = 0

    # Total por mês
    query_mes = """
        SELECT DATE_FORMAT(data, '%Y-%m') AS mes, SUM(valor) AS total
        FROM despesas
        GROUP BY mes
        ORDER BY mes DESC
    """
    cursor.execute(query_mes)
    resumo_mensal = cursor.fetchall()

    # Agrupa e soma o valor de cada "nome_despesa" repetido,
    # ordenado do maior gasto pro menor, pegando só o Top 5
    # (isso alimenta o gráfico de rosca e o ranking do Dashboard)
    query_top_despesas = """
        SELECT nome_despesa, SUM(valor) AS total
        FROM despesas
        GROUP BY nome_despesa
        ORDER BY total DESC
        LIMIT 5
    """
    cursor.execute(query_top_despesas)
    top_despesas = cursor.fetchall()

    cursor.close()
    conexao.close()

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

    conexao = conectar()
    cursor = conexao.cursor() 

    query = "INSERT INTO despesas (nome_despesa, descricao, valor) VALUE (%s, %s, %s)"
    valores = (nome_despesa, descricao, valor)

    cursor.execute(query, valores)
    conexao.commit()

    cursor.close()
    conexao.close

    return redirect(url_for("index"))

@app.route("/atualizar", methods=["POST"])

def atualizar_despesa():
    id_despesa = request.form["id_despesa"]
    nome_despesa = request.form["nome_despesa"]
    descricao = request.form["descricao"]
    valor = request.form["valor"]

    conexao = conectar()
    cursor = conexao.cursor()

    query = "UPDATE despesas SET nome_despesa = %s, descricao = %s, valor = %s WHERE id = %s "
    valores = (nome_despesa, descricao, valor, id_despesa)

    cursor.execute(query,valores)
    conexao.commit()

    cursor.close()
    conexao.close()

    return redirect(url_for("index"))

@app.route("/deletar", methods = ["POST"])
def deletar_despesa():
    id_despesa  = request.form["id_despesa"]

    conexao = conectar()
    cursor = conexao.cursor()

    query = "DELETE FROM despesas WHERE id = %s"

    cursor.execute(query, (id_despesa,) )
    conexao.commit()

    cursor.close()
    conexao.close()

    return redirect(url_for("index"))

@app.route("/")
def resumo():
    conexao = conectar()
    cursor = conexao.cursor()

    query = "SELECT COUNT(*), SUM(valor) FROM despesas"
    cursor.execute(query)

    resumo = cursor.fetchone() #Usa fetchone porque retorna apenas uma linha

    cursor.close()
    conexao.close()

    return render_template("index.html", resumo=resumo)

if __name__ == "__main__":
    app.run(debug = True)