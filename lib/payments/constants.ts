/**
 * Constantes financieras — FUENTE ÚNICA.
 *
 * Ningún otro fichero debe declarar la tarifa por visita fallida. Los
 * módulos legados (`payment-ledger`, `payment-audit`, `app/page.tsx`,
 * módulo ISDIN) importan de aquí.
 */

/** Tarifa por visita fallida (pagada al instalador), en céntimos: 8,56 €. */
export const FAILED_VISIT_FEE_CENTS = 856;

/** Tarifa por visita fallida en euros (para UI/código legado). NO cambiar: 8,56 €. */
export const FAILED_VISIT_FEE_EUR = FAILED_VISIT_FEE_CENTS / 100;

export const CURRENCY = "EUR" as const;
