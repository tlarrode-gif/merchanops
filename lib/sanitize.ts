/**
 * Sanitización de entradas de usuario.
 *
 * React ya escapa todo lo que se renderiza por JSX (la vía principal de XSS
 * queda cubierta) y supabase-js parametriza las consultas (sin SQL injection),
 * así que el objetivo aquí es: eliminar caracteres de control invisibles,
 * acotar longitudes y neutralizar la inyección de fórmulas al exportar a
 * CSV/Excel (celdas que empiezan por =, +, -, @ se interpretan como fórmula).
 */

const MAX_TEXT_LENGTH = 10_000;

/** Limpia texto de usuario: sin caracteres de control (salvo \n y \t), recortado y acotado. */
export function sanitizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  let text = String(value ?? "");
  // Caracteres de control C0/C1 excepto salto de línea y tabulador.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text.trim();
}

/** Variante para identificadores cortos (usuarios, códigos): una sola línea. */
export function sanitizeIdentifier(value: unknown, maxLength = 120): string {
  return sanitizeText(value, maxLength).replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * Neutraliza inyección de fórmulas en celdas CSV: si el valor empieza por
 * = + - @ o tab/CR, se antepone un apóstrofo para que Excel lo trate como texto.
 * Aplicar ANTES del escapado de comillas del CSV.
 */
export function csvSafeCell(value: unknown): string {
  const text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}
