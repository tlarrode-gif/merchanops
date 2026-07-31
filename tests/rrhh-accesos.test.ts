/**
 * Pruebas de la lógica pura de ACCESOS A CENTRO de RR.HH.
 *
 * Lo que se vigila aquí es el "texto gris" del diseño: cuántas solicitudes salen
 * de marcar unos chips de centros y hasta cuándo hay plazo para pedirlas. Los
 * textos se comparan LITERALES contra el diseño a propósito: si alguien cambia
 * una palabra, una flecha o un punto medio, esto se pone rojo.
 *
 * "Hoy" siempre se pasa por parámetro: ninguna prueba puede depender del día en
 * que se ejecute.
 */
import { describe, expect, it } from "vitest";
import {
  accesosNecesarios,
  esConcedidoNoConsumido,
  estadoDePlazo,
  estadoInicialAcceso,
  exigeMotivoAcceso,
  fechaLimiteSolicitud,
  puedeTransicionarAcceso,
  textoSolicitudAcceso
} from "@/lib/rrhh/accesos";
import { Cadena, Centro, SolicitudAcceso } from "@/lib/rrhh/tipos";

function cadena(overrides: Partial<Cadena> = {}): Cadena {
  return {
    id: "cad-1",
    nombre: "Alcampo",
    modo_tramite: "centro",
    lead_time_dias: 2,
    activa: true,
    ...overrides
  };
}

function centro(overrides: Partial<Centro> = {}): Centro {
  return {
    id: "cen-1",
    cadena_id: "cad-1",
    codigo: "A-001",
    nombre: "Alcampo Sanchinarro",
    activo: true,
    ...overrides
  };
}

/** Tres centros distintos de la misma cadena, en el orden en que los marca el gestor. */
function tresCentros(): Centro[] {
  return [
    centro({ id: "cen-1", nombre: "Alcampo Sanchinarro" }),
    centro({ id: "cen-2", nombre: "Alcampo La Vaguada" }),
    centro({ id: "cen-3", nombre: "Alcampo Alcorcón" })
  ];
}

function solicitud(overrides: Partial<SolicitudAcceso> = {}): SolicitudAcceso {
  return {
    id: "acc-1",
    codigo: "ACC-260731-001",
    worker_id: "w1",
    worker_nombre: "Manuel",
    cadena_id: "cad-1",
    cadena_nombre: "Alcampo",
    centro_id: "cen-1",
    centro_nombre: "Alcampo Sanchinarro",
    fecha_trabajo: "2026-07-28",
    fecha_limite: "2026-07-26",
    origen_tipo: "campana",
    origen_id: "gc-1",
    trabajo: "Vuelta al cole",
    estado: "concedido",
    solicitada_por: "u1",
    solicitada_por_nombre: "Gestora",
    concedido_at: "2026-07-27T09:00:00Z",
    consumido_at: null,
    motivo: null,
    created_at: "2026-07-26T08:00:00Z",
    updated_at: null,
    version: 1,
    ...overrides
  };
}

describe("Accesos necesarios según el modo de trámite", () => {
  it("modo centro con un solo centro genera un acceso a ese centro", () => {
    const accesos = accesosNecesarios(cadena({ modo_tramite: "centro" }), [centro()]);
    expect(accesos).toEqual([{ centro_id: "cen-1", centro_nombre: "Alcampo Sanchinarro" }]);
  });

  it("modo centro con tres centros genera tres accesos, en el orden recibido", () => {
    const accesos = accesosNecesarios(cadena({ modo_tramite: "centro" }), tresCentros());
    expect(accesos).toHaveLength(3);
    expect(accesos.map(acceso => acceso.centro_id)).toEqual(["cen-1", "cen-2", "cen-3"]);
    expect(accesos.map(acceso => acceso.centro_nombre)).toEqual([
      "Alcampo Sanchinarro",
      "Alcampo La Vaguada",
      "Alcampo Alcorcón"
    ]);
  });

  it("modo cadena con cuatro centros genera UN solo acceso a toda la cadena", () => {
    const centros = [...tresCentros(), centro({ id: "cen-4", nombre: "Alcampo Getafe" })];
    const accesos = accesosNecesarios(cadena({ modo_tramite: "cadena", nombre: "Media Markt" }), centros);
    expect(accesos).toEqual([{ centro_id: null, centro_nombre: null }]);
  });

  it("modo cadena con un único centro sigue siendo un acceso a toda la cadena", () => {
    const accesos = accesosNecesarios(cadena({ modo_tramite: "cadena" }), [centro()]);
    expect(accesos).toEqual([{ centro_id: null, centro_nombre: null }]);
  });

  it("sin centros marcados no hay nada que solicitar, en cualquiera de los dos modos", () => {
    expect(accesosNecesarios(cadena({ modo_tramite: "centro" }), [])).toEqual([]);
    expect(accesosNecesarios(cadena({ modo_tramite: "cadena" }), [])).toEqual([]);
  });

  it("el mismo centro marcado dos veces es un único acceso", () => {
    const accesos = accesosNecesarios(cadena({ modo_tramite: "centro" }), [centro(), centro(), centro({ id: "cen-2" })]);
    expect(accesos.map(acceso => acceso.centro_id)).toEqual(["cen-1", "cen-2"]);
  });
});

