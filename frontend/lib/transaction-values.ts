/** Date-only arithmetic without timezone shifts; clamp month-end dates. */
export function addCalendarMonths(date: string, count: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const value = new Date(Date.UTC(year, month - 1 + count, 1))
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate()
  value.setUTCDate(Math.min(day, lastDay))
  return value.toISOString().slice(0, 10)
}

/** Each installment is integer cents; their sum is exactly the purchase total. */
export function installmentAmounts(total: number, count: number): number[] {
  const cents = Math.round(total * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isInteger(count) || count < 1 || count > 120 || count > cents) throw new Error("Revise o valor e a quantidade de parcelas.")
  return Array.from({ length: count }, (_, index) => (Math.floor(cents / count) + (index < cents % count ? 1 : 0)) / 100)
}

export function csvCell(value: string | number): string {
  const raw = String(value)
  const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

/** Quoted fields, escaped quotes, CRLF, semicolons and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "")
  const first = source.split(/\r?\n/, 1)[0]
  const delimiter = first.includes(";") ? ";" : ","
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index++ }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) { row.push(field); field = "" }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index++
      row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = ""
    } else field += char
  }
  if (quoted) throw new Error("CSV incompleto: confira as aspas do arquivo.")
  row.push(field); if (row.some(value => value.trim())) rows.push(row)
  return rows
}

export function parseCsvAmount(value: string): number {
  const raw = value.trim().replace(/R\$\s*/g, "").replace(/\s/g, "")
  if (!raw) return NaN
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw
  return /^-?\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : NaN
}
