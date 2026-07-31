/**
 * Pruebas de la lógica pura de ALTAS de RR.HH.
 *
 * Lo que se vigila aquí es el "texto gris" del diseño: el sistema decide si hace
 * falta un alta nueva, si el trabajo ya está cubierto o si hay que ampliar un alta
 * existente, y lo dice con unas frases concretas. Los textos se comparan LITERALES
 * contra el diseño a propósito: si alguien cambia una palabra, esto se pone rojo.
 */
import { describe, expect, it } from "vitest";
import {
  CECO_SIN_ASIGNAR,
  altasVigentes,
  cubreRango,
  diasEntreFechas,
  estadoSugerido,
  exigeMotivo,
  formateaFechaCorta,
  formateaHoras,
  horasDiaDerivadas,
  hoyISO,
  imputacionesPorCeco,
  interseccionDias,
  normalizaFecha,
  puedeTransicionar,
  rangoDeTrabajos,
  resolverCobertura,
  solapaRango,
  textoResolucion
} from "@/lib/rrhh/altas";
import { AltaLaboral, TrabajoPendiente } from "@/lib/rrhh/tipos";

function trabajo(overrides: Partial<TrabajoPendiente> = {}): TrabajoPendiente {
  return {
    origen_tipo: "campana",
    origen_id: "gc-1",
    worker_id: "w1",
    campana: "Vuelta al cole",
    ceco: "3005",
    fecha_inicio: "2026-07-28",
    fecha_fin: "2026-07-31",
    horas_dia: 4,
    ...overrides
  };
}

function alta(overrides: Partial<AltaLaboral> = {}): AltaLaboral {
  return {
    id: "alta-1",
    worker_id: "w1",
    numero_alta: "18832",
    tipo: "temporal",
    fecha_inicio: "2026-07-20",
    fecha_fin: "2026-07-29",
    ceco: "3005",
    horas_dia: 4,
    estado: "vigente",
    ...overrides
  };
}

const RANGO = { inicio: "2026-07-28", fin: "2026-07-31" };

describe("Fechas: normalización y formato corto", () => {
  it("recorta un timestamp a YYYY-MM-DD y deja intacta una fecha ya ISO", () => {
    expect(normalizaFecha("2026-07-28T10:35:00.000Z")).toBe("2026-07-28");
    expect(normalizaFecha("2026-07-28")).toBe("2026-07-28");
    expect(normalizaFecha("  2026-07-28  ")).toBe("2026-07-28");
    expect(normalizaFecha(new Date(Date.UTC(2026, 6, 28)))).toBe("2026-07-28");
  });

  it("devuelve null cuando no hay una fecha real detrás", () => {
    expect(normalizaFecha(null)).toBeNull();
    expect(normalizaFecha(undefined)).toBeNull();
    expect(normalizaFecha("")).toBeNull();
    expect(normalizaFecha("   ")).toBeNull();
    expect(normalizaFecha("28/07/2026")).toBeNull();
    expect(normalizaFecha("pendiente")).toBeNull();
    expect(normalizaFecha("2026-02-30")).toBeNull(); // día que no existe
    expect(normalizaFecha("2026-13-01")).toBeNull(); // mes que no existe
    expect(normalizaFecha(new Date("no-es-fecha"))).toBeNull();
  });

  it("formatea en DD/MM y devuelve cadena vacía si no hay fecha", () => {
    expect(formateaFechaCorta("2026-07-28")).toBe("28/07");
    expect(formateaFechaCorta("2026-07-31T23:00:00Z")).toBe("31/07");
    expect(formateaFechaCorta("2026-01-05")).toBe("05/01");
    expect(formateaFechaCorta(null)).toBe("");
    expect(formateaFechaCorta("basura")).toBe("");
  });

  it("cuenta días entre fechas y no depende del reloj para saber «hoy»", () => {
    expect(diasEntreFechas("2026-07-28", "2026-07-31")).toBe(3);
    expect(diasEntreFechas("2026-07-31", "2026-07-28")).toBe(-3);
    expect(diasEntreFechas("2026-07-28", "basura")).toBe(0);
    // «Hoy» es el día CIVIL en España, no el día UTC: a las 22:00 UTC del 31 de
    // julio en Madrid ya es la medianoche del 1 de agosto, y así lo cuenta
    // también la base (now() at time zone 'Europe/Madrid', v10_7).
    expect(hoyISO(new Date(Date.UTC(2026, 6, 31, 22, 0, 0)))).toBe("2026-08-01");
    // A las 21:59 UTC todavía es 31 de julio en Madrid.
    expect(hoyISO(new Date(Date.UTC(2026, 6, 31, 21, 59, 0)))).toBe("2026-07-31");
  });
});

