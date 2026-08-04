import { describe, expect, it } from "vitest";

import {
  PuntoEvento,
  agruparEventosPorDia,
  describirEvento,
  describirOrigen,
  esCampoSensible,
  formatearValorEvento,
  resumirEventos
} from "@/lib/campana-auditoria";

function evento(patch: Partial<PuntoEvento> = {}): PuntoEvento {
  return {
    id: "evt",
    punto_id: "p1",
    campana_id: "c1",
    punto_nombre: "Farmacia Central",
    accion: "actualizado",
    campo: "importe",
    valor_anterior: "25",
    valor_nuevo: "250",
    actor_id: "u1",
    actor_nombre: "Marta",
    origen: "pantalla",
    created_at: "2026-08-04T09:30:00.000Z",
    ...patch
  };
}

describe("formatearValorEvento", () => {
  it("da formato de euros al importe", () => {
    expect(formatearValorEvento("importe", "250")).toBe("250,00 €");
    expect(formatearValorEvento("importe", "25.5")).toBe("25,50 €");
  });

  it("no inventa un número cuando el importe guardado no lo es", () => {
    expect(formatearValorEvento("importe", "no-numérico")).toBe("no-numérico");
  });

  it("da formato español a las fechas", () => {
    expect(formatearValorEvento("fecha_visita", "2026-08-04")).toBe("04/08/2026");
    expect(formatearValorEvento("picking_cerrado_at", "2026-08-04T10:00:00Z")).toBe("04/08/2026");
  });

  it("traduce el estado al nombre que ve el usuario", () => {
    expect(formatearValorEvento("estado", "completado")).toBe("Completado");
    // Un estado que no esté en el catálogo se enseña tal cual, sin romper.
    expect(formatearValorEvento("estado", "inventado")).toBe("inventado");
  });

  it("llama vacío a lo que no tiene valor", () => {
    expect(formatearValorEvento("importe", null)).toBe("vacío");
    expect(formatearValorEvento("notas", "   ")).toBe("vacío");
  });

  it("recorta las notas largas para que no revienten la línea", () => {
    const largo = "x".repeat(200);
    const salida = formatearValorEvento("notas", largo);
    expect(salida).toHaveLength(118);
    expect(salida.endsWith("…")).toBe(true);
  });
});

describe("describirEvento", () => {
  it("describe un cambio de importe con los dos valores", () => {
    expect(describirEvento(evento())).toBe("cambió el importe de 25,00 € a 250,00 €");
  });

  it("distingue poner un valor de cambiarlo", () => {
    expect(describirEvento(evento({ valor_anterior: null }))).toBe("puso el importe en 250,00 €");
  });

  it("distingue borrar un valor", () => {
    expect(describirEvento(evento({ valor_nuevo: null }))).toBe("borró el importe (era 25,00 €)");
  });

  it("describe el alta y la baja del punto", () => {
    expect(describirEvento(evento({ accion: "creado", campo: null }))).toBe("creó el punto");
    expect(describirEvento(evento({ accion: "borrado", campo: null }))).toBe("borró el punto");
  });

  it("no se rompe con un campo que no conoce", () => {
    expect(describirEvento(evento({ campo: "columna_futura", valor_anterior: "a", valor_nuevo: "b" })))
      .toBe("cambió «columna_futura» de a a b");
  });
});

describe("origen del cambio", () => {
  it("traduce los orígenes que emite la aplicación", () => {
    expect(describirOrigen("importacion")).toBe("subiendo un archivo");
    expect(describirOrigen("masiva")).toBe("en una acción masiva");
  });

  it("no oculta un origen desconocido: lo dice", () => {
    expect(describirOrigen(null)).toBe("origen no registrado");
    expect(describirOrigen("desconocido")).toBe("origen no registrado");
  });
});

describe("esCampoSensible", () => {
  it("marca los campos que mueven dinero o responsable", () => {
    expect(esCampoSensible("importe")).toBe(true);
    expect(esCampoSensible("estado")).toBe(true);
    expect(esCampoSensible("instalador_id")).toBe(true);
  });

  it("no marca los descriptivos", () => {
    expect(esCampoSensible("notas")).toBe(false);
    expect(esCampoSensible(null)).toBe(false);
  });
});

describe("agruparEventosPorDia", () => {
  it("agrupa por día con el más reciente primero y conserva el orden interno", () => {
    const eventos = [
      evento({ id: "a", created_at: "2026-08-04T10:00:00Z" }),
      evento({ id: "b", created_at: "2026-08-04T09:00:00Z" }),
      evento({ id: "c", created_at: "2026-08-01T09:00:00Z" })
    ];
    const dias = agruparEventosPorDia(eventos);
    expect(dias.map(d => d.dia)).toEqual(["2026-08-04", "2026-08-01"]);
    expect(dias[0].eventos.map(e => e.id)).toEqual(["a", "b"]);
  });

  it("devuelve lista vacía sin eventos", () => {
    expect(agruparEventosPorDia([])).toEqual([]);
  });
});

describe("resumirEventos", () => {
  it("cuenta el total, los sensibles y ordena por actor y origen", () => {
    const resumen = resumirEventos([
      evento({ actor_nombre: "Marta", campo: "importe" }),
      evento({ actor_nombre: "Marta", campo: "notas" }),
      evento({ actor_nombre: "Kilian", campo: "estado", origen: "importacion" })
    ]);
    expect(resumen.total).toBe(3);
    expect(resumen.sensibles).toBe(2);
    expect(resumen.porActor[0]).toEqual({ actor: "Marta", cambios: 2 });
    expect(resumen.porOrigen).toContainEqual({ origen: "subiendo un archivo", cambios: 1 });
  });

  it("no falla con la bitácora vacía", () => {
    expect(resumirEventos([])).toEqual({ total: 0, sensibles: 0, porActor: [], porOrigen: [] });
  });
});
