import csv
import hashlib
import hmac
import io
import json
import os
import re
import unicodedata
import urllib.parse
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, Response, jsonify, request, session
from supabase import AuthApiError
from werkzeug.middleware.proxy_fix import ProxyFix

# connection carrega o .env; synch_ia le as variaveis dele ao ser importado.
from connection import conectar, conectar_admin, conectar_como_usuario, renovar_sessao
import synch_ia

CAKTO_WEBHOOK_SECRET = os.getenv("CAKTO_WEBHOOK_SECRET")

# So existe um plano pago (Synch IA, com tudo -- contas ilimitadas,
# parcelas/recorrencias, relatorios completos, importacao E o Assistente
# por texto e voz). O link de checkout reaproveita o produto que ja
# existia como "Basico" na Cakto (R$ 149,90/ano).
CAKTO_PLANOS = {
    "synch_ia": {
        "oferta_id": "syw8q2x",
        "checkout_url": "https://pay.cakto.com.br/syw8q2x",
        "nome": "Synch IA",
        "preco": "R$ 149,90/ano",
        "parcelado": "12x de R$ 15,57",
    },
}
CAKTO_OFERTA_PARA_PLANO = {
    "syw8q2x": "synch_ia",
}

# Acesso vitalicio Basico: taxa unica (nao e assinatura, nao e o Synch IA) exigida pra criar
# conta -- ver _cadastro_autorizado. "psh8aeu" e o data.offer.id real, confirmado num pagamento
# de teste (o data.checkout, "1097259", e o produto/funil, nao a oferta -- a URL de checkout
# concatena os dois com "_", mas so o offer.id entra na comparacao aqui).
#
# Nota: antes desta correcao, "psh8aeu_1097259" (a URL inteira, nao o offer.id) estava na
# CAKTO_OFERTA_PARA_PLANO acima como se desse Synch IA -- nunca bateu com nenhum webhook real
# (nenhum offer.id vem com esse sufixo), entao nao tinha ninguem "presa" nessa oferta.
CAKTO_OFERTA_BASICO_VITALICIO = {
    id.strip() for id in os.getenv("CAKTO_OFERTAS_BASICO_VITALICIO", "psh8aeu").split(",") if id.strip()
}
CAKTO_CHECKOUT_BASICO_VITALICIO = os.getenv("CAKTO_CHECKOUT_BASICO_VITALICIO", "https://pay.cakto.com.br/psh8aeu_1097259")

PLANOS_ORDEM = {"gratis": 0, "synch_ia": 1}
CAKTO_EVENTOS_ATIVA = {
    "purchase_approved", "subscription_created",
    "subscription_renewed", "subscription_resumed",
}
CAKTO_EVENTOS_INATIVA = {
    "subscription_canceled", "subscription_renewal_refused",
    "subscription_paused", "refund", "chargeback", "purchase_refused",
}

LIMITE_GRATIS_CONTAS = 1
LIMITE_GRATIS_CARTOES = 1
LIMITE_GRATIS_TRANSACOES_MES = 100
LIMITE_GRATIS_METAS = 1

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")

# Atras do proxy da Vercel a requisicao chega em HTTP por dentro; sem isso
# o cookie de sessao marcado "Secure" nunca seria enviado de volta em producao.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

EM_PRODUCAO = os.getenv("VERCEL") == "1" or os.getenv("FLASK_ENV") == "production"
app.config.update(
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=EM_PRODUCAO,
    SESSION_COOKIE_HTTPONLY=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

# So em desenvolvimento: em producao o front (Next.js) e o back (Flask)
# vivem na mesma origem -- a Vercel roteia /api/* pra ca -- entao o
# navegador nunca faz um pedido cross-origin e nao precisa de CORS nenhum.
# Em dev sao dois servidores (:3000 e :5000), entao libera so o :3000.
if not EM_PRODUCAO:
    try:
        from flask_cors import CORS
        CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)
    except ImportError:
        pass

RECEIPTS_BUCKET = "comprovantes"

CATEGORIAS = ["Moradia", "Alimentação", "Transporte", "Lazer", "Assinaturas", "Receita", "Outros"]
# "Outros" recebe o que perde a categoria e "Receita" e a de toda entrada:
# o app depende das duas, entao nao podem ser excluidas.
CATEGORIAS_SISTEMA = ("Outros", "Receita")
TIPOS_CONTA = ["Conta corrente", "Cartão de crédito", "Dinheiro"]
ORCAMENTOS_PADRAO = {
    "Moradia": 1600, "Alimentação": 1100, "Transporte": 650,
    "Lazer": 450, "Assinaturas": 300, "Outros": 900,
}


# ------------------------------------------------------------------
# Resposta JSON padrao
# ------------------------------------------------------------------

def json_ok(payload, status=200):
    return jsonify(payload), status


def json_error(code, message, status=400, **extra):
    corpo = {"code": code, "message": message}
    corpo.update(extra)
    return jsonify(corpo), status


def _corpo():
    return request.get_json(silent=True) or {}


def _chave_conta(nome):
    """Nome de conta normalizado para comparacao (ver nota historica: a
    transacao guarda o NOME da conta como texto, nao um id -- comparar
    exato quebra o vinculo por qualquer diferenca de acentuacao/maiuscula)."""
    return unicodedata.normalize("NFC", (nome or "").strip()).casefold()


def _chave_email(email):
    """E-mail normalizado pra comparar e usar como chave em cakto_pendencias
    (mesma normalizacao que o webhook da Cakto ja aplicava)."""
    return (email or "").strip().lower()


def _cor_valida(cor, padrao):
    """Cor de conta/cartao no formato #rrggbb; qualquer outra coisa cai no padrao."""
    cor = (cor or "").strip()
    return cor if re.fullmatch(r"#[0-9a-fA-F]{6}", cor) else padrao


def _frontend_url(caminho):
    base = request.host_url.rstrip("/")
    return f"{base}{caminho}"


# ------------------------------------------------------------------
# Sessao / Supabase
# ------------------------------------------------------------------

_MENSAGENS_AUTH = {
    "over_email_send_rate_limit": "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
    "email_exists": "Já existe uma conta com esse e-mail.",
    "user_already_exists": "Já existe uma conta com esse e-mail.",
    "weak_password": "Essa senha é fraca demais; use pelo menos 6 caracteres.",
}


def _mensagem_erro_auth(erro):
    codigo = getattr(erro, "code", None)
    return _MENSAGENS_AUTH.get(codigo, f"Não foi possível concluir: {erro}")


def obter_supabase():
    """Retorna um cliente autenticado, renovando o token se estiver expirado."""
    supabase = conectar_como_usuario(session["access_token"])
    try:
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
            return json_error("UNAUTHENTICATED", "Sessão expirada. Faça login novamente.", 401)
        return f(*args, **kwargs)
    return decorada


def com_supabase(f):
    """Injeta o cliente autenticado como 1o argumento e trata sessao
    expirada num lugar so, em vez de repetir o mesmo if em cada rota."""
    @wraps(f)
    @login_necessario
    def decorada(*args, **kwargs):
        supabase = obter_supabase()
        if supabase is None:
            return json_error("UNAUTHENTICATED", "Sessão expirada. Faça login novamente.", 401)
        return f(supabase, *args, **kwargs)
    return decorada


def _uid():
    return session["user_id"]


# ------------------------------------------------------------------
# Planos (Gratis / Synch IA)
# ------------------------------------------------------------------

def _plano_usuario(supabase):
    """'gratis' ou 'synch_ia'. So o webhook da Cakto grava essa linha --
    'gratis' e o padrao pra quem nunca assinou nada."""
    try:
        linha = (
            supabase.table("assinaturas").select("plano")
            .eq("user_id", _uid()).execute().data
        )
    except Exception:
        return "gratis"
    plano = (linha[0].get("plano") if linha else None) or "gratis"
    return plano if plano in PLANOS_ORDEM else "gratis"


def _plano_permite(plano_usuario, plano_minimo):
    return PLANOS_ORDEM.get(plano_usuario, 0) >= PLANOS_ORDEM.get(plano_minimo, 0)


def _link_assinatura(plano):
    """Link de checkout com o e-mail da conta ja preenchido, pra o
    pagamento bater certinho com a conta na hora do webhook."""
    info = CAKTO_PLANOS.get(plano)
    if not info:
        return None
    email = session.get("email") or ""
    if not email:
        return info["checkout_url"]
    query = urllib.parse.urlencode({"email": email, "confirmEmail": email})
    return f"{info['checkout_url']}?{query}"


def _erro_plano(motivo):
    return json_error("PLAN_LIMIT", motivo, 403, upgradeUrl=_link_assinatura("synch_ia"))


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
    """Registros do mecanismo ANTIGO de pagamento (antes desta migracao).
    Mantido so pra nao perder o historico de quem ja pagou fatura pelo
    fluxo antigo -- o novo motor usa fatura_pagamentos/fatura_ajustes."""
    resposta = supabase.table("faturas").select("*").eq("user_id", _uid()).execute()
    return resposta.data or []


def _orcamentos(supabase):
    """Devolve {categoria: limite}. Na primeira visita cria os limites
    padrao, senao o front abriria sem nada pra editar."""
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


def _chave_categoria(nome):
    """Compara categorias sem ligar pra maiuscula, acento ou espaco a mais."""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", nome or "") if unicodedata.category(c) != "Mn"
    )
    return " ".join(sem_acento.split()).casefold()


def _categorias_derivadas(supabase, transacoes=None):
    """As categorias padrao mais tudo que ja existe como orcamento, transacao
    ou recorrencia (ex.: 'Investimentos'), sem repetir. E a lista inicial de
    quem ainda nao tem categorias gravadas."""
    if transacoes is None:
        transacoes = _transacoes(supabase)
    orcamentos = supabase.table("orcamentos").select("categoria").eq("user_id", _uid()).execute().data or []
    usadas = [o.get("categoria") for o in orcamentos]
    usadas += [t.get("categoria") for t in transacoes]
    usadas += [r.get("categoria") for r in _recorrentes(supabase)]

    extras = sorted({" ".join(n.split()) for n in usadas if n and n.strip()})
    nomes, vistas = [], set()
    for nome in list(CATEGORIAS) + extras:
        chave = _chave_categoria(nome)
        if chave and chave not in vistas:
            vistas.add(chave)
            nomes.append(nome)
    return nomes


def _categorias(supabase, transacoes=None):
    """Nomes das categorias do usuario, na ordem em que foram criadas. Na
    primeira leitura grava a lista inicial (ver _categorias_derivadas), do
    mesmo jeito que _orcamentos faz com os limites padrao. Levanta erro se a
    tabela 'categorias' ainda nao existe."""
    linhas = (
        supabase.table("categorias").select("nome")
        .eq("user_id", _uid()).order("id").execute().data or []
    )
    if linhas:
        return [l["nome"] for l in linhas]
    nomes = _categorias_derivadas(supabase, transacoes)
    supabase.table("categorias").insert([{"user_id": _uid(), "nome": n} for n in nomes]).execute()
    return nomes


def _nomes_categorias(supabase, transacoes=None):
    """Como _categorias, mas sem derrubar o app se a tabela ainda nao foi
    criada (migracao nao rodada): nesse caso usa a lista derivada."""
    try:
        return _categorias(supabase, transacoes)
    except Exception:
        return _categorias_derivadas(supabase, transacoes)


def _metas(supabase):
    resposta = supabase.table("metas").select("*").eq("user_id", _uid()).order("id").execute()
    return resposta.data or []


