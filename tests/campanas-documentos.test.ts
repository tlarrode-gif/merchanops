import { describe, expect, it } from "vitest";

import {
  Documento,
  MAX_DOC_BYTES,
  agruparDocumentos,
  extensionDe,
  formatearTamano,
  historialVersiones,
  mimeDeArchivo,
  nombreSeguroArchivo,
  puedeBorrar,
  rutaDocumento,
  validarArchivo
} from "@/lib/campana-documentos";
import { AppSession } from "@/lib/access-control";

function doc(patch: Partial<Documento> = {}): Documento {
  return {
    id: "d1",
    campana_id: "c1",
    punto_id: null,
    nombre: "Planograma",
    categoria: "planograma",
    storage_path: "c1/campana/x-planograma.pdf",
    mime: "application/pdf",
    tamano_bytes: 1024,
    version: 1,
    sustituye_a: null,
    vigente: true,
    visible_instalador: false,
    visible_gestor: true,
    subido_por: "u1",
    subido_por_nombre: "Marta",
    created_at: "2026-08-04T09:00:00Z",
    deleted_at: null,
    ...patch
  };
}

function sesion(patch: Partial<AppSession> = {}): AppSession {
  return {
    id: "u1",
    username: "marta",
    display_name: "Marta",
    role: "manager",
    active: true,
    provinces: ["Barcelona"],
    permissions: { servicios: true, isdin: true, calendario: true, pagos: true, logistica: true, rrhh: true, usuarios: false },
    ...patch
  } as AppSession;
}

describe("mimeDeArchivo", () => {
  it("acepta el MIME del navegador cuando lo conocemos", () => {
    expect(mimeDeArchivo("plano.pdf", "application/pdf")).toBe("application/pdf");
  });

  it("deduce por extensión cuando el navegador no manda un MIME útil", () => {
    // Windows manda application/octet-stream para muchos .xlsx y .heic.
    expect(mimeDeArchivo("reporte.xlsx", "application/octet-stream"))
      .toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(mimeDeArchivo("foto.HEIC", "")).toBe("image/heic");
  });

  it("devuelve vacío cuando no hay forma de saberlo", () => {
    expect(mimeDeArchivo("cosa.exe", "application/x-msdownload")).toBe("");
    expect(mimeDeArchivo("sinextension", "")).toBe("");
  });
});

describe("validarArchivo", () => {
  it("acepta un PDF normal", () => {
    expect(validarArchivo({ name: "briefing.pdf", size: 2048, type: "application/pdf" })).toBeNull();
  });

  it("rechaza por tamaño diciendo cuánto ocupa y cuál es el tope", () => {
    const motivo = validarArchivo({ name: "video.pdf", size: MAX_DOC_BYTES + 1, type: "application/pdf" });
    expect(motivo).toContain("25 MB");
  });

  it("rechaza un tipo que no está en la lista blanca", () => {
    expect(validarArchivo({ name: "virus.exe", size: 10, type: "" })).toContain("No se admite");
  });

  it("rechaza el archivo vacío", () => {
    expect(validarArchivo({ name: "vacio.pdf", size: 0, type: "application/pdf" })).toBe("El archivo está vacío.");
  });
});

describe("nombreSeguroArchivo", () => {
  it("quita acentos, espacios y símbolos", () => {
    expect(nombreSeguroArchivo("Planograma Añadido (v2).pdf")).toBe("planograma-anadido-v2.pdf");
  });

  it("nunca devuelve vacío", () => {
    expect(nombreSeguroArchivo("///")).toBe("documento");
    expect(nombreSeguroArchivo("")).toBe("documento");
  });

  it("corta los nombres kilométricos", () => {
    expect(nombreSeguroArchivo("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("rutaDocumento", () => {
  it("pone SIEMPRE la campaña como primera carpeta (de ahí sale el ámbito en Storage)", () => {
    const ruta = rutaDocumento("camp-1", null, "Briefing.pdf", "abc");
    expect(ruta.split("/")[0]).toBe("camp-1");
    expect(ruta).toBe("camp-1/campana/abc-briefing.pdf");
  });

  it("separa los documentos de punto en su propia carpeta", () => {
    expect(rutaDocumento("camp-1", "p9", "Foto.jpg", "abc")).toBe("camp-1/punto-p9/abc-foto.jpg");
  });
});

describe("agruparDocumentos", () => {
  it("separa campaña de puntos y deja fuera lo retirado y lo no vigente", () => {
    const agrupado = agruparDocumentos([
      doc({ id: "a" }),
      doc({ id: "b", punto_id: "p1" }),
      doc({ id: "c", punto_id: "p1" }),
      doc({ id: "d", deleted_at: "2026-08-04T10:00:00Z" }),
      doc({ id: "e", vigente: false })
    ]);
    expect(agrupado.campana.map(d => d.id)).toEqual(["a"]);
    expect(agrupado.porPunto).toHaveLength(1);
    expect(agrupado.porPunto[0]).toEqual({ puntoId: "p1", documentos: [expect.objectContaining({ id: "b" }), expect.objectContaining({ id: "c" })] });
  });
});

describe("historialVersiones", () => {
  it("devuelve la cadena de la más nueva a la más vieja", () => {
    const documentos = [
      doc({ id: "v3", version: 3, sustituye_a: "v2" }),
      doc({ id: "v2", version: 2, sustituye_a: "v1", vigente: false }),
      doc({ id: "v1", version: 1, sustituye_a: null, vigente: false })
    ];
    expect(historialVersiones(documentos, "v3").map(d => d.id)).toEqual(["v3", "v2", "v1"]);
  });

  it("no se cuelga si los datos tienen un ciclo", () => {
    const documentos = [
      doc({ id: "a", sustituye_a: "b" }),
      doc({ id: "b", sustituye_a: "a" })
    ];
    expect(historialVersiones(documentos, "a").map(d => d.id)).toEqual(["a", "b"]);
  });
});

describe("puedeBorrar", () => {
  it("administración puede retirar cualquiera", () => {
    expect(puedeBorrar(sesion({ role: "admin", id: "otro" }), doc())).toBe(true);
  });

  it("el gestor solo puede retirar los suyos", () => {
    expect(puedeBorrar(sesion({ id: "u1" }), doc({ subido_por: "u1" }))).toBe(true);
    expect(puedeBorrar(sesion({ id: "u2" }), doc({ subido_por: "u1" }))).toBe(false);
  });

  it("sin sesión, no", () => {
    expect(puedeBorrar(null, doc())).toBe(false);
  });
});

describe("utilidades", () => {
  it("formatea tamaños legibles", () => {
    expect(formatearTamano(512)).toBe("512 B");
    expect(formatearTamano(2048)).toBe("2 KB");
    expect(formatearTamano(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("saca la extensión en minúsculas", () => {
    expect(extensionDe("Reporte.XLSX")).toBe("xlsx");
    expect(extensionDe("sinpunto")).toBe("");
  });
});
