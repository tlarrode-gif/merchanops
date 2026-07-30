import { describe, expect, it } from "vitest";
import {
  CAMPO_DIRECCION_ENVIO,
  CAMPO_IGNORAR,
  CAMPO_INSTALADOR,
  CAMPO_PICKING,
  CampanaColumna,
  camposInternosDuplicados,
  camposNoImportables,
  conColumnasFijas,
  columnasDesdeImportacion,
  esColumnaFija
} from "@/lib/campana-columnas";
import { parseImportFile } from "@/lib/csv-parser";

function csv(text: string, name = "puntos.csv") {
  return new File([text], name, { type: "text/csv" });
}

const CAMPOS_FIJOS = [CAMPO_INSTALADOR, CAMPO_DIRECCION_ENVIO, CAMPO_PICKING];

describe("columnas fijas de campaña", () => {
  it("añade Instalador, Dirección de envío y Picking aunque el Excel no las traiga", () => {
    const columnas = columnasDesdeImportacion(
      ["Codigo", "Nombre", "Provincia"],
      ["codigo", "nombre_comercial", "provincia"]
    );
    expect(columnas.map(col => col.campo_interno)).toEqual([
      "codigo", "nombre_comercial", "provincia", CAMPO_INSTALADOR, CAMPO_DIRECCION_ENVIO, CAMPO_PICKING
    ]);
    expect(columnas.filter(esColumnaFija)).toHaveLength(3);
  });

  it("reutiliza las columnas del Excel que ya son esas, sin duplicarlas", () => {
    // Caso real: el Excel traía PICKING y ENVÍO y hubo que mapearlas a «notas» a mano.
    const columnas = columnasDesdeImportacion(
      ["Nombre", "INSTALADOR", "ENVÍO", "PICKING"],
      ["nombre_comercial", CAMPO_INSTALADOR, CAMPO_DIRECCION_ENVIO, CAMPO_PICKING]
    );
    expect(columnas).toHaveLength(4);
    expect(columnas.map(col => [col.nombre_original, col.campo_interno])).toEqual([
      ["Nombre", "nombre_comercial"],
      ["INSTALADOR", CAMPO_INSTALADOR],
      ["ENVÍO", CAMPO_DIRECCION_ENVIO],
      ["PICKING", CAMPO_PICKING]
    ]);
    // La de picking se fuerza a tipo fecha aunque el archivo la trajera como texto.
    expect(columnas.find(col => col.campo_interno === CAMPO_PICKING)?.tipo).toBe("fecha");
  });

  it("adopta una columna sin mapear cuyo nombre coincide con una fija", () => {
    const columnas = columnasDesdeImportacion(["Nombre", "Trabajador"], ["nombre_comercial", null]);
    expect(columnas).toHaveLength(4);
    expect(columnas.find(col => col.nombre_original === "Trabajador")?.campo_interno).toBe(CAMPO_INSTALADOR);
  });

  it("conColumnasFijas es idempotente", () => {
    const base: CampanaColumna[] = [
      { nombre_original: "Nombre", nombre_visible: "Nombre", tipo: "texto", campo_interno: "nombre_comercial", visible_gestor: true, obligatoria: true, orden: 0, valor_defecto: null }
    ];
    const una = conColumnasFijas(base);
    const dos = conColumnasFijas(una);
    expect(dos).toHaveLength(una.length);
    expect(dos.map(col => col.campo_interno)).toEqual(una.map(col => col.campo_interno));
  });

  it("renumera el orden de forma consecutiva", () => {
    const columnas = columnasDesdeImportacion(["A", "B"], [null, null]);
    expect(columnas.map(col => col.orden)).toEqual([0, 1, 2, 3, 4]);
  });

  it("las tres columnas fijas están marcadas como no importables", () => {
    expect(CAMPOS_FIJOS.every(campo => camposNoImportables.has(campo))).toBe(true);
    expect(camposNoImportables.has("importe")).toBe(false);
  });
});

