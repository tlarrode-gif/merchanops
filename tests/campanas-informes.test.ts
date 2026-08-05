import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BloqueCalculado,
  EntradaInforme,
  bloques,
  bloquesInternos,
  calcularBloque,
  calcularBloques,
  esBloqueInterno,
  semanaDe,
  validarInforme
} from "@/lib/campana-informes";
import { Campana, CampanaKpis, IncidenciaCampana, PuntoVenta } from "@/lib/campanas";
import { Regularizacion } from "@/lib/campana-regularizaciones";

const campana: Campana = {
  id: "c1",
  nombre: "Campaña test",
  cliente_marca: "ISDIN",
  estado: "activa",
  fecha_inicio: "2026-07-01",
  fecha_fin: "2026-09-30",
  provincias: ["Barcelona", "Madrid"],
  presupuesto: 10000
};

const kpis: CampanaKpis = {
  campana_id: "c1",
  total_puntos: 4,
  completados: 2,
  pendientes: 2,
  asignados: 4,
  incidencias_abiertas: 1,
  coste_ejecutado: 300,
  importe_total: 800,
  dias_restantes: 30
};

function punto(patch: Partial<PuntoVenta> = {}): PuntoVenta {
  return {
    id: "p1",
    campana_id: "c1",
    nombre_comercial: "Farmacia Uno",
    provincia: "Barcelona",
    estado: "pendiente",
    fecha_visita: null,
    importe: 200,
    instalador_id: "w1",
    instalador_nombre: "Luis",
    ...patch
  };
}

const puntos: PuntoVenta[] = [
  punto({ id: "p1", estado: "completado", fecha_visita: "2026-07-06", importe: 200, instalador_nombre: "Luis" }),
  punto({ id: "p2", estado: "completado", fecha_visita: "2026-07-13", importe: 100, instalador_nombre: "Ana", instalador_id: "w2" }),
  punto({ id: "p3", estado: "pendiente", provincia: "Madrid" }),
  punto({ id: "p4", estado: "incidencia", provincia: "Madrid", nombre_comercial: "Farmacia Cuatro" })
];

const incidencias: IncidenciaCampana[] = [
  { id: "i1", punto_id: "p4", campana_id: "c1", descripcion: "Farmacia cerrada", estado: "abierta" },
  { id: "i2", punto_id: "p1", campana_id: "c1", descripcion: "Resuelta ya", estado: "resuelta" },
  // Incidencia de un punto que ya no existe: el informe no puede romperse por eso.
  { id: "i3", punto_id: "borrado", campana_id: "c1", descripcion: "Punto retirado", estado: "en_gestion" }
];

const regularizaciones: Regularizacion[] = [
  {
    id: "r1", campana_id: "c1", punto_id: "p1", concepto_tipo: "revisita", concepto: "Segunda visita",
    importe_cents: 2500, fecha: "2026-07-20", mes_contable: "2026-07", estado: "aprobada",
    refacturable: true, solicitada_at: "2026-07-20T09:00:00Z"
  },
  {
    id: "r2", campana_id: "c1", punto_id: "p2", concepto_tipo: "otro", concepto: "Extra",
    importe_cents: 1000, fecha: "2026-07-21", mes_contable: "2026-07", estado: "propuesta",
    refacturable: null, solicitada_at: "2026-07-21T09:00:00Z"
  }
];

const entrada: EntradaInforme = { campana, kpis, puntos, incidencias, regularizaciones };

function cifra(bloque: BloqueCalculado | null, etiqueta: string): string | undefined {
  return bloque?.cifras?.find(c => c.etiqueta === etiqueta)?.valor;
}

