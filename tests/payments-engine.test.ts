/**
 * Pruebas obligatorias del motor único de pagos (fase 1 de la remediación).
 * Cubre los escenarios 1-10, 17 y 18 de la auditoría a nivel de dominio;
 * los escenarios transaccionales (11-16) llegan con el backend (fases 3-5).
 */
import { describe, expect, it } from "vitest";
import { FAILED_VISIT_FEE_CENTS, FAILED_VISIT_FEE_EUR } from "@/lib/payments/constants";
import { MoneyError, eurosToCents, parseEurToCents } from "@/lib/payments/money";
import {
  computeBigCampaignPointObligations,
  computeIsdinObligations,
  computeServiceObligations,
  isdinExpectedTotalEur,
  summarize
} from "@/lib/payments/engine";
import { IsdinVinylInput, ServiceInput } from "@/lib/payments/types";

function vinyl(overrides: Partial<IsdinVinylInput>): IsdinVinylInput {
  return {
    vin: "VIN-001",
    status: "Nuevo",
    basePaymentEur: 40,
    revisitCount: 0,
    incidentPaymentWeek: null,
    incidentPaymentDate: "2026-07-01",
    installationPaymentDate: "2026-07-08",
    incidentOpenedAt: null,
    incidentResolvedAt: null,
    statusChangedAt: "2026-07-08",
    installerId: "w1",
    installerName: "Manuel",
    ...overrides
  };
}

describe("Tarifa por visita fallida", () => {
  it("es exactamente 8,56 € y única en el sistema", () => {
    expect(FAILED_VISIT_FEE_CENTS).toBe(856);
    expect(FAILED_VISIT_FEE_EUR).toBe(8.56);
  });
});

describe("ISDIN: reglas de visitas fallidas", () => {
  it("1. Incidencia con una visita paga 8,56 € (sin importe original)", () => {
    const { obligations } = computeIsdinObligations(vinyl({ status: "Incidencia", revisitCount: 1, incidentOpenedAt: "2026-07-01" }));
    expect(obligations).toHaveLength(1);
    expect(obligations[0].key).toBe("isdin:VIN-001:failed_visit:1");
    expect(obligations[0].amountCents).toBe(856);
    expect(summarize(obligations).totalCents).toBe(856);
  });

  it("2. Incidencia con tres visitas paga 25,68 €", () => {
    const { obligations } = computeIsdinObligations(vinyl({ status: "Incidencia", revisitCount: 3, incidentOpenedAt: "2026-07-01" }));
    expect(obligations.map((o) => o.key)).toEqual([
      "isdin:VIN-001:failed_visit:1",
      "isdin:VIN-001:failed_visit:2",
      "isdin:VIN-001:failed_visit:3"
    ]);
    expect(summarize(obligations).totalCents).toBe(2568);
  });

  it("3. Resuelto - Pendiente colocador con tres visitas: 25,68 € y SIN importe original", () => {
    const v = vinyl({ status: "Resuelto - Pendiente colocador", revisitCount: 3, incidentOpenedAt: "2026-07-01" });
    const { obligations, issues } = computeIsdinObligations(v);
    expect(obligations).toHaveLength(3);
    expect(obligations.every((o) => o.type === "failed_visit")).toBe(true);
    expect(summarize(obligations).totalCents).toBe(2568);
    expect(isdinExpectedTotalEur(v)).toBeCloseTo(25.68, 2);
    // Señal de conciliación: el original NO debe cobrarse aún.
    expect(issues.some((i) => i.description.includes("NO debe pagarse"))).toBe(true);
  });

  it("4. Finalizado de 40 € con tres visitas: 65,68 € (original + 3 × 8,56)", () => {
    const v = vinyl({ status: "Finalizado", revisitCount: 3, incidentOpenedAt: "2026-07-01", incidentResolvedAt: "2026-07-07" });
    const { obligations } = computeIsdinObligations(v);
    expect(obligations).toHaveLength(4);
    expect(obligations.find((o) => o.type === "installation")?.amountCents).toBe(4000);
    expect(summarize(obligations).totalCents).toBe(6568);
    expect(isdinExpectedTotalEur(v)).toBeCloseTo(65.68, 2);
  });

  it("5. Incidencia en llamada (preventiva): 0 €", () => {
    const { obligations } = computeIsdinObligations(vinyl({ status: "Incidencia llamada", revisitCount: 2 }));
    expect(obligations).toHaveLength(0);
  });

  it("Finalizado sin incidencia previa paga solo el original", () => {
    const { obligations } = computeIsdinObligations(vinyl({ status: "Finalizado", revisitCount: 0 }));
    expect(obligations).toHaveLength(1);
    expect(obligations[0].key).toBe("isdin:VIN-001:installation");
    expect(obligations[0].amountCents).toBe(4000);
  });

  it("Cancelado en frío (sin visita real) no paga nada; con visita real paga la visita", () => {
    expect(computeIsdinObligations(vinyl({ status: "Cancelado" })).obligations).toHaveLength(0);
    const withVisit = computeIsdinObligations(vinyl({ status: "Cancelado", incidentPaymentWeek: "Semana 27" }));
    expect(withVisit.obligations).toHaveLength(1);
    expect(withVisit.obligations[0].amountCents).toBe(856);
  });

  it("Incidencia con revisit_count=0 asume 1 visita real y lo señala", () => {
    const { obligations, issues } = computeIsdinObligations(vinyl({ status: "Incidencia", revisitCount: 0, incidentOpenedAt: "2026-07-01" }));
    expect(obligations).toHaveLength(1);
    expect(issues.some((i) => i.description.includes("revisit_count=0"))).toBe(true);
  });
});

