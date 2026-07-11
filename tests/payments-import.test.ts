/**
 * Pruebas de la importación CSV unificada (fase 3). La atomicidad, la
 * idempotencia por hash de archivo y el rollback ante fallo intermedio se
 * verificaron EN VIVO contra la base real (RPC confirm_import_run, transacción
 * revertida): confirmación ok, reimportación => 'duplicada' sin re-aplicar,
 * fallo intermedio => cero runs y cero obligaciones parciales, registro de
 * importaciones inmutable. Aquí se prueba la validación y la previsualización.
 */
import { describe, expect, it } from "vitest";
import { previewIsdinImport, sha256Hex } from "@/lib/payments/import";

const HEADER = "nombre farmacia;Vinyl;Estado;COMENTARIOS;Tipo;Campaña;Alto;Ancho;PAGO BASE;Semana;Calle;Numero;Ciudad;CP;Provincia;INSTALADOR;Obs;ANDAMIO;Revisitas;Telefono";

function line(overrides: Partial<Record<"farmacia" | "vin" | "estado" | "base" | "revisitas", string>> = {}) {
  const v = { farmacia: "Farmacia Sol", vin: "VIN-100", estado: "Incidencia", base: "40", revisitas: "2", ...overrides };
  return `${v.farmacia};${v.vin};${v.estado};;Vinilo a medida;ISDIN 2026;200;150;${v.base};Semana 27;Calle Mayor;1;Madrid;28001;Madrid;Manuel;obs;No;${v.revisitas};600111222`;
}

describe("previsualización de importación ISDIN", () => {
  it("valida y calcula obligaciones sin tocar la base", async () => {
    const preview = await previewIsdinImport(`${HEADER}\n${line()}`);
    expect(preview.validCount).toBe(1);
    expect(preview.rejectedCount).toBe(0);
    // Incidencia con 2 revisitas => 2 obligaciones de 8,56
    expect(preview.obligations.map((o) => o.key)).toEqual(["isdin:VIN-100:failed_visit:1", "isdin:VIN-100:failed_visit:2"]);
    expect(preview.obligations.every((o) => o.amountCents === 856)).toBe(true);
    // El CSV trae semanas, no fechas: nacen bloqueadas, jamás fechadas a hoy.
    expect(preview.obligations.every((o) => !o.payable && o.blockedReasons.includes("missing_event_date"))).toBe(true);
  });

  it("un importe inválido rechaza la fila con error, no lo convierte en 0", async () => {
    const preview = await previewIsdinImport(`${HEADER}\n${line({ estado: "Finalizado", base: "cuarenta" })}`);
    expect(preview.rejectedCount).toBe(1);
    expect(preview.rows[0].errors.join(" ")).toMatch(/Pago base inválido/);
    expect(preview.obligations).toHaveLength(0);
  });

  it("no inventa estados ni identificadores: filas incompletas se rechazan", async () => {
    const preview = await previewIsdinImport([
      HEADER,
      line({ vin: "" }), // sin VIN
      line({ vin: "VIN-2", estado: "" }), // sin estado
      line({ vin: "VIN-3", estado: "EstadoRaro" }) // estado desconocido
    ].join("\n"));
    expect(preview.rejectedCount).toBe(3);
    expect(preview.rows[0].errors.join(" ")).toMatch(/VIN/);
    expect(preview.rows[1].errors.join(" ")).toMatch(/estado/i);
    expect(preview.rows[2].errors.join(" ")).toMatch(/Estado desconocido/);
  });

  it("Finalizado sin pago base se rechaza; Finalizado con importe queda incluido en pagos", async () => {
    const bad = await previewIsdinImport(`${HEADER}\n${line({ estado: "Finalizado", base: "" })}`);
    expect(bad.rejectedCount).toBe(1);

    const ok = await previewIsdinImport(`${HEADER}\n${line({ estado: "Finalizado", base: "40", revisitas: "0" })}`);
    expect(ok.validCount).toBe(1);
    const installation = ok.obligations.find((o) => o.type === "installation");
    expect(installation?.amountCents).toBe(4000);
  });

  it("detecta VIN duplicado dentro del mismo archivo", async () => {
    const preview = await previewIsdinImport(`${HEADER}\n${line()}\n${line()}`);
    expect(preview.validCount).toBe(1);
    expect(preview.rejectedCount).toBe(1);
    expect(preview.rows[1].errors.join(" ")).toMatch(/duplicado/);
  });

  it("6. la huella de archivo y de fila son estables: reimportar produce huellas idénticas", async () => {
    const text = `${HEADER}\n${line()}`;
    const a = await previewIsdinImport(text);
    const b = await previewIsdinImport(text);
    expect(a.fileHash).toBe(b.fileHash);
    expect(a.rows[0].fingerprint).toBe(b.rows[0].fingerprint);
    // La huella de fila es por identidad (VIN), no por importe:
    const c = await previewIsdinImport(`${HEADER}\n${line({ base: "55" })}`);
    expect(c.rows[0].fingerprint).toBe(a.rows[0].fingerprint);
    expect(c.fileHash).not.toBe(a.fileHash);
  });

  it("el payload minimizado no incluye teléfono ni comentarios", async () => {
    const preview = await previewIsdinImport(`${HEADER}\n${line()}`);
    const payload = JSON.stringify(preview.rows[0].payload);
    expect(payload).not.toMatch(/600111222|obs/);
  });

  it("sha256Hex es determinista", async () => {
    expect(await sha256Hex("hola")).toBe(await sha256Hex("hola"));
    expect(await sha256Hex("hola")).not.toBe(await sha256Hex("hola2"));
  });
});
