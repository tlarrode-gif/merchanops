import { describe, expect, it } from "vitest";
import { resolverCobertura, textoResolucion, rangoDeTrabajos, imputacionesPorCeco, estadoSugerido } from "@/lib/rrhh/altas";
import { fechaLimiteSolicitud, accesosNecesarios, textoSolicitudAcceso } from "@/lib/rrhh/accesos";
import { AltaLaboral, TrabajoPendiente, Cadena, Centro } from "@/lib/rrhh/tipos";

const alta = (o: Partial<AltaLaboral>): AltaLaboral => ({
  id: "a1", worker_id: "w1", numero_alta: "18832", tipo: "temporal",
  fecha_inicio: "2026-07-20", fecha_fin: "2026-07-29", ceco: null, horas_dia: null, estado: "vigente", ...o });
const trab = (o: Partial<TrabajoPendiente>): TrabajoPendiente => ({
  origen_tipo: "servicio", origen_id: "s1", worker_id: "w1", campana: "C", ceco: "3005",
  fecha_inicio: "2026-07-28", fecha_fin: "2026-07-29", horas_dia: 3, ...o });

describe("BORDES · cobertura", () => {
  it("alta contigua (acaba el dia ANTES del inicio) NO es solape", () => {
    const r = resolverCobertura({ inicio: "2026-07-30", fin: "2026-07-31" }, [alta({ fecha_fin: "2026-07-29" })]);
    expect(r.resolucion).toBe("alta_nueva");
  });
  it("alta que acaba el MISMO dia que empieza el trabajo si es solape", () => {
    const r = resolverCobertura({ inicio: "2026-07-29", fin: "2026-07-31" }, [alta({ fecha_fin: "2026-07-29" })]);
    expect(r.resolucion).toBe("solape");
    expect(r.ampliarHasta).toBe("2026-07-31");
  });
  it("alta abierta (fecha_fin null) cubre por la derecha", () => {
    const r = resolverCobertura({ inicio: "2026-07-28", fin: "2099-01-01" }, [alta({ fecha_fin: null, tipo: "indefinido" })]);
    expect(r.resolucion).toBe("cubierta");
  });
  it("cobertura exacta por los dos extremos", () => {
    const r = resolverCobertura({ inicio: "2026-07-20", fin: "2026-07-29" }, [alta({})]);
    expect(r.resolucion).toBe("cubierta");
  });
  it("un dia mas por la derecha ya es solape", () => {
    const r = resolverCobertura({ inicio: "2026-07-20", fin: "2026-07-30" }, [alta({})]);
    expect(r.resolucion).toBe("solape");
  });
  it("altas anuladas y de baja no cuentan", () => {
    const r = resolverCobertura({ inicio: "2026-07-20", fin: "2026-07-29" },
      [alta({ id: "x", estado: "anulada" }), alta({ id: "y", estado: "baja" })]);
    expect(r.resolucion).toBe("alta_nueva");
  });
  it("entre dos que cubren, prefiere la INDEFINIDA", () => {
    const r = resolverCobertura({ inicio: "2026-07-28", fin: "2026-07-29" },
      [alta({ id: "temp", tipo: "temporal" }), alta({ id: "indef", tipo: "indefinido", fecha_fin: null })]);
    expect(r.alta?.id).toBe("indef");
    expect(estadoSugerido(r.resolucion, r.alta)).toBe("ya_alta_indefinida");
  });
  it("cobertura por alta TEMPORAL sugiere solo_imputacion", () => {
    const r = resolverCobertura({ inicio: "2026-07-28", fin: "2026-07-29" }, [alta({ tipo: "temporal" })]);
    expect(estadoSugerido(r.resolucion, r.alta)).toBe("solo_imputacion");
  });
});

