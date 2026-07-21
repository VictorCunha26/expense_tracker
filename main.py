from connection import conectar

def adicionar_despesa():
    nome_despesa = input("Escreva o nome da sua despesa: ")
    descricao = input("Escreva a descrição da sua despesa: ")
    valor = float(input("Escreva o valor: "))

    conexao = conectar()
    cursor = conexao.cursor()

    query = "INSERT INTO despesas (nome_despesa, descricao, valor) VALUE (%s, %s, %s)"
    valores = (nome_despesa, descricao, valor)

    cursor.execute(query, valores)
    conexao.commit()

    print("Dados enviados")

    cursor.close()
    conexao.close()

def ver_despesas():
    conexao = conectar()
    cursor = conexao.cursor()

    query = "SELECT id, nome_despesa FROM despesas"
    cursor.execute(query)

    resultados = cursor.fetchall() #traz todas as linhas de uma vez, como uma lista de tuplas

    if not resultados:
        print("Nenhuma despesa cadastrada")
    else:
        for linha in resultados:
            id, nome = linha
            print(f"ID: {id} - Despesa: {nome}")

    cursor.close()
    conexao.close()

    

def atualizar_despesa():
    ver_despesas()
    id_despesa = int(input("Digite o ID da despesa que deseja atualizar: "))
    nome_despesa = input("Novo nome da despesa: ")
    descricao = input("Nova Descrição: ")
    valor = float(input("Novo valor: "))

    conexao = conectar()
    cursor = conexao.cursor()

    query = "UPDATE despesas SET nome_despesa = %s, descricao = %s, valor = %s WHERE id = %s"
    valores = (nome_despesa, descricao, valor, id_despesa)

    cursor.execute(query, valores)
    conexao.commit()

    if cursor.rowcount == 0:
        print("Não existe esse ID")
    else:
        print("Despesa foi atualizada")

    cursor.close()
    conexao.close()

def deletar_despesa():
    ver_despesas()
    id_despesa = int(input("Digite o ID da despesa que deseja deletar"))

    conexao = conectar()
    cursor = conexao.cursor()

    query = "DELETE FROM despesas WHERE id = %s"
    valores=(id_despesa,)

    cursor.execute(query, valores)
    conexao.commit()

    if cursor.rowcount == 0:
        print("Não existe esse ID")
    else:
        print("Despesa foi apagada")

    cursor.close()
    conexao.close()

def resumo_despesa():
    conexao = conectar()
    cursor = conexao.cursor()

    query = "SELECT COUNT(*), SUM(valor) FROM despesas"
    cursor.execute(query)

    resultado = cursor.fetchone() #Usa fetchone porque retorna apenas uma linha
    total_depesas, soma_total = resultado

    if total_depesas == 0:
        print("Nenhuma despesas cadastrada")
    else:
        print(f"Total de despesas {total_depesas}")
        print(f"Valor Total gasto: R$ {soma_total:.2f}")

    cursor.close()
    conexao.close()

def resumo_despesa_mes():
    mes = int(input("Digite o mês (1 a 12): "))
    ano = int(input("Digite o ano (ex 2026): "))

    conexao = conectar()
    cursor = conexao.cursor()

    query = "SELECT COUNT(*), SUM(valor) FROM despesas WHERE MONTH(data) = %s AND YEAR(data) = %s"
    valores = (mes, ano)

    cursor.execute(query, valores)
    resultado = cursor.fetchone()
    total_depesas, soma_total = resultado

    if total_depesas == 0:
        print(f"Nemnhuma despesa encontrada para {mes}/{ano}.")
    else: 
        print(f"Total de despesas em {mes}/{ano}: {total_depesas}")
        print(f"Valor total gasto: R$ {soma_total:.2f}")



while True:
    print("1-Adicionar Despesa\n2-Atualizar Despesa\n3-Deletar uma despesa\n4-Ver todas as depesas\n5-resumo da despesa\n6-resumo despesa mês específico\n7-Sair")
    resposta = int(input("Selecione o valor correspondente: "))

    if resposta == 1:
        adicionar_despesa()
    elif resposta == 2:
        atualizar_despesa()
    elif resposta == 3:
        deletar_despesa()
    elif resposta == 4:
        ver_despesas()
    elif resposta == 5:
        resumo_despesa()
    elif resposta == 6:
        resumo_despesa_mes()
    elif resposta == 7:
        break
    else:
        print("Selecione um número válido")