def _preferencias(supabase):
    resposta = supabase.table("preferencias").select("*").eq("user_id", _uid()).execute()
    linhas = resposta.data or []
    if linhas:
        return linhas[0]
    padrao = {
        "user_id": _uid(),
        "nome": (session.get("email") or "").split("@")[0].title() or "Usuário",
        "notificacoes": True, "resumo_semanal": True, "onboarding": False,
    }
    try:
        supabase.table("preferencias").insert(padrao).execute()
    except Exception:
        pass
    return padrao


def _valor(t):
    return float(t.get("valor") or 0)


def _e_despesa(t):
    return t.get("tipo", "despesa") != "receita"


def _do_mes(transacoes, mes):
    return [t for t in transacoes if (t.get("data") or "")[:7] == mes]


def _ultimo_dia_do_mes(mes):
    ano, m = int(mes[:4]), int(mes[5:7])
    if m == 12:
        return 31
    return (date(ano, m + 1, 1) - timedelta(days=1)).day


def _somar_meses(data_base, n):
    """Mesma data n meses a frente, encurtando o dia quando o mes destino
    for mais curto (31/01 + 1 mes -> 28 ou 29/02)."""
    if isinstance(data_base, str):
        try:
            ano, mes, dia = (int(p) for p in data_base[:10].split("-"))
            data_base = date(ano, mes, dia)
        except (ValueError, TypeError):
            data_base = date.today()
    mes = data_base.month - 1 + n
    ano = data_base.year + mes // 12
    mes = mes % 12 + 1
    bissexto = ano % 4 == 0 and (ano % 100 != 0 or ano % 400 == 0)
    ultimo = [31, 29 if bissexto else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]
    return date(ano, mes, min(data_base.day, ultimo))


def _proximo_lancamento(dia):
    hoje = date.today()
    primeiro = date(hoje.year, hoje.month, 1)
    try:
        candidato = primeiro.replace(day=dia)
    except ValueError:
        candidato = _somar_meses(primeiro, 1) - timedelta(days=1)
    if candidato < hoje:
        candidato = _somar_meses(candidato, 1)
    meses_curto = {1: "jan", 2: "fev", 3: "mar", 4: "abr", 5: "mai", 6: "jun",
                   7: "jul", 8: "ago", 9: "set", 10: "out", 11: "nov", 12: "dez"}
    return f"{candidato.day:02d} {meses_curto[candidato.month]}"


# ------------------------------------------------------------------
# Ciclo do cartao
#
# A fatura nao e um valor digitado: ela e a soma do que foi lancado no
# cartao dentro do ciclo. Compra feita depois do fechamento ja cai na
# fatura do mes que vem, que e como cartao funciona de verdade.
# ------------------------------------------------------------------

def _mes_da_fatura(data_iso, fechamento):
    """Em qual fatura (YYYY-MM) a compra cai. A fatura leva o mes em que FECHA:
    ate o dia do fechamento (inclusive) a compra fica nela, mesmo que ela ja
    tenha sido paga; so o que passa do fechamento vai pra fatura seguinte."""
    ano, mes, dia = int(data_iso[:4]), int(data_iso[5:7]), int(data_iso[8:10])
    if dia > fechamento:
        return _somar_meses(date(ano, mes, 1), 1).strftime("%Y-%m")
    return f"{ano:04d}-{mes:02d}"


def _vencimento_da_fatura(mes, fechamento, vencimento):
    base = date(int(mes[:4]), int(mes[5:7]), 1)
    if vencimento <= fechamento:
        base = _somar_meses(base, 1)
    dia = min(vencimento, _ultimo_dia_do_mes(base.strftime("%Y-%m")))
    return date(base.year, base.month, dia)


def _saldo_conta(conta, transacoes):
    """Saldo atual da conta: o saldo cadastrado (inicial) mais tudo que ja
    foi pago nela ate hoje. Tudo calculado na hora, nada gravado em
    contas.saldo -- assim pagar/estornar fatura nunca fica dessincronizado.
    Lancamento com data futura (ex.: parcelas dos proximos meses) ainda nao
    saiu da conta, entao so entra quando a data chega."""
    total = float(conta.get("saldo") or 0)
    chave = _chave_conta(conta["nome"])
    hoje = date.today().isoformat()
    for t in transacoes:
        if _chave_conta(t.get("conta")) != chave or t.get("status") != "pago":
            continue
        if (t.get("data") or "")[:10] > hoje:
            continue
        total += -_valor(t) if _e_despesa(t) else _valor(t)
    return round(total, 2)


def _compras_do_ciclo(transacoes, cartao, ciclo):
    """Soma das compras (receita/estorno no cartao abate) lancadas nesse
    cartao que caem no ciclo pedido -- nunca inclui quitacao de fatura
    (fatura_id/fatura_pagamento_id) nem transferencia."""
    chave = _chave_conta(cartao["nome"])
    fechamento = int(cartao.get("fechamento") or 28)
    total = 0.0
    for t in transacoes:
        if _chave_conta(t.get("conta")) != chave or not t.get("data"):
            continue
        if t.get("kind") == "transfer" or t.get("fatura_id") or t.get("fatura_pagamento_id"):
            continue
        if _mes_da_fatura(t["data"], fechamento) != ciclo:
            continue
        total += _valor(t) if _e_despesa(t) else -_valor(t)
    return total


def _ciclos_do_cartao(transacoes, cartao):
    """Todos os ciclos (YYYY-MM) que ja tiveram alguma compra nesse cartao."""
    chave = _chave_conta(cartao["nome"])
    fechamento = int(cartao.get("fechamento") or 28)
    ciclos = set()
    for t in transacoes:
        if _chave_conta(t.get("conta")) != chave or not t.get("data"):
            continue
        if t.get("kind") == "transfer" or t.get("fatura_id") or t.get("fatura_pagamento_id"):
            continue
        ciclos.add(_mes_da_fatura(t["data"], fechamento))
    return ciclos


def _pago_legado(supabase, transacoes):
    """Pagamentos feitos pelo mecanismo ANTIGO (fatura_id -> tabela
    faturas), de antes desta migracao -- soma por (conta_id, ciclo) pra
    somar certinho com o motor novo e nao perder historico."""
    registros = {f["id"]: f for f in _faturas(supabase)}
    total = defaultdict(float)
    for t in transacoes:
        fid = t.get("fatura_id")
        if fid and fid in registros:
            r = registros[fid]
            total[(r["conta_id"], r["mes"])] += _valor(t)
    return total


def _pago_novo(supabase, conta_id=None, ciclo=None):
    """Soma dos pagamentos ATIVOS (nao estornados) do motor novo, por
    (conta_id, ciclo)."""
    consulta = supabase.table("fatura_pagamentos").select("conta_id,ciclo,valor") \
        .eq("user_id", _uid()).eq("status", "active")
    if conta_id is not None:
        consulta = consulta.eq("conta_id", conta_id)
    if ciclo is not None:
        consulta = consulta.eq("ciclo", ciclo)
    total = defaultdict(float)
    for linha in consulta.execute().data or []:
        total[(linha["conta_id"], linha["ciclo"])] += float(linha["valor"] or 0)
    return total


def _ajustes_ativos(supabase, conta_id=None, ciclo=None):
    """Soma dos ajustes manuais ATIVOS, por (conta_id, ciclo)."""
    consulta = supabase.table("fatura_ajustes").select("conta_id,ciclo,valor") \
        .eq("user_id", _uid()).eq("status", "active")
    if conta_id is not None:
        consulta = consulta.eq("conta_id", conta_id)
    if ciclo is not None:
        consulta = consulta.eq("ciclo", ciclo)
    total = defaultdict(float)
    for linha in consulta.execute().data or []:
        total[(linha["conta_id"], linha["ciclo"])] += float(linha["valor"] or 0)
    return total


def _pago_total(supabase, transacoes, conta_id=None, ciclo=None):
    """Legado + novo, somados -- fonte unica de 'quanto ja foi pago'."""
    legado = _pago_legado(supabase, transacoes)
    novo = _pago_novo(supabase, conta_id, ciclo)
    if conta_id is not None or ciclo is not None:
        legado = {
            k: v for k, v in legado.items()
            if (conta_id is None or k[0] == conta_id) and (ciclo is None or k[1] == ciclo)
        }
    chaves = set(legado) | set(novo)
    return {k: legado.get(k, 0.0) + novo.get(k, 0.0) for k in chaves}


def _cartao_usado(supabase, transacoes, cartao):
    """Compromisso total do cartao: o que se deve em CADA ciclo (nao so o
    mes corrente) -- o que o front chama de 'commitment().used'. Credito
    (estorno numa fatura ainda sem compras, pagamento a mais) abate o que
    se deve nas outras faturas: o limite volta mesmo quando o estorno cai
    num ciclo vazio. Nunca fica abaixo de zero."""
    ciclos = _ciclos_do_cartao(transacoes, cartao)
    pagos = _pago_total(supabase, transacoes, conta_id=cartao["id"])
    ajustes = _ajustes_ativos(supabase, conta_id=cartao["id"])
    ciclos |= {c for (_, c) in pagos} | {c for (_, c) in ajustes}

    total = 0.0
    for ciclo in ciclos:
        compras = _compras_do_ciclo(transacoes, cartao, ciclo)
        bruto = compras + ajustes.get((cartao["id"], ciclo), 0.0)
        pago = pagos.get((cartao["id"], ciclo), 0.0)
        total += bruto - pago
    return round(max(0.0, total), 2)


# ------------------------------------------------------------------
# Recorrencias automaticas
# ------------------------------------------------------------------

def _data_iso(valor):
    """'2026-09-19T00:11:43...' -> date(2026, 9, 19); None se nao der pra ler."""
    try:
        return date.fromisoformat(str(valor)[:10])
    except (TypeError, ValueError):
        return None


def _lancar_recorrentes(supabase):
    """Cria em Transacoes as recorrencias cujo dia do mes ja chegou.

    Nao existe cron aqui (deploy serverless): a geracao acontece na
    primeira chamada autenticada do dia (ver /api/v1/bootstrap).

    Uma regra so lanca a partir da PROXIMA ocorrencia depois de criada: o dia
    deste mes que ja tinha passado antes de ela existir nao e lancado
    retroativamente (uma assinatura criada dia 10 com "todo dia 1" comeca no
    dia 1 do mes seguinte, nao lanca um dia 1 que ja foi).

    Idempotencia: se o mes ja tem lancamento da regra, nao cria outro. Vale o
    vinculo por recorrente_id e tambem o lancamento feito na mao com "repetir
    mensalmente" (que nao carrega o id da regra): mesmo nome, tipo e valor.
    """
    hoje = date.today()
    mes = hoje.strftime("%Y-%m")
    proximo_mes = _somar_meses(date(hoje.year, hoje.month, 1), 1).strftime("%Y-%m")

    regras = [r for r in _recorrentes(supabase) if r.get("ativo")]
    if not regras:
        return 0

    do_mes = (
        supabase.table("despesas").select("recorrente_id, nome_despesa, valor, tipo, recorrente")
        .eq("user_id", _uid()).gte("data", f"{mes}-01").lt("data", f"{proximo_mes}-01")
        .execute().data or []
    )
    ja_lancadas = {d["recorrente_id"] for d in do_mes if d.get("recorrente_id")}
    manuais = {
        (_chave_categoria(d.get("nome_despesa")), d.get("tipo") or "despesa", round(float(d.get("valor") or 0), 2))
        for d in do_mes if d.get("recorrente") and not d.get("recorrente_id")
    }
    cartoes = {
        _chave_conta(c["nome"]) for c in _contas(supabase)
        if c.get("tipo") == "Cartão de crédito"
    }

    novas = []
    for r in regras:
        if r["id"] in ja_lancadas:
            continue
        assinatura = (_chave_categoria(r.get("nome")), r.get("tipo") or "despesa", round(float(r.get("valor") or 0), 2))
        if assinatura in manuais:
            continue
        dia = max(1, min(int(r.get("dia") or 1), _ultimo_dia_do_mes(mes)))
        if hoje.day < dia:
            continue
        criada_em = _data_iso(r.get("criado_em"))
        if criada_em and date(hoje.year, hoje.month, dia) <= criada_em:
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


