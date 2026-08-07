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

// ---------------------------------------------------------------------------
// v11.5 · Campañas por horas y kilometraje
// ---------------------------------------------------------------------------

describe("campaña con pago por HORAS", () => {
  const porHoras = (partial: Partial<CampanaPuntoInput> = {}) =>
    punto({ importeEur: null, pagoPorHoras: true, tarifaHoraEur: 12, horas: 7.5, ...partial });

  it("un punto completado se paga horas x tarifa, no por el importe del punto", () => {
    const { obligations } = computeCampanaPuntoObligations(porHoras());
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({
      key: "gran_campana:p1:hours",
      type: "hours",
      amountCents: 9000, // 7,5 h x 12 €
      payable: true
    });
  });

  it("la clave de horas es distinta de la de instalación: cambiar de modo no reescribe la línea vieja", () => {
    // Si compartieran clave, activar «pago por horas» en una campaña ya volcada
    // cambiaría en silencio el importe de una obligación con otro concepto.
    const horas = computeCampanaPuntoObligations(porHoras()).obligations[0].key;
    const puntos = computeCampanaPuntoObligations(punto()).obligations[0].key;
    expect(horas).not.toBe(puntos);
  });

  it("sin horas reportadas la obligación existe pero queda BLOQUEADA", () => {
    const { obligations } = computeCampanaPuntoObligations(porHoras({ horas: null, horasError: "sin_datos" }));
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_hours");
    expect(obligations[0].amountCents).toBe(0);
  });

  it("un turno incoherente bloquea con su propio motivo, no se aproxima", () => {
    const { obligations } = computeCampanaPuntoObligations(porHoras({ horas: null, horasError: "salida_anterior_a_entrada" }));
    expect(obligations[0].blockedReasons).toContain("invalid_hours");
    expect(obligations[0].amountCents).toBe(0);
  });

  it("sin tarifa configurada bloquea: 'gratis' no es lo mismo que 'sin configurar'", () => {
    const { obligations } = computeCampanaPuntoObligations(porHoras({ tarifaHoraEur: null }));
    expect(obligations[0].payable).toBe(false);
    expect(obligations[0].blockedReasons).toContain("missing_hourly_rate");
  });

  it("una tarifa de 0 € SÍ es una tarifa: no bloquea, paga 0", () => {
    const { obligations } = computeCampanaPuntoObligations(porHoras({ tarifaHoraEur: 0 }));
    expect(obligations[0].payable).toBe(true);
    expect(obligations[0].amountCents).toBe(0);
  });

  it("las visitas fallidas se siguen pagando a su tarifa única", () => {
    const { obligations } = computeCampanaPuntoObligations(
      porHoras({ estado: "incidencia", incidencias: [{ id: "i1", estado: "abierta", fecha: "2026-02-03" }] })
    );
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({ type: "failed_visit", amountCents: FAILED_VISIT_FEE_CENTS });
  });
});

describe("kilometraje", () => {
  const conKm = (partial: Partial<CampanaPuntoInput> = {}) =>
    punto({ pagoKilometraje: true, tarifaKmEur: 0.26, kilometros: 120, ...partial });

  it("genera una obligación PROPIA, aparte del pago del trabajo", () => {
    const { obligations } = computeCampanaPuntoObligations(conKm());
    expect(obligations.map(o => o.type).sort()).toEqual(["installation", "mileage"]);
    const km = obligations.find(o => o.type === "mileage")!;
    expect(km.key).toBe("gran_campana:p1:mileage");
    expect(km.amountCents).toBe(3120); // 120 km x 0,26 €
    expect(km.payable).toBe(true);
  });

  it("se paga también cuando la visita fue fallida: el desplazamiento se hizo igual", () => {
    const { obligations } = computeCampanaPuntoObligations(
      conKm({ estado: "incidencia", incidencias: [{ id: "i1", estado: "abierta", fecha: "2026-02-03" }] })
    );
    expect(obligations.map(o => o.type).sort()).toEqual(["failed_visit", "mileage"]);
  });

  it("sin kilómetros reportados no se emite ninguna línea: 0 € solo ensucia Pagos", () => {
    const { obligations } = computeCampanaPuntoObligations(conKm({ kilometros: null }));
    expect(obligations.some(o => o.type === "mileage")).toBe(false);
  });

  it("sin la opción activada no se paga aunque el punto traiga kilómetros", () => {
    const { obligations } = computeCampanaPuntoObligations(punto({ kilometros: 120, tarifaKmEur: 0.26 }));
    expect(obligations.some(o => o.type === "mileage")).toBe(false);
  });

  it("sin tarifa por kilómetro queda bloqueado con su motivo", () => {
    const { obligations } = computeCampanaPuntoObligations(conKm({ tarifaKmEur: null }));
    const km = obligations.find(o => o.type === "mileage")!;
    expect(km.payable).toBe(false);
    expect(km.blockedReasons).toContain("missing_km_rate");
  });

  it("un punto cancelado no paga ni kilometraje", () => {
    const { obligations } = computeCampanaPuntoObligations(conKm({ estado: "cancelado" }));
    expect(obligations).toHaveLength(0);
  });

  it("redondea UNA vez sobre el total, no kilómetro a kilómetro", () => {
    // 33 km x 0,265 € = 8,745 € → 875 céntimos. Redondeando la tarifa primero
    // (0,27 €) saldrían 891: casi dos céntimos de más por punto.
    const { obligations } = computeCampanaPuntoObligations(conKm({ kilometros: 33, tarifaKmEur: 0.265 }));
    expect(obligations.find(o => o.type === "mileage")!.amountCents).toBe(875);
  });
});

describe("puntoRowToEngineInput · configuración de la campaña", () => {
  it("resuelve las horas de las marcas horarias de la fila", () => {
    const entrada = puntoRowToEngineInput(
      { id: "abc", campana_id: "c", estado: "completado", hora_entrada: "08:00:00", hora_salida: "16:30:00", kilometros: "40.5" },
      [],
      { pago_por_horas: true, tarifa_hora: 10, pago_kilometraje: true, tarifa_km: 0.26 }
    );
    expect(entrada).toMatchObject({ horas: 8.5, kilometros: 40.5, pagoPorHoras: true, tarifaHoraEur: 10 });
    const { obligations } = computeCampanaPuntoObligations(entrada);
    expect(obligations.find(o => o.type === "hours")!.amountCents).toBe(8500);
    expect(obligations.find(o => o.type === "mileage")!.amountCents).toBe(1053);
  });

  it("sin configuración se comporta como antes de v11.5: paga el importe del punto", () => {
    const entrada = puntoRowToEngineInput({ id: "abc", campana_id: "c", estado: "completado", importe: 25, fecha_visita: "2026-02-09" });
    const { obligations } = computeCampanaPuntoObligations(entrada);
    expect(obligations).toHaveLength(1);
    expect(obligations[0]).toMatchObject({ type: "installation", amountCents: 2500 });
  });

  it("traslada el motivo del turno incoherente hasta el bloqueo del pago", () => {
    const entrada = puntoRowToEngineInput(
      { id: "abc", campana_id: "c", estado: "completado", fecha_visita: "2026-02-09", hora_entrada: "22:00", hora_salida: "06:00" },
      [],
      { pago_por_horas: true, tarifa_hora: 10 }
    );
    expect(entrada.horasError).toBe("salida_anterior_a_entrada");
    expect(computeCampanaPuntoObligations(entrada).obligations[0].blockedReasons).toContain("invalid_hours");
  });
});
