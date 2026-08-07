import { describe, expect, it } from "vitest";
import { sugerirGestoresPorPunto } from "@/lib/campana-asignacion";
import {
  delegacionesComoCandidatos,
  esProvinciaDelegada,
  provinciasDelegadas,
  responsablesDeZona
} from "@/lib/campana-delegaciones";

// Operativa real: gestores de la casa con varias provincias y empresas
// subcontratadas que cubren zonas concretas.
const GESTORES = [
  { id: "gestor_1", display_name: "MAI", provinces: ["Asturias", "Valencia", "Alicante"], active: true },
  { id: "gestor_2", display_name: "MARC", provinces: ["Malaga", "Murcia"], active: true },
  { id: "gestor_3", display_name: "KILIAN", provinces: ["Barcelona"], active: true }
];

const FILAS_DELEGACION = [
  { delegacion_id: "del_1", delegacion_nombre: "TRADE SUR", provincias: ["Malaga", "Murcia"] },
  { delegacion_id: "del_2", delegacion_nombre: "NORTE PLV", provincias: ["Asturias"] }
];

const USUARIOS_DELEGACION = [
  { id: "del_1", display_name: "TRADE SUR", provinces: ["Malaga", "Murcia", "Almeria"], active: true },
  { id: "del_2", display_name: "NORTE PLV", provinces: ["Asturias"], active: true }
];

const puntos = [
  { id: "p1", provincia: "Barcelona" },
  { id: "p2", provincia: "Malaga" },
  { id: "p3", provincia: "Asturias" },
  { id: "p4", provincia: "Valencia" },
  { id: "p5", provincia: "Murcia" }
];

describe("delegacionesComoCandidatos", () => {
  it("usa las provincias guardadas en la campaña, no las de la ficha del usuario", () => {
    // TRADE SUR cubre hoy también Almería, pero al firmar esta campaña cubría dos
    // provincias: el reparto de la campaña no puede cambiar por editar un usuario.
    const candidatos = delegacionesComoCandidatos(FILAS_DELEGACION, USUARIOS_DELEGACION);
    expect(candidatos.find(c => c.id === "del_1")?.provinces).toEqual(["Malaga", "Murcia"]);
  });

  it("cae a las provincias del usuario cuando la fila no guardó ninguna", () => {
    const candidatos = delegacionesComoCandidatos([{ delegacion_id: "del_1", provincias: [] }], USUARIOS_DELEGACION);
    expect(candidatos[0].provinces).toEqual(["Malaga", "Murcia", "Almeria"]);
    expect(candidatos[0].display_name).toBe("TRADE SUR");
  });

  it("una delegación desactivada deja de repartir", () => {
    const candidatos = delegacionesComoCandidatos(FILAS_DELEGACION, [
      { id: "del_1", display_name: "TRADE SUR", provinces: ["Malaga"], active: false },
      ...USUARIOS_DELEGACION.slice(1)
    ]);
    expect(candidatos.find(c => c.id === "del_1")?.active).toBe(false);
  });

  it("ignora filas sin delegación", () => {
    expect(delegacionesComoCandidatos([{ delegacion_id: null, provincias: [] }], [])).toHaveLength(0);
  });
});

describe("provinciasDelegadas / esProvinciaDelegada", () => {
  const candidatos = delegacionesComoCandidatos(FILAS_DELEGACION, USUARIOS_DELEGACION);

  it("lista las zonas subcontratadas ordenadas", () => {
    expect(provinciasDelegadas(candidatos)).toEqual(["Asturias", "Malaga", "Murcia"]);
  });

  it("compara sin importar los acentos", () => {
    const delegadas = provinciasDelegadas(candidatos);
    expect(esProvinciaDelegada("Malaga", delegadas)).toBe(true);
    expect(esProvinciaDelegada("Málaga", delegadas)).toBe(true);
    expect(esProvinciaDelegada("Barcelona", delegadas)).toBe(false);
    expect(esProvinciaDelegada(null, delegadas)).toBe(false);
  });

  it("no cuenta las zonas de una delegación desactivada", () => {
    expect(provinciasDelegadas([{ id: "x", display_name: "X", provinces: ["Cadiz"], active: false }])).toEqual([]);
  });
});