describe("Identidad estable e idempotencia de claves", () => {
  it("6/9. El mismo estado produce exactamente las mismas claves (sin importe/fecha en la clave)", () => {
    const v = vinyl({ status: "Incidencia", revisitCount: 2, incidentOpenedAt: "2026-07-01" });
    const first = computeIsdinObligations(v).obligations.map((o) => o.key);
    const second = computeIsdinObligations({ ...v, basePaymentEur: 55, incidentPaymentDate: "2026-07-02" }).obligations.map((o) => o.key);
    expect(first).toEqual(second); // cambiar importe/fecha NO cambia la identidad
    expect(first.join("|")).not.toMatch(/8[.,]56|2026/);
  });

  it("7. Subir revisitas de 2 a 3 añade únicamente la clave :3", () => {
    const base = vinyl({ status: "Incidencia", revisitCount: 2, incidentOpenedAt: "2026-07-01" });
    const before = new Set(computeIsdinObligations(base).obligations.map((o) => o.key));
    const after = computeIsdinObligations({ ...base, revisitCount: 3 }).obligations.map((o) => o.key);
    const added = after.filter((k) => !before.has(k));
    expect(added).toEqual(["isdin:VIN-001:failed_visit:3"]);
  });

  it("8. Finalizar dos veces produce una única obligación de instalación (misma clave)", () => {
    const v = vinyl({ status: "Finalizado", revisitCount: 1, incidentOpenedAt: "2026-07-01" });
    const runA = computeIsdinObligations(v).obligations.filter((o) => o.type === "installation");
    const runB = computeIsdinObligations(v).obligations.filter((o) => o.type === "installation");
    expect(runA).toHaveLength(1);
    expect(runA[0].key).toBe(runB[0].key);
  });

  it("Bajar el contador no elimina claves ya emitidas (se detecta como divergencia)", () => {
    const three = computeIsdinObligations(vinyl({ status: "Incidencia", revisitCount: 3, incidentOpenedAt: "2026-07-01" }));
    const two = computeIsdinObligations(vinyl({ status: "Incidencia", revisitCount: 2, incidentOpenedAt: "2026-07-01" }));
    const missing = three.obligations.map((o) => o.key).filter((k) => !two.obligations.some((o) => o.key === k));
    // El motor calcula el estado deseado; el ledger (fase 2) convierte esta
    // diferencia en incidencia de conciliación/anulación, nunca en borrado.
    expect(missing).toEqual(["isdin:VIN-001:failed_visit:3"]);
  });
});

