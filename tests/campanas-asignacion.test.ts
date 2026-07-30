import { describe, expect, it } from "vitest";
import {
  agruparPuntosParaMaterial,
  asignarGestoresAPuntosNuevos,
  mismaProvincia,
  provinciasConVariosTrabajadores,
  provinciasDeLosPuntos,
  sugerirGestoresPorPunto,
  sugerirTrabajadoresPorPunto,
  trabajadoresConPuntos,
  trabajadoresDeProvincia
} from "@/lib/campana-asignacion";

// Datos calcados de la operativa real: gestores con varias provincias y trabajadores
// (tabla workers) con una sola, incluidas provincias sin nadie.
const GESTORES = [
  { id: "gestor_1", display_name: "MAI", provinces: ["Asturias", "Valencia", "Alicante", "Sevilla", "Zaragoza"], active: true },
  { id: "gestor_2", display_name: "MARC", provinces: ["Malaga", "Murcia", "Cadiz"], active: true },
  { id: "gestor_3", display_name: "KILIAN", provinces: ["Barcelona"], active: true },
  { id: "gestor_4", display_name: "YIMA", provinces: ["Alava", "Navarra"], active: true },
  { id: "admin", display_name: "Administracion", provinces: [], active: true },
  { id: "inactivo", display_name: "BAJA", provinces: ["Valencia"], active: false }
];

const WORKERS = [
  { id: "w1", name: "DEL CASTILLO CERDA, MANUEL", province: "Alicante" },
  { id: "w2", name: "MARCOS HERRERO, JESICA", province: "Alicante" },
  { id: "w3", name: "GOMIS DUYOS, ALFONSO", province: "Valencia" },
  { id: "w4", name: "HERRERAS MIÑARRO, JOSE DOMINGO", province: "Murcia" },
  { id: "w5", name: "ALVAREZ ARGUELLO, SARA MARIA", province: "Asturias" }
];

describe("mismaProvincia", () => {
  it("iguala grafías con y sin acento", () => {
    expect(mismaProvincia("Almería", "Almeria")).toBe(true);
    expect(mismaProvincia("A Coruña", "A Coruna")).toBe(true);
    expect(mismaProvincia("Malaga", "Málaga")).toBe(true);
  });

  it("no iguala provincias distintas ni vacíos", () => {
    expect(mismaProvincia("Madrid", "Toledo")).toBe(false);
    expect(mismaProvincia("", "Madrid")).toBe(false);
    expect(mismaProvincia(null, null)).toBe(false);
  });
});

describe("sugerirGestoresPorPunto", () => {
  it("asigna el gestor de la provincia de cada punto", () => {
    const puntos = [
      { id: "p1", provincia: "Alicante" },
      { id: "p2", provincia: "Malaga" },
      { id: "p3", provincia: "Barcelona" }
    ];
    const resultado = sugerirGestoresPorPunto(puntos, GESTORES);
    expect(resultado.sugerencias.map(s => [s.punto_id, s.persona_nombre])).toEqual([
      ["p1", "MAI"],
      ["p2", "MARC"],
      ["p3", "KILIAN"]
    ]);
  });

  it("deja sin gestor las provincias que nadie cubre y las reporta", () => {
    const puntos = [
      { id: "p1", provincia: "Las Palmas" },
      { id: "p2", provincia: "Santa Cruz de Tenerife" },
      { id: "p3", provincia: "Alicante" }
    ];
    const resultado = sugerirGestoresPorPunto(puntos, GESTORES);
    expect(resultado.sugerencias).toHaveLength(1);
    expect(resultado.provinciasSinCandidato).toEqual(["Las Palmas", "Santa Cruz de Tenerife"]);
    expect(resultado.sinTocar).toBe(2);
  });

  it("no toca los puntos que ya tienen gestor", () => {
    const puntos = [
      { id: "p1", provincia: "Alicante", gestor_id: "gestor_2" },
      { id: "p2", provincia: "Alicante" }
    ];
    const resultado = sugerirGestoresPorPunto(puntos, GESTORES);
    expect(resultado.sugerencias.map(s => s.punto_id)).toEqual(["p2"]);
    expect(resultado.sinTocar).toBe(1);
  });

  it("ignora usuarios inactivos y usuarios sin provincias (administración)", () => {
    const resultado = sugerirGestoresPorPunto([{ id: "p1", provincia: "Valencia" }], GESTORES);
    expect(resultado.sugerencias[0].persona_nombre).toBe("MAI");
  });
});