describe("Horas por día derivadas de las horas totales", () => {
  it("un solo día: todas las horas caen ese día", () => {
    expect(horasDiaDerivadas(6, "2026-07-28", "2026-07-28")).toBe(6);
    expect(horasDiaDerivadas(1.5, "2026-07-28", "2026-07-28")).toBe(1.5);
  });

  it("dos días: 6 h del 28/07 al 29/07 son 3 h/día (el ejemplo del diseño)", () => {
    expect(horasDiaDerivadas(6, "2026-07-28", "2026-07-29")).toBe(3);
    // Cuatro días naturales, extremos incluidos: 12 / 4.
    expect(horasDiaDerivadas(12, "2026-07-28", "2026-07-31")).toBe(3);
  });

  it("un reparto no exacto se redondea a la media hora más cercana", () => {
    expect(horasDiaDerivadas(10, "2026-07-28", "2026-07-30")).toBe(3.5); // 3,33 → 3,5
    expect(horasDiaDerivadas(7, "2026-07-28", "2026-07-29")).toBe(3.5); // exacto
    expect(horasDiaDerivadas(8, "2026-07-28", "2026-07-30")).toBe(2.5); // 2,66 → 2,5
    // Un reparto por debajo de la media hora NO se convierte en cero: un trabajo
    // con horas no tiene jornadas de cero horas.
    expect(horasDiaDerivadas(1, "2026-07-28", "2026-08-01")).toBe(0.5); // 0,2 → 0,5
  });

  it("sin horas no hay reparto: null, undefined, 0 y negativo dan null", () => {
    expect(horasDiaDerivadas(null, "2026-07-28", "2026-07-29")).toBeNull();
    expect(horasDiaDerivadas(undefined, "2026-07-28", "2026-07-29")).toBeNull();
    expect(horasDiaDerivadas(0, "2026-07-28", "2026-07-29")).toBeNull();
    expect(horasDiaDerivadas(-6, "2026-07-28", "2026-07-29")).toBeNull();
    expect(horasDiaDerivadas(Number.NaN, "2026-07-28", "2026-07-29")).toBeNull();
  });

  it("sin fechas legibles no hay calendario que repartir: null", () => {
    expect(horasDiaDerivadas(6, "", "2026-07-29")).toBeNull();
    expect(horasDiaDerivadas(6, "2026-07-28", "")).toBeNull();
    expect(horasDiaDerivadas(6, "28/07/2026", "29/07/2026")).toBeNull();
    expect(horasDiaDerivadas(6, "2026-02-30", "2026-03-02")).toBeNull(); // día que no existe
    expect(horasDiaDerivadas(6, null as unknown as string, null as unknown as string)).toBeNull();
  });

  it("un fin anterior al inicio es un dato incoherente: cuenta como un solo día", () => {
    // Mismo criterio que rangoDeTrabajos, que cierra el rango en el inicio en vez
    // de devolver un intervalo imposible.
    expect(horasDiaDerivadas(6, "2026-07-29", "2026-07-28")).toBe(6);
    expect(horasDiaDerivadas(6, "2026-07-31", "2026-07-01")).toBe(6);
  });

  it("un trabajo largo que cruza el fin de mes cuenta los días naturales de los dos meses", () => {
    // Del 28/07 al 06/08 hay 10 días naturales: 4 de julio + 6 de agosto.
    expect(horasDiaDerivadas(40, "2026-07-28", "2026-08-06")).toBe(4);
    expect(horasDiaDerivadas(45, "2026-07-28", "2026-08-06")).toBe(4.5);
    // Y de un febrero bisiesto a marzo: del 27/02 al 02/03 de 2024 son 5 días.
    expect(horasDiaDerivadas(15, "2024-02-27", "2024-03-02")).toBe(3);
  });

  it("las horas también se leen si llegan como texto numérico desde la base", () => {
    expect(horasDiaDerivadas("6" as unknown as number, "2026-07-28", "2026-07-29")).toBe(3);
    expect(horasDiaDerivadas("" as unknown as number, "2026-07-28", "2026-07-29")).toBeNull();
    expect(horasDiaDerivadas("seis" as unknown as number, "2026-07-28", "2026-07-29")).toBeNull();
  });
});

