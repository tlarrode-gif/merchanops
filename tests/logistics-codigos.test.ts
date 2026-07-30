import { describe, expect, it } from "vitest";
import { PREFIJO_CODIGO_SOLICITUD, codigoSolicitudEnMemoria } from "@/lib/logistics-sync";
import type { LogisticsState } from "@/lib/logistics";

function estado(codes: string[]): LogisticsState {
  return { requests: codes.map(code => ({ code })) } as unknown as LogisticsState;
}

const hoy = new Date();
const dia = [
  String(hoy.getFullYear()).slice(2),
  String(hoy.getMonth() + 1).padStart(2, "0"),
  String(hoy.getDate()).padStart(2, "0")
].join("");

describe("código de solicitud logística {ORIGEN}-{AAMMDD}-{NNN}", () => {
  it("usa un prefijo distinto por origen", () => {
    expect(codigoSolicitudEnMemoria(estado([]), "campaign")).toBe(`GC-${dia}-001`);
    expect(codigoSolicitudEnMemoria(estado([]), "service_point")).toBe(`SRV-${dia}-001`);
    expect(codigoSolicitudEnMemoria(estado([]), "service")).toBe(`SRV-${dia}-001`);
    expect(codigoSolicitudEnMemoria(estado([]), "isdin_vinyl")).toBe(`ISD-${dia}-001`);
  });

  it("cae en LOG cuando el origen es desconocido", () => {
    expect(codigoSolicitudEnMemoria(estado([]), "otra_cosa")).toBe(`LOG-${dia}-001`);
    expect(PREFIJO_CODIGO_SOLICITUD.campaign).toBe("GC");
  });

  it("numera dentro del mismo origen y día", () => {
    const state = estado([`GC-${dia}-001`, `GC-${dia}-002`]);
    expect(codigoSolicitudEnMemoria(state, "campaign")).toBe(`GC-${dia}-003`);
  });

  it("cada origen lleva su propia numeración", () => {
    const state = estado([`GC-${dia}-001`, `GC-${dia}-002`, `GC-${dia}-003`]);
    expect(codigoSolicitudEnMemoria(state, "isdin_vinyl")).toBe(`ISD-${dia}-001`);
  });

  it("no cuenta los códigos de otros días ni el formato antiguo", () => {
    const state = estado([`GC-250101-007`, "LOG-2026-0013", `SRV-${dia}-001`]);
    expect(codigoSolicitudEnMemoria(state, "campaign")).toBe(`GC-${dia}-001`);
  });

  it("el formato nunca puede coincidir con un código antiguo LOG-AAAA-NNNN", () => {
    const nuevo = codigoSolicitudEnMemoria(estado([]), "campaign");
    expect(nuevo).not.toMatch(/^LOG-\d{4}-\d{4}$/);
    expect(nuevo).toMatch(/^(GC|SRV|ISD|LOG)-\d{6}-\d{3}$/);
  });

  it("ordena cronológicamente al ordenar como texto dentro del mismo origen", () => {
    const codigos = [`GC-260801-002`, `GC-260730-001`, `GC-260801-001`];
    expect([...codigos].sort()).toEqual([`GC-260730-001`, `GC-260801-001`, `GC-260801-002`]);
  });
});
