"""Synch IA: o assistente financeiro do app, rodando no Gemini (Google).

O modelo recebe um retrato das financas do usuario e ferramentas para
pesquisar as transacoes. Ele nunca grava nada: registrar gasto, ajustar
orcamento, criar meta ou recorrencia volta para o front como PROPOSTA, e
so vira dado quando o usuario confirma no card da conversa.

Este modulo nao conhece o Supabase: o app.py monta o dicionario `dados`
(mesmo formato que o front recebe no bootstrap) e chama `responder`.
"""
import json
import logging
import os
import unicodedata
from collections import defaultdict
from datetime import date

import openai

# O Gemini tem plano gratuito e aceita o formato de API da OpenAI; trocar
# SYNCH_IA_BASE_URL/SYNCH_IA_MODELOS aponta para outro provedor compativel.
BASE_URL = os.getenv("SYNCH_IA_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
# Em ordem de preferencia: o flash-lite e o mais estavel no plano gratuito.
# Os maiores vivem sobrecarregados (503) ou com a cota do dia esgotada
# (429); nesses casos a conversa segue no proximo da lista.
MODELOS = [m.strip() for m in os.getenv("SYNCH_IA_MODELOS", "gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.5-flash").split(",") if m.strip()]
RACIOCINIO = os.getenv("SYNCH_IA_RACIOCINIO", "low")
MAX_RODADAS = 6
MAX_HISTORICO = 20
MAX_TEXTO = 4000

log = logging.getLogger(__name__)

DIAS_SEMANA = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]

INSTRUCOES = """Você é a Synch, assistente financeira do Synch Cash, um app brasileiro de controle financeiro pessoal. Você conversa em português do Brasil com o dono da conta, por texto ou por voz. Mensagens por voz chegam transcritas automaticamente e podem ter erros de transcrição: interprete pelo sentido.

Seu trabalho é entender o que a pessoa quer do jeito que ela escrever ou falar (gíria, erro de digitação, frase incompleta, valor por extenso como "cinquenta conto", "1k" ou "dois e cinquenta"), consultar os dados reais dela e responder com precisão.

# Como responder
- Use somente os dados do contexto financeiro e das ferramentas. Nunca invente valores, transações, contas ou datas. Se o dado não existe no app, diga isso.
- O contexto financeiro já traz contas, cartões e faturas, orçamentos, metas, recorrências e o resumo do mês atual. Para perguntas que dependem de transações específicas (um estabelecimento, outro período, comparação entre meses, maior gasto, pendências, busca por descrição), consulte buscar_transacoes ou resumo_por_mes antes de responder.
- "Este mês" é o mês da data de hoje. Se a pessoa não disser o período, use o mês atual e diga qual período considerou.
- Escreva valores no formato brasileiro: R$ 1.234,56.
- Responda em texto simples, sem Markdown (nada de asteriscos, cerquilhas, negrito ou tabelas): a resposta aparece como texto puro e pode ser lida em voz alta. Para listar itens, use uma linha por item.
- Seja direta e calorosa. Comece pela resposta e acrescente só os detalhes que ajudam. Em geral, até quatro frases, a menos que a pessoa peça mais.
- Você pode dar orientação financeira geral baseada nos números dela (onde cortar, qual meta priorizar, se uma compra cabe no limite), mas não recomende investimentos, ativos ou produtos financeiros específicos.

# Ações
- Para registrar gasto ou receita, definir orçamento, criar meta ou criar recorrência, use a ferramenta propor_* correspondente. Ela não grava nada: mostra um card para a pessoa revisar e confirmar. Depois da proposta, diga em uma frase o que preparou e peça confirmação.
- Relatos no passado ("gastei 30 no uber", "caiu meu salário de 3 mil") são pedidos de registro.
- Deduza o que for razoável: data de hoje quando não houver outra, a categoria existente mais adequada, a conta mais provável. Mencione suposições que a pessoa talvez queira corrigir. Pergunte apenas quando faltar algo essencial, como o valor.
- Prepare uma proposta por vez; várias transações podem ir juntas na mesma proposta de lançamentos.
- Se há uma ação pendente e a pessoa confirma ("sim", "pode", "manda", "confirmo"), cancela ("não", "deixa", "esquece") ou pede para desfazer a última ação, use decidir_acao. Se ela pedir para mudar algo na ação pendente, faça uma nova proposta completa já com a correção.
- Você não edita nem exclui transações, contas ou metas existentes, não paga faturas e não transfere dinheiro. Nesses casos, explique onde fazer no app: Transações, Contas e cartões, Metas, Recorrentes ou Planejamento.

# Fora do escopo
- Cumprimentos e conversa rápida: responda com simpatia e ofereça ajuda com as finanças.
- Se o pedido não tem relação com as finanças da pessoa nem com o Synch Cash (receitas culinárias, notícias, programação, trabalhos escolares), diga com gentileza que não entendeu como isso se relaciona às finanças dela, que só consegue ajudar com o dinheiro e o app, e dê um ou dois exemplos do que ela pode pedir.
- Se a mensagem for ambígua mas plausivelmente financeira, siga a interpretação mais provável; só pergunte quando duas leituras levariam a respostas bem diferentes.

# Valores ocultos
Quando o estado da tela disser que os valores estão ocultos, não diga nenhum valor em reais: use "valor oculto" e fale de proporções, datas e nomes."""