describe("sugerirTrabajadoresPorPunto", () => {
  it("reparte por carga cuando la provincia tiene varios trabajadores", () => {
    const puntos = [
      { id: "p1", provincia: "Alicante" },
      { id: "p2", provincia: "Alicante" },
      { id: "p3", provincia: "Alicante" },
      { id: "p4", provincia: "Alicante" }
    ];
    const resultado = sugerirTrabajadoresPorPunto(puntos, WORKERS);
    const porPersona = resultado.sugerencias.reduce<Record<string, number>>((acc, s) => {
      acc[s.persona_id] = (acc[s.persona_id] || 0) + 1;
      return acc;
    }, {});
    // Dos candidatos en Alicante y cuatro puntos: dos para cada uno.
    expect(porPersona).toEqual({ w1: 2, w2: 2 });
    expect(resultado.provinciasConVarios).toEqual(["Alicante"]);
  });

  it("tiene en cuenta la carga que ya arrastra cada trabajador", () => {
    const puntos = [
      { id: "p0", provincia: "Alicante", instalador_id: "w1" },
      { id: "p1", provincia: "Alicante" },
      { id: "p2", provincia: "Alicante" }
    ];
    const resultado = sugerirTrabajadoresPorPunto(puntos, WORKERS);
    // w1 ya tenía uno, así que el primer punto libre va a w2.
    expect(resultado.sugerencias[0].persona_id).toBe("w2");
    expect(resultado.sugerencias.map(s => s.persona_id).sort()).toEqual(["w1", "w2"]);
  });

  it("no inventa trabajador en provincias sin nadie", () => {
    const resultado = sugerirTrabajadoresPorPunto([{ id: "p1", provincia: "Malaga" }], WORKERS);
    expect(resultado.sugerencias).toHaveLength(0);
    expect(resultado.provinciasSinCandidato).toEqual(["Malaga"]);
  });

  it("es estable: dos ejecuciones dan el mismo reparto", () => {
    const puntos = [
      { id: "p1", provincia: "Alicante" },
      { id: "p2", provincia: "Alicante" },
      { id: "p3", provincia: "Valencia" }
    ];
    const a = sugerirTrabajadoresPorPunto(puntos, WORKERS);
    const b = sugerirTrabajadoresPorPunto(puntos, WORKERS);
    expect(a.sugerencias).toEqual(b.sugerencias);
  });
});

describe("trabajadoresDeProvincia y provinciasConVariosTrabajadores", () => {
  it("filtra por provincia del punto", () => {
    expect(trabajadoresDeProvincia(WORKERS, "Alicante").map(w => w.id)).toEqual(["w1", "w2"]);
    expect(trabajadoresDeProvincia(WORKERS, "Málaga")).toEqual([]);
    expect(trabajadoresDeProvincia(WORKERS, null)).toEqual([]);
  });

  it("lista las provincias donde hay que elegir a mano", () => {
    expect(provinciasConVariosTrabajadores(WORKERS)).toEqual(["Alicante"]);
  });
});