describe("18. Fechas ausentes bloquean el pago (no se inventa la fecha actual)", () => {
  it("visita fallida sin fecha de evento queda bloqueada", () => {
    const { obligations } = computeIsdinObligations(
      vinyl({ status: "Incidencia", revisitCount: 1, incidentPaymentDate: null, incidentOpenedAt: null, incidentPaymentWeek: "S27" })
    );
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_event_date");
    expect(obligations[0].period).toBeNull();
  });

  it("servicio Validado sin validated_at queda bloqueado con motivo explícito", () => {
    const service: ServiceInput = {
      id: "srv1",
      status: "Validado",
      paymentType: "Puntos",
      validatedAt: null,
      hourlyRateEur: null,
      hoursWorked: null,
      workerId: "w1",
      workerName: "Ana",
      points: [{ id: "p1", feeEur: 30, originalFeeEur: null, incidentFeeEur: null, pointStatus: "Finalizado", incidentStatus: null, incidentResolvedAt: null }]
    };
    const { obligations, issues } = computeServiceObligations(service);
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_validated_at");
    expect(issues.some((i) => i.description.includes("sin validated_at"))).toBe(true);
  });

  it("servicio en estado no pagable queda bloqueado", () => {
    const service: ServiceInput = {
      id: "srv2",
      status: "Asignado",
      paymentType: "Puntos",
      validatedAt: "2026-07-01",
      hourlyRateEur: null,
      hoursWorked: null,
      workerId: null,
      workerName: null,
      points: [{ id: "p1", feeEur: 30, originalFeeEur: null, incidentFeeEur: null, pointStatus: "Finalizado", incidentStatus: null, incidentResolvedAt: null }]
    };
    const { obligations } = computeServiceObligations(service);
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("not_payable_status");
  });
});

describe("17. Redondeo e importes inválidos", () => {
  it("redondea half-up a dos decimales (regla documentada)", () => {
    expect(eurosToCents(8.555)).toBe(856);
    expect(eurosToCents(1.005)).toBe(101);
    expect(eurosToCents(40.614)).toBe(4061);
    expect(eurosToCents(40.615)).toBe(4062);
  });

  it("parsea formatos españoles e internacionales sin convertir errores en cero", () => {
    expect(parseEurToCents("8,56")).toBe(856);
    expect(parseEurToCents("8.56")).toBe(856);
    expect(parseEurToCents("1.234,56")).toBe(123456);
    expect(parseEurToCents("1,234.56")).toBe(123456);
    expect(parseEurToCents("40 €")).toBe(4000);
    expect(() => parseEurToCents("")).toThrow(MoneyError);
    expect(() => parseEurToCents("abc")).toThrow(MoneyError);
    expect(() => parseEurToCents(Number.NaN)).toThrow(MoneyError);
  });

  it("un importe original inválido bloquea la obligación en vez de pagar 0 silencioso", () => {
    const { obligations } = computeIsdinObligations(vinyl({ status: "Finalizado", basePaymentEur: Number.NaN }));
    const installation = obligations.find((o) => o.type === "installation")!;
    expect(installation.payable).toBe(false);
    expect(installation.blockedReasons).toContain("invalid_amount");
  });
});

describe("Grandes campañas: visita fallida separada del pago original", () => {
  const basePoint = {
    id: "pt1",
    campaignId: "c1",
    feeEur: 50,
    originalFeeEur: 50,
    incidentFeeEur: null,
    incidentStatus: null,
    incidentResolvedAt: null,
    validatedAt: "2026-07-05",
    finishedAt: "2026-07-05",
    workerId: "w1",
    workerName: "Mai"
  };

  it("incidencia activa: solo la visita fallida (8,56), sin original", () => {
    const { obligations } = computeBigCampaignPointObligations({ ...basePoint, pointStatus: "Incidencia" });
    expect(obligations).toHaveLength(1);
    expect(obligations[0].type).toBe("failed_visit");
    expect(obligations[0].amountCents).toBe(856);
  });

  it("incidencia resuelta: visita fallida + original como obligaciones SEPARADAS", () => {
    const { obligations } = computeBigCampaignPointObligations({ ...basePoint, pointStatus: "Finalizado", incidentResolvedAt: "2026-07-06" });
    expect(obligations.map((o) => o.type).sort()).toEqual(["failed_visit", "installation"]);
    expect(summarize(obligations).totalCents).toBe(856 + 5000);
  });

  it("finalizado sin fecha alguna queda bloqueado, no fechado a hoy", () => {
    const { obligations } = computeBigCampaignPointObligations({ ...basePoint, pointStatus: "Finalizado", validatedAt: null, finishedAt: null });
    const installation = obligations.find((o) => o.type === "installation")!;
    expect(installation.payable).toBe(false);
    expect(installation.blockedReasons).toContain("missing_event_date");
  });
});