def _criar_recorrente(supabase, campos, valor, data_base):
    """Cria a regra em Recorrentes quando 'repetir mensalmente' esta
    marcado. Vale pra despesa e pra receita. Nao duplica."""
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
        "user_id": _uid(), "nome": campos["nome_despesa"], "categoria": campos["categoria"],
        "tipo": campos["tipo"], "conta": campos["conta"], "valor": valor, "dia": dia, "ativo": True,
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


# ------------------------------------------------------------------
# Serializacao: linhas do banco (portugues) -> modelo do front (ingles),
# igual ao que esta em lib/models.ts do synch-cash-frontend.
# ------------------------------------------------------------------

def _serializar_transacao(t, contas_por_nome):
    conta_info = contas_por_nome.get(_chave_conta(t.get("conta")))
    cartao_id = conta_info["id"] if conta_info and conta_info.get("tipo") == "Cartão de crédito" else None
    ciclo = None
    if cartao_id and t.get("data"):
        ciclo = _mes_da_fatura(t["data"], int(conta_info.get("fechamento") or 28))
    return {
        "id": t["id"],
        "description": t.get("nome_despesa") or "",
        "category": t.get("categoria") or "Outros",
        "date": (t.get("data") or "")[:10],
        "amount": _valor(t),
        "type": "income" if not _e_despesa(t) else "expense",
        "account": t.get("conta") or "",
        "status": "pending" if t.get("status") == "pendente" and not cartao_id else "paid",
        "notes": t.get("descricao") or None,
        "recurring": bool(t.get("recorrente")),
        "merchant": t.get("merchant"),
        "paymentMethod": t.get("payment_method"),
        "kind": t.get("kind") or "purchase",
        "receiptName": t.get("receipt_name"),
        "qualityResolved": bool(t.get("quality_resolved")),
        "transferPairId": t.get("transfer_pair_id"),
        "cardId": cartao_id,
        "invoiceCycle": ciclo,
        "invoicePaymentId": t.get("fatura_pagamento_id"),
    }


def _serializar_conta(c, saldo):
    return {
        "id": c["id"],
        "name": c.get("nome") or "",
        "type": c.get("tipo") or "Conta corrente",
        "balance": round(saldo, 2),
        "detail": c.get("detalhe") or "",
        "color": c.get("cor") or "#22c55e",
        "creditLimit": c.get("limite_credito"),
        "closingDay": c.get("fechamento"),
        "dueDay": c.get("vencimento"),
        "lastFour": c.get("ultimos_digitos"),
    }


def _serializar_meta(m):
    guardado, alvo = float(m.get("guardado") or 0), float(m.get("alvo") or 0)
    return {
        "id": m["id"], "name": m.get("nome") or "", "saved": guardado,
        "target": alvo, "deadline": m.get("prazo") or "Sem prazo",
        "color": m.get("cor") or "#22c55e",
    }


def _serializar_recorrente(r):
    return {
        "id": r["id"], "name": r.get("nome") or "",
        "category": r.get("categoria") or "Outros",
        "amount": float(r.get("valor") or 0),
        "type": "income" if r.get("tipo") == "receita" else "expense",
        "next": _proximo_lancamento(int(r.get("dia") or 1)),
        "day": max(1, min(28, int(r.get("dia") or 1))),
        "active": bool(r.get("ativo")),
    }


def _serializar_preferencias(p, email):
    return {
        "name": p.get("nome") or "Usuário",
        "email": email or "",
        "notifications": bool(p.get("notificacoes", True)),
        "weekly": bool(p.get("resumo_semanal", True)),
    }


def _serializar_pagamento(p, nomes_conta):
    return {
        "id": p["id"],
        "transactionId": p.get("transacao_id"),
        "reversalTransactionId": p.get("transacao_estorno_id"),
        "cardId": p["conta_id"],
        "cardName": nomes_conta.get(p["conta_id"], ""),
        "cycle": p["ciclo"],
        "sourceAccountId": p["conta_origem_id"],
        "sourceAccountName": nomes_conta.get(p["conta_origem_id"], ""),
        "amount": float(p["valor"]),
        "date": p["data"],
        "mode": p["modo"],
        "status": p["status"],
        "createdAt": p.get("criado_em"),
        "reversedAt": p.get("revertido_em"),
        "idempotencyKey": p["idempotency_key"],
    }


def _serializar_ajuste(a):
    return {
        "id": str(a["id"]), "cardId": a["conta_id"], "cycle": a["ciclo"],
        "amount": float(a["valor"]), "reason": a.get("motivo") or "",
        "createdAt": a.get("criado_em"), "status": a["status"],
        "reversedAt": a.get("revertido_em"),
    }


# ------------------------------------------------------------------
# Autenticacao
# ------------------------------------------------------------------

