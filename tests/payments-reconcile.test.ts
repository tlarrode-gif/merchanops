/**
 * Conciliación histórica (fase 7): detecta revisitas omitidas, cobros
 * prematuros del original y calcula SOLO las obligaciones faltantes.
 * La aplicación real reutiliza sync_payment_obligations (verificado en vivo:
 * nunca duplica ni toca cerradas). La tarifa histórica no se modifica.
 */
import { describe, expect, it } from "vitest";
import { buildReconcileReport } from "@/lib/payments/reconcile";
import { LedgerRow } from "@/lib/payments/ledger";
import { IsdinVinylInput } from "@/lib/payments/types";

const vinyl = (over: Partial<IsdinVinylInput>): IsdinVinylInput => ({
  vin: "VIN-R1",
  status: "Finalizado",
  basePaymentEur: 40,
  revisitCount: 3,
  incidentPaymentWeek: "S27",
  incidentPaymentDate: "2026-06-01",
  installationPaymentDate: "2026-06-20",
  incidentOpenedAt: "2026-06-01",
  incidentResolvedAt: "2026-06-19",
  statusChangedAt: "2026-06-20",
  installerId: "w1",
  installerName: "Manuel",
  ...over
});

const row = (key: string, cents: number, status = "cerrado"): LedgerRow =>
  ({
    id: key,
    obligation_key: key,
    origin: "isdin",
    source_id: key.split(":")[1],
    type: key.includes("failed_visit") ? "failed_visit" : "installation",
    kind: "pago",
    amount_cents: cents,
    currency: "EUR",
    event_date: "2026-06-01",
    period: "2026-06",
    worker_id: "w1",
    worker_name: "Manuel",
    concept: "",
    status: status as LedgerRow["status"],
    payable: true,
    blocked_reasons: [],
    version: 1,
    created_at: "",
    updated_at: ""
  });

describe("conciliación histórica ISDIN", () => {
  it("detecta un finalizado que cobró UNA sola visita fallida habiendo 3 (revisitas omitidas)", () => {
    const ledger = [row("isdin:VIN-R1:failed_visit:1", 856), row("isdin:VIN-R1:installation", 4000)];
    const report = buildReconcileReport([vinyl({})], ledger);
    const missingKeys = report.missing.map((m) => m.key);
    expect(missingKeys).toEqual(["isdin:VIN-R1:failed_visit:2", "isdin:VIN-R1:failed_visit:3"]);
    // Solo crea las faltantes: la visita 1 y la instalación pagadas no se duplican.
    expect(report.missing.every((m) => m.amountCents === 856)).toBe(true);
  });

  it("detecta 'Resuelto - Pendiente colocador' con el importe original ya cobrado", () => {
    const ledger = [row("isdin:VIN-R1:failed_visit:1", 856), row("isdin:VIN-R1:installation", 4000)];
    const report = buildReconcileReport([vinyl({ status: "Resuelto - Pendiente colocador" })], ledger);
    expect(report.findings.some((f) => f.kind === "resuelto_con_original_cobrado")).toBe(true);
    // Y jamás propone crear una instalación en ese estado.
    expect(report.missing.every((m) => m.type !== "installation")).toBe(true);
  });

  it("divergencia de importe sobre línea cerrada se reporta (ajuste manual), no se edita", () => {
    const ledger = [
      row("isdin:VIN-R1:failed_visit:1", 999),
      row("isdin:VIN-R1:failed_visit:2", 856),
      row("isdin:VIN-R1:failed_visit:3", 856),
      row("isdin:VIN-R1:installation", 4000)
    ];
    const report = buildReconcileReport([vinyl({})], ledger);
    expect(report.missing).toHaveLength(0);
    expect(report.findings.some((f) => f.kind === "amount_divergence" && /ajuste\/anulación/.test(f.detail))).toBe(true);
  });

  it("ledger completo y correcto => informe limpio (dry-run sin cambios)", () => {
    const ledger = [
      row("isdin:VIN-R1:failed_visit:1", 856),
      row("isdin:VIN-R1:failed_visit:2", 856),
      row("isdin:VIN-R1:failed_visit:3", 856),
      row("isdin:VIN-R1:installation", 4000)
    ];
    const report = buildReconcileReport([vinyl({})], ledger);
    expect(report.missing).toHaveLength(0);
    expect(report.findings).toHaveLength(0);
    expect(report.expectedObligations).toBe(4);
  });
});