class IAIndisponivel(Exception):
    """Falha ao falar com o modelo -- o app devolve 503 com esta mensagem."""


class ErroFerramenta(Exception):
    """Entrada invalida numa ferramenta; volta pro modelo como resultado de erro."""


# ------------------------------------------------------------------
# Ferramentas
# ------------------------------------------------------------------

_CONFIANCA = {"type": "integer", "description": "De 0 a 100: o quanto você tem certeza de ter entendido o pedido."}

FERRAMENTAS = [
    {
        "name": "buscar_transacoes",
        "description": (
            "Pesquisa as transações do usuário com filtros e devolve os totais já somados (despesas, receitas, "
            "por categoria e por conta) e a lista das transações encontradas. Use para perguntas sobre gastos, "
            "receitas, estabelecimentos, períodos, maiores despesas ou pendências. Transferências entre contas e "
            "pagamentos de fatura ficam fora, a não ser que incluir_transferencias seja true. Os totais sempre "
            "consideram todas as transações encontradas, mesmo as que não couberem na lista."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "data_inicio": {"type": "string", "description": "Data inicial AAAA-MM-DD, inclusive."},
                "data_fim": {"type": "string", "description": "Data final AAAA-MM-DD, inclusive."},
                "tipo": {"type": "string", "enum": ["despesa", "receita", "todos"]},
                "categoria": {"type": "string", "description": "Nome de uma categoria existente."},
                "conta": {"type": "string", "description": "Nome de uma conta ou cartão existente."},
                "status": {"type": "string", "enum": ["pago", "pendente", "todos"]},
                "texto": {"type": "string", "description": "Trecho procurado na descrição, estabelecimento ou observação. Ignora acentos e maiúsculas."},
                "incluir_transferencias": {"type": "boolean"},
                "ordenar_por": {"type": "string", "enum": ["data_desc", "data_asc", "valor_desc", "valor_asc"]},
                "limite": {"type": "integer", "description": "Máximo de transações listadas, de 1 a 100 (padrão 30)."},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "resumo_por_mes",
        "description": (
            "Totais mês a mês entre dois meses: receitas, despesas, resultado e despesas por categoria, "
            "contando só lançamentos pagos e sem transferências. Use para comparar meses e ver tendências."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "mes_inicio": {"type": "string", "description": "AAAA-MM"},
                "mes_fim": {"type": "string", "description": "AAAA-MM"},
            },
            "required": ["mes_inicio", "mes_fim"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propor_lancamentos",
        "description": (
            "Prepara uma ou mais transações (gastos ou receitas) para o usuário revisar e confirmar. Não grava nada. "
            "Compra parcelada vira uma transação com parcelas > 1 e o valor TOTAL da compra."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "lancamentos": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 20,
                    "items": {
                        "type": "object",
                        "properties": {
                            "descricao": {"type": "string", "description": "Nome curto, como aparece num extrato: Mercado, Uber, Salário."},
                            "valor": {"type": "number", "description": "Valor total em reais, positivo."},
                            "tipo": {"type": "string", "enum": ["despesa", "receita"]},
                            "categoria": {"type": "string", "description": "Uma das categorias existentes."},
                            "data": {"type": "string", "description": "AAAA-MM-DD"},
                            "conta": {"type": "string", "description": "Uma das contas ou cartões existentes."},
                            "status": {"type": "string", "enum": ["pago", "pendente"]},
                            "parcelas": {"type": "integer", "description": "1 quando for à vista."},
                            "recorrente": {"type": "boolean", "description": "true quando se repete todo mês."},
                        },
                        "required": ["descricao", "valor", "tipo", "categoria", "data", "conta", "status"],
                        "additionalProperties": False,
                    },
                },
                "confianca": _CONFIANCA,
            },
            "required": ["lancamentos", "confianca"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propor_orcamento",
        "description": "Prepara um novo limite mensal de gastos para uma categoria. Não grava nada.",
        "input_schema": {
            "type": "object",
            "properties": {
                "categoria": {"type": "string", "description": "Uma das categorias existentes."},
                "valor": {"type": "number", "description": "Limite mensal em reais."},
                "confianca": _CONFIANCA,
            },
            "required": ["categoria", "valor", "confianca"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propor_meta",
        "description": "Prepara uma nova meta financeira (objetivo de economia). Não grava nada.",
        "input_schema": {
            "type": "object",
            "properties": {
                "nome": {"type": "string", "description": "Nome curto da meta: Viagem, Reserva de emergência."},
                "valor_alvo": {"type": "number", "description": "Quanto quer juntar, em reais."},
                "prazo": {"type": "string", "description": "Prazo em texto, como 'Dezembro 2026'. Omita se não houver."},
                "confianca": _CONFIANCA,
            },
            "required": ["nome", "valor_alvo", "confianca"],
            "additionalProperties": False,
        },
    },
    {
        "name": "propor_recorrencia",
        "description": "Prepara uma cobrança ou receita que se repete todo mês (assinatura, aluguel, salário). Não grava nada.",
        "input_schema": {
            "type": "object",
            "properties": {
                "nome": {"type": "string"},
                "categoria": {"type": "string", "description": "Uma das categorias existentes."},
                "valor": {"type": "number", "description": "Valor mensal em reais."},
                "tipo": {"type": "string", "enum": ["despesa", "receita"]},
                "dia": {"type": "integer", "description": "Dia do mês do lançamento, de 1 a 28."},
                "confianca": _CONFIANCA,
            },
            "required": ["nome", "categoria", "valor", "tipo", "dia", "confianca"],
            "additionalProperties": False,
        },
    },
    {
        "name": "decidir_acao",
        "description": (
            "Executa a decisão do usuário sobre a ação pendente no card (confirmar ou cancelar) ou desfaz a "
            "última ação executada. Use só quando a mensagem mais recente do usuário pedir isso com clareza."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"decisao": {"type": "string", "enum": ["confirmar", "cancelar", "desfazer"]}},
            "required": ["decisao"],
            "additionalProperties": False,
        },
    },
]


def _sem_acento(texto):
    base = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in base if unicodedata.category(c) != "Mn").casefold().strip()


def _achar_nome(nome, opcoes):
    """Nome exato da opcao que casa com `nome` ignorando acento/maiuscula."""
    chave = _sem_acento(nome)
    return next((o for o in opcoes if _sem_acento(o) == chave), None)


def _data_valida(texto):
    try:
        return date.fromisoformat(str(texto)[:10]).isoformat()
    except ValueError:
        raise ErroFerramenta(f"Data inválida: {texto!r}. Use AAAA-MM-DD.")


def _mes_valido(texto):
    texto = str(texto or "")
    try:
        date.fromisoformat(f"{texto[:7]}-01")
    except ValueError:
        raise ErroFerramenta(f"Mês inválido: {texto!r}. Use AAAA-MM.")
    return texto[:7]


def _valor_positivo(valor, rotulo="valor"):
    if not isinstance(valor, (int, float)) or valor <= 0:
        raise ErroFerramenta(f"O {rotulo} precisa ser um número maior que zero.")
    return round(float(valor), 2)


def _confianca(entrada):
    try:
        return max(0, min(100, int(entrada.get("confianca", 90))))
    except (TypeError, ValueError):
        return 90


def _categoria_existente(nome, dados):
    achada = _achar_nome(nome, dados["categorias"])
    if not achada:
        raise ErroFerramenta(f"Categoria {nome!r} não existe. Use uma destas: {', '.join(dados['categorias'])}.")
    return achada


def _analitica(t):
    return t.get("analitica", True)


def _totais(transacoes):
    despesas = receitas = 0.0
    por_categoria, por_conta = defaultdict(float), defaultdict(float)
    for t in transacoes:
        if t["type"] == "expense":
            despesas += t["amount"]
            por_categoria[t["category"]] += t["amount"]
            por_conta[t["account"]] += t["amount"]
        else:
            receitas += t["amount"]
    ordenado = lambda d: {k: round(v, 2) for k, v in sorted(d.items(), key=lambda i: -i[1])}
    return {
        "total_despesas": round(despesas, 2),
        "total_receitas": round(receitas, 2),
        "resultado": round(receitas - despesas, 2),
        "despesas_por_categoria": ordenado(por_categoria),
        "despesas_por_conta": ordenado(por_conta),
    }


def _resumo_transacao(t):
    item = {
        "data": t["date"], "descricao": t["description"], "valor": t["amount"],
        "tipo": "receita" if t["type"] == "income" else "despesa",
        "categoria": t["category"], "conta": t["account"],
        "status": "pendente" if t["status"] == "pending" else "pago",
    }
    if t.get("merchant") and t["merchant"] != t["description"]:
        item["estabelecimento"] = t["merchant"]
    if t.get("notes"):
        item["observacao"] = t["notes"]
    if t.get("kind") == "refund":
        item["estorno"] = True
    return item


def _buscar_transacoes(entrada, dados):
    inicio = _data_valida(entrada["data_inicio"]) if entrada.get("data_inicio") else None
    fim = _data_valida(entrada["data_fim"]) if entrada.get("data_fim") else None
    tipo = {"despesa": "expense", "receita": "income"}.get(entrada.get("tipo"))
    status = {"pago": "paid", "pendente": "pending"}.get(entrada.get("status"))
    categoria = _categoria_existente(entrada["categoria"], dados) if entrada.get("categoria") else None
    conta = None
    if entrada.get("conta"):
        conta = _achar_nome(entrada["conta"], [c["nome"] for c in dados["contas"]])
        if not conta:
            raise ErroFerramenta(f"Conta {entrada['conta']!r} não existe. Contas: {', '.join(c['nome'] for c in dados['contas'])}.")
    texto = _sem_acento(entrada.get("texto"))
    com_transferencias = bool(entrada.get("incluir_transferencias"))

    achadas = []
    for t in dados["transacoes"]:
        if not com_transferencias and not _analitica(t):
            continue
        if (inicio and t["date"] < inicio) or (fim and t["date"] > fim):
            continue
        if (tipo and t["type"] != tipo) or (status and t["status"] != status):
            continue
        if (categoria and t["category"] != categoria) or (conta and _sem_acento(t["account"]) != _sem_acento(conta)):
            continue
        if texto and texto not in _sem_acento(" ".join(filter(None, [t["description"], t.get("merchant"), t.get("notes")]))):
            continue
        achadas.append(t)

    chave, reverso = {
        "data_asc": ("date", False), "valor_desc": ("amount", True), "valor_asc": ("amount", False),
    }.get(entrada.get("ordenar_por"), ("date", True))
    achadas.sort(key=lambda t: t[chave], reverse=reverso)
    try:
        limite = max(1, min(100, int(entrada.get("limite") or 30)))
    except (TypeError, ValueError):
        limite = 30

    pendentes = [t for t in achadas if t["status"] == "pending"]
    pagas = [t for t in achadas if t["status"] != "pending"]
    return {
        "quantidade": len(achadas),
        "totais_pagos": _totais(pagas),
        "pendentes": {"quantidade": len(pendentes), "total": round(sum(t["amount"] for t in pendentes), 2)},
        "transacoes": [_resumo_transacao(t) for t in achadas[:limite]],
        "lista_cortada": len(achadas) > limite,
    }


def _resumo_por_mes(entrada, dados):
    inicio, fim = _mes_valido(entrada["mes_inicio"]), _mes_valido(entrada["mes_fim"])
    if inicio > fim:
        inicio, fim = fim, inicio
    meses = defaultdict(list)
    for t in dados["transacoes"]:
        if _analitica(t) and t["status"] == "paid" and inicio <= t["date"][:7] <= fim:
            meses[t["date"][:7]].append(t)
    resultado, ano, mes = {}, int(inicio[:4]), int(inicio[5:7])
    while f"{ano:04d}-{mes:02d}" <= fim and len(resultado) < 36:
        chave = f"{ano:04d}-{mes:02d}"
        totais = _totais(meses.get(chave, []))
        totais.pop("despesas_por_conta")
        resultado[chave] = {**totais, "quantidade": len(meses.get(chave, []))}
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)
    return resultado


def _propor_lancamentos(entrada, dados):
    nomes_contas = [c["nome"] for c in dados["contas"]] or ["Carteira"]
    rascunhos = []
    for item in entrada.get("lancamentos") or []:
        tipo = "income" if item.get("tipo") == "receita" else "expense"
        conta = _achar_nome(item.get("conta"), nomes_contas)
        if not conta:
            raise ErroFerramenta(f"Conta {item.get('conta')!r} não existe. Contas: {', '.join(nomes_contas)}.")
        descricao = (item.get("descricao") or "").strip()
        if not descricao:
            raise ErroFerramenta("Cada lançamento precisa de uma descrição.")
        try:
            parcelas = max(1, min(48, int(item.get("parcelas") or 1)))
        except (TypeError, ValueError):
            parcelas = 1
        rascunhos.append({
            "description": descricao[:80],
            "amount": _valor_positivo(item.get("valor")),
            "type": tipo,
            "category": _categoria_existente(item.get("categoria"), dados),
            "date": _data_valida(item.get("data")),
            "account": conta,
            "status": "pending" if item.get("status") == "pendente" else "paid",
            "installments": parcelas,
            "recurring": bool(item.get("recorrente")),
        })
    if not rascunhos:
        raise ErroFerramenta("Informe pelo menos um lançamento.")
    return {"kind": "transactions", "confidence": _confianca(entrada), "drafts": rascunhos}


def _propor_orcamento(entrada, dados):
    return {
        "kind": "budget", "confidence": _confianca(entrada),
        "category": _categoria_existente(entrada.get("categoria"), dados),
        "amount": _valor_positivo(entrada.get("valor")),
    }


def _propor_meta(entrada, dados):
    nome = (entrada.get("nome") or "").strip()
    if not nome:
        raise ErroFerramenta("A meta precisa de um nome.")
    acao = {"kind": "goal", "confidence": _confianca(entrada), "name": nome[:60], "amount": _valor_positivo(entrada.get("valor_alvo"), "valor alvo")}
    if (entrada.get("prazo") or "").strip():
        acao["deadline"] = entrada["prazo"].strip()[:40]
    return acao


def _propor_recorrencia(entrada, dados):
    nome = (entrada.get("nome") or "").strip()
    if not nome:
        raise ErroFerramenta("A recorrência precisa de um nome.")
    try:
        dia = int(entrada.get("dia"))
    except (TypeError, ValueError):
        dia = 0
    if not 1 <= dia <= 28:
        raise ErroFerramenta("O dia da recorrência precisa estar entre 1 e 28.")
    return {
        "kind": "recurring", "confidence": _confianca(entrada), "name": nome[:60],
        "category": _categoria_existente(entrada.get("categoria"), dados),
        "amount": _valor_positivo(entrada.get("valor")),
        "type": "income" if entrada.get("tipo") == "receita" else "expense",
        "day": dia,
    }


CONSULTAS = {"buscar_transacoes": _buscar_transacoes, "resumo_por_mes": _resumo_por_mes}
PROPOSTAS = {
    "propor_lancamentos": _propor_lancamentos, "propor_orcamento": _propor_orcamento,
    "propor_meta": _propor_meta, "propor_recorrencia": _propor_recorrencia,
}


# ------------------------------------------------------------------
# Contexto
# ------------------------------------------------------------------

def _contexto(dados, estado):
    hoje = dados["hoje"]
    mes = hoje.isoformat()[:7]
    do_mes = [t for t in dados["transacoes"] if t["date"][:7] == mes and _analitica(t)]
    pagas = [t for t in do_mes if t["status"] != "pending"]
    pendentes = [t for t in do_mes if t["status"] == "pending"]
    totais = _totais(pagas)
    gasto_categoria = totais["despesas_por_categoria"]
    datas = sorted(t["date"] for t in dados["transacoes"])

    retrato = {
        "hoje": f"{hoje.isoformat()} ({DIAS_SEMANA[hoje.weekday()]})",
        "nome_do_usuario": dados["usuario"],
        "contas_e_cartoes": dados["contas"],
        "categorias": dados["categorias"],
        "orcamentos_do_mes_atual": [
            {"categoria": c, "limite": v, "gasto": gasto_categoria.get(c, 0.0), "restante": round(v - gasto_categoria.get(c, 0.0), 2)}
            for c, v in dados["orcamentos"].items()
        ],
        "metas": [
            {"nome": m["name"], "guardado": m["saved"], "alvo": m["target"], "prazo": m["deadline"],
             "percentual": round(m["saved"] / m["target"] * 100) if m["target"] else 0}
            for m in dados["metas"]
        ],
        "recorrencias": [
            {"nome": r["name"], "categoria": r["category"], "valor": r["amount"],
             "tipo": "receita" if r["type"] == "income" else "despesa",
             "dia": r["day"], "proximo_lancamento": r["next"], "ativa": r["active"]}
            for r in dados["recorrentes"]
        ],
        "mes_atual": {
            "mes": mes,
            **totais,
            "pendentes": {"quantidade": len(pendentes), "total": round(sum(t["amount"] for t in pendentes), 2)},
        },
        "historico_de_transacoes": {
            "quantidade": len(datas), "primeira_data": datas[0] if datas else None, "ultima_data": datas[-1] if datas else None,
        },
    }

    tela = [f"Mês aberto na tela: {estado['mes_na_tela']}." if estado.get("mes_na_tela") else None,
            "A mensagem mais recente veio por voz (transcrição automática)." if estado.get("origem") == "voice" else None,
            "Os valores estão ocultos na tela." if estado.get("valores_ocultos") else None]
    if estado.get("acao_pendente"):
        tela.append("Ação pendente no card, aguardando confirmação: " + json.dumps(estado["acao_pendente"], ensure_ascii=False))
    else:
        tela.append("Nenhuma ação pendente.")
    if estado.get("ultima_acao"):
        tela.append(f"Última ação executada, que pode ser desfeita: {estado['ultima_acao']}.")

    return (
        "<contexto_financeiro>\n" + json.dumps(retrato, ensure_ascii=False) + "\n</contexto_financeiro>\n"
        "<estado_da_tela>\n" + "\n".join(filter(None, tela)) + "\n</estado_da_tela>"
    )


def _mensagens(historico, mensagem):
    """Historico do front ({role, text}) -> mensagens da API. A saudacao
    inicial do assistente e descartada: a conversa precisa abrir com o usuario."""
    mensagens = []
    for item in (historico or [])[-MAX_HISTORICO:]:
        papel, texto = item.get("role"), str(item.get("text") or "").strip()[:MAX_TEXTO]
        if papel not in ("user", "assistant") or not texto or (not mensagens and papel == "assistant"):
            continue
        mensagens.append({"role": papel, "content": texto})
    mensagens.append({"role": "user", "content": mensagem})
    return mensagens


# ------------------------------------------------------------------
# Conversa
# ------------------------------------------------------------------

def _schema_compativel(schema):
    """O Gemini recusa additionalProperties nos parametros das funcoes."""
    if isinstance(schema, dict):
        return {k: _schema_compativel(v) for k, v in schema.items() if k != "additionalProperties"}
    if isinstance(schema, list):
        return [_schema_compativel(v) for v in schema]
    return schema


FUNCOES = [
    {"type": "function", "function": {"name": f["name"], "description": f["description"], "parameters": _schema_compativel(f["input_schema"])}}
    for f in FERRAMENTAS
]

_cliente = None


def _obter_cliente():
    global _cliente
    if _cliente is None:
        chave = os.getenv("GEMINI_API_KEY") or os.getenv("SYNCH_IA_API_KEY")
        if not chave:
            raise IAIndisponivel("A Synch IA ainda não foi configurada no servidor.")
        _cliente = openai.OpenAI(api_key=chave, base_url=BASE_URL, timeout=30.0, max_retries=2)
    return _cliente


def _chamar_modelo(mensagens, modelos):
    """Tenta cada modelo ate um responder. Devolve (resposta, modelos a partir
    do que respondeu), para as proximas rodadas da mesma conversa ficarem nele."""
    extra = {"reasoning_effort": RACIOCINIO} if RACIOCINIO else {}
    limite_estourado = False
    for i, modelo in enumerate(modelos):
        ultimo = i == len(modelos) - 1
        try:
            resposta = _obter_cliente().with_options(max_retries=1 if ultimo else 0).chat.completions.create(
                model=modelo, messages=mensagens, tools=FUNCOES, tool_choice="auto", **extra,
            )
            return resposta, modelos[i:]
        except openai.RateLimitError:
            log.warning("Modelo %s sem cota disponível", modelo)
            limite_estourado = True
        except (openai.AuthenticationError, openai.PermissionDeniedError):
            log.exception("Chave da API de IA recusada")
            raise IAIndisponivel("A Synch IA está indisponível por um problema de configuração no servidor.")
        except (openai.InternalServerError, openai.NotFoundError, openai.APIConnectionError) as e:
            log.warning("Modelo %s indisponível: %s", modelo, str(e)[:200])
        except openai.APIStatusError as e:
            log.exception("Erro da API de IA (%s) no modelo %s", e.status_code, modelo)
            raise IAIndisponivel("A Synch IA não conseguiu responder agora. Tente novamente em instantes.")
    if limite_estourado:
        raise IAIndisponivel("A Synch IA atingiu o limite de uso gratuito por agora. Tente de novo em alguns minutos.")
    raise IAIndisponivel("A Synch IA não conseguiu responder agora. Tente novamente em instantes.")


def _executar(nome, argumentos, dados, estado, proposta):
    """Roda uma chamada de ferramenta. Devolve (conteudo, proposta, decisao)."""
    try:
        entrada = json.loads(argumentos or "{}")
    except json.JSONDecodeError:
        raise ErroFerramenta("Os argumentos não são um JSON válido.")
    if not isinstance(entrada, dict):
        raise ErroFerramenta("Os argumentos precisam ser um objeto JSON.")
    if nome == "decidir_acao":
        decisao = {"confirmar": "confirm", "cancelar": "cancel", "desfazer": "undo"}.get(entrada.get("decisao"))
        if decisao == "undo" and not estado.get("ultima_acao"):
            raise ErroFerramenta("Não há ação recente para desfazer.")
        if decisao in ("confirm", "cancel") and not estado.get("acao_pendente"):
            raise ErroFerramenta("Não há ação pendente no card.")
        if not decisao:
            raise ErroFerramenta("Decisão inválida.")
        return "", proposta, decisao
    if nome in PROPOSTAS:
        if proposta:
            raise ErroFerramenta("Já existe uma proposta nesta resposta. Prepare uma ação por vez.")
        return "Proposta exibida no card para o usuário revisar. Nada foi gravado ainda.", PROPOSTAS[nome](entrada, dados), None
    if nome in CONSULTAS:
        return json.dumps(CONSULTAS[nome](entrada, dados), ensure_ascii=False), proposta, None
    raise ErroFerramenta(f"Ferramenta desconhecida: {nome}.")


def responder(mensagem, historico, dados, estado):
    """Conversa com o modelo ate ele dar a resposta final.

    Devolve {"answer": texto, "action": proposta|None, "decision": None|"confirm"|"cancel"|"undo"}.
    """
    mensagens = [{"role": "system", "content": INSTRUCOES + "\n\n" + _contexto(dados, estado)}] + _mensagens(historico, mensagem)
    proposta, modelos = None, MODELOS

    for _ in range(MAX_RODADAS):
        resposta, modelos = _chamar_modelo(mensagens, modelos)
        escolha = resposta.choices[0]
        if escolha.finish_reason == "content_filter":
            return {"answer": "Não posso ajudar com esse pedido. Se quiser, posso analisar seus gastos, contas ou metas.", "action": None, "decision": None}

        chamadas = escolha.message.tool_calls or []
        if not chamadas:
            texto = (escolha.message.content or "").strip()
            return {"answer": texto or "Não consegui formular uma resposta. Pode repetir de outro jeito?", "action": proposta, "decision": None}

        # model_dump preserva campos extras do provedor (o Gemini exige de volta a assinatura do raciocinio).
        mensagens.append({"role": "assistant", "content": escolha.message.content or "", "tool_calls": [c.model_dump(exclude_none=True) for c in chamadas]})
        for chamada in chamadas:
            try:
                conteudo, proposta, decisao = _executar(chamada.function.name, chamada.function.arguments, dados, estado, proposta)
                if decisao:
                    # O front executa a decisao e escreve a propria confirmacao na conversa.
                    return {"answer": "", "action": None, "decision": decisao}
            except (ErroFerramenta, KeyError) as e:
                conteudo = "ERRO: " + (str(e) if isinstance(e, ErroFerramenta) else f"campo obrigatório ausente: {e}.")
            mensagens.append({"role": "tool", "tool_call_id": chamada.id, "content": conteudo})

    log.warning("Synch IA atingiu o limite de %s rodadas de ferramentas", MAX_RODADAS)
    return {"answer": "Essa análise ficou longa demais para eu concluir agora. Pode dividir o pedido em partes menores?", "action": proposta, "decision": None}
