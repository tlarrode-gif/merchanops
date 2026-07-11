/**
 * C3: las líneas del Historial económico salen del motor único con identidad
 * estable — una corrección actualiza el mismo evento, no crea uno paralelo.
 */
import { describe, expect, it } from "vitest";
import { buildEnginePaymentLines } from "@/lib/payments/lines";

const service = (over: Record<string, unknown> = {}) => ({
  id: "s1", status: "Validado", payment_type: "Puntos", validated_at: "2026-07-01",
  worker_id: "w1", worker_name: "Ana", client_id: "c1", client: "ACME", ceco: "100",
  campaign: "Verano", province: "Madrid", ...over
});
const point = (over: Record<string, unknown> = {}) => ({
  id: "p1", service_id: "s1", fee: 30, original_fee: null, incident_fee: null,
  point_status: "Finalizado", incident_status: null, incident_resolved_at: null, ...over
});

describe("buildEnginePaymentLines (C3)", () => {
  it("fingerprint = clave estable sin fecha ni importe; corregir el importe conserva la identidad", () => {
    const a = buildEnginePaymentLines([service()], [point()], [], []);
    const b = buildEnginePaymentLines([service()], [point({ fee: 55 })], [], []);
    expect(a.lines[0].fingerprint).toBe("servicio:s1:points");
    expect(b.lines[0].fingerprint).toBe(a.lines[0].fingerprint); // misma identidad
    expect(b.lines[0].amount).toBe(55); // importe corregido, no línea nueva
    expect(a.lines[0].fingerprint).not.toMatch(/2026|30/);
  });

  it("servicio Validado sin validated_at NO entra en pagos (issue, sin fecha inventada)", () => {
    const r = buildEnginePaymentLines([service({ validated_at: null })], [point()], [], []);
    expect(r.lines).toHaveLength(0);
    expect(r.issues.some((i) => i.description.includes("missing_validated_at"))).toBe(true);
  });

  it("gran campaña: visita fallida y pago original como líneas separadas del motor", () => {
    const bigPoint = {
      id: "bp1", big_campaign_id: "bc1", point_status: "Finalizado", fee: 50, original_fee: 50,
      incident_fee: null, incident_status: "Resuelta", incident_resolved_at: "2026-07-02",
      validated_at: "2026-07-02", finished_at: "2026-07-02", worker_id: "w1", worker_name: "Mai", province: "Sevilla"
    };
    const r = buildEnginePaymentLines([], [], [{ id: "bc1", client: "Nestlé", name: "Promo" }], [bigPoint]);
    expect(r.lines.map((l) => l.fingerprint).sort()).toEqual([
      "gran_campana:bp1:failed_visit:1",
      "gran_campana:bp1:installation"
    ]);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(58.56, 2);
  });

  it("importe inválido en un punto bloquea la línea con issue (no 0 silencioso)", () => {
    const r = buildEnginePaymentLines([service()], [point({ fee: Number.NaN })], [], []);
    expect(r.lines).toHaveLength(0);
    expect(r.issues.some((i) => i.description.includes("invalid_amount"))).toBe(true);
  });
});
