/**
 * Dinero en céntimos enteros de EUR.
 *
 * REGLA DE REDONDEO (documentada y testeada): half-up sobre el tercer
 * decimal — 1.005 € → 101 céntimos; 8.555 € → 856. Es la regla comercial
 * habitual en liquidaciones en España y la que asume la tarifa 8,56 €.
 *
 * Los importes inválidos (NaN, Infinity, texto no numérico) NUNCA se
 * convierten en 0: se lanza MoneyError para que la fila/entidad quede
 * rechazada con motivo. El 0 silencioso era una de las fuentes de pagos
 * incorrectos detectadas en la auditoría.
 */

export class MoneyError extends Error {
  constructor(message: string, public readonly value: unknown) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Redondeo half-up a céntimos desde un número en euros. */
export function eurosToCents(euros: number): number {
  if (typeof euros !== "number" || !Number.isFinite(euros)) {
    throw new MoneyError(`Importe no numérico o no finito: ${String(euros)}`, euros);
  }
  // Corrección de coma flotante antes del redondeo (40.615 → 4061.5 exacto).
  const scaled = Math.round((euros * 1000 + (euros >= 0 ? 1e-7 : -1e-7))) / 10;
  return euros >= 0 ? Math.floor(scaled + 0.5) : -Math.floor(-scaled + 0.5);
}

export function centsToEuros(cents: number): number {
  assertCents(cents);
  return cents / 100;
}

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents)) throw new MoneyError(`Céntimos no enteros: ${String(cents)}`, cents);
}

/** Importe de una obligación ordinaria: entero y >= 0. */
export function assertObligationCents(cents: number): void {
  assertCents(cents);
  if (cents < 0) throw new MoneyError(`Una obligación ordinaria no puede ser negativa: ${cents}`, cents);
}

/**
 * Parsea un importe en EUR desde texto de CSV. Acepta "8,56", "8.56",
 * "1.234,56", "1,234.56" y espacios/símbolo €. Devuelve céntimos.
 * Lanza MoneyError ante cadenas vacías o no numéricas.
 */
export function parseEurToCents(raw: unknown): number {
  if (typeof raw === "number") return eurosToCents(raw);
  const text = String(raw ?? "").trim().replace(/€/g, "").replace(/\s+/g, "");
  if (!text) throw new MoneyError("Importe vacío", raw);
  let normalized = text;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El separador decimal es el que aparece más a la derecha.
    normalized = lastComma > lastDot
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new MoneyError(`Importe no numérico: "${String(raw)}"`, raw);
  return eurosToCents(value);
}

export function formatCents(cents: number): string {
  assertCents(cents);
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
