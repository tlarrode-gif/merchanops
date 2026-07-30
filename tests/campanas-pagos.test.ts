import { describe, expect, it } from "vitest";
import { FAILED_VISIT_FEE_CENTS } from "@/lib/payments/constants";
import { computeCampanaPuntoObligations } from "@/lib/payments/engine";
import { puntoRowToEngineInput } from "@/lib/payments/campana-obligations";
import { CampanaPuntoInput } from "@/lib/payments/types";

function punto(partial: Partial<CampanaPuntoInput> = {}): CampanaPuntoInput {
  return {
    id: "p1",
    campaignId: "c1",
    estado: "completado",
    importeEur: 25,
    fechaInstalacion: "2026-02-09",
    workerId: "w3",
    workerName: "GOMIS DUYOS, ALFONSO",
    ...partial
  };
}

describe("obligaciones de un punto de gran campaña", () => {
  it("un punto completado genera un pago de instalación al instalador", () => {
    const { obligations } = computeCampanaPuntoObligations(punto());
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({
      key: "gran_campana:p1:installation",
      origin: "gran_campana",
      type: "installation",
      amountCents: 2500,
      eventDate: "2026-02-09",
      period: "2026-02",
      workerName: "GOMIS DUYOS, ALFONSO",
      payable: true
    });
    expect(obligations[0].blockedReasons).toEqual([]);
  });

  it("sin importe la obligación existe pero queda bloqueada", () => {
    const { obligations } = computeCampanaPuntoObligations(punto({ importeEur: null }));
    expect(obligations).toHaveLength(1);
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("invalid_amount");
    expect(obligations[0].amountCents).toBe(0);
  });

  it("sin fecha de instalación queda bloqueada y NO se inventa la fecha de hoy", () => {
    const { obligations } = computeCampanaPuntoObligations(punto({ fechaInstalacion: null }));
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_event_date");
    expect(obligations[0].eventDate).toBeNull();
    expect(obligations[0].period).toBeNull();
  });

  it("sin instalador queda bloqueada y nunca se paga al gestor por error", () => {
    const { obligations } = computeCampanaPuntoObligations(punto({ workerId: null, workerName: null }));
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_worker");
    expect(obligations[0].workerName).toBeNull();
  });

  it("acumula todos los motivos de bloqueo a la vez", () => {
    const { obligations } = computeCampanaPuntoObligations(
      punto({ importeEur: null, fechaInstalacion: null, workerId: null, workerName: null })
    );
    expect(obligations[0].blockedReasons.sort()).toEqual(["invalid_amount", "missing_event_date", "missing_worker"]);
  });

  it("un importe negativo bloquea en vez de pagar", () => {
    const { obligations } = computeCampanaPuntoObligations(punto({ importeEur: -10 }));
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("invalid_amount");
  });

  it("un punto cancelado no genera ningún pago", () => {
    expect(computeCampanaPuntoObligations(punto({ estado: "cancelado" })).obligations).toEqual([]);
    // Ni siquiera la visita fallida de sus incidencias.
    const conIncidencia = computeCampanaPuntoObligations(
      punto({ estado: "cancelado", incidencias: [{ id: "i1", estado: "abierta", fecha: "2026-02-01" }] })
    );
    expect(conIncidencia.obligations).toEqual([]);
  });

  it("un punto pendiente sin incidencias no genera nada", () => {
    expect(computeCampanaPuntoObligations(punto({ estado: "pendiente" })).obligations).toEqual([]);
  });
});