describe("BORDES · textos literales del diseño", () => {
  it("alta nueva con dos CECO", () => {
    const t = textoResolucion([trab({ ceco: "3005" }), trab({ origen_id: "s2", ceco: "3136", fecha_fin: "2026-07-31" })], []);
    expect(t.texto).toBe("Alta nueva del 28/07 al 31/07 · 2 imputaciones a 3005, 3136");
  });
  it("una sola imputacion va en singular", () => {
    const t = textoResolucion([trab({ ceco: "3210" })], [alta({ fecha_fin: "2026-08-15" })]);
    expect(t.texto).toBe("Cubierto por el alta 18832 · no hace falta alta nueva · 1 imputación a 3210");
  });
  it("solape reproduce el texto del diseño", () => {
    const t = textoResolucion([trab({ fecha_inicio: "2026-07-25", fecha_fin: "2026-07-31" })], [alta({})]);
    expect(t.texto).toBe("Se solapa con el alta 18832 (20/07 → 29/07) · ampliar hasta el 31/07");
    expect(t.tono).toBe("aviso");
  });
  it("sin seleccion", () => {
    expect(textoResolucion([], []).texto).toBe("Selecciona trabajos para calcular el alta");
  });
});

describe("BORDES · fechas de plazo", () => {
  it("lead time cruza fin de mes", () => {
    expect(fechaLimiteSolicitud("2026-08-02", 5)).toBe("2026-07-28");
  });
  it("lead time cruza fin de año", () => {
    expect(fechaLimiteSolicitud("2027-01-02", 5)).toBe("2026-12-28");
  });
  it("año bisiesto: 2028 tiene 29 de febrero", () => {
    expect(fechaLimiteSolicitud("2028-03-01", 1)).toBe("2028-02-29");
  });
  it("año NO bisiesto: del 1 de marzo menos 1 dia es 28 de febrero", () => {
    expect(fechaLimiteSolicitud("2026-03-01", 1)).toBe("2026-02-28");
  });
  it("lead time 0 = el propio dia de trabajo", () => {
    expect(fechaLimiteSolicitud("2026-07-31", 0)).toBe("2026-07-31");
  });
  it("fecha inexistente se rechaza", () => {
    expect(fechaLimiteSolicitud("2026-02-30", 1)).toBeNull();
  });
});

describe("BORDES · accesos por modo de tramite", () => {
  const cad = (o: Partial<Cadena>): Cadena => ({ id: "c", nombre: "Alcampo", modo_tramite: "centro", lead_time_dias: 2, activa: true, ...o });
  const cen = (i: number): Centro => ({ id: `ce${i}`, cadena_id: "c", nombre: `Centro ${i}`, activo: true });
  it("por centro: 3 centros -> 3 accesos", () => {
    expect(accesosNecesarios(cad({}), [cen(1), cen(2), cen(3)])).toHaveLength(3);
  });
  it("por cadena: 4 centros -> 1 acceso sin centro", () => {
    const a = accesosNecesarios(cad({ modo_tramite: "cadena" }), [cen(1), cen(2), cen(3), cen(4)]);
    expect(a).toHaveLength(1);
    expect(a[0].centro_id).toBeNull();
  });
  it("texto por centro, literal", () => {
    const t = textoSolicitudAcceso(cad({}), [cen(1), cen(2), cen(3)], "2026-07-31", "2026-07-28");
    expect(t.texto).toBe("Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07");
  });
  it("texto por cadena, literal", () => {
    const t = textoSolicitudAcceso(cad({ nombre: "Media Markt", modo_tramite: "cadena", lead_time_dias: 0 }), [cen(1), cen(2), cen(3), cen(4)], "2026-07-31", "2026-07-28");
    expect(t.texto).toBe("Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07");
  });
  it("plazo vencido, literal y en rojo", () => {
    const t = textoSolicitudAcceso(cad({ nombre: "El Corte Inglés", lead_time_dias: 4 }), [cen(1)], "2026-07-29", "2026-07-28");
    expect(t.texto).toBe("El Corte Inglés · plazo vencido el 25/07");
    expect(t.tono).toBe("error");
  });
});