describe("Horas formateadas para la fila", () => {
  it("entero sin decimales, media hora con coma, y vacío cuando no hay horas", () => {
    expect(formateaHoras(3)).toBe("3 h/día");
    expect(formateaHoras(4.5)).toBe("4,5 h/día");
    expect(formateaHoras(0.5)).toBe("0,5 h/día");
    expect(formateaHoras(null)).toBe("");
    expect(formateaHoras(0)).toBe("");
    expect(formateaHoras(-3)).toBe("");
    expect(formateaHoras(Number.NaN)).toBe("");
  });

  it("encaja con lo que devuelve el cálculo: «3 h/día» en la fila del diseño", () => {
    expect(formateaHoras(horasDiaDerivadas(6, "2026-07-28", "2026-07-29"))).toBe("3 h/día");
    expect(formateaHoras(horasDiaDerivadas(9, "2026-07-28", "2026-07-29"))).toBe("4,5 h/día");
    expect(formateaHoras(horasDiaDerivadas(null, "2026-07-28", "2026-07-29"))).toBe("");
  });
});

describe("Rango de los trabajos marcados", () => {
  it("toma el inicio más temprano y el fin más tardío", () => {
    const rango = rangoDeTrabajos([
      trabajo({ fecha_inicio: "2026-07-29", fecha_fin: "2026-07-31" }),
      trabajo({ fecha_inicio: "2026-07-28", fecha_fin: "2026-07-30" })
    ]);
    expect(rango).toEqual({ inicio: "2026-07-28", fin: "2026-07-31" });
  });

  it("ignora las fechas inválidas o nulas y devuelve null si no queda nada utilizable", () => {
    const conBasura = rangoDeTrabajos([
      trabajo({ fecha_inicio: "sin fecha", fecha_fin: "2026-08-02" }),
      trabajo({ fecha_inicio: "2026-07-28", fecha_fin: "" })
    ]);
    expect(conBasura).toEqual({ inicio: "2026-07-28", fin: "2026-08-02" });

    expect(rangoDeTrabajos([])).toBeNull();
    expect(rangoDeTrabajos([trabajo({ fecha_inicio: "", fecha_fin: "" })])).toBeNull();
    expect(rangoDeTrabajos([trabajo({ fecha_inicio: "2026-07-28", fecha_fin: null as unknown as string })])).toBeNull();
  });

  it("un fin anterior al inicio no produce un intervalo imposible", () => {
    expect(rangoDeTrabajos([trabajo({ fecha_inicio: "2026-07-28", fecha_fin: "2026-07-20" })])).toEqual({
      inicio: "2026-07-28",
      fin: "2026-07-28"
    });
  });
});