describe("agruparPuntosParaMaterial", () => {
  it("crea un grupo por trabajador y dirección de envío", () => {
    const grupos = agruparPuntosParaMaterial([
      { id: "p1", instalador_id: "w1", instalador_nombre: "MANUEL", direccion_envio: "Calle A 1" },
      { id: "p2", instalador_id: "w1", instalador_nombre: "MANUEL", direccion_envio: "Calle A 1" },
      { id: "p3", instalador_id: "w3", instalador_nombre: "ALFONSO", direccion_envio: "Calle B 2" }
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map(g => [g.instalador_nombre, g.puntos.length])).toEqual([
      ["ALFONSO", 1],
      ["MANUEL", 2]
    ]);
  });

  it("separa al mismo trabajador si las direcciones de envío son distintas", () => {
    const grupos = agruparPuntosParaMaterial([
      { id: "p1", instalador_id: "w1", instalador_nombre: "MANUEL", direccion_envio: "Calle A 1" },
      { id: "p2", instalador_id: "w1", instalador_nombre: "MANUEL", direccion_envio: "Almacén central" }
    ]);
    expect(grupos).toHaveLength(2);
  });

  it("usa la dirección del punto cuando no hay dirección de envío (lo mismo que la RPC)", () => {
    const grupos = agruparPuntosParaMaterial([
      { id: "p1", instalador_id: "w1", instalador_nombre: "MANUEL", direccion: "Gran Via 1" }
    ]);
    expect(grupos[0].direccion_envio).toBe("Gran Via 1");
  });

  it("aísla los puntos sin trabajador en su propio grupo, no en el del primero", () => {
    // Este era el bug: 14 puntos con un único instalador asignado acababan todos a nombre
    // de esa persona porque la cabecera de la solicitud se queda con el primer no nulo.
    const puntos = [
      { id: "p1", provincia: "Las Palmas", direccion: "X" },
      { id: "p2", provincia: "Malaga", direccion: "X" },
      { id: "p3", instalador_id: "w1", instalador_nombre: "DEL CASTILLO CERDA, MANUEL", direccion: "X" }
    ];
    const grupos = agruparPuntosParaMaterial(puntos);
    const conTrabajador = grupos.filter(g => g.instalador_id);
    const sinTrabajador = grupos.filter(g => !g.instalador_id);
    expect(conTrabajador).toHaveLength(1);
    expect(conTrabajador[0].puntos.map(p => p.id)).toEqual(["p3"]);
    expect(sinTrabajador).toHaveLength(1);
    expect(sinTrabajador[0].puntos.map(p => p.id)).toEqual(["p1", "p2"]);
    expect(sinTrabajador[0].instalador_nombre).toBeNull();
  });
});

describe("asignarGestoresAPuntosNuevos", () => {
  it("reparte las filas importadas entre el equipo elegido", () => {
    const filas = [
      { nombre_comercial: "A", provincia: "Alicante", gestor_id: null, gestor_nombre: null },
      { nombre_comercial: "B", provincia: "Barcelona", gestor_id: null, gestor_nombre: null },
      { nombre_comercial: "C", provincia: "Las Palmas", gestor_id: null, gestor_nombre: null }
    ];
    const resultado = asignarGestoresAPuntosNuevos(filas, GESTORES);
    expect(resultado.asignados).toBe(2);
    expect(resultado.puntos[0].gestor_nombre).toBe("MAI");
    expect(resultado.puntos[1].gestor_nombre).toBe("KILIAN");
    expect(resultado.puntos[2].gestor_id).toBeNull();
    expect(resultado.provinciasSinGestor).toEqual(["Las Palmas"]);
  });

  it("no modifica el array original", () => {
    const filas = [{ nombre_comercial: "A", provincia: "Alicante", gestor_id: null, gestor_nombre: null }];
    asignarGestoresAPuntosNuevos(filas, GESTORES);
    expect(filas[0].gestor_id).toBeNull();
  });
});

describe("provinciasDeLosPuntos y trabajadoresConPuntos", () => {
  it("deduce las provincias del archivo sin duplicados", () => {
    expect(provinciasDeLosPuntos([
      { provincia: "Alicante" },
      { provincia: "Alicante" },
      { provincia: "Málaga" },
      { provincia: null }
    ])).toEqual(["Alicante", "Malaga"]);
  });

  it("cuenta puntos y puntos sin dirección por trabajador", () => {
    expect(trabajadoresConPuntos([
      { id: "p1", instalador_id: "w1", instalador_nombre: "MANUEL", direccion_envio: "Calle A" },
      { id: "p2", instalador_id: "w1", instalador_nombre: "MANUEL" },
      { id: "p3", instalador_id: "w3", instalador_nombre: "ALFONSO" },
      { id: "p4" }
    ])).toEqual([
      { id: "w3", nombre: "ALFONSO", puntos: 1, sinDireccion: 1 },
      { id: "w1", nombre: "MANUEL", puntos: 2, sinDireccion: 1 }
    ]);
  });
});
