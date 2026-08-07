import { describe, expect, it } from "vitest";
import {
  horaDesdeMinutos,
  horasDelPunto,
  horasEntreMarcas,
  minutosDeHora,
  normalizarHora,
  numeroReportado,
  valorPuntoEur
} from "@/lib/campana-horas";

describe("minutosDeHora · las cinco formas en que llega una hora", () => {
  it("lee texto con separador de horas", () => {
    expect(minutosDeHora("8:30")).toBe(510);
    expect(minutosDeHora("08:30")).toBe(510);
    expect(minutosDeHora("08:30:00")).toBe(510);
    expect(minutosDeHora("8h30")).toBe(510);
  });

  it("lee la hora en punto escrita a secas", () => {
    expect(minutosDeHora("8")).toBe(480);
    expect(minutosDeHora("18")).toBe(1080);
  });

  it("lee la fracción de día con la que Excel guarda las horas de verdad", () => {
    // 08:30 = 8,5/24 = 0,354166…
    expect(minutosDeHora(0.3541666666666667)).toBe(510);
    expect(minutosDeHora(0.5)).toBe(720);
  });

  it("descarta la parte de fecha de un serial completo de Excel", () => {
    expect(minutosDeHora(45000.5)).toBe(720);
  });

  it("lee un Date (SheetJS con cellDates)", () => {
    expect(minutosDeHora(new Date(2026, 1, 9, 8, 30))).toBe(510);
  });

  it("devuelve null —jamás 0— con lo que no entiende", () => {
    expect(minutosDeHora("mañana")).toBeNull();
    expect(minutosDeHora("25:00")).toBeNull();
    expect(minutosDeHora("8:75")).toBeNull();
    expect(minutosDeHora("")).toBeNull();
    expect(minutosDeHora(null)).toBeNull();
    expect(minutosDeHora(-0.5)).toBeNull();
  });
});

describe("normalizarHora / horaDesdeMinutos", () => {
  it("normaliza al HH:MM que guarda la base", () => {
    expect(normalizarHora("8:5")).toBe("08:05");
    expect(normalizarHora(0.75)).toBe("18:00");
    expect(normalizarHora("basura")).toBeNull();
  });

  it("rechaza minutos fuera del día", () => {
    expect(horaDesdeMinutos(-1)).toBeNull();
    expect(horaDesdeMinutos(24 * 60 + 1)).toBeNull();
    expect(horaDesdeMinutos(24 * 60)).toBe("24:00");
  });
});

describe("horasEntreMarcas", () => {
  it("calcula el turno con dos decimales", () => {
    expect(horasEntreMarcas("08:00", "16:30")).toEqual({ horas: 8.5 });
    expect(horasEntreMarcas("09:15", "13:45")).toEqual({ horas: 4.5 });
    expect(horasEntreMarcas("10:00", "10:20")).toEqual({ horas: 0.33 });
  });

  it("sin alguna de las dos marcas no es un error del usuario, es que falta el dato", () => {
    expect(horasEntreMarcas("08:00", null)).toEqual({ horas: null, error: "sin_datos" });
    expect(horasEntreMarcas(null, "16:00")).toEqual({ horas: null, error: "sin_datos" });
    expect(horasEntreMarcas("", "")).toEqual({ horas: null, error: "sin_datos" });
  });

  it("una salida anterior a la entrada NO se interpreta como turno de noche", () => {
    // Adivinar aquí es inventarse ocho horas en la nómina de alguien.
    expect(horasEntreMarcas("22:00", "06:00")).toEqual({ horas: null, error: "salida_anterior_a_entrada" });
  });

  it("una hora ilegible se señala como tal", () => {
    expect(horasEntreMarcas("mañana", "16:00")).toEqual({ horas: null, error: "hora_no_reconocida" });
  });

  it("un turno de duración cero es válido: es 0 h, no un error", () => {
    expect(horasEntreMarcas("10:00", "10:00")).toEqual({ horas: 0 });
  });
});

describe("horasDelPunto · qué gana cuando hay dos fuentes", () => {
  it("las marcas horarias mandan sobre el total importado", () => {
    expect(horasDelPunto({ hora_entrada: "08:00", hora_salida: "12:00", horas_trabajadas: 9 })).toEqual({ horas: 4 });
  });

  it("sin marcas se usa el total que trae el Excel ya sumado", () => {
    expect(horasDelPunto({ hora_entrada: null, hora_salida: null, horas_trabajadas: 7.5 })).toEqual({ horas: 7.5 });
  });

  it("un turno incoherente no cae al total importado: se queda en error", () => {
    // Si cayera, un reporte mal tecleado se pagaría con el número viejo sin avisar.
    expect(horasDelPunto({ hora_entrada: "22:00", hora_salida: "06:00", horas_trabajadas: 8 }))
      .toEqual({ horas: null, error: "salida_anterior_a_entrada" });
  });

  it("sin nada devuelve sin_datos", () => {
    expect(horasDelPunto({})).toEqual({ horas: null, error: "sin_datos" });
  });
});

describe("numeroReportado", () => {
  it("acepta la coma decimal española, el separador de millares y las unidades", () => {
    expect(numeroReportado("12,5")).toBe(12.5);
    expect(numeroReportado("1.234,50")).toBe(1234.5);
    expect(numeroReportado("120 km")).toBe(120);
    expect(numeroReportado("7,5 horas")).toBe(7.5);
  });

  it("rechaza negativos y basura en vez de devolver 0", () => {
    expect(numeroReportado("-5")).toBeNull();
    expect(numeroReportado("muchos")).toBeNull();
    expect(numeroReportado("")).toBeNull();
    expect(numeroReportado(null)).toBeNull();
  });
});

describe("valorPuntoEur · espejo de lo que liquida el motor de pagos", () => {
  const punto = { importe: 25, hora_entrada: "08:00", hora_salida: "16:00", kilometros: 40 };

  it("campaña por punto: vale el importe del punto", () => {
    expect(valorPuntoEur(punto, {})).toBe(25);
  });

  it("campaña por horas: vale horas x tarifa, y el importe del punto se ignora", () => {
    expect(valorPuntoEur(punto, { pago_por_horas: true, tarifa_hora: 10 })).toBe(80);
  });

  it("el kilometraje se suma aparte y funciona también en campañas por punto", () => {
    expect(valorPuntoEur(punto, { pago_kilometraje: true, tarifa_km: 0.26 })).toBe(35.4);
    expect(valorPuntoEur(punto, { pago_por_horas: true, tarifa_hora: 10, pago_kilometraje: true, tarifa_km: 0.26 })).toBe(90.4);
  });

  it("sin tarifa vale 0 en el KPI (y en Pagos sale BLOQUEADO, no gratis)", () => {
    expect(valorPuntoEur(punto, { pago_por_horas: true, tarifa_hora: null })).toBe(0);
  });

  it("un turno incoherente no aporta horas al total", () => {
    expect(valorPuntoEur({ hora_entrada: "22:00", hora_salida: "06:00" }, { pago_por_horas: true, tarifa_hora: 10 })).toBe(0);
  });
});