@app.route("/api/v1/auth/login", methods=["POST"])
def api_login():
    corpo = _corpo()
    email = (corpo.get("email") or "").strip()
    senha = corpo.get("password") or ""
    if not email or not senha:
        return json_error("VALIDATION", "Informe e-mail e senha.", 422)

    supabase = conectar()
    try:
        resposta = supabase.auth.sign_in_with_password({"email": email, "password": senha})
    except Exception:
        return json_error("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401)

    session.permanent = bool(corpo.get("remember", True))
    session["access_token"] = resposta.session.access_token
    session["refresh_token"] = resposta.session.refresh_token
    session["user_id"] = resposta.user.id
    session["email"] = resposta.user.email

    # Rede de seguranca: se a Cakto avisou um pagamento antes desta conta
    # existir (webhook guardou em cakto_pendencias), aplica aqui tambem --
    # nao deveria sobrar nenhuma, mas login e barato e nunca deve travar por isso.
    try:
        _aplicar_pendencia_cakto(conectar_admin(), resposta.user.id, resposta.user.email)
    except Exception:
        pass

    logado = conectar_como_usuario(session["access_token"])
    return json_ok({"user": _serializar_preferencias(_preferencias(logado), session["email"])})


@app.route("/api/v1/auth/register", methods=["POST"])
def api_register():
    corpo = _corpo()
    email = (corpo.get("email") or "").strip()
    senha = corpo.get("password") or ""
    nome = (corpo.get("name") or "").strip()
    if not email or len(senha) < 6:
        return json_error("VALIDATION", "Informe e-mail e uma senha com pelo menos 6 caracteres.", 422)

    # Cadastro exige ter pago o acesso vitalicio Basico com este e-mail (taxa unica, nao e
    # o Synch IA). Quem ja pagou aparece em cakto_pendencias pelo webhook; sem isso, nao cria
    # a conta -- e nem chega a chamar o Supabase Auth (que ja dispararia e-mail de confirmacao).
    if not _cadastro_autorizado(email):
        return json_error(
            "PAYMENT_REQUIRED",
            "Para criar uma conta é preciso pagar o acesso vitalício com este e-mail. "
            "Assine o acesso e volte para se cadastrar com o mesmo e-mail usado na compra.",
            402,
            checkoutUrl=CAKTO_CHECKOUT_BASICO_VITALICIO,
        )

    supabase = conectar()
    try:
        opcoes = {"data": {"nome": nome}} if nome else {}
        resposta = supabase.auth.sign_up({"email": email, "password": senha, "options": opcoes})
    except Exception as erro:
        return json_error("AUTH_ERROR", _mensagem_erro_auth(erro), 422)

    # Se essa pessoa ja pagou na Cakto com esse e-mail antes de criar a conta,
    # o webhook guardou o plano em cakto_pendencias (sem conta ainda, sem
    # user_id pra marcar). Agora que a conta existe, aplica de uma vez --
    # sem isso, quem pagou primeiro e cadastrou depois ficaria no Gratis.
    try:
        usuario_id = getattr(resposta.user, "id", None) if resposta and resposta.user else None
        if usuario_id:
            _aplicar_pendencia_cakto(conectar_admin(), usuario_id, email)
    except Exception:
        pass

    return json_ok({
        "user": {"name": nome or email.split("@")[0], "email": email, "notifications": True, "weekly": True},
        "needsEmailConfirmation": True,
    }, 201)


@app.route("/api/v1/auth/forgot-password", methods=["POST"])
def api_forgot_password():
    corpo = _corpo()
    email = (corpo.get("email") or "").strip()
    if email:
        supabase = conectar()
        try:
            supabase.auth.reset_password_for_email(
                email, {"redirect_to": _frontend_url("/redefinir-senha")}
            )
        except AuthApiError as erro:
            if erro.code == "over_email_send_rate_limit":
                return json_error("RATE_LIMITED", _mensagem_erro_auth(erro), 429)
        except Exception:
            pass
    # Mensagem igual sempre que o e-mail exista ou nao -- evita que alguem
    # descubra quais e-mails estao cadastrados por tentativa.
    return json_ok({"message": "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha."})


@app.route("/api/v1/auth/reset-password/exchange", methods=["POST"])
def api_reset_password_exchange():
    """Fluxo PKCE: a pagina de redefinicao troca o ?code=... da URL por um
    access/refresh token antes de deixar digitar a senha nova."""
    codigo = _corpo().get("code")
    if not codigo:
        return json_error("INVALID_TOKEN", "Link inválido ou expirado.", 422)
    supabase = conectar()
    try:
        resposta = supabase.auth.exchange_code_for_session({"auth_code": codigo})
    except Exception:
        return json_error("INVALID_TOKEN", "Link inválido ou expirado.", 422)
    return json_ok({
        "accessToken": resposta.session.access_token,
        "refreshToken": resposta.session.refresh_token,
    })


@app.route("/api/v1/auth/reset-password/confirm", methods=["POST"])
def api_reset_password_confirm():
    """Segunda metade do 'esqueci minha senha': recebe o token que veio no
    fragmento (#access_token=...) ou da troca via /exchange e grava a
    senha nova de verdade no Supabase Auth."""
    corpo = _corpo()
    access_token = corpo.get("accessToken")
    refresh_token = corpo.get("refreshToken") or ""
    nova = corpo.get("newPassword") or ""
    if not access_token:
        return json_error("INVALID_TOKEN", "Link inválido ou expirado.", 422)
    if len(nova) < 6:
        return json_error("VALIDATION", "A nova senha precisa ter pelo menos 6 caracteres.", 422)

    supabase = conectar()
    try:
        supabase.auth.set_session(access_token, refresh_token)
        supabase.auth.update_user({"password": nova})
    except Exception:
        return json_error("AUTH_ERROR", "Não foi possível atualizar a senha. O link pode ter expirado.", 422)
    return json_ok({"message": "Senha atualizada."})


@app.route("/api/v1/auth/password", methods=["PUT"])
@com_supabase
def api_trocar_senha(supabase):
    nova = _corpo().get("newPassword") or ""
    if len(nova) < 6:
        return json_error("VALIDATION", "A nova senha precisa ter pelo menos 6 caracteres.", 422)
    try:
        supabase.auth.update_user({"password": nova})
    except Exception:
        return json_error("AUTH_ERROR", "Não foi possível atualizar a senha.", 422)
    return "", 204


@app.route("/api/v1/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return "", 204


# ------------------------------------------------------------------
# Bootstrap: tudo que o painel precisa pra carregar de uma vez
# ------------------------------------------------------------------

@app.route("/api/v1/bootstrap")
@com_supabase
def api_bootstrap(supabase):
    hoje = date.today().isoformat()
    if session.get("recorrentes_em") != hoje:
        session["recorrentes_em"] = hoje
        try:
            _lancar_recorrentes(supabase)
        except Exception:
            session.pop("recorrentes_em", None)

    contas = _contas(supabase)
    transacoes = _transacoes(supabase)
    contas_por_nome = {_chave_conta(c["nome"]): c for c in contas}
    nomes_conta = {c["id"]: c["nome"] for c in contas}

    saldos = {}
    for c in contas:
        saldos[c["id"]] = (
            _cartao_usado(supabase, transacoes, c) if c.get("tipo") == "Cartão de crédito"
            else _saldo_conta(c, transacoes)
        )

    pagamentos = supabase.table("fatura_pagamentos").select("*") \
        .eq("user_id", _uid()).order("id").execute().data or []
    ajustes = supabase.table("fatura_ajustes").select("*") \
        .eq("user_id", _uid()).order("id").execute().data or []

    return json_ok({
        "transactions": [_serializar_transacao(t, contas_por_nome) for t in transacoes],
        "accounts": [_serializar_conta(c, saldos.get(c["id"], 0.0)) for c in contas],
        "invoicePayments": [_serializar_pagamento(p, nomes_conta) for p in pagamentos],
        "invoiceAdjustments": [_serializar_ajuste(a) for a in ajustes],
        "budgets": _orcamentos(supabase),
        "categories": _nomes_categorias(supabase, transacoes),
        "recurring": [_serializar_recorrente(r) for r in _recorrentes(supabase)],
        "goals": [_serializar_meta(m) for m in _metas(supabase)],
        "preferences": _serializar_preferencias(_preferencias(supabase), session.get("email")),
        "plan": _plano_usuario(supabase),
    })


# ------------------------------------------------------------------
# Transacoes
# ------------------------------------------------------------------

def _validar_transacao_payload(corpo, contas):
    descricao = (corpo.get("description") or "").strip()
    valor = corpo.get("amount")
    if not descricao or not isinstance(valor, (int, float)) or valor <= 0:
        return None, json_error("VALIDATION", "Informe uma descrição e um valor válido.", 422)

    tipo = "receita" if corpo.get("type") == "income" else "despesa"
    categoria = corpo.get("category") or "Outros"
    conta_nome = corpo.get("account") or None

    cartoes = {_chave_conta(c["nome"]) for c in contas if c.get("tipo") == "Cartão de crédito"}
    no_cartao = bool(conta_nome) and _chave_conta(conta_nome) in cartoes
    if tipo == "receita":
        categoria = "Receita"
    elif categoria == "Receita":
        categoria = "Outros"

    # Receita no cartao e estorno: fica ligada ao cartao e abate a fatura do ciclo (devolve o valor ao
    # limite). Antes a conta era solta e o estorno nunca chegava ao cartao.
    # Compra no cartao nunca fica pendente: quem esta pendente e a fatura, nao a compra.
    kind = corpo.get("kind") or "purchase"
    if no_cartao:
        kind = "refund" if tipo == "receita" else ("purchase" if kind == "refund" else kind)

    campos = {
        "nome_despesa": descricao,
        "descricao": (corpo.get("notes") or "").strip(),
        "categoria": categoria,
        "tipo": tipo,
        "conta": conta_nome,
        "status": "pendente" if corpo.get("status") == "pending" and not no_cartao else "pago",
        "recorrente": bool(corpo.get("recurring")),
        "merchant": corpo.get("merchant"),
        "payment_method": corpo.get("paymentMethod"),
        "kind": kind,
    }
    return campos, None


@app.route("/api/v1/transactions", methods=["POST"])
@com_supabase
def api_criar_transacao(supabase):
    corpo = _corpo()
    contas = _contas(supabase)
    campos, erro = _validar_transacao_payload(corpo, contas)
    if erro:
        return erro

    total = float(corpo.get("amount"))
    parcelas = max(1, int(corpo.get("installments") or 1))
    data_base = corpo.get("date") or date.today().isoformat()

    plano = _plano_usuario(supabase)
    if not _plano_permite(plano, "synch_ia"):
        if parcelas > 1:
            return _erro_plano("Parcelar uma compra é um recurso do plano Synch IA. Assine para dividir em várias vezes.")
        if campos["recorrente"]:
            return _erro_plano("Repetir uma transação todo mês é um recurso do plano Synch IA. Assine para automatizar lançamentos fixos.")
        mes_lancamento = data_base[:7]
        no_mes = sum(1 for t in _transacoes(supabase) if (t.get("data") or "")[:7] == mes_lancamento)
        if no_mes >= LIMITE_GRATIS_TRANSACOES_MES:
            return _erro_plano(
                f"O plano Grátis permite até {LIMITE_GRATIS_TRANSACOES_MES} movimentações por mês. "
                "Assine o Synch IA para lançar sem limite."
            )

    novas = _parcelas(campos, campos["nome_despesa"], total, parcelas, data_base)
    criadas = supabase.table("despesas").insert(novas).execute().data or []
    _criar_recorrente(supabase, campos, novas[0]["valor"], data_base)

    contas_por_nome = {_chave_conta(c["nome"]): c for c in contas}
    return json_ok([_serializar_transacao(t, contas_por_nome) for t in criadas], 201)


@app.route("/api/v1/transactions/<int:id_transacao>", methods=["PUT"])
@com_supabase
def api_editar_transacao(supabase, id_transacao):
    corpo = _corpo()
    contas = _contas(supabase)
    campos, erro = _validar_transacao_payload(corpo, contas)
    if erro:
        return erro

    total = float(corpo.get("amount"))
    data_base = corpo.get("date") or date.today().isoformat()

    atualizada = supabase.table("despesas").update({**campos, "valor": total, "data": data_base}) \
        .eq("id", id_transacao).eq("user_id", _uid()).execute().data
    if not atualizada:
        return json_error("NOT_FOUND", "Transação não encontrada.", 404)
    _criar_recorrente(supabase, campos, total, data_base)

    contas_por_nome = {_chave_conta(c["nome"]): c for c in contas}
    return json_ok(_serializar_transacao(atualizada[0], contas_por_nome))


@app.route("/api/v1/transactions/<int:id_transacao>", methods=["DELETE"])
@com_supabase
def api_deletar_transacao(supabase, id_transacao):
    """Apaga a transacao. Parcela apaga a compra inteira (mesmo grupo).
    Transferencia apaga o par junto. Pagamento de fatura e protegido --
    use POST /invoice-payments/:id/reverse pra desfazer esse."""
    linha = supabase.table("despesas").select("grupo_parcela, fatura_id, fatura_pagamento_id, transfer_pair_id") \
        .eq("id", id_transacao).eq("user_id", _uid()).execute().data
    if not linha:
        return "", 204
    linha = linha[0]

    if linha.get("fatura_pagamento_id"):
        return json_error("PROTECTED", "Pagamentos de fatura são protegidos: use estornar em vez de excluir.", 409)

    if linha.get("transfer_pair_id"):
        supabase.table("despesas").delete().eq("id", id_transacao).eq("user_id", _uid()).execute()
        supabase.table("despesas").delete().eq("id", linha["transfer_pair_id"]).eq("user_id", _uid()).execute()
        return "", 204

    id_fatura = linha.get("fatura_id")
    if id_fatura:
        supabase.table("despesas").delete().eq("id", id_transacao).eq("user_id", _uid()).execute()
        restantes = supabase.table("despesas").select("id") \
            .eq("fatura_id", id_fatura).eq("user_id", _uid()).execute().data
        if not restantes:
            supabase.table("faturas").update({
                "status": "pendente", "pago_com": None, "valor_pago": None, "pago_em": None,
            }).eq("id", id_fatura).eq("user_id", _uid()).execute()
        return "", 204

    grupo = linha.get("grupo_parcela")
    if grupo:
        supabase.table("despesas").delete().eq("grupo_parcela", grupo).eq("user_id", _uid()).execute()
    else:
        supabase.table("despesas").delete().eq("id", id_transacao).eq("user_id", _uid()).execute()
    return "", 204


# ------------------------------------------------------------------
# Contas e cartoes
# ------------------------------------------------------------------

@app.route("/api/v1/accounts", methods=["POST"])
@com_supabase
def api_criar_conta(supabase):
    corpo = _corpo()
    nome = (corpo.get("name") or "").strip()
    if not nome:
        return json_error("VALIDATION", "Informe o nome da conta.", 422)
    tipo = corpo.get("type") or "Conta corrente"
    if tipo not in TIPOS_CONTA:
        return json_error("VALIDATION", "Tipo de conta inválido.", 422)

    if not _plano_permite(_plano_usuario(supabase), "synch_ia"):
        existentes = _contas(supabase)
        cartoes = sum(1 for c in existentes if c.get("tipo") == "Cartão de crédito")
        outras = len(existentes) - cartoes
        estourou = (
            (tipo == "Cartão de crédito" and cartoes >= LIMITE_GRATIS_CARTOES)
            or (tipo != "Cartão de crédito" and outras >= LIMITE_GRATIS_CONTAS)
        )
        if estourou:
            return _erro_plano(
                f"O plano Grátis permite {LIMITE_GRATIS_CONTAS} conta e {LIMITE_GRATIS_CARTOES} cartão. "
                "Assine o Synch IA para ter contas e cartões ilimitados."
            )

    campos = {
        "nome": nome, "tipo": tipo,
        "detalhe": (corpo.get("detail") or "").strip() or "Criada agora",
        "cor": _cor_valida(corpo.get("color"), "#22c55e"),
    }
    if tipo == "Cartão de crédito":
        campos["saldo"] = 0
        campos["fechamento"] = max(1, min(28, int(corpo.get("closingDay") or 28)))
        campos["vencimento"] = max(1, min(28, int(corpo.get("dueDay") or 10)))
        campos["limite_credito"] = corpo.get("creditLimit")
        campos["ultimos_digitos"] = corpo.get("lastFour")
    else:
        campos["saldo"] = float(corpo.get("balance") or 0)

    criada = supabase.table("contas").insert({**campos, "user_id": _uid()}).execute().data[0]
    saldo = 0.0 if tipo == "Cartão de crédito" else criada["saldo"]
    return json_ok(_serializar_conta(criada, saldo), 201)


@app.route("/api/v1/accounts/<int:id_conta>", methods=["PUT"])
@com_supabase
def api_editar_conta(supabase, id_conta):
    corpo = _corpo()
    nome = (corpo.get("name") or "").strip()
    if not nome:
        return json_error("VALIDATION", "Informe o nome da conta.", 422)

    antes = supabase.table("contas").select("*").eq("id", id_conta).eq("user_id", _uid()).execute().data
    if not antes:
        return json_error("NOT_FOUND", "Conta não encontrada.", 404)
    atual = antes[0]
    tipo = atual.get("tipo") or "Conta corrente"  # tipo nao muda depois de criada

    campos = {
        "nome": nome,
        "detalhe": (corpo.get("detail") or "").strip() or atual.get("detalhe") or "",
        "cor": _cor_valida(corpo.get("color"), atual.get("cor") or "#22c55e"),
    }
    if tipo == "Cartão de crédito":
        if "closingDay" in corpo:
            campos["fechamento"] = max(1, min(28, int(corpo.get("closingDay") or 28)))
        if "dueDay" in corpo:
            campos["vencimento"] = max(1, min(28, int(corpo.get("dueDay") or 10)))
        if "creditLimit" in corpo:
            campos["limite_credito"] = corpo.get("creditLimit")
        if "lastFour" in corpo:
            campos["ultimos_digitos"] = corpo.get("lastFour")
    elif "balance" in corpo:
        # O campo do formulario e o saldo ATUAL que a pessoa quer ver, mas o
        # que se grava e o saldo inicial: desconta o que as transacoes ja
        # movimentaram, senao cada edicao somaria tudo de novo por cima.
        movimentado = _saldo_conta({**atual, "saldo": 0}, _transacoes(supabase))
        campos["saldo"] = round(float(corpo.get("balance") or 0) - movimentado, 2)

    supabase.table("contas").update(campos).eq("id", id_conta).eq("user_id", _uid()).execute()

    # Renomear tem que arrastar as transacoes junto: elas guardam o NOME
    # da conta, entao o vinculo quebra sem isso.
    if atual["nome"] != nome:
        supabase.table("despesas").update({"conta": nome}).eq("conta", atual["nome"]).eq("user_id", _uid()).execute()
        supabase.table("recorrentes").update({"conta": nome}).eq("conta", atual["nome"]).eq("user_id", _uid()).execute()

    transacoes = _transacoes(supabase)
    nova = {**atual, **campos}
    saldo = _cartao_usado(supabase, transacoes, nova) if tipo == "Cartão de crédito" else _saldo_conta(nova, transacoes)
    return json_ok(_serializar_conta(nova, saldo))


@app.route("/api/v1/accounts/<int:id_conta>", methods=["DELETE"])
@com_supabase
def api_deletar_conta(supabase, id_conta):
    try:
        supabase.table("contas").delete().eq("id", id_conta).eq("user_id", _uid()).execute()
    except Exception:
        return json_error("CONFLICT", "Esta conta tem histórico de pagamentos de fatura e não pode ser excluída.", 409)
    return "", 204


# ------------------------------------------------------------------
# Orcamentos
# ------------------------------------------------------------------

@app.route("/api/v1/budgets", methods=["PUT"])
@com_supabase
def api_salvar_orcamentos(supabase):
    corpo = _corpo()
    if not isinstance(corpo, dict):
        return json_error("VALIDATION", "Envie um mapa de categoria para limite.", 422)

    # Definir o limite de uma categoria que o usuario ja tem (as padrao ou as que ele
    # criou) vale em qualquer plano; o gate so pega nome que nao e categoria nenhuma.
    existentes = set(_orcamentos(supabase)) | set(_nomes_categorias(supabase))
    if [c for c in corpo if c not in existentes] and not _plano_permite(_plano_usuario(supabase), "synch_ia"):
        return _erro_plano("Criar uma categoria de orçamento nova é um recurso do plano Synch IA. Assine para ter orçamentos ilimitados.")

    linhas = []
    for categoria, limite in corpo.items():
        categoria = (categoria or "").strip()
        if not categoria or categoria.lower() == "receita":
            continue
        try:
            limite = float(limite)
        except (TypeError, ValueError):
            continue
        if limite <= 0:
            continue
        linhas.append({"user_id": _uid(), "categoria": categoria, "limite": limite})

    if linhas:
        supabase.table("orcamentos").upsert(linhas, on_conflict="user_id,categoria").execute()
    return json_ok(_orcamentos(supabase))


# ------------------------------------------------------------------
# Categorias
# ------------------------------------------------------------------

def _erro_categorias_indisponiveis():
    return json_error(
        "MIGRATION_REQUIRED",
        "Falta rodar a atualização do banco (seção 11 do supabase_schema.sql) para criar e excluir categorias.",
        503,
    )


@app.route("/api/v1/categories", methods=["POST"])
@com_supabase
def api_criar_categoria(supabase):
    nome = " ".join(str(_corpo().get("name") or "").split())
    if not nome:
        return json_error("VALIDATION", "Informe o nome da categoria.", 422)
    if len(nome) > 40:
        return json_error("VALIDATION", "O nome da categoria pode ter no máximo 40 caracteres.", 422)

    try:
        existentes = _categorias(supabase)
    except Exception:
        return _erro_categorias_indisponiveis()
    if _chave_categoria(nome) in {_chave_categoria(c) for c in existentes}:
        return json_error("CONFLICT", "Já existe uma categoria com esse nome.", 409)

    supabase.table("categorias").insert({"user_id": _uid(), "nome": nome}).execute()
    return json_ok({"name": nome}, 201)


@app.route("/api/v1/categories", methods=["PUT"])
@com_supabase
def api_renomear_categoria(supabase):
    corpo = _corpo()
    antigo = " ".join(str(corpo.get("name") or "").split())
    novo = " ".join(str(corpo.get("newName") or "").split())
    if not antigo or not novo:
        return json_error("VALIDATION", "Informe a categoria e o novo nome.", 422)
    if len(novo) > 40:
        return json_error("VALIDATION", "O nome da categoria pode ter no máximo 40 caracteres.", 422)
    if antigo in CATEGORIAS_SISTEMA:
        return json_error("PROTECTED", f"“{antigo}” é uma categoria do sistema e não pode ser renomeada.", 409)

    try:
        existentes = _categorias(supabase)
    except Exception:
        return _erro_categorias_indisponiveis()
    if antigo not in existentes:
        return json_error("NOT_FOUND", "Categoria não encontrada.", 404)
    if novo == antigo:
        return json_ok({"name": novo})

    # Nao pode virar o nome de outra categoria (nem de uma do sistema). Mudar so a
    # maiuscula ou o acento da propria categoria ("viagem" -> "Viagem") pode.
    chave = _chave_categoria(novo)
    ocupados = {_chave_categoria(c) for c in existentes if c != antigo}
    ocupados |= {_chave_categoria(c) for c in CATEGORIAS_SISTEMA}
    if chave in ocupados:
        return json_error("CONFLICT", "Já existe uma categoria com esse nome.", 409)

    # Tudo que usa a categoria acompanha o novo nome. A propria categoria e a ultima a
    # mudar, entao se algo falhar no meio basta repetir.
    uid = _uid()
    supabase.table("despesas").update({"categoria": novo}).eq("categoria", antigo).eq("user_id", uid).execute()
    supabase.table("recorrentes").update({"categoria": novo}).eq("categoria", antigo).eq("user_id", uid).execute()
    if supabase.table("orcamentos").select("id").eq("categoria", antigo).eq("user_id", uid).execute().data:
        # Um orcamento solto com o nome novo (sem categoria) cede lugar ao da categoria renomeada.
        supabase.table("orcamentos").delete().eq("categoria", novo).eq("user_id", uid).execute()
        supabase.table("orcamentos").update({"categoria": novo}).eq("categoria", antigo).eq("user_id", uid).execute()
    supabase.table("categorias").update({"nome": novo}).eq("nome", antigo).eq("user_id", uid).execute()
    return json_ok({"name": novo})


@app.route("/api/v1/categories", methods=["DELETE"])
@com_supabase
def api_deletar_categoria(supabase):
    nome = " ".join((request.args.get("name") or "").split())
    if not nome:
        return json_error("VALIDATION", "Informe a categoria.", 422)
    if nome in CATEGORIAS_SISTEMA:
        return json_error("PROTECTED", f"“{nome}” é uma categoria do sistema e não pode ser excluída.", 409)

    try:
        existentes = _categorias(supabase)
    except Exception:
        return _erro_categorias_indisponiveis()
    if nome not in existentes:
        return "", 204

    # O que usava a categoria nao pode ficar apontando pra uma que nao existe
    # mais: movimentacoes e recorrencias vao pra "Outros" e o orcamento dela
    # (que so fazia sentido pra ela) sai. A categoria em si e a ultima a sair,
    # entao se algo falhar no meio basta repetir.
    supabase.table("despesas").update({"categoria": "Outros"}).eq("categoria", nome).eq("user_id", _uid()).execute()
    supabase.table("recorrentes").update({"categoria": "Outros"}).eq("categoria", nome).eq("user_id", _uid()).execute()
    supabase.table("orcamentos").delete().eq("categoria", nome).eq("user_id", _uid()).execute()
    supabase.table("categorias").delete().eq("nome", nome).eq("user_id", _uid()).execute()
    return "", 204


# ------------------------------------------------------------------
# Recorrentes
# ------------------------------------------------------------------

@app.route("/api/v1/recurring", methods=["POST"])
@com_supabase
def api_criar_recorrente(supabase):
    corpo = _corpo()
    nome = (corpo.get("name") or "").strip()
    valor = corpo.get("amount")
    if not nome or not isinstance(valor, (int, float)) or valor <= 0:
        return json_error("VALIDATION", "Preencha os dados da recorrência.", 422)
    if not _plano_permite(_plano_usuario(supabase), "synch_ia"):
        return _erro_plano("Criar uma recorrência é um recurso do plano Synch IA. Assine para automatizar lançamentos fixos.")

    tipo = "receita" if corpo.get("type") == "income" else "despesa"
    campos = {
        "nome": nome,
        "categoria": "Receita" if tipo == "receita" else (corpo.get("category") or "Assinaturas"),
        "tipo": tipo, "valor": float(valor),
        "conta": corpo.get("account") or None,
        "dia": max(1, min(28, int(corpo.get("day") or 1))),
        "ativo": bool(corpo.get("active", True)),
    }
    criada = supabase.table("recorrentes").insert({**campos, "user_id": _uid()}).execute().data[0]
    return json_ok(_serializar_recorrente(criada), 201)


@app.route("/api/v1/recurring/<int:id_recorrente>", methods=["PUT"])
@com_supabase
def api_editar_recorrente(supabase, id_recorrente):
    corpo = _corpo()
    nome = (corpo.get("name") or "").strip()
    valor = corpo.get("amount")
    if not nome or not isinstance(valor, (int, float)) or valor <= 0:
        return json_error("VALIDATION", "Preencha os dados da recorrência.", 422)

    # So muda o que veio no corpo: pausar ou renomear uma recorrencia nao pode
    # zerar o dia, a conta nem o tipo (receita/despesa) que ela ja tinha.
    campos = {"nome": nome, "valor": float(valor)}
    if "type" in corpo:
        campos["tipo"] = "receita" if corpo.get("type") == "income" else "despesa"
    if "category" in corpo:
        campos["categoria"] = "Receita" if campos.get("tipo") == "receita" else (corpo.get("category") or "Assinaturas")
    if "account" in corpo:
        campos["conta"] = corpo.get("account") or None
    if "day" in corpo:
        campos["dia"] = max(1, min(28, int(corpo.get("day") or 1)))
    if "active" in corpo:
        campos["ativo"] = bool(corpo.get("active"))

    atualizada = supabase.table("recorrentes").update(campos) \
        .eq("id", id_recorrente).eq("user_id", _uid()).execute().data
    if not atualizada:
        return json_error("NOT_FOUND", "Recorrência não encontrada.", 404)
    return json_ok(_serializar_recorrente(atualizada[0]))


@app.route("/api/v1/recurring/<int:id_recorrente>", methods=["DELETE"])
@com_supabase
def api_deletar_recorrente(supabase, id_recorrente):
    supabase.table("recorrentes").delete().eq("id", id_recorrente).eq("user_id", _uid()).execute()
    return "", 204


# ------------------------------------------------------------------
# Metas
# ------------------------------------------------------------------

@app.route("/api/v1/goals", methods=["POST"])
@com_supabase
def api_criar_meta(supabase):
    corpo = _corpo()
    nome = (corpo.get("name") or "").strip()
    alvo = corpo.get("target")
    if not nome or not isinstance(alvo, (int, float)) or alvo <= 0:
        return json_error("VALIDATION", "Preencha os dados da meta.", 422)
    if not _plano_permite(_plano_usuario(supabase), "synch_ia"):
        if len(_metas(supabase)) >= LIMITE_GRATIS_METAS:
            return _erro_plano(f"O plano Grátis permite {LIMITE_GRATIS_METAS} meta financeira. Assine o Synch IA para ter metas ilimitadas.")

    criada = supabase.table("metas").insert({
        "user_id": _uid(), "nome": nome,
        "guardado": min(float(corpo.get("saved") or 0), float(alvo)),
        "alvo": float(alvo),
        "prazo": (corpo.get("deadline") or "").strip() or "Sem prazo",
        "cor": corpo.get("color") or "#22c55e",
    }).execute().data[0]
    return json_ok(_serializar_meta(criada), 201)


@app.route("/api/v1/goals/<int:id_meta>", methods=["PUT"])
@com_supabase
def api_editar_meta(supabase, id_meta):
    corpo = _corpo()
    atual = supabase.table("metas").select("*").eq("id", id_meta).eq("user_id", _uid()).execute().data
    if not atual:
        return json_error("NOT_FOUND", "Meta não encontrada.", 404)
    atual = atual[0]

    alvo = float(corpo.get("target", atual["alvo"]) or 0)
    guardado = float(corpo.get("saved", atual["guardado"]) or 0)
    guardado = min(guardado, alvo) if alvo else guardado  # nunca passa do alvo

    campos = {
        "nome": (corpo.get("name") or atual["nome"]).strip(),
        "guardado": guardado, "alvo": alvo,
        "prazo": corpo.get("deadline", atual.get("prazo")),
        "cor": corpo.get("color", atual.get("cor")),
    }
    atualizada = supabase.table("metas").update(campos).eq("id", id_meta).eq("user_id", _uid()).execute().data[0]
    return json_ok(_serializar_meta(atualizada))


@app.route("/api/v1/goals/<int:id_meta>", methods=["DELETE"])
@com_supabase
def api_deletar_meta(supabase, id_meta):
    supabase.table("metas").delete().eq("id", id_meta).eq("user_id", _uid()).execute()
    return "", 204


# ------------------------------------------------------------------
# Preferencias
# ------------------------------------------------------------------

@app.route("/api/v1/preferences", methods=["PUT"])
@com_supabase
def api_salvar_preferencias(supabase):
    corpo = _corpo()
    _preferencias(supabase)
    supabase.table("preferencias").update({
        "nome": (corpo.get("name") or "").strip() or "Usuário",
        "notificacoes": bool(corpo.get("notifications", True)),
        "resumo_semanal": bool(corpo.get("weekly", True)),
    }).eq("user_id", _uid()).execute()
    return json_ok(_serializar_preferencias(_preferencias(supabase), session.get("email")))


# ------------------------------------------------------------------
# Transferencias entre contas
# ------------------------------------------------------------------

@app.route("/api/v1/transfers", methods=["POST"])
@com_supabase
def api_criar_transferencia(supabase):
    corpo = _corpo()
    contas = _contas(supabase)
    por_id = {c["id"]: c for c in contas}
    origem = por_id.get(corpo.get("fromAccountId"))
    destino = por_id.get(corpo.get("toAccountId"))
    valor = corpo.get("amount")
    data_transf = corpo.get("date") or date.today().isoformat()

    if not origem or not destino or origem["id"] == destino["id"]:
        return json_error("VALIDATION", "Escolha duas contas diferentes.", 422)
    if not isinstance(valor, (int, float)) or valor <= 0:
        return json_error("VALIDATION", "Informe um valor válido.", 422)

    descricao = (corpo.get("description") or "").strip() or f"Transferência para {destino['nome']}"
    debito = {
        "user_id": _uid(), "nome_despesa": descricao, "descricao": "",
        "categoria": "Outros", "tipo": "despesa", "conta": origem["nome"],
        "status": "pago", "valor": float(valor), "data": data_transf,
        "recorrente": False, "kind": "transfer",
    }
    credito = {**debito, "tipo": "receita", "conta": destino["nome"]}

    criadas = supabase.table("despesas").insert([debito, credito]).execute().data
    supabase.table("despesas").update({"transfer_pair_id": criadas[1]["id"]}).eq("id", criadas[0]["id"]).execute()
    supabase.table("despesas").update({"transfer_pair_id": criadas[0]["id"]}).eq("id", criadas[1]["id"]).execute()

    contas_por_nome = {_chave_conta(c["nome"]): c for c in contas}
    return json_ok({
        "debit": _serializar_transacao({**criadas[0], "transfer_pair_id": criadas[1]["id"]}, contas_por_nome),
        "credit": _serializar_transacao({**criadas[1], "transfer_pair_id": criadas[0]["id"]}, contas_por_nome),
    }, 201)


# ------------------------------------------------------------------
# Fatura: pagamento parcial/total, estorno e ajuste manual
# ------------------------------------------------------------------

def _validar_cartao(contas, id_cartao):
    return next((c for c in contas if c["id"] == id_cartao and c.get("tipo") == "Cartão de crédito"), None)


@app.route("/api/v1/cards/<int:id_cartao>/invoices/<ciclo>/payments", methods=["GET"])
@com_supabase
def api_listar_pagamentos_fatura(supabase, id_cartao, ciclo):
    nomes = {c["id"]: c["nome"] for c in _contas(supabase)}
    linhas = supabase.table("fatura_pagamentos").select("*") \
        .eq("user_id", _uid()).eq("conta_id", id_cartao).eq("ciclo", ciclo) \
        .order("data").execute().data or []
    return json_ok([_serializar_pagamento(p, nomes) for p in linhas])


@app.route("/api/v1/cards/<int:id_cartao>/invoices/<ciclo>/payments", methods=["POST"])
@com_supabase
def api_pagar_fatura(supabase, id_cartao, ciclo):
    corpo = _corpo()
    contas = _contas(supabase)
    cartao = _validar_cartao(contas, id_cartao)
    if not cartao:
        return json_error("NOT_FOUND", "Cartão não encontrado.", 404)

    origem = next((c for c in contas if c["id"] == corpo.get("sourceAccountId")), None)
    valor = corpo.get("amount")
    data_pagamento = corpo.get("date") or date.today().isoformat()
    modo = "full" if corpo.get("mode") == "full" else "partial"
    chave_idem = (corpo.get("idempotencyKey") or "").strip()

    if not chave_idem:
        return json_error("VALIDATION", "idempotencyKey é obrigatória.", 422)
    if not origem or origem.get("tipo") == "Cartão de crédito":
        return json_error("VALIDATION", "Escolha uma conta de origem válida.", 422)
    if not isinstance(valor, (int, float)) or valor <= 0:
        return json_error("VALIDATION", "Informe um valor válido.", 422)
    if len(ciclo) != 7 or ciclo[4] != "-":
        return json_error("VALIDATION", "Ciclo inválido.", 422)
    try:
        datetime.strptime(data_pagamento, "%Y-%m-%d")
    except ValueError:
        return json_error("VALIDATION", "Data inválida.", 422)

    # Idempotencia: reenviar a mesma chave devolve o resultado anterior;
    # a mesma chave com dados diferentes e um conflito.
    existente = supabase.table("fatura_pagamentos").select("*") \
        .eq("user_id", _uid()).eq("idempotency_key", chave_idem).execute().data
    if existente:
        registro = existente[0]
        igual = (registro["conta_id"], registro["ciclo"], round(float(registro["valor"]), 2)) == \
                (id_cartao, ciclo, round(float(valor), 2))
        if not igual:
            return json_error("IDEMPOTENCY_CONFLICT", "Essa chave já foi usada com dados diferentes.", 409)
        nomes = {c["id"]: c["nome"] for c in contas}
        return json_ok(_serializar_pagamento(registro, nomes))

    transacoes = _transacoes(supabase)
    compras = _compras_do_ciclo(transacoes, cartao, ciclo)
    ajuste = _ajustes_ativos(supabase, id_cartao, ciclo).get((id_cartao, ciclo), 0.0)
    pago_ate_agora = _pago_total(supabase, transacoes, id_cartao, ciclo).get((id_cartao, ciclo), 0.0)
    outstanding = round(compras + ajuste - pago_ate_agora, 2)

    if outstanding <= 0:
        return json_error("VALIDATION", "Esta fatura não tem valor em aberto.", 422)
    if modo == "full" and round(valor, 2) != outstanding:
        return json_error("VALIDATION", f"Pagamento total precisa ser exatamente {outstanding:.2f}.", 422)
    if valor > outstanding:
        return json_error("VALIDATION", "O valor é maior do que o saldo em aberto da fatura.", 422)

    saldo_origem = _saldo_conta(origem, transacoes)
    if saldo_origem < valor:
        return json_error("INSUFFICIENT_BALANCE", "Saldo insuficiente na conta de origem.", 422)

    nomes = {c["id"]: c["nome"] for c in contas}
    mirror = supabase.table("despesas").insert({
        "user_id": _uid(), "nome_despesa": f"Fatura {cartao['nome']}",
        "descricao": f"Pagamento da fatura de {ciclo}",
        "categoria": "Outros", "tipo": "despesa", "conta": origem["nome"],
        "status": "pago", "valor": float(valor), "data": data_pagamento,
        "recorrente": False, "kind": "transfer",
    }).execute().data[0]

    try:
        registro = supabase.table("fatura_pagamentos").insert({
            "user_id": _uid(), "conta_id": id_cartao, "ciclo": ciclo,
            "conta_origem_id": origem["id"], "valor": float(valor), "data": data_pagamento,
            "modo": modo, "status": "active",
            "transacao_id": mirror["id"], "idempotency_key": chave_idem,
        }).execute().data[0]
    except Exception:
        supabase.table("despesas").delete().eq("id", mirror["id"]).execute()
        return json_error("CONFLICT", "Não foi possível registrar o pagamento.", 409)

    supabase.table("despesas").update({"fatura_pagamento_id": registro["id"]}).eq("id", mirror["id"]).execute()
    registro["transacao_id"] = mirror["id"]
    return json_ok(_serializar_pagamento(registro, nomes), 201)


@app.route("/api/v1/invoice-payments/<int:id_pagamento>/reverse", methods=["POST"])
@com_supabase
def api_estornar_pagamento(supabase, id_pagamento):
    """Estornar apaga o pagamento e o gasto dele (a despesa-espelho na conta de
    origem) na hora: a fatura volta a ficar em aberto e o saldo da conta se
    recalcula sozinho, porque nada disso e gravado. Idempotente: pagamento que
    ja nao existe (clique duplo) responde 204 do mesmo jeito."""
    uid = _uid()
    registro = supabase.table("fatura_pagamentos").select("*") \
        .eq("id", id_pagamento).eq("user_id", uid).execute().data
    if not registro:
        return "", 204
    registro = registro[0]

    # A despesa-espelho sai primeiro, sem depender do "on delete cascade" do schema.
    # Estornos do modelo antigo (pagamento marcado 'reversed' + movimento inverso)
    # levam o movimento inverso junto, senao sobraria um credito solto.
    supabase.table("despesas").delete().eq("fatura_pagamento_id", id_pagamento).eq("user_id", uid).execute()
    for coluna in ("transacao_id", "transacao_estorno_id"):
        if registro.get(coluna):
            supabase.table("despesas").delete().eq("id", registro[coluna]).eq("user_id", uid).execute()
    supabase.table("fatura_pagamentos").delete().eq("id", id_pagamento).eq("user_id", uid).execute()

    # O banco pode recusar o DELETE sem dar erro (politica de seguranca sem permissao de apagar). Sem conferir,
    # o pagamento continuaria valendo e o valor nunca voltaria para o cartao. Se ficou, ao menos tira ele da
    # fatura marcando como estornado; se ja estava estornado, avisa em vez de fingir que apagou.
    if supabase.table("fatura_pagamentos").select("id").eq("id", id_pagamento).eq("user_id", uid).execute().data:
        if registro.get("status") == "reversed":
            return json_error(
                "DELETE_BLOCKED",
                "O banco não permitiu apagar este registro. Confira a permissão de exclusão da tabela fatura_pagamentos no Supabase.",
                409,
            )
        supabase.table("fatura_pagamentos").update({"status": "reversed", "revertido_em": datetime.utcnow().isoformat()}) \
            .eq("id", id_pagamento).eq("user_id", uid).execute()
    return "", 204


@app.route("/api/v1/cards/<int:id_cartao>/invoices/<ciclo>/adjustments", methods=["POST"])
@com_supabase
def api_ajustar_fatura(supabase, id_cartao, ciclo):
    corpo = _corpo()
    contas = _contas(supabase)
    cartao = _validar_cartao(contas, id_cartao)
    if not cartao:
        return json_error("NOT_FOUND", "Cartão não encontrado.", 404)

    motivo = (corpo.get("reason") or "").strip()
    if len(motivo) < 5:
        return json_error("VALIDATION", "Informe uma justificativa com pelo menos 5 caracteres.", 422)

    transacoes = _transacoes(supabase)
    compras = _compras_do_ciclo(transacoes, cartao, ciclo)
    ajuste_atual = _ajustes_ativos(supabase, id_cartao, ciclo).get((id_cartao, ciclo), 0.0)
    pago = _pago_total(supabase, transacoes, id_cartao, ciclo).get((id_cartao, ciclo), 0.0)
    bruto = compras + ajuste_atual

    alvo = corpo.get("total")
    if not isinstance(alvo, (int, float)) or alvo < 0 or alvo < pago:
        return json_error("VALIDATION", "O novo total não pode ser negativo nem menor do que já foi pago.", 422)

    delta = round(alvo - bruto, 2)
    criado = supabase.table("fatura_ajustes").insert({
        "user_id": _uid(), "conta_id": id_cartao, "ciclo": ciclo,
        "valor": delta, "motivo": motivo, "status": "active",
    }).execute().data[0]
    return json_ok(_serializar_ajuste(criado), 201)


# ------------------------------------------------------------------
# CSV: exportar e importar
# ------------------------------------------------------------------

@app.route("/api/v1/transactions/export.csv")
@com_supabase
def api_exportar_csv(supabase):
    mes = request.args.get("month") or date.today().strftime("%Y-%m")
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
        "﻿" + buffer.getvalue(), mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="synch-cash-{mes}.csv"'},
    )


@app.route("/api/v1/transactions/imports", methods=["POST"])
@com_supabase
def api_importar_transacoes(supabase):
    """O parse do CSV/OFX e revisao acontecem no front (ja tem parser
    testado em lib/transaction-values.ts); aqui so recebe as linhas ja
    revisadas e confirmadas pelo usuario e grava em lote."""
    if not _plano_permite(_plano_usuario(supabase), "synch_ia"):
        return _erro_plano("Importar um arquivo CSV é um recurso do plano Synch IA. Assine para importar suas transações.")

    linhas = _corpo().get("transactions")
    if not isinstance(linhas, list) or not linhas:
        return json_error("VALIDATION", "Nenhuma transação para importar.", 422)

    contas = _contas(supabase)
    categorias_validas = set(CATEGORIAS) | set(_nomes_categorias(supabase))
    novas = []
    for linha in linhas[:500]:
        campos, erro = _validar_transacao_payload(linha, contas)
        if erro:
            continue
        if campos["categoria"] not in categorias_validas:
            campos["categoria"] = "Outros"
        data_linha = linha.get("date")
        try:
            datetime.strptime(data_linha, "%Y-%m-%d")
        except (ValueError, TypeError):
            continue
        novas.append({**campos, "valor": float(linha.get("amount")), "data": data_linha, "user_id": _uid()})

    if not novas:
        return json_error("VALIDATION", "Não foi possível reconhecer transações válidas.", 422)

    criadas = supabase.table("despesas").insert(novas).execute().data or []
    contas_por_nome = {_chave_conta(c["nome"]): c for c in contas}
    return json_ok([_serializar_transacao(t, contas_por_nome) for t in criadas], 201)


# ------------------------------------------------------------------
# Comprovantes (Supabase Storage)
# ------------------------------------------------------------------

def _garantir_bucket_comprovantes():
    try:
        admin = conectar_admin()
        if admin is not None:
            admin.storage.create_bucket(RECEIPTS_BUCKET, options={"public": False})
    except Exception:
        pass  # ja existe, ou sem permissao pra criar -- segue o fluxo normal


@app.route("/api/v1/transactions/<int:id_transacao>/receipts", methods=["POST"])
@com_supabase
def api_upload_comprovante(supabase, id_transacao):
    arquivo = request.files.get("file")
    if not arquivo or not arquivo.filename:
        return json_error("VALIDATION", "Envie um arquivo.", 422)

    linha = supabase.table("despesas").select("id").eq("id", id_transacao).eq("user_id", _uid()).execute().data
    if not linha:
        return json_error("NOT_FOUND", "Transação não encontrada.", 404)

    _garantir_bucket_comprovantes()
    caminho = f"{_uid()}/{id_transacao}-{uuid.uuid4().hex}-{arquivo.filename}"
    try:
        supabase.storage.from_(RECEIPTS_BUCKET).upload(
            caminho, arquivo.read(), {"content-type": arquivo.mimetype or "application/octet-stream"}
        )
        assinada = supabase.storage.from_(RECEIPTS_BUCKET).create_signed_url(caminho, 60 * 60 * 24 * 7)
    except Exception:
        return json_error("UPLOAD_FAILED", "Não foi possível enviar o comprovante.", 502)

    supabase.table("despesas").update({"receipt_name": arquivo.filename}) \
        .eq("id", id_transacao).eq("user_id", _uid()).execute()
    url = assinada.get("signedURL") or assinada.get("signed_url") if isinstance(assinada, dict) else None
    return json_ok({"receiptUrl": url})


# ------------------------------------------------------------------
# Central de qualidade (heuristicas simples sobre os dados existentes)
# ------------------------------------------------------------------

@app.route("/api/v1/data-quality/issues", methods=["GET"])
@com_supabase
def api_qualidade_issues(supabase):
    transacoes = _transacoes(supabase)
    contas_conhecidas = {_chave_conta(c["nome"]) for c in _contas(supabase)}
    issues, vistos = [], {}
    for t in transacoes:
        if t.get("quality_resolved") or t.get("kind") == "transfer":
            continue
        if t.get("conta") and _chave_conta(t["conta"]) not in contas_conhecidas:
            issues.append({
                "id": f"orphan-account-{t['id']}", "type": "orphan_account",
                "transactionId": t["id"], "message": f"Conta \"{t['conta']}\" não existe mais.",
            })
        if (t.get("categoria") or "Outros") == "Outros":
            issues.append({
                "id": f"uncategorized-{t['id']}", "type": "uncategorized",
                "transactionId": t["id"], "message": "Sem categoria específica.",
            })
        chave = (round(_valor(t), 2), t.get("data"), _chave_conta(t.get("conta")))
        if chave in vistos:
            issues.append({
                "id": f"duplicate-{t['id']}", "type": "duplicate", "transactionId": t["id"],
                "message": f"Possível duplicata de \"{t.get('nome_despesa')}\".",
            })
        else:
            vistos[chave] = t["id"]
    return json_ok(issues)


@app.route("/api/v1/data-quality/issues/<issue_id>/resolve", methods=["POST"])
@com_supabase
def api_resolver_issue(supabase, issue_id):
    try:
        id_transacao = int(issue_id.rsplit("-", 1)[-1])
    except ValueError:
        return json_error("NOT_FOUND", "Pendência não encontrada.", 404)
    supabase.table("despesas").update({"quality_resolved": True}) \
        .eq("id", id_transacao).eq("user_id", _uid()).execute()
    return "", 204


# ------------------------------------------------------------------
# Assinatura (Synch IA)
# ------------------------------------------------------------------

@app.route("/api/v1/billing/subscription", methods=["GET"])
@com_supabase
def api_assinatura(supabase):
    plano = _plano_usuario(supabase)
    info = CAKTO_PLANOS.get(plano)
    return json_ok({
        "plan": plano,
        "planName": info["nome"] if info else "Grátis",
        "status": "active" if plano != "gratis" else "none",
        "renewalAt": None,
        "checkoutUrl": _link_assinatura("synch_ia"),
    })


@app.route("/api/v1/billing/subscription/cancel", methods=["POST"])
@com_supabase
def api_cancelar_assinatura(supabase):
    # Nao existe cancelamento self-service aqui: a Cakto e a fonte da
    # verdade do pagamento, e so o webhook dela muda o plano de verdade.
    return json_ok({
        "message": "Para cancelar, use o link de gerenciamento enviado no e-mail de confirmação da compra na Cakto.",
    })


# ------------------------------------------------------------------
# Cakto: webhook que libera/troca/cancela o plano do usuario
#
# Mantido no caminho ORIGINAL (fora de /api/v1) porque e a URL ja
# cadastrada no painel da Cakto -- mudar aqui quebraria pagamentos em
# producao sem reconfigurar nada la. A Cakto chama isso direto do
# servidor dela, sem sessao de login -- so da pra confiar no pedido
# depois de validar a assinatura HMAC (ou o "secret" no corpo, como
# fallback). Docs: https://docs.cakto.com.br/conceitos/webhooks
# ------------------------------------------------------------------

def _cakto_assinatura_valida(corpo_bruto, timestamp, assinatura_recebida):
    if not (CAKTO_WEBHOOK_SECRET and timestamp and assinatura_recebida):
        return False
    mensagem = f"{timestamp}.{corpo_bruto.decode('utf-8')}"
    esperada = hmac.new(CAKTO_WEBHOOK_SECRET.encode(), mensagem.encode(), hashlib.sha256).hexdigest()
    recebida = assinatura_recebida.split("=", 1)[-1]  # tira o prefixo "v1="
    return hmac.compare_digest(esperada, recebida)


def _aplicar_pendencia_cakto(admin, user_id, email):
    """Se a Cakto avisou um pagamento (ou cancelamento) antes desta conta
    existir, o webhook guardou o estado em cakto_pendencias por e-mail
    (ver webhook_cakto). Ao criar a conta ou entrar com esse e-mail,
    aplica esse estado uma vez em 'assinaturas' e limpa a pendencia --
    assim quem pagou antes de ter conta continua com o plano pago na
    Cakto, sem depender de pedir pra Cakto reenviar o webhook."""
    if admin is None:
        return
    chave = _chave_email(email)
    if not chave:
        return
    try:
        pendencias = admin.table("cakto_pendencias").select("*").eq("email", chave).execute().data
        if not pendencias:
            return
        pendencia = pendencias[0]
        admin.table("assinaturas").upsert({
            "user_id": user_id, "plano": pendencia.get("plano") or "gratis",
            "cakto_evento": pendencia.get("cakto_evento"), "cakto_id": pendencia.get("cakto_id"),
            "atualizada_em": datetime.utcnow().isoformat(),
        }).execute()
        admin.table("cakto_pendencias").delete().eq("email", chave).execute()
    except Exception:
        pass  # nao pode travar login/cadastro por causa disso -- o webhook tenta de novo no proximo evento


def _cadastro_autorizado(email):
    """Cadastro so e permitido pra quem pagou o acesso vitalicio Basico com esse
    e-mail (o webhook grava isso em cakto_pendencias -- ver webhook_cakto). Sem
    nenhuma oferta configurada (CAKTO_OFERTAS_BASICO_VITALICIO vazia), a exigencia
    fica desligada e todo cadastro e permitido, como era antes desse recurso."""
    if not CAKTO_OFERTA_BASICO_VITALICIO:
        return True
    admin = conectar_admin()
    if admin is None:
        return False  # sem como confirmar o pagamento agora -- mais seguro negar do que deixar passar
    try:
        pendencias = admin.table("cakto_pendencias").select("email").eq("email", _chave_email(email)).execute().data
    except Exception:
        return False
    return bool(pendencias)


def _achar_usuario_por_email(admin, email):
    """Nao tem 'buscar por e-mail' no client do Supabase -- so listar
    paginado. Pro tamanho deste app isso e suficiente."""
    pagina, por_pagina = 1, 200
    while pagina <= 20:
        usuarios = admin.auth.admin.list_users(page=pagina, per_page=por_pagina)
        if not usuarios:
            return None
        for usuario in usuarios:
            if (usuario.email or "").strip().lower() == email:
                return usuario
        if len(usuarios) < por_pagina:
            return None
        pagina += 1
    return None


@app.route("/webhooks/cakto", methods=["POST"])
def webhook_cakto():
    corpo_bruto = request.get_data()
    payload = request.get_json(silent=True) or {}

    valido = _cakto_assinatura_valida(
        corpo_bruto,
        request.headers.get("X-Cakto-Timestamp"),
        request.headers.get("X-Cakto-Signature"),
    )
    if not valido and CAKTO_WEBHOOK_SECRET:
        valido = hmac.compare_digest(str(payload.get("secret") or ""), CAKTO_WEBHOOK_SECRET)
    if not valido:
        return "assinatura invalida", 401

    evento = payload.get("event")
    dados = payload.get("data") or {}
    if evento not in (CAKTO_EVENTOS_ATIVA | CAKTO_EVENTOS_INATIVA):
        return "", 200  # evento que nao muda nada aqui (ex.: pix_gerado)

    oferta_id = (dados.get("offer") or {}).get("id")
    email = _chave_email((dados.get("customer") or {}).get("email"))
    admin = conectar_admin()
    if not email or admin is None:
        return "", 200

    if oferta_id in CAKTO_OFERTA_BASICO_VITALICIO:
        # Acesso vitalicio Basico (taxa unica): so autoriza CADASTRO por esse e-mail
        # (ver _cadastro_autorizado). Nunca muda o plano de quem ja tem conta -- essa
        # oferta nao e o Synch IA, e quem ja se cadastrou nao precisa de nada daqui.
        usuario = _achar_usuario_por_email(admin, email)
        if not usuario:
            if evento in CAKTO_EVENTOS_ATIVA:
                admin.table("cakto_pendencias").upsert({
                    "email": email, "plano": "gratis",
                    "cakto_evento": evento, "cakto_id": dados.get("id"),
                    "atualizada_em": datetime.utcnow().isoformat(),
                }).execute()
            else:
                # Reembolso/chargeback antes de criar a conta: revoga a autorizacao pendente.
                admin.table("cakto_pendencias").delete().eq("email", email).execute()
        return "", 200

    if evento in CAKTO_EVENTOS_ATIVA:
        plano = CAKTO_OFERTA_PARA_PLANO.get(oferta_id)
        if not plano:
            return "", 200
    else:
        plano = "gratis"

    usuario = _achar_usuario_por_email(admin, email)
    if not usuario:
        # Pagou (ou cancelou) mas ainda nao tem conta no app -- ou usou outro
        # e-mail no checkout. Guarda o estado por e-mail; api_register e
        # api_login aplicam isso em 'assinaturas' na primeira vez que essa
        # pessoa criar a conta ou entrar com esse e-mail.
        admin.table("cakto_pendencias").upsert({
            "email": email, "plano": plano,
            "cakto_evento": evento, "cakto_id": dados.get("id"),
            "atualizada_em": datetime.utcnow().isoformat(),
        }).execute()
        return "", 200

    admin.table("assinaturas").upsert({
        "user_id": usuario.id, "plano": plano,
        "cakto_evento": evento, "cakto_id": dados.get("id"),
        "atualizada_em": datetime.utcnow().isoformat(),
    }).execute()
    # A conta ja existia, entao ja foi aplicado direto -- limpa uma pendencia
    # antiga desse e-mail (se sobrou uma de antes da conta existir).
    admin.table("cakto_pendencias").delete().eq("email", email).execute()
    return "", 200


# ------------------------------------------------------------------
# Assistente (Synch IA): o modelo em si fica em synch_ia.py. Aqui so se
# monta o retrato das financas do usuario que ele vai consultar.
# ------------------------------------------------------------------

def _fatura_do_ciclo(cartao, transacoes, ciclo, pagos, ajustes):
    fechamento = int(cartao.get("fechamento") or 28)
    total = _compras_do_ciclo(transacoes, cartao, ciclo) + ajustes.get((cartao["id"], ciclo), 0.0)
    pago = pagos.get((cartao["id"], ciclo), 0.0)
    fatura = {
        "ciclo": ciclo,
        "fecha_em": date(int(ciclo[:4]), int(ciclo[5:7]), min(fechamento, _ultimo_dia_do_mes(ciclo))).isoformat(),
        "total": round(total, 2), "pago": round(pago, 2), "restante": round(max(0.0, total - pago), 2),
    }
    if cartao.get("vencimento"):
        fatura["vence_em"] = _vencimento_da_fatura(ciclo, fechamento, int(cartao["vencimento"])).isoformat()
    return fatura


def _contas_para_ia(supabase, contas, transacoes):
    hoje = date.today()
    resultado = []
    for c in contas:
        if c.get("tipo") != "Cartão de crédito":
            resultado.append({"nome": c["nome"], "tipo": c.get("tipo") or "Conta corrente", "saldo": _saldo_conta(c, transacoes)})
            continue
        usado = _cartao_usado(supabase, transacoes, c)
        limite = float(c.get("limite_credito") or 0)
        aberta = _mes_da_fatura(hoje.isoformat(), int(c.get("fechamento") or 28))
        anterior = _somar_meses(date(int(aberta[:4]), int(aberta[5:7]), 1), -1).strftime("%Y-%m")
        pagos = _pago_total(supabase, transacoes, conta_id=c["id"])
        ajustes = _ajustes_ativos(supabase, conta_id=c["id"])
        resultado.append({
            "nome": c["nome"], "tipo": "Cartão de crédito",
            "limite": limite or None,
            "comprometido_em_todas_as_faturas": usado,
            "limite_disponivel": round(max(0.0, limite - usado), 2) if limite else None,
            "dia_fechamento": c.get("fechamento"), "dia_vencimento": c.get("vencimento"),
            "fatura_fechada_anterior": _fatura_do_ciclo(c, transacoes, anterior, pagos, ajustes),
            "fatura_aberta": _fatura_do_ciclo(c, transacoes, aberta, pagos, ajustes),
        })
    return resultado


def _analitica(t):
    """Mesmo criterio de isAnalytical no front: transferencia, pagamento de
    fatura e o marcador antigo "Fatura do cartão" nao sao gasto nem receita."""
    if t.get("kind") == "transfer" or t.get("fatura_id") or t.get("fatura_pagamento_id"):
        return False
    return not (re.fullmatch(r"fatura do cart[aã]o", (t.get("nome_despesa") or "").strip(), re.I) and not t.get("payment_method"))


@app.route("/api/v1/assistant/messages", methods=["POST"])
@com_supabase
def api_assistente(supabase):
    if not _plano_permite(_plano_usuario(supabase), "synch_ia"):
        return _erro_plano("O Assistente financeiro (texto e voz) é exclusivo do plano Synch IA.")

    corpo = _corpo()
    pergunta = (corpo.get("message") or "").strip()
    if not pergunta:
        return json_error("VALIDATION", "Envie uma mensagem.", 422)
    if len(pergunta) > synch_ia.MAX_TEXTO:
        return json_error("VALIDATION", "Mensagem longa demais. Tente resumir o pedido.", 422)

    contas = _contas(supabase)
    transacoes = _transacoes(supabase)
    contas_por_nome = {_chave_conta(c["nome"]): c for c in contas}
    dados = {
        "hoje": date.today(),
        "usuario": _preferencias(supabase).get("nome") or "Usuário",
        "contas": _contas_para_ia(supabase, contas, transacoes),
        "transacoes": [{**_serializar_transacao(t, contas_por_nome), "analitica": _analitica(t)} for t in transacoes],
        "orcamentos": _orcamentos(supabase),
        "categorias": _nomes_categorias(supabase, transacoes),
        "metas": [_serializar_meta(m) for m in _metas(supabase)],
        "recorrentes": [_serializar_recorrente(r) for r in _recorrentes(supabase)],
    }
    pendente = corpo.get("pendingAction") if isinstance(corpo.get("pendingAction"), dict) else None
    estado = {
        "mes_na_tela": str(corpo.get("month") or "")[:7] or None,
        "origem": "voice" if corpo.get("source") == "voice" else "text",
        "valores_ocultos": bool(corpo.get("hidden")),
        "acao_pendente": pendente if pendente and len(json.dumps(pendente)) <= synch_ia.MAX_TEXTO else None,
        "ultima_acao": str(corpo.get("lastUndo") or "")[:120] or None,
    }
    historico = corpo.get("history") if isinstance(corpo.get("history"), list) else []

    try:
        resposta = synch_ia.responder(pergunta, [h for h in historico if isinstance(h, dict)], dados, estado)
    except synch_ia.IAIndisponivel as e:
        return json_error("AI_UNAVAILABLE", str(e), 503)
    return json_ok({"conversationId": corpo.get("conversationId") or str(uuid.uuid4()), **resposta})


# ------------------------------------------------------------------
# Erros: tudo em JSON, nunca a pagina de erro HTML padrao do Flask.
# ------------------------------------------------------------------

@app.errorhandler(404)
def _nao_encontrado(e):
    return json_error("NOT_FOUND", "Rota não encontrada.", 404)


@app.errorhandler(405)
def _metodo_nao_permitido(e):
    return json_error("METHOD_NOT_ALLOWED", "Método não permitido.", 405)


@app.errorhandler(Exception)
def _erro_interno(e):
    app.logger.exception("Erro nao tratado")
    return json_error("INTERNAL_ERROR", "Erro interno. Tente novamente.", 500)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
