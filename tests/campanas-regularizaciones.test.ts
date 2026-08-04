import { describe, expect, it } from "vitest";

import {
  Regularizacion,
  avisoConceptoRepetido,
  centimosAEuros,
  eurosACentimos,
  mesContableDe,
  resumirRegularizaciones,
  validarRegularizacion
} from "@/lib/campana-regularizaciones";

function reg(patch: Partial<Regularizacion> = {}): Regularizacion {
  return {
    id: "r1",
    campana_id: "c1",
    punto_id: "p1",
    concepto_tipo: "desplazamiento_extra",
    concepto: "Segundo viaje",
    importe_cents: 2500,
    fecha: "2026-08-04",
    mes_contable: "2026-08",
    trabajador_nombre: "Luis",
    refacturable: null,
    estado: "propuesta",
    solicitada_at: "2026-08-04T09:00:00Z",
    ...patch
  };
}

describe("eurosACentimos", () => {
  it("acepta coma y punto decimal", () => {
    expect(eurosACentimos("25,50")).toBe(2550);
    expect(eurosACentimos("25.50")).toBe(2550);
  });

  it("acepta el símbolo del euro y los espacios", () => {
    expect(eurosACentimos(" 25,50 € ")).toBe(2550);
  });

  it("entiende el separador de millares sin confundirlo con el decimal", () => {
    expect(eurosACentimos("1.250,00")).toBe(125000);
    expect(eurosACentimos("1.250")).toBe(125000);
  });

  it("acepta negativos (un descuento es una regularización válida)", () => {
    expect(eurosACentimos("-30")).toBe(-3000);
  });

  it("redondea al céntimo en vez de truncar", () => {
    expect(eurosACentimos("0.125")).toBe(13);
  });

  it("solo trata el punto como millares cuando el número está agrupado de verdad", () => {
    // «12.50» es 12,50 € (dos decimales), no 1.250 €.
    expect(eurosACentimos("12.50")).toBe(1250);
    // «12.500» sí es agrupación de millares.
    expect(eurosACentimos("12.500")).toBe(1250000);
    expect(eurosACentimos("1.250.000")).toBe(125000000);
  });

  it("rechaza lo que no es un número", () => {
    expect(eurosACentimos("veinte")).toBeNull();
    expect(eurosACentimos("12,,3")).toBeNull();
    expect(eurosACentimos("")).toBeNull();
    expect(eurosACentimos(null)).toBeNull();
  });

  it("acepta también un número ya numérico", () => {
    expect(eurosACentimos(30)).toBe(3000);
    expect(eurosACentimos(Number.NaN)).toBeNull();
  });
});

describe("centimosAEuros", () => {
  it("da formato español", () => {
    expect(centimosAEuros(2550)).toBe("25,50 €");
    expect(centimosAEuros(-3000)).toBe("-30,00 €");
  });
});

describe("validarRegularizacion", () => {
  const base = {
    campanaId: "c1",
    conceptoTipo: "revisita" as const,
    concepto: "Segunda visita",
    importe: "25",
    fecha: "2026-08-04"
  };

  it("acepta una propuesta correcta", () => {
    expect(validarRegularizacion(base)).toBeNull();
  });

  it("exige concepto escrito", () => {
    expect(validarRegularizacion({ ...base, concepto: "   " })).toContain("concepto");
  });

  it("exige fecha", () => {
    expect(validarRegularizacion({ ...base, fecha: "" })).toContain("fecha");
  });

  it("rechaza importe cero y no numérico", () => {
    expect(validarRegularizacion({ ...base, importe: "0" })).toContain("cero");
    expect(validarRegularizacion({ ...base, importe: "abc" })).toContain("no es un número");
  });

  it("bloquea contra un mes contable cerrado y dice cuál", () => {
    const motivo = validarRegularizacion(base, ["2026-08"]);
    expect(motivo).toContain("2026-08");
    expect(motivo).toContain("cerrado");
  });

  it("no bloquea si el cerrado es otro mes", () => {
    expect(validarRegularizacion(base, ["2026-07"])).toBeNull();
  });
});

describe("mesContableDe", () => {
  it("saca el mes de una fecha ISO", () => {
    expect(mesContableDe("2026-08-04")).toBe("2026-08");
    expect(mesContableDe("")).toBe("");
  });
});

describe("resumirRegularizaciones", () => {
  it("separa pendiente de aprobado y reparte lo aprobado entre refacturable y asumido", () => {
    const resumen = resumirRegularizaciones([
      reg({ id: "a", estado: "propuesta", importe_cents: 1000 }),
      reg({ id: "b", estado: "aprobada", importe_cents: 2000, refacturable: true }),
      reg({ id: "c", estado: "aprobada", importe_cents: 500, refacturable: false }),
      reg({ id: "d", estado: "rechazada", importe_cents: 9999 })
    ]);
    expect(resumen.pendientes).toBe(1);
    expect(resumen.importePendiente).toBe(1000);
    expect(resumen.aprobadas).toBe(2);
    expect(resumen.importeAprobado).toBe(2500);
    expect(resumen.refacturable).toBe(2000);
    expect(resumen.asumido).toBe(500);
    expect(resumen.rechazadas).toBe(1);
  });

  it("deja las rechazadas fuera del desglose por concepto: no son gasto", () => {
    const resumen = resumirRegularizaciones([
      reg({ id: "a", estado: "rechazada", concepto_tipo: "otro", importe_cents: 9999 }),
      reg({ id: "b", estado: "aprobada", concepto_tipo: "revisita", importe_cents: 100, refacturable: true })
    ]);
    expect(resumen.porConcepto).toEqual([{ tipo: "revisita", cuantas: 1, importe: 100 }]);
  });

  it("no falla con la lista vacía", () => {
    const resumen = resumirRegularizaciones([]);
    expect(resumen.pendientes).toBe(0);
    expect(resumen.porConcepto).toEqual([]);
  });
});

describe("avisoConceptoRepetido", () => {
  it("calla mientras hay pocas regularizaciones", () => {
    const resumen = resumirRegularizaciones([reg({ estado: "aprobada", refacturable: true })]);
    expect(avisoConceptoRepetido(resumen)).toBeNull();
  });

  it("avisa de que un error de tarifa repetido es una tarifa mal puesta", () => {
    const filas = Array.from({ length: 6 }, (_, i) =>
      reg({ id: `r${i}`, estado: "aprobada", refacturable: true, concepto_tipo: i < 4 ? "error_tarifa" : "revisita" })
    );
    const aviso = avisoConceptoRepetido(resumirRegularizaciones(filas));
    expect(aviso).toContain("error de tarifa");
    expect(aviso).toContain("revisa el precio");
  });

  it("avisa también de otros conceptos dominantes, con otro texto", () => {
    const filas = Array.from({ length: 6 }, (_, i) =>
      reg({ id: `r${i}`, estado: "aprobada", refacturable: true, concepto_tipo: i < 5 ? "desplazamiento_extra" : "otro" })
    );
    const aviso = avisoConceptoRepetido(resumirRegularizaciones(filas));
    expect(aviso).toContain("Desplazamiento extra");
    expect(aviso).not.toContain("revisa el precio");
  });

  it("no avisa cuando están repartidas", () => {
    const tipos = ["revisita", "otro", "hora_adicional", "material_repuesto", "desplazamiento_extra", "otro"] as const;
    const filas = tipos.map((tipo, i) => reg({ id: `r${i}`, estado: "aprobada", refacturable: true, concepto_tipo: tipo }));
    expect(avisoConceptoRepetido(resumirRegularizaciones(filas))).toBeNull();
  });
});