describe("responsablesDeZona · la regla completa en una función", () => {
  const delegaciones = delegacionesComoCandidatos(FILAS_DELEGACION, USUARIOS_DELEGACION);

  it("con el modo APAGADO las delegaciones se ignoran aunque estén guardadas", () => {
    // Guardar la lista y activarla más tarde no puede cambiar nada por sí solo.
    const { candidatos, delegadas } = responsablesDeZona(GESTORES, delegaciones, false);
    expect(candidatos).toEqual(GESTORES);
    expect(delegadas).toEqual([]);
  });

  it("con el modo ENCENDIDO la delegación sustituye al gestor solo en SUS provincias", () => {
    const { candidatos } = responsablesDeZona(GESTORES, delegaciones, true);
    // MAI conserva Valencia y Alicante, pero pierde Asturias (subcontratada).
    expect(candidatos.find(c => c.id === "gestor_1")?.provinces).toEqual(["Valencia", "Alicante"]);
    // MARC se queda sin provincias propias: sale del reparto.
    expect(candidatos.find(c => c.id === "gestor_2")).toBeUndefined();
    // KILIAN no está afectado.
    expect(candidatos.find(c => c.id === "gestor_3")?.provinces).toEqual(["Barcelona"]);
    // Y las dos delegaciones entran.
    expect(candidatos.filter(c => c.role === "delegacion").map(c => c.id).sort()).toEqual(["del_1", "del_2"]);
  });

  it("sin delegaciones marcadas se comporta como antes de v11.5", () => {
    const { candidatos, delegadas } = responsablesDeZona(GESTORES, [], true);
    expect(candidatos).toEqual(GESTORES);
    expect(delegadas).toEqual([]);
  });
});

describe("reparto de puntos con delegaciones", () => {
  const delegaciones = delegacionesComoCandidatos(FILAS_DELEGACION, USUARIOS_DELEGACION);

  it("los puntos de zona subcontratada van a la delegación y el resto a los gestores", () => {
    const { candidatos } = responsablesDeZona(GESTORES, delegaciones, true);
    const { sugerencias } = sugerirGestoresPorPunto(puntos, candidatos);
    const porPunto = new Map(sugerencias.map(s => [s.punto_id, s.persona_nombre]));
    expect(porPunto.get("p2")).toBe("TRADE SUR");  // Málaga
    expect(porPunto.get("p5")).toBe("TRADE SUR");  // Murcia
    expect(porPunto.get("p3")).toBe("NORTE PLV");  // Asturias
    expect(porPunto.get("p1")).toBe("KILIAN");     // Barcelona, sin delegación
    expect(porPunto.get("p4")).toBe("MAI");        // Valencia, sin delegación
  });

  it("con el modo apagado los mismos puntos van a los gestores de siempre", () => {
    const { candidatos } = responsablesDeZona(GESTORES, delegaciones, false);
    const { sugerencias } = sugerirGestoresPorPunto(puntos, candidatos);
    const porPunto = new Map(sugerencias.map(s => [s.punto_id, s.persona_nombre]));
    expect(porPunto.get("p2")).toBe("MARC");
    expect(porPunto.get("p3")).toBe("MAI");
  });

  it("una delegación sin provincias no se lleva ningún punto y la zona queda sin cubrir", () => {
    const sinZona = delegacionesComoCandidatos([{ delegacion_id: "del_x", delegacion_nombre: "SIN ZONA", provincias: [] }], []);
    const { candidatos } = responsablesDeZona(GESTORES, sinZona, true);
    const { sugerencias, provinciasSinCandidato } = sugerirGestoresPorPunto([{ id: "p9", provincia: "Cadiz" }], candidatos);
    expect(sugerencias).toHaveLength(0);
    expect(provinciasSinCandidato).toEqual(["Cadiz"]);
  });
});
