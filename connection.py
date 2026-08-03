import os #biblioteca nativa que conecta o programa ao sitema operacional, permitindo gerenciar arquivos, controlar pastas e consultar o ambiente 
from supabase import create_client, Client 
from dotenv import load_dotenv 

# lê o arquivo .env e disponibiliza as variàveis via os.getenv()

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

"""
Cria e retorna um cliente do Supabase.
Diferença importante em relação ao MySql: aqui não existe "cursor" nem SQL cru (SELECT/INSERT em texto). O cliente já vem com métodos prontos, tipo .table("despesas").select("*"), que montam a query por baixo dos panos via API REST
"""

def conectar(): 
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return supabase