describe("Imputaciones por CECO", () => {
  it("varias líneas del mismo CECO son UNA imputación con sus dos trabajos", () => {
    const grupos = imputacionesPorCeco([
      trabajo({ origen_id: "gc-1", ceco: "3005" }),
      trabajo({ origen_id: "gc-2", ceco: "3005" })
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ceco).toBe("3005");
    expect(grupos[0].trabajos.map(t => t.origen_id)).toEqual(["gc-1", "gc-2"]);
  });

  it("ordena los CECOs de menor a mayor sea cual sea el orden de entrada", () => {
    const grupos = imputacionesPorCeco([
      trabajo({ ceco: "3210" }),
      trabajo({ ceco: "3005" }),
      trabajo({ ceco: "3136" })
    ]);
    expect(grupos.map(g => g.ceco)).toEqual(["3005", "3136", "3210"]);
  });

  it("los trabajos sin CECO se agrupan como «Sin CECO» y quedan los últimos", () => {
    const grupos = imputacionesPorCeco([
      trabajo({ ceco: "  " }),
      trabajo({ ceco: "3136" }),
      trabajo({ ceco: "" })
    ]);
    expect(grupos.map(g => g.ceco)).toEqual(["3136", CECO_SIN_ASIGNAR]);
    expect(grupos[1].trabajos).toHaveLength(2);
    expect(imputacionesPorCeco([])).toEqual([]);
  });
});

describe("Altas que cuentan para el cálculo", () => {
  it("descarta las anuladas y las de baja, y conserva ampliada y baja pendiente", () => {
    const vigentes = altasVigentes([
      alta({ id: "a1", estado: "vigente" }),
      alta({ id: "a2", estado: "ampliada" }),
      alta({ id: "a3", estado: "baja_pendiente" }),
      alta({ id: "a4", estado: "baja" }),
      alta({ id: "a5", estado: "anulada" })
    ]);
    expect(vigentes.map(a => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(altasVigentes([])).toEqual([]);
  });
});

describe("Cobertura y solape de un alta sobre el rango", () => {
  it("un alta indefinida sin fecha de fin cubre el rango entero", () => {
    const indefinida = alta({ tipo: "indefinido", fecha_inicio: "2025-01-07", fecha_fin: null });
    expect(cubreRango(indefinida, RANGO)).toBe(true);
    expect(solapaRango(indefinida, RANGO)).toBe(false);
  });

  it("cobertura exacta por los dos extremos: mismo día de inicio y mismo día de fin", () => {
    const exacta = alta({ fecha_inicio: "2026-07-28", fecha_fin: "2026-07-31" });
    expect(cubreRango(exacta, RANGO)).toBe(true);
    expect(solapaRango(exacta, RANGO)).toBe(false);
    expect(interseccionDias(exacta, RANGO)).toBe(4);
  });

  it("solape solo por la izquierda: el alta acaba dentro del rango", () => {
    const izquierda = alta({ fecha_inicio: "2026-07-20", fecha_fin: "2026-07-29" });
    expect(cubreRango(izquierda, RANGO)).toBe(false);
    expect(solapaRango(izquierda, RANGO)).toBe(true);
    expect(interseccionDias(izquierda, RANGO)).toBe(2); // 28 y 29
  });

  it("solape solo por la derecha: el alta empieza dentro del rango", () => {
    const derecha = alta({ fecha_inicio: "2026-07-30", fecha_fin: "2026-08-15" });
    expect(cubreRango(derecha, RANGO)).toBe(false);
    expect(solapaRango(derecha, RANGO)).toBe(true);
    expect(interseccionDias(derecha, RANGO)).toBe(2); // 30 y 31
  });

  it("un alta contigua que termina justo la víspera NO es solape", () => {
    const vispera = alta({ fecha_inicio: "2026-07-10", fecha_fin: "2026-07-27" });
    expect(solapaRango(vispera, RANGO)).toBe(false);
    expect(cubreRango(vispera, RANGO)).toBe(false);
    expect(interseccionDias(vispera, RANGO)).toBe(0);

    const siguiente = alta({ fecha_inicio: "2026-08-01", fecha_fin: "2026-08-20" });
    expect(solapaRango(siguiente, RANGO)).toBe(false);
    expect(interseccionDias(siguiente, RANGO)).toBe(0);
  });

  it("un alta con fecha de inicio ilegible no cubre ni solapa", () => {
    const rota = alta({ fecha_inicio: "" });
    expect(cubreRango(rota, RANGO)).toBe(false);
    expect(solapaRango(rota, RANGO)).toBe(false);
    expect(interseccionDias(rota, RANGO)).toBe(0);
  });
});

describe("Resolución del sistema", () => {
  it("trabajador sin altas: alta nueva", () => {
    expect(resolverCobertura(RANGO, [])).toEqual({ resolucion: "alta_nueva", alta: null, ampliarHasta: null });
  });

  it("altas anuladas y de baja se ignoran aunque cubrieran el rango", () => {
    const resultado = resolverCobertura(RANGO, [
      alta({ id: "a4", estado: "baja", fecha_inicio: "2026-01-01", fecha_fin: null }),
      alta({ id: "a5", estado: "anulada", fecha_inicio: "2026-01-01", fecha_fin: null })
    ]);
    expect(resultado.resolucion).toBe("alta_nueva");
    expect(resultado.alta).toBeNull();
  });

  it("con varias altas que cubren gana la indefinida", () => {
    const resultado = resolverCobertura(RANGO, [
      alta({ id: "temporal", numero_alta: "111", tipo: "temporal", fecha_inicio: "2026-07-01", fecha_fin: "2026-08-31" }),
      alta({ id: "indef", numero_alta: "222", tipo: "indefinido", fecha_inicio: "2026-07-15", fecha_fin: null })
    ]);
    expect(resultado.resolucion).toBe("cubierta");
    expect(resultado.alta?.id).toBe("indef");
  });

  it("a igualdad de tipo gana la de fecha de inicio más temprana", () => {
    const resultado = resolverCobertura(RANGO, [
      alta({ id: "tarde", numero_alta: "222", fecha_inicio: "2026-07-20", fecha_fin: "2026-08-31" }),
      alta({ id: "pronto", numero_alta: "111", fecha_inicio: "2026-07-01", fecha_fin: "2026-08-31" })
    ]);
    expect(resultado.resolucion).toBe("cubierta");
    expect(resultado.alta?.id).toBe("pronto");
  });

  it("si ninguna cubre, elige la de mayor intersección y propone ampliar hasta el fin del rango", () => {
    const resultado = resolverCobertura(RANGO, [
      alta({ id: "poca", numero_alta: "111", fecha_inicio: "2026-07-10", fecha_fin: "2026-07-28" }),
      alta({ id: "mucha", numero_alta: "222", fecha_inicio: "2026-07-20", fecha_fin: "2026-07-30" })
    ]);
    expect(resultado.resolucion).toBe("solape");
    expect(resultado.alta?.id).toBe("mucha");
    expect(resultado.ampliarHasta).toBe("2026-07-31");
  });

  it("la cobertura manda sobre el solape aunque el solape sea más largo", () => {
    const resultado = resolverCobertura(RANGO, [
      alta({ id: "solapa", fecha_inicio: "2026-07-01", fecha_fin: "2026-07-30" }),
      alta({ id: "cubre", fecha_inicio: "2026-07-28", fecha_fin: "2026-07-31" })
    ]);
    expect(resultado.resolucion).toBe("cubierta");
    expect(resultado.alta?.id).toBe("cubre");
  });
});

describe("Estado sugerido para la solicitud", () => {
  it("tabla completa: alta nueva, cubierta indefinida, cubierta temporal, cubierta fija discontinua y solape", () => {
    expect(estadoSugerido("alta_nueva", null)).toBe("pendiente");
    expect(estadoSugerido("cubierta", alta({ tipo: "indefinido" }))).toBe("ya_alta_indefinida");
    expect(estadoSugerido("cubierta", alta({ tipo: "temporal" }))).toBe("solo_imputacion");
    expect(estadoSugerido("cubierta", alta({ tipo: "fijo_discontinuo" }))).toBe("solo_imputacion");
    expect(estadoSugerido("solape", alta())).toBe("se_solapa");
  });

  it("una cobertura sin alta identificada se queda en solo imputación, nunca en «ya de alta indefinida»", () => {
    expect(estadoSugerido("cubierta", null)).toBe("solo_imputacion");
    expect(estadoSugerido("alta_nueva")).toBe("pendiente");
  });
});

describe("Texto calculado (literal del diseño)", () => {
  it("alta nueva con dos CECOs: «Alta nueva del 28/07 al 31/07 · 2 imputaciones a 3005, 3136»", () => {
    const resultado = textoResolucion(
      [
        trabajo({ origen_id: "gc-1", ceco: "3005", fecha_inicio: "2026-07-28", fecha_fin: "2026-07-30" }),
        trabajo({ origen_id: "gc-2", ceco: "3136", fecha_inicio: "2026-07-29", fecha_fin: "2026-07-31" })
      ],
      []
    );
    expect(resultado.texto).toBe("Alta nueva del 28/07 al 31/07 · 2 imputaciones a 3005, 3136");
    expect(resultado.tono).toBe("neutro");
    expect(resultado.resolucion).toBe("alta_nueva");
    expect(resultado.alta).toBeNull();
    expect(resultado.ampliarHasta).toBeNull();
  });

  it("cubierto: «Cubierto por el alta 18832 · no hace falta alta nueva · 1 imputación a 3210»", () => {
    const resultado = textoResolucion(
      [trabajo({ ceco: "3210", fecha_inicio: "2026-07-28", fecha_fin: "2026-07-31" })],
      [alta({ numero_alta: "18832", tipo: "indefinido", fecha_inicio: "2026-01-07", fecha_fin: null })]
    );
    expect(resultado.texto).toBe("Cubierto por el alta 18832 · no hace falta alta nueva · 1 imputación a 3210");
    expect(resultado.tono).toBe("neutro");
    expect(resultado.resolucion).toBe("cubierta");
    expect(resultado.alta?.numero_alta).toBe("18832");
  });

  it("solape: «Se solapa con el alta 18832 (20/07 → 29/07) · ampliar hasta el 31/07»", () => {
    const resultado = textoResolucion(
      [trabajo({ ceco: "3005", fecha_inicio: "2026-07-28", fecha_fin: "2026-07-31" })],
      [alta({ numero_alta: "18832", fecha_inicio: "2026-07-20", fecha_fin: "2026-07-29" })]
    );
    expect(resultado.texto).toBe("Se solapa con el alta 18832 (20/07 → 29/07) · ampliar hasta el 31/07");
    expect(resultado.tono).toBe("aviso");
    expect(resultado.resolucion).toBe("solape");
    expect(resultado.ampliarHasta).toBe("2026-07-31");
  });

  it("singular y plural correctos según el número de CECOs", () => {
    const singular = textoResolucion([trabajo({ ceco: "3210" })], []);
    expect(singular.texto).toBe("Alta nueva del 28/07 al 31/07 · 1 imputación a 3210");

    const dosDelMismoCeco = textoResolucion([trabajo({ origen_id: "a", ceco: "3210" }), trabajo({ origen_id: "b", ceco: "3210" })], []);
    expect(dosDelMismoCeco.texto).toBe("Alta nueva del 28/07 al 31/07 · 1 imputación a 3210");

    const plural = textoResolucion(
      [trabajo({ origen_id: "a", ceco: "3005" }), trabajo({ origen_id: "b", ceco: "3136" }), trabajo({ origen_id: "c", ceco: "3210" })],
      []
    );
    expect(plural.texto).toBe("Alta nueva del 28/07 al 31/07 · 3 imputaciones a 3005, 3136, 3210");
  });

  it("sin número de alta todavía, el texto no inventa un número", () => {
    const cubierta = textoResolucion(
      [trabajo({ ceco: "3210" })],
      [alta({ numero_alta: null, tipo: "indefinido", fecha_inicio: "2026-01-07", fecha_fin: null })]
    );
    expect(cubierta.texto).toBe("Cubierto por un alta vigente · no hace falta alta nueva · 1 imputación a 3210");

    const solape = textoResolucion([trabajo({ ceco: "3005" })], [alta({ numero_alta: "   ", fecha_inicio: "2026-07-20", fecha_fin: "2026-07-29" })]);
    expect(solape.texto).toBe("Se solapa con un alta vigente (20/07 → 29/07) · ampliar hasta el 31/07");
  });

  it("un alta abierta que empieza tarde solapa y se anuncia como abierta", () => {
    const resultado = textoResolucion(
      [trabajo({ ceco: "3005" })],
      [alta({ numero_alta: "18832", tipo: "indefinido", fecha_inicio: "2026-07-30", fecha_fin: null })]
    );
    expect(resultado.texto).toBe("Se solapa con el alta 18832 (30/07 → abierta) · ampliar hasta el 31/07");
    expect(resultado.tono).toBe("aviso");
  });

  it("selección vacía: invita a marcar trabajos y no calcula nada", () => {
    const resultado = textoResolucion([], [alta()]);
    expect(resultado.texto).toBe("Selecciona trabajos para calcular el alta");
    expect(resultado.tono).toBe("vacio");
    expect(resultado.resolucion).toBeNull();
    expect(resultado.alta).toBeNull();
    expect(resultado.ampliarHasta).toBeNull();
  });

  it("trabajos marcados sin fechas legibles: avisa en vez de fingir que no hay selección", () => {
    const resultado = textoResolucion([trabajo({ fecha_inicio: "", fecha_fin: "sin fecha" })], []);
    expect(resultado.texto).toBe("Los trabajos seleccionados no tienen fechas válidas");
    expect(resultado.tono).toBe("aviso");
    expect(resultado.resolucion).toBeNull();
  });

  it("un trabajo sin CECO se nombra «Sin CECO» y no desaparece del texto", () => {
    const resultado = textoResolucion([trabajo({ ceco: "" })], []);
    expect(resultado.texto).toBe(`Alta nueva del 28/07 al 31/07 · 1 imputación a ${CECO_SIN_ASIGNAR}`);
  });
});

describe("Transiciones y motivo obligatorio", () => {
  it("respeta la tabla de transiciones de tipos.ts", () => {
    expect(puedeTransicionar("pendiente", "tramitada")).toBe(true);
    expect(puedeTransicionar("pendiente", "baja_pendiente")).toBe(false);
    expect(puedeTransicionar("se_solapa", "alta_online")).toBe(true);
    expect(puedeTransicionar("tramitada", "baja_pendiente")).toBe(true);
    expect(puedeTransicionar("rechazada", "tramitada")).toBe(false);
    expect(puedeTransicionar("cancelada", "pendiente")).toBe(false);
  });

  it("solo los cierres en negativo exigen motivo", () => {
    expect(exigeMotivo("rechazada")).toBe(true);
    expect(exigeMotivo("cancelada")).toBe(true);
    expect(exigeMotivo("tramitada")).toBe(false);
    expect(exigeMotivo("pendiente")).toBe(false);
    expect(exigeMotivo("solo_imputacion")).toBe(false);
  });
});