describe("Fecha límite de la solicitud", () => {
  it("con lead time 0 el límite es el propio día de trabajo", () => {
    expect(fechaLimiteSolicitud("2026-07-31", 0)).toBe("2026-07-31");
  });

  it("con lead time 2 se piden dos días antes", () => {
    expect(fechaLimiteSolicitud("2026-07-31", 2)).toBe("2026-07-29");
  });

  it("el lead time cruza el fin de mes sin inventarse días", () => {
    expect(fechaLimiteSolicitud("2026-08-02", 5)).toBe("2026-07-28");
    expect(fechaLimiteSolicitud("2026-03-01", 1)).toBe("2026-02-28");
  });

  it("el lead time cruza el fin de año y el 29 de febrero de un bisiesto", () => {
    expect(fechaLimiteSolicitud("2027-01-03", 5)).toBe("2026-12-29");
    expect(fechaLimiteSolicitud("2028-03-01", 1)).toBe("2028-02-29");
  });

  it("una fecha de trabajo ilegible no produce límite", () => {
    expect(fechaLimiteSolicitud("", 3)).toBeNull();
    expect(fechaLimiteSolicitud("mañana", 3)).toBeNull();
    expect(fechaLimiteSolicitud("2026-02-30", 3)).toBeNull();
  });

  it("un lead time roto o negativo se trata como 0 y nunca adelanta el plazo", () => {
    expect(fechaLimiteSolicitud("2026-07-31", -4)).toBe("2026-07-31");
    expect(fechaLimiteSolicitud("2026-07-31", Number.NaN)).toBe("2026-07-31");
  });
});

describe("Plazo y estado inicial de la solicitud", () => {
  it("el propio día límite todavía está EN plazo", () => {
    expect(estadoDePlazo("2026-07-29", "2026-07-29")).toBe("en_plazo");
    expect(estadoInicialAcceso("2026-07-31", 2, "2026-07-29")).toBe("pendiente");
  });

  it("un límite que venció ayer está fuera de plazo", () => {
    expect(estadoDePlazo("2026-07-29", "2026-07-30")).toBe("fuera_de_plazo");
    expect(estadoInicialAcceso("2026-07-31", 2, "2026-07-30")).toBe("fuera_de_plazo");
  });

  it("con margen de sobra el estado inicial es 'pendiente'", () => {
    expect(estadoDePlazo("2026-07-29", "2026-07-20")).toBe("en_plazo");
    expect(estadoInicialAcceso("2026-07-31", 2, "2026-07-20")).toBe("pendiente");
  });

  it("sin fecha de trabajo legible no hay plazo que incumplir", () => {
    expect(estadoDePlazo(null, "2026-07-31")).toBe("en_plazo");
    expect(estadoInicialAcceso("sin fecha", 7, "2026-07-31")).toBe("pendiente");
  });

  it("'hoy' tiene valor por defecto y no hace falta pasarlo", () => {
    expect(estadoDePlazo("2999-12-31")).toBe("en_plazo");
    expect(estadoDePlazo("2000-01-01")).toBe("fuera_de_plazo");
  });
});

describe("Accesos concedidos que se quedan sin consumir", () => {
  it("sí: concedido, sin consumir y con el día de trabajo ya pasado", () => {
    expect(esConcedidoNoConsumido(solicitud({ fecha_trabajo: "2026-07-28" }), "2026-07-31")).toBe(true);
  });

  it("no: se consumió", () => {
    const consumida = solicitud({ fecha_trabajo: "2026-07-28", consumido_at: "2026-07-28T07:30:00Z" });
    expect(esConcedidoNoConsumido(consumida, "2026-07-31")).toBe(false);
  });

  it("no: el día de trabajo es hoy o está por llegar", () => {
    expect(esConcedidoNoConsumido(solicitud({ fecha_trabajo: "2026-07-31" }), "2026-07-31")).toBe(false);
    expect(esConcedidoNoConsumido(solicitud({ fecha_trabajo: "2026-08-04" }), "2026-07-31")).toBe(false);
  });

  it("no: nunca llegó a concederse", () => {
    const sinConceder = solicitud({ fecha_trabajo: "2026-07-28", estado: "pendiente", concedido_at: null });
    expect(esConcedidoNoConsumido(sinConceder, "2026-07-31")).toBe(false);
  });
});