describe("catálogo de bloques", () => {
  it("la lista de bloques internos coincide con la de la base (v11_3)", () => {
    // Duplicación consciente: la base es la que aplica el candado y TypeScript la
    // que pinta la pantalla. Si se separan, el candado protege algo distinto de
    // lo que el usuario ve marcado como interno.
    const sql = readFileSync(resolve(__dirname, "../supabase/v11_3_gc_informes.sql"), "utf8");
    const cuerpo = sql.split("returns text[]")[1].split("$$")[1];
    const enSql = Array.from(cuerpo.matchAll(/'([a-z_]+)'/g)).map(m => m[1]).sort();
    expect(enSql).toEqual([...bloquesInternos].sort());
  });

  it("no hay claves duplicadas", () => {
    const claves = bloques.map(bloque => bloque.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("todo bloque interno se reconoce como tal", () => {
    expect(esBloqueInterno("coste_ejecutado")).toBe(true);
    expect(esBloqueInterno("avance_general")).toBe(false);
    expect(esBloqueInterno("inventado")).toBe(false);
  });
});

describe("validarInforme (el candado)", () => {
  it("deja pasar un informe de cliente con bloques públicos", () => {
    expect(validarInforme(["avance_general", "avance_provincia"], false)).toBeNull();
  });

  it("BLOQUEA un informe de cliente que lleve coste, y dice cuál", () => {
    const motivo = validarInforme(["avance_general", "coste_ejecutado"], false);
    expect(motivo).toContain("Coste ejecutado");
  });

  it("permite los internos cuando el informe se marca como interno", () => {
    expect(validarInforme(["coste_ejecutado", "margen"], true)).toBeNull();
  });

  it("exige al menos un bloque", () => {
    expect(validarInforme([], true)).toContain("al menos un bloque");
  });
});

describe("semanaDe", () => {
  it("devuelve el lunes de la semana natural", () => {
    expect(semanaDe("2026-07-06")).toBe("2026-07-06"); // lunes
    expect(semanaDe("2026-07-09")).toBe("2026-07-06"); // jueves
    expect(semanaDe("2026-07-12")).toBe("2026-07-06"); // domingo, misma semana
    expect(semanaDe("2026-07-13")).toBe("2026-07-13"); // lunes siguiente
  });

  it("no revienta con una fecha ausente o ilegible", () => {
    expect(semanaDe("")).toBe("");
    expect(semanaDe("no-es-fecha")).toBe("");
  });
});

describe("cálculo de bloques públicos", () => {
  it("avance general cuenta y calcula el porcentaje", () => {
    const bloque = calcularBloque("avance_general", entrada);
    expect(cifra(bloque, "Puntos totales")).toBe("4");
    expect(cifra(bloque, "Completados")).toBe("2");
    expect(cifra(bloque, "Avance")).toBe("50 %");
  });

  it("avance por provincia ordena por volumen", () => {
    const bloque = calcularBloque("avance_provincia", entrada);
    expect(bloque?.filas?.[0]).toEqual({ Provincia: "Barcelona", Puntos: 2, Completados: 2, Avance: "100 %" });
    expect(bloque?.filas?.[1]).toEqual({ Provincia: "Madrid", Puntos: 2, Completados: 0, Avance: "0 %" });
  });

  it("avance semanal agrupa por lunes y ordena cronológicamente", () => {
    const bloque = calcularBloque("avance_semanal", entrada);
    expect(bloque?.filas).toEqual([
      { "Semana del": "06/07/2026", "Puntos completados": 1 },
      { "Semana del": "13/07/2026", "Puntos completados": 1 }
    ]);
  });

  it("los puntos completados salen SIN importe", () => {
    const bloque = calcularBloque("puntos_completados", entrada);
    expect(bloque?.columnas).toEqual(["Punto", "Provincia", "Fecha"]);
    expect(JSON.stringify(bloque?.filas)).not.toContain("200");
  });

  it("el equipo desplegado se cuenta, no se nombra", () => {
    const bloque = calcularBloque("cobertura_equipo", entrada);
    expect(cifra(bloque, "Personas desplegadas")).toBe("2");
    expect(JSON.stringify(bloque)).not.toContain("Luis");
  });

  it("las incidencias salen con su descripción y estado legible", () => {
    const bloque = calcularBloque("incidencias_detalle", entrada);
    expect(bloque?.filas?.[0]).toEqual({ Punto: "Farmacia Cuatro", "Descripción": "Farmacia cerrada", Estado: "Abierta" });
    // Un punto borrado no deja el informe a medias: sale con guion.
    expect(bloque?.filas?.[2]).toEqual({ Punto: "—", "Descripción": "Punto retirado", Estado: "En gestión" });
  });
});

describe("cálculo de bloques internos", () => {
  it("margen resta el coste ejecutado del presupuesto", () => {
    // Sin punto de millar: en español los números de cuatro cifras no se agrupan.
    expect(cifra(calcularBloque("margen", entrada), "Margen sobre presupuesto")).toBe("9700,00 €");
  });

  it("margen dice que falta el presupuesto en vez de inventar un cero", () => {
    const sinPresupuesto = { ...entrada, campana: { ...campana, presupuesto: null } };
    expect(cifra(calcularBloque("margen", sinPresupuesto), "Margen sobre presupuesto")).toBe("Sin presupuesto fijado");
  });

  it("coste medio no divide entre cero", () => {
    const sinCompletados = { ...entrada, puntos: [punto({ estado: "pendiente" })] };
    expect(cifra(calcularBloque("coste_medio_punto", sinCompletados), "Coste medio por punto completado"))
      .toBe("Sin puntos completados");
  });

  it("las regularizaciones separan lo refacturable de lo asumido", () => {
    const bloque = calcularBloque("regularizaciones_importe", entrada);
    expect(cifra(bloque, "Aprobado en regularizaciones")).toBe("25,00 €");
    expect(cifra(bloque, "Refacturable al cliente")).toBe("25,00 €");
    expect(cifra(bloque, "Pendientes de aprobar")).toBe("1");
  });

  it("el detalle de pagos agrupa por trabajador y ordena por importe", () => {
    const bloque = calcularBloque("detalle_pagos", entrada);
    expect(bloque?.filas?.[0]).toEqual({ Trabajador: "Luis", Puntos: 1, Importe: "200,00 €" });
  });
});

describe("calcularBloques", () => {
  it("ignora en silencio una clave que ya no existe en el catálogo", () => {
    const calculados = calcularBloques(["avance_general", "bloque_borrado"], entrada);
    expect(calculados.map(b => b.clave)).toEqual(["avance_general"]);
  });

  it("respeta el orden pedido por la plantilla", () => {
    const calculados = calcularBloques(["calendario", "avance_general"], entrada);
    expect(calculados.map(b => b.clave)).toEqual(["calendario", "avance_general"]);
  });
});
