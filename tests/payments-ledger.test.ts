/**
 * Pruebas del cliente del ledger (fase 2). La lógica transaccional vive en
 * PostgreSQL y se verificó en vivo contra la base real dentro de una
 * transacción revertida (ver docs/PAYMENTS_REMEDIATION_PLAN.md §F2):
 * idempotencia (2ª pasada: 0 inserciones), subida 2→3 visitas (1 inserción),
 * reapertura de cerradas bloqueada, borrado físico bloqueado, conflicto de
 * versión detectado, ajuste enlazado y auditoría inmutable.
 * Aquí se prueba el contrato del cliente: mapeo, validaciones y modo degradado.
 */
import { describe, expect, it } from "vitest";
import { LedgerError, createAdjustment, syncObligations, toRpcPayload } from "@/lib/payments/ledger";
import { computeIsdinObligations } from "@/lib/payments/engine";

const vinyl = {
  vin: "VIN-9",
  status: "Incidencia",
  basePaymentEur: 40,
  revisitCount: 2,
  incidentPaymentWeek: "S27",
  incidentPaymentDate: "2026-07-01",
  installationPaymentDate: null,
  incidentOpenedAt: "2026-07-01",
  incidentResolvedAt: null,
  statusChangedAt: "2026-07-01",
  installerId: "w1",
  installerName: "Manuel"
};

describe("toRpcPayload", () => {
  it("mapea la obligación del motor al contrato del RPC sin perder campos financieros", () => {
    const { obligations } = computeIsdinObligations(vinyl);
    const payload = toRpcPayload(obligations[0]);
    expect(payload).toMatchObject({
      key: "isdin:VIN-9:failed_visit:1",
      origin: "isdin",
      sourceId: "VIN-9",
      type: "failed_visit",
      kind: "pago",
      amountCents: 856,
      eventDate: "2026-07-01",
      payable: true
    });
    expect(payload.blockedReasons).toEqual([]);
  });

  it("la clave del payload nunca contiene importe, fecha ni estado", () => {
    const { obligations } = computeIsdinObligations(vinyl);
    for (const o of obligations) {
      expect(o.key).not.toMatch(/856|8[.,]56|2026|calculado|Incidencia/);
    }
  });
});

describe("modo degradado y validaciones del cliente", () => {
  it("15. sin Supabase configurado, el ledger falla como transitorio (solo lectura), no simula guardado", async () => {
    // En el entorno de test no hay NEXT_PUBLIC_SUPABASE_*: supabase es null.
    const { obligations } = computeIsdinObligations(vinyl);
    await expect(syncObligations(obligations, "tester")).rejects.toMatchObject({
      name: "LedgerError",
      kind: "transient"
    });
  });

  it("un ajuste sin motivo o con céntimos no enteros se rechaza en validación", async () => {
    await expect(createAdjustment("isdin:VIN-9:failed_visit:1", -856, "tester", "  ")).rejects.toMatchObject({ kind: "validation" });
    await expect(createAdjustment("isdin:VIN-9:failed_visit:1", -8.56, "tester", "motivo")).rejects.toMatchObject({ kind: "validation" });
  });

  it("LedgerError clasifica los tipos de fallo exigidos por la auditoría", () => {
    expect(new LedgerError("x", "concurrency").kind).toBe("concurrency");
    expect(new LedgerError("x", "validation").kind).toBe("validation");
    expect(new LedgerError("x", "transient").kind).toBe("transient");
    expect(new LedgerError("x", "permanent").kind).toBe("permanent");
  });
});
