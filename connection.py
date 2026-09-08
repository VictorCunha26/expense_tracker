import os #biblioteca nativa que conecta o programa ao sitema operacional, permitindo gerenciar arquivos, controlar pastas e consultar o ambiente 
from pathlib import Path
from supabase import create_client, Client 
from dotenv import load_dotenv 

# lê o arquivo .env e disponibiliza as variàveis via os.getenv()

env_path = Path(__file__).resolve().parent/ ".env"
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
# service_role: ignora RLS. So pra rotina de servidor sem usuario logado
# (webhook da Cakto) -- nunca usar essa chave num fluxo que responde
# diretamente a um pedido do navegador.
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

"""
Cria e retorna um cliente do Supabase.
Diferença importante em relação ao MySql: aqui não existe "cursor" nem SQL cru (SELECT/INSERT em texto). O cliente já vem com métodos prontos, tipo .table("despesas").select("*"), que montam a query por baixo dos panos via API REST
"""

def conectar():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def conectar_como_usuario(acess_token):
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    supabase.postgrest.auth(acess_token)
    return supabase

def conectar_admin():
    if not SUPABASE_SERVICE_KEY:
        return None
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def renovar_sessao(refresh_token):
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    resposta = supabase.auth.refresh_session(refresh_token)
    return resposta.session

