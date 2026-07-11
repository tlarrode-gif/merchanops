/**
 * A7: las regularizaciones de facturación ISDIN nunca se borran físicamente;
 * una regularización anulada (annulled_at) queda fuera de la facturación al
 * cliente (historial económico, totales y exports).
 */
import { describe, expect, it } from "vitest";
import { facturacionEventsFromIsdin } from "@/lib/economic-events";
import { IsdinBillingAdjustment } from "@/lib/isdin-billing";

const adj = (over: Partial<IsdinBillingAdjustment> = {}): IsdinBillingAdjustment => ({
  id: "a1",
  concept: "Regularización test",
  amount: 50,
  billing_week: "2026-S28",
  billing_date: "2026-07-10",
  ...over
});

describe("regularizaciones ISDIN (A7)", () => {
  it("una regularización activa genera evento de facturación", () => {
    const eventos = facturacionEventsFromIsdin([], [adj()]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].importe).toBe(50);
    expect(eventos[0].tipo).toBe("facturacion_cliente");
  });

  it("una regularización anulada NO genera facturación", () => {
    const eventos = facturacionEventsFromIsdin([], [
      adj({ id: "a2", annulled_at: "2026-07-11T10:00:00Z", annulled_by: "admin", annul_reason: "duplicada" })
    ]);
    expect(eventos).toHaveLength(0);
  });

  it("mezcla: solo las activas facturan y el importe 0 se descarta", () => {
    const eventos = facturacionEventsFromIsdin([], [
      adj({ id: "a1", amount: 25 }),
      adj({ id: "a2", amount: -10, annulled_at: "2026-07-11T10:00:00Z", annul_reason: "error" }),
      adj({ id: "a3", amount: 0 })
    ]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].source_id).toBe("a1");
  });
});