describe("visitas fallidas de gran campaña", () => {
  it("cada incidencia genera una visita fallida con la tarifa única", () => {
    const { obligations } = computeCampanaPuntoObligations(
      punto({ estado: "incidencia", incidencias: [{ id: "i1", estado: "abierta", fecha: "2026-02-03" }] })
    );
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({
      key: "gran_campana:p1:failed_visit:i1",
      type: "failed_visit",
      amountCents: FAILED_VISIT_FEE_CENTS,
      eventDate: "2026-02-03",
      payable: true
    });
    expect(FAILED_VISIT_FEE_CENTS).toBe(856);
  });

  it("dos desplazamientos fallidos son dos pagos con claves distintas", () => {
    const { obligations } = computeCampanaPuntoObligations(
      punto({
        estado: "incidencia",
        incidencias: [
          { id: "i1", estado: "resuelta", fecha: "2026-02-03" },
          { id: "i2", estado: "abierta", fecha: "2026-02-10" }
        ]
      })
    );
    expect(obligations.map(o => o.key)).toEqual([
      "gran_campana:p1:failed_visit:i1",
      "gran_campana:p1:failed_visit:i2"
    ]);
  });

  it("una incidencia resuelta NO paga la instalación hasta que el punto está completado", () => {
    // En este módulo resolver una incidencia devuelve el punto a «pendiente»: si aquí se
    // pagara la instalación, se cobraría un punto que todavía no se ha ejecutado.
    const pendiente = computeCampanaPuntoObligations(
      punto({ estado: "pendiente", incidencias: [{ id: "i1", estado: "resuelta", fecha: "2026-02-03" }] })
    );
    expect(pendiente.obligations.map(o => o.type)).toEqual(["failed_visit"]);

    const completado = computeCampanaPuntoObligations(
      punto({ estado: "completado", incidencias: [{ id: "i1", estado: "resuelta", fecha: "2026-02-03" }] })
    );
    expect(completado.obligations.map(o => o.type)).toEqual(["failed_visit", "installation"]);
  });

  it("la visita fallida sin trabajador también queda bloqueada", () => {
    const { obligations } = computeCampanaPuntoObligations(
      punto({ estado: "incidencia", workerId: null, workerName: null, incidencias: [{ id: "i1", estado: "abierta", fecha: "2026-02-03" }] })
    );
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_worker");
  });

  it("las claves son estables: recalcular no duplica obligaciones", () => {
    const entrada = punto({ incidencias: [{ id: "i1", estado: "abierta", fecha: "2026-02-03" }] });
    const a = computeCampanaPuntoObligations(entrada).obligations.map(o => o.key);
    const b = computeCampanaPuntoObligations({ ...entrada, importeEur: 99, fechaInstalacion: "2026-03-01" }).obligations.map(o => o.key);
    // La clave no lleva importe ni fecha: una corrección ACTUALIZA la misma línea.
    expect(a).toEqual(b);
  });
});

describe("puntoRowToEngineInput", () => {
  it("traduce una fila real de puntos_venta_campana", () => {
    const entrada = puntoRowToEngineInput(
      {
        id: "abc",
        campana_id: "camp",
        estado: "completado",
        importe: "25.00",
        fecha_visita: "2026-02-09T00:00:00+00:00",
        instalador_id: "w3",
        instalador_nombre: "GOMIS DUYOS, ALFONSO",
        gestor_nombre: "MAI"
      },
      [{ id: "i1", punto_id: "abc", estado: "resuelta", created_at: "2026-02-01T10:00:00Z", resolved_at: "2026-02-05T10:00:00Z" }]
    );
    expect(entrada).toMatchObject({
      id: "abc",
      estado: "completado",
      importeEur: 25,
      workerId: "w3",
      workerName: "GOMIS DUYOS, ALFONSO"
    });
    // Se queda la fecha de resolución de la incidencia, no la de apertura.
    expect(entrada.incidencias).toEqual([{ id: "i1", estado: "resuelta", fecha: "2026-02-05T10:00:00Z" }]);
    // El beneficiario NUNCA es el gestor.
    expect(JSON.stringify(entrada)).not.toContain("MAI");
  });

  it("solo se queda con las incidencias de ESE punto", () => {
    const entrada = puntoRowToEngineInput({ id: "abc", campana_id: "c", estado: "completado" }, [
      { id: "i1", punto_id: "abc", estado: "abierta", created_at: "2026-02-01" },
      { id: "i2", punto_id: "otro", estado: "abierta", created_at: "2026-02-01" }
    ]);
    expect(entrada.incidencias?.map(i => i.id)).toEqual(["i1"]);
  });

  it("importe y fecha vacíos llegan como null, no como 0 ni cadena vacía", () => {
    const entrada = puntoRowToEngineInput({ id: "abc", campana_id: "c", estado: "completado", importe: null, fecha_visita: "" });
    expect(entrada.importeEur).toBeNull();
    expect(entrada.fechaInstalacion).toBeNull();
    const { obligations } = computeCampanaPuntoObligations(entrada);
    expect(obligations[0].payable).toBe(false);
  });
});
