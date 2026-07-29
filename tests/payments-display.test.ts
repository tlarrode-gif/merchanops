/**
 * M-03 — la capa de presentación deriva del motor único.
 *
 * Estos tests fijan las tres diferencias que existían entre el cálculo inline
 * de `app/page.tsx` y el motor, para que la consolidación no se revierta sin
 * darse cuenta.
 */

import { describe, expect, it } from "vitest";
import { pointPayEur, serviceTotalsEur } from "@/lib/payments/display";

const punto = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  service_id: "s1",
  fee: 17,
  point_status: "Pendiente",
  ...extra
});

const servicio = (extra: Record<string, unknown> = {}) => ({
  id: "s1",
  status: "Validado",
  payment_type: "Puntos",
  validated_at: "2026-07-01",
  ...extra
});

describe("importes de presentación (M-03)", () => {
  it("un punto normal paga su tarifa", () => {
    expect(pointPayEur(punto())).toBe(17);
  });

  it("un punto pendiente de recepción post-incidencia no paga", () => {
    expect(pointPayEur(punto({ point_status: "Pendiente recepción post-incidencia" }))).toBe(0);
  });

  it("una incidencia activa paga solo la tarifa de visita fallida", () => {
    expect(pointPayEur(punto({ point_status: "Incidencia", incident_fee: 8.56 }))).toBe(8.56);
  });

  it("una incidencia resuelta paga el original MÁS la visita fallida", () => {
    const p = punto({ point_status: "Incidencia", incident_status: "Resuelta", original_fee: 17, incident_fee: 8.56 });
    expect(pointPayEur(p)).toBe(25.56);
  });

  it("la aritmética es exacta: en coma flotante 0,1 + 0,2 daría 0,30000000000000004", () => {
    const p = punto({ point_status: "Incidencia", incident_status: "Resuelta", original_fee: 0.1, incident_fee: 0.2 });
    expect(pointPayEur(p)).toBe(0.3);
    // Prueba de que el problema que se está evitando es real:
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("usa point_status y solo cae a la columna legada `status` si falta", () => {
    expect(pointPayEur({ id: "p", fee: 17, status: "Incidencia", incident_fee: 8.56 })).toBe(8.56);
    expect(pointPayEur({ id: "p", fee: 17, status: "Incidencia", point_status: "Pendiente" })).toBe(17);
  });

  it("un servicio Mixto suma puntos y horas", () => {
    const s = servicio({ payment_type: "Mixto", hourly_rate: 12.5, hours_worked: 3 });
    const totales = serviceTotalsEur(s, [punto(), punto({ id: "p2", fee: 8 })]);
    expect(totales.pointsEur).toBe(25);
    expect(totales.hoursEur).toBe(37.5);
    expect(totales.totalEur).toBe(62.5);
  });

  it("un servicio por Horas ignora los puntos", () => {
    const s = servicio({ payment_type: "Horas", hourly_rate: 10, hours_worked: 2 });
    expect(serviceTotalsEur(s, [punto()]).totalEur).toBe(20);
  });

  it("un importe inválido se señala en vez de convertirse en 0 silencioso", () => {
    const totales = serviceTotalsEur(servicio(), [punto({ fee: Number.NaN })]);
    expect(totales.amountIssue).toBe(true);
  });

  it("un servicio aún no validado NO se marca como problema de importe", () => {
    // `not_payable_status` habla de cuándo se paga, no de si la cifra es buena.
    const totales = serviceTotalsEur(servicio({ status: "En ejecución", validated_at: null }), [punto()]);
    expect(totales.amountIssue).toBe(false);
    expect(totales.totalEur).toBe(17);
  });
});