describe("camposInternosDuplicados", () => {
  it("detecta dos columnas mapeadas al mismo campo interno", () => {
    // Caso real: CLIENTE y Nombre las dos a nombre_comercial; la segunda pisaba la primera.
    const columnas: CampanaColumna[] = [
      { nombre_original: "CLIENTE", nombre_visible: "CLIENTE", tipo: "texto", campo_interno: "nombre_comercial", visible_gestor: true, obligatoria: true, orden: 0, valor_defecto: null },
      { nombre_original: "Nombre", nombre_visible: "Nombre", tipo: "texto", campo_interno: "nombre_comercial", visible_gestor: true, obligatoria: true, orden: 1, valor_defecto: null },
      { nombre_original: "PROV", nombre_visible: "PROV", tipo: "texto", campo_interno: "provincia", visible_gestor: true, obligatoria: false, orden: 2, valor_defecto: null }
    ];
    const duplicados = camposInternosDuplicados(columnas);
    expect(duplicados).toHaveLength(1);
    expect(duplicados[0].columnas).toEqual(["CLIENTE", "Nombre"]);
    expect(duplicados[0].label).toBe("Nombre comercial");
  });

  it("no cuenta como duplicados los datos extra ni las ignoradas", () => {
    const columnas: CampanaColumna[] = [
      { nombre_original: "A", nombre_visible: "A", tipo: "texto", campo_interno: null, visible_gestor: true, obligatoria: false, orden: 0, valor_defecto: null },
      { nombre_original: "B", nombre_visible: "B", tipo: "texto", campo_interno: null, visible_gestor: true, obligatoria: false, orden: 1, valor_defecto: null },
      { nombre_original: "C", nombre_visible: "C", tipo: "texto", campo_interno: CAMPO_IGNORAR, visible_gestor: true, obligatoria: false, orden: 2, valor_defecto: null },
      { nombre_original: "D", nombre_visible: "D", tipo: "texto", campo_interno: CAMPO_IGNORAR, visible_gestor: true, obligatoria: false, orden: 3, valor_defecto: null }
    ];
    expect(camposInternosDuplicados(columnas)).toEqual([]);
  });
});

describe("importación de las columnas reservadas", () => {
  it("«Instalador» del Excel ya no se confunde con el gestor de zona", async () => {
    const result = await parseImportFile(csv("Nombre;Gestor;Instalador\nFarmacia Sol;MAI;MANUEL\n"));
    expect(result.mapping).toEqual(["nombre_comercial", "gestor_nombre", CAMPO_INSTALADOR]);
    expect(result.rows[0].data.gestor_nombre).toBe("MAI");
  });

  it("no importa los valores de Instalador, Envío ni Picking del archivo", async () => {
    const result = await parseImportFile(csv("Nombre;Instalador;Envio;Picking\nFarmacia Sol;MANUEL;Calle Falsa 1;01/07/2026\n"));
    expect(result.fileError).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    // Ni en la ficha del punto ni en datos_extra: los rellenan el gestor y Almacén.
    expect(result.rows[0].data.datos_extra).toEqual({});
    expect(result.rows[0].data.notas).toBeNull();
    expect(JSON.stringify(result.rows[0].data)).not.toContain("Calle Falsa");
    expect(JSON.stringify(result.rows[0].data)).not.toContain("MANUEL");
  });

  it("el esquema generado por el importador incluye esas columnas una sola vez", async () => {
    const result = await parseImportFile(csv("Nombre;Picking\nFarmacia Sol;01/07/2026\n"));
    const columnas = columnasDesdeImportacion(result.headers, result.mapping);
    expect(columnas.filter(col => col.campo_interno === CAMPO_PICKING)).toHaveLength(1);
    expect(columnas.map(col => col.campo_interno)).toContain(CAMPO_INSTALADOR);
  });
});
