"use client"

import { createContext, useContext } from "react"

export const defaultCategories = ["Moradia", "Alimentação", "Transporte", "Lazer", "Assinaturas", "Receita", "Outros"]

// "Outros" recebe o que perde a categoria; "Receita" é a categoria de toda entrada.
export const systemCategories = ["Outros", "Receita"]

const fixedColors: Record<string, string> = { Moradia: "#16a34a", Alimentação: "#f59e0b", Transporte: "#3b82f6", Lazer: "#8b5cf6", Assinaturas: "#06b6d4", Outros: "#64748b", Receita: "#22c55e" }
const extraPalette = ["#ec4899", "#0ea5e9", "#a855f7", "#eab308", "#14b8a6", "#f97316", "#6366f1", "#84cc16"]

// Categoria criada pelo usuário não tem cor fixa: a cor sai da paleta pelo nome,
// então a mesma categoria tem sempre a mesma cor em todas as telas.
export function categoryColor(name: string) {
  if (fixedColors[name]) return fixedColors[name]
  if (!name) return fixedColors.Outros
  return extraPalette[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % extraPalette.length]
}

export const CategoriesContext = createContext<string[]>(defaultCategories)
export const useCategories = () => useContext(CategoriesContext)