describe("Texto calculado de la solicitud de acceso", () => {
  it("sin centros marcados invita a marcarlos", () => {
    const resultado = textoSolicitudAcceso(cadena(), [], "2026-07-31", "2026-07-28");
    expect(resultado.texto).toBe("Selecciona centros para calcular la solicitud");
    expect(resultado.tono).toBe("vacio");
  });

  it("con centros pero sin fecha de trabajo pide la fecha", () => {
    const resultado = textoSolicitudAcceso(cadena(), tresCentros(), "", "2026-07-28");
    expect(resultado.texto).toBe("Indica la fecha de trabajo");
    expect(resultado.tono).toBe("vacio");
  });

  it("modo centro: «Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07»", () => {
    const resultado = textoSolicitudAcceso(
      cadena({ nombre: "Alcampo", modo_tramite: "centro", lead_time_dias: 2 }),
      tresCentros(),
      "2026-07-31",
      "2026-07-28"
    );
    expect(resultado.texto).toBe("Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07");
    expect(resultado.tono).toBe("neutro");
  });

  it("modo cadena: «Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07»", () => {
    const centros = [...tresCentros(), centro({ id: "cen-4", nombre: "Media Markt Getafe" })];
    const resultado = textoSolicitudAcceso(
      cadena({ nombre: "Media Markt", modo_tramite: "cadena", lead_time_dias: 0 }),
      centros,
      "2026-07-31",
      "2026-07-28"
    );
    expect(resultado.texto).toBe("Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07");
    expect(resultado.tono).toBe("neutro");
  });

  it("plazo vencido: «El Corte Inglés · plazo vencido el 25/07» en rojo", () => {
    const resultado = textoSolicitudAcceso(
      cadena({ nombre: "El Corte Inglés", modo_tramite: "centro", lead_time_dias: 7 }),
      tresCentros(),
      "2026-08-01",
      "2026-07-31"
    );
    expect(resultado.texto).toBe("El Corte Inglés · plazo vencido el 25/07");
    expect(resultado.tono).toBe("error");
  });

  it("singular correcto en modo centro: «1 centro → 1 acceso»", () => {
    const resultado = textoSolicitudAcceso(
      cadena({ nombre: "Alcampo", modo_tramite: "centro", lead_time_dias: 2 }),
      [centro()],
      "2026-07-31",
      "2026-07-28"
    );
    expect(resultado.texto).toBe("Alcampo tramita por centro · 1 centro → 1 acceso · pedir antes del 29/07");
  });

  it("singular correcto en modo cadena: «1 centro → 1 acceso»", () => {
    const resultado = textoSolicitudAcceso(
      cadena({ nombre: "Media Markt", modo_tramite: "cadena", lead_time_dias: 0 }),
      [centro()],
      "2026-07-31",
      "2026-07-28"
    );
    expect(resultado.texto).toBe("Media Markt tramita por cadena · 1 centro → 1 acceso · pedir antes del 31/07");
  });

  it("el día límite todavía cuenta como en plazo: texto neutro, no rojo", () => {
    const resultado = textoSolicitudAcceso(
      cadena({ nombre: "Alcampo", modo_tramite: "centro", lead_time_dias: 2 }),
      tresCentros(),
      "2026-07-31",
      "2026-07-29"
    );
    expect(resultado.texto).toBe("Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07");
    expect(resultado.tono).toBe("neutro");
  });
});

describe("Transiciones y motivo obligatorio", () => {
  it("respeta la tabla de transiciones de tipos.ts", () => {
    expect(puedeTransicionarAcceso("pendiente", "solicitado")).toBe(true);
    expect(puedeTransicionarAcceso("pendiente", "concedido_no_consumido")).toBe(false);
    expect(puedeTransicionarAcceso("fuera_de_plazo", "solicitado")).toBe(true);
    expect(puedeTransicionarAcceso("solicitado", "concedido")).toBe(true);
    expect(puedeTransicionarAcceso("concedido", "concedido_no_consumido")).toBe(true);
    expect(puedeTransicionarAcceso("concedido_no_consumido", "concedido")).toBe(true);
    expect(puedeTransicionarAcceso("denegado", "concedido")).toBe(false);
    expect(puedeTransicionarAcceso("cancelado", "pendiente")).toBe(false);
  });

  it("solo los cierres en negativo exigen motivo", () => {
    expect(exigeMotivoAcceso("denegado")).toBe(true);
    expect(exigeMotivoAcceso("cancelado")).toBe(true);
    expect(exigeMotivoAcceso("concedido")).toBe(false);
    expect(exigeMotivoAcceso("pendiente")).toBe(false);
    expect(exigeMotivoAcceso("fuera_de_plazo")).toBe(false);
  });
});
