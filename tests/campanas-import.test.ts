import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { MAX_FILE_BYTES, parseImportFile } from "@/lib/csv-parser";

function textFile(text: string, name: string, type = "text/csv") {
  return new File([text], name, { type });
}

function sheetFile(sheets: Record<string, unknown[][]>, name: string, bookType: XLSX.BookType = "xlsx") {
  const workbook = XLSX.utils.book_new();
  for (const [hoja, filas] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(filas), hoja);
  }
  const buffer = XLSX.write(workbook, { type: "array", bookType });
  return new File([buffer], name, { type: "" });
}

const CABECERAS = ["Codigo", "Nombre comercial", "Direccion", "Provincia"];
const FILA = ["PV-1", "Farmacia Sol", "Calle Mayor 1", "Madrid"];

describe("parseImportFile · formatos de archivo", () => {
  it("acepta CSV con punto y coma", async () => {
    const result = await parseImportFile(textFile("codigo;nombre_comercial;provincia\nPV-1;Farmacia Sol;Madrid\n", "puntos.csv"));
    expect(result.fileError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data.nombre_comercial).toBe("Farmacia Sol");
    expect(result.rows[0].errors).toEqual([]);
  });

  it("acepta CSV con comas y cabeceras entrecomilladas que contienen comas", async () => {
    const text = '"Nombre comercial","Direccion, completa","Provincia"\n"Farmacia Sol","Calle Mayor 1, 2 A","Madrid"\n';
    const result = await parseImportFile(textFile(text, "puntos.csv"));
    expect(result.fileError).toBeUndefined();
    expect(result.rows[0].data.nombre_comercial).toBe("Farmacia Sol");
    expect(result.rows[0].data.datos_extra).toEqual({ "Direccion, completa": "Calle Mayor 1, 2 A" });
  });

  it("acepta CSV con tabuladores y extensión .tsv", async () => {
    const result = await parseImportFile(textFile("Nombre\tProvincia\nFarmacia Sol\tMadrid\n", "puntos.tsv", "text/tab-separated-values"));
    expect(result.fileError).toBeUndefined();
    expect(result.rows[0].data.provincia).toBe("Madrid");
  });

  it("acepta XLSX", async () => {
    const result = await parseImportFile(sheetFile({ Hoja1: [CABECERAS, FILA] }, "puntos.xlsx"));
    expect(result.fileError).toBeUndefined();
    expect(result.sheetName).toBe("Hoja1");
    expect(result.rows[0].data.codigo).toBe("PV-1");
  });

  it("acepta XLSM y XLS", async () => {
    for (const [name, bookType] of [["puntos.xlsm", "xlsm"], ["puntos.xls", "xls"]] as Array<[string, XLSX.BookType]>) {
      const result = await parseImportFile(sheetFile({ Datos: [CABECERAS, FILA] }, name, bookType));
      expect(result.fileError, name).toBeUndefined();
      expect(result.rows, name).toHaveLength(1);
    }
  });

  it("acepta la extensión en mayúsculas", async () => {
    const result = await parseImportFile(sheetFile({ Hoja1: [CABECERAS, FILA] }, "PUNTOS.XLSX"));
    expect(result.fileError).toBeUndefined();
  });

  it("acepta un XLSX renombrado con extensión desconocida (detección por firma)", async () => {
    const result = await parseImportFile(sheetFile({ Hoja1: [CABECERAS, FILA] }, "centros_junio"));
    expect(result.fileError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
  });

  it("rechaza con mensaje claro un formato que no es tabla", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0, 1, 2, 3, 4, 5, 6, 7])], "puntos.pdf", { type: "application/pdf" });
    const result = await parseImportFile(pdf);
    expect(result.fileError).toContain("No se reconoce el formato");
  });

  it("rechaza archivos vacíos y demasiado grandes", async () => {
    expect((await parseImportFile(textFile("", "puntos.csv"))).fileError).toContain("vacío");
    const grande = new File(["x".repeat(MAX_FILE_BYTES + 1)], "puntos.csv", { type: "text/csv" });
    expect((await parseImportFile(grande)).fileError).toContain("máximo es");
  });
});

describe("parseImportFile · cabeceras y hojas reales", () => {
  it("salta títulos y filas en blanco por encima de la cabecera", async () => {
    const result = await parseImportFile(sheetFile({
      Hoja1: [
        ["INFORME DE CENTROS 2026", "", "", ""],
        ["Cliente: ISDIN", "", "", ""],
        [],
        CABECERAS,
        FILA,
        ["PV-2", "Farmacia Luna", "Gran Via 3", "Barcelona"]
      ]
    }, "informe.xlsx"));
    expect(result.fileError).toBeUndefined();
    expect(result.headerRow).toBe(4);
    expect(result.rows).toHaveLength(2);
    // La fila reportada coincide con la que ve el usuario en Excel.
    expect(result.rows[0].index).toBe(5);
    expect(result.rows[1].index).toBe(6);
  });

  it("usa la hoja con datos aunque no sea la primera", async () => {
    const result = await parseImportFile(sheetFile({
      Portada: [["Instrucciones"], ["Rellena la hoja Centros"]],
      Centros: [CABECERAS, FILA]
    }, "libro.xlsx"));
    expect(result.fileError).toBeUndefined();
    expect(result.sheetName).toBe("Centros");
    expect(result.sheetNames).toEqual(["Portada", "Centros"]);
    expect(result.rows[0].data.nombre_comercial).toBe("Farmacia Sol");
  });

  it("reconoce cabeceras habituales de centros y farmacias", async () => {
    const result = await parseImportFile(textFile("Código centro;Nombre del centro;Dirección;Provincia;Fecha visita;Importe\n001;Farmacia Sol;Calle Mayor 1;A Coruña;15/06/2026;34,50\n", "centros.csv"));
    expect(result.fileError).toBeUndefined();
    expect(result.mapping).toEqual(["codigo", "nombre_comercial", "direccion", "provincia", "fecha_visita", "importe"]);
    // La provincia se normaliza a la grafía canónica del catálogo (sin acentos).
    expect(result.rows[0].data).toMatchObject({ codigo: "001", fecha_visita: "2026-06-15", importe: 34.5, provincia: "A Coruna" });
    expect(result.rows[0].errors).toEqual([]);
  });

  it("no rechaza el archivo cuando falta la columna de nombre: pide mapearla", async () => {
    const result = await parseImportFile(textFile("Ref interna;Rotulo del local;Poblacion\nA1;Sol;Madrid\n", "raro.csv"));
    expect(result.fileError).toBeUndefined();
    expect(result.needsNameColumn).toBe(true);
    expect(result.headers).toEqual(["Ref interna", "Rotulo del local", "Poblacion"]);
    expect(result.rows).toHaveLength(1);
    // Ninguna fila se marca con error de nombre: el problema es del esquema, no de la fila.
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].data.nombre_comercial).toBe("");
  });

  it("importa tras mapear a mano la columna de nombre", async () => {
    const file = textFile("Ref interna;Rotulo del local;Poblacion\nA1;Farmacia Sol;Madrid\n", "raro.csv");
    const esquema = [
      { nombre_original: "Ref interna", nombre_visible: "Ref interna", tipo: "texto" as const, campo_interno: "codigo", visible_gestor: true, obligatoria: false, orden: 0, valor_defecto: null },
      { nombre_original: "Rotulo del local", nombre_visible: "Rótulo", tipo: "texto" as const, campo_interno: "nombre_comercial", visible_gestor: true, obligatoria: true, orden: 1, valor_defecto: null },
      { nombre_original: "Poblacion", nombre_visible: "Población", tipo: "texto" as const, campo_interno: null, visible_gestor: true, obligatoria: false, orden: 2, valor_defecto: null }
    ];
    const result = await parseImportFile(file, esquema);
    expect(result.needsNameColumn).toBe(false);
    expect(result.rows[0].data.nombre_comercial).toBe("Farmacia Sol");
    expect(result.rows[0].data.codigo).toBe("A1");
    expect(result.rows[0].data.datos_extra).toEqual({ Poblacion: "Madrid" });
  });

  it("marca error solo en las filas sin nombre cuando la columna sí existe", async () => {
    const result = await parseImportFile(textFile("Nombre;Provincia\nFarmacia Sol;Madrid\n;Madrid\n", "puntos.csv"));
    expect(result.needsNameColumn).toBe(false);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[1].errors[0]).toContain("Falta el nombre comercial");
  });

  it("no confunde una fila de datos con la cabecera", async () => {
    // "Farmacia" y "Centro" son alias de nombre_comercial: como valores de celda no
    // deben convertir la fila de datos en cabecera.
    const result = await parseImportFile(sheetFile({
      Hoja1: [["Ref interna", "Rotulo", "Poblacion"], ["A1", "Farmacia", "Madrid"], ["A2", "Centro", "Madrid"]]
    }, "raro.xlsx"));
    expect(result.headerRow).toBe(1);
    expect(result.rows).toHaveLength(2);
  });

  it("detecta una cabecera de una sola columna bajo un título", async () => {
    const result = await parseImportFile(sheetFile({
      Hoja1: [["Listado de centros"], ["Nombre comercial"], ["Farmacia Sol"]]
    }, "listado.xlsx"));
    expect(result.headerRow).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data.nombre_comercial).toBe("Farmacia Sol");
  });

  it("acepta un archivo de avance con solo código y estado (actualización masiva)", async () => {
    const result = await parseImportFile(textFile("Codigo;Estado;Fecha visita\nPV-1;Completado;01/07/2026\n", "avance.csv"));
    expect(result.fileError).toBeUndefined();
    expect(result.needsNameColumn).toBe(true);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].data).toMatchObject({ codigo: "PV-1", estado: "completado", fecha_visita: "2026-07-01" });
    // Nombre vacío: la actualización por código no debe pisar el nombre existente.
    expect(result.rows[0].data.nombre_comercial).toBe("");
  });
});
