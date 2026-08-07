/**
 * MerchanOps · Grandes Campañas — informe para el cliente (v11.3).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * El gestor de cuentas monta a mano, cada semana, el informe de avance que manda
 * al cliente. La única exportación que existía es el volcado de puntos a Excel,
 * que lleva coste, notas internas y nombre del instalador: no es algo que se
 * pueda mandar fuera.
 *
 * LAS TRES REGLAS QUE SOSTIENEN ESTO
 *  1. PLANTILLAS. Configurar «Informe semanal ISDIN» una vez y luego un botón.
 *     Si hay que recomponerlo cada semana, se vuelve a PowerPoint.
 *  2. CANDADO. Cada bloque declara si es interno. Un informe que no está marcado
 *     como interno y lleva un bloque de coste NO se emite: lo rechaza la base
 *     (trigger `merchan_gc_informe_guard`) además de esta capa.
 *  3. CONGELADO. Al emitir se guardan las cifras, no la consulta. Si el informe
 *     se recalculase al abrirlo no se podría defender lo que se mandó el martes.
 *
 * El catálogo de bloques internos está DUPLICADO en v11_3_gc_informes.sql. La
 * base es la que manda; el test `tests/campanas-informes.test.ts` lee el fichero
 * SQL y comprueba que las dos listas no se han separado.
 */

import { supabase } from "@/lib/supabase";
import { Campana, CampanaKpis, IncidenciaCampana, PuntoVenta, dateOnly, eur, formatDate } from "@/lib/campanas";
import { Regularizacion, centimosAEuros, resumirRegularizaciones } from "@/lib/campana-regularizaciones";
import { valorPuntoEur } from "@/lib/campana-horas";

export type ClaveBloque =
  // Bloques que pueden ir a un cliente
  | "avance_general"
  | "avance_provincia"
  | "avance_semanal"
  | "calendario"
  | "incidencias_resumen"
  | "incidencias_detalle"
  | "puntos_completados"
  | "cobertura_equipo"
  // Bloques INTERNOS (ver merchan_gc_bloques_internos() en v11_3)
  | "coste_ejecutado"
  | "importe_total"
  | "presupuesto"
  | "margen"
  | "coste_medio_punto"
  | "regularizaciones_importe"
  | "detalle_pagos";

export type TipoBloque = "cifra" | "tabla" | "lista";

export type DefinicionBloque = {
  clave: ClaveBloque;
  etiqueta: string;
  tipo: TipoBloque;
  /** true = no puede salir en un informe de cliente sin marcarlo como interno. */
  interno: boolean;
  ayuda: string;
};

/**
 * Catálogo completo. El orden es el que se ofrece en la pantalla; el orden del
 * informe lo decide la plantilla.
 */
export const bloques: DefinicionBloque[] = [
  { clave: "avance_general", etiqueta: "Avance general", tipo: "cifra", interno: false, ayuda: "Puntos totales, completados, pendientes y porcentaje." },
  { clave: "avance_provincia", etiqueta: "Avance por provincia", tipo: "tabla", interno: false, ayuda: "Una fila por provincia con su avance." },
  { clave: "avance_semanal", etiqueta: "Avance por semana", tipo: "tabla", interno: false, ayuda: "Puntos completados en cada semana natural." },
  { clave: "calendario", etiqueta: "Fechas de la campaña", tipo: "cifra", interno: false, ayuda: "Inicio, fin y días restantes." },
  { clave: "incidencias_resumen", etiqueta: "Incidencias (resumen)", tipo: "cifra", interno: false, ayuda: "Abiertas, en gestión y resueltas." },
  { clave: "incidencias_detalle", etiqueta: "Incidencias (detalle)", tipo: "lista", interno: false, ayuda: "Punto, descripción y estado. Sin datos internos." },
  { clave: "puntos_completados", etiqueta: "Puntos completados", tipo: "tabla", interno: false, ayuda: "Punto, provincia y fecha de instalación. Sin importes." },
  { clave: "cobertura_equipo", etiqueta: "Equipo desplegado", tipo: "cifra", interno: false, ayuda: "Cuántas personas han trabajado en la campaña (sin nombres)." },
  { clave: "coste_ejecutado", etiqueta: "Coste ejecutado", tipo: "cifra", interno: true, ayuda: "Lo que se paga a los trabajadores por lo ya completado." },
  { clave: "importe_total", etiqueta: "Importe total de los puntos", tipo: "cifra", interno: true, ayuda: "Suma de los importes de todos los puntos." },
  { clave: "presupuesto", etiqueta: "Presupuesto", tipo: "cifra", interno: true, ayuda: "Presupuesto interno de la campaña." },
  { clave: "margen", etiqueta: "Margen sobre presupuesto", tipo: "cifra", interno: true, ayuda: "Presupuesto menos coste ejecutado." },
  { clave: "coste_medio_punto", etiqueta: "Coste medio por punto", tipo: "cifra", interno: true, ayuda: "Coste ejecutado entre puntos completados." },
  { clave: "regularizaciones_importe", etiqueta: "Regularizaciones", tipo: "cifra", interno: true, ayuda: "Aprobado en regularizaciones y cuánto es refacturable." },
  { clave: "detalle_pagos", etiqueta: "Detalle de pagos por trabajador", tipo: "tabla", interno: true, ayuda: "Cuánto cobra cada trabajador. Jamás sale a un cliente." }
];

const bloquePorClave = new Map(bloques.map(bloque => [bloque.clave, bloque]));

export function definicionBloque(clave: ClaveBloque | string): DefinicionBloque | undefined {
  return bloquePorClave.get(clave as ClaveBloque);
}

/** Espejo de `merchan_gc_bloques_internos()` (v11_3). El test comprueba que cuadran. */
export const bloquesInternos: ClaveBloque[] = bloques.filter(bloque => bloque.interno).map(bloque => bloque.clave);

export function esBloqueInterno(clave: ClaveBloque | string): boolean {
  return bloquesInternos.includes(clave as ClaveBloque);
}

export type FilaTabla = Record<string, string | number>;

export type BloqueCalculado = {
  clave: ClaveBloque;
  etiqueta: string;
  tipo: TipoBloque;
  interno: boolean;
  /** Para los bloques de tipo «cifra»: pares etiqueta/valor ya formateados. */
  cifras?: Array<{ etiqueta: string; valor: string }>;
  /** Para «tabla» y «lista». */
  filas?: FilaTabla[];
  columnas?: string[];
};

export type EntradaInforme = {
  campana: Campana;
  kpis: CampanaKpis | null;
  puntos: PuntoVenta[];
  incidencias: IncidenciaCampana[];
  regularizaciones: Regularizacion[];
};

function porcentaje(parte: number, total: number): string {
  if (!total) return "0 %";
  return `${Math.round((parte / total) * 100)} %`;
}

/** Lunes de la semana natural de una fecha ISO, en ISO. Sin objetos Date intermedios ambiguos. */
export function semanaDe(fechaIso: string): string {
  const dia = dateOnly(fechaIso);
  if (!dia) return "";
  const fecha = new Date(`${dia}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return "";
  // getUTCDay(): 0 = domingo. Se retrocede hasta el lunes.
  const desplazamiento = (fecha.getUTCDay() + 6) % 7;
  fecha.setUTCDate(fecha.getUTCDate() - desplazamiento);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Calcula un bloque a partir de los datos de la campaña. Función PURA: recibe
 * todo lo que necesita y no consulta nada.
 */
export function calcularBloque(clave: ClaveBloque, entrada: EntradaInforme): BloqueCalculado | null {
  const definicion = definicionBloque(clave);
  if (!definicion) return null;
  const base = { clave, etiqueta: definicion.etiqueta, tipo: definicion.tipo, interno: definicion.interno };
  const { campana, kpis, puntos, incidencias, regularizaciones } = entrada;
  const total = puntos.length;
  const completados = puntos.filter(punto => punto.estado === "completado");

  switch (clave) {
    case "avance_general":
      return {
        ...base,
        cifras: [
          { etiqueta: "Puntos totales", valor: total.toLocaleString("es-ES") },
          { etiqueta: "Completados", valor: completados.length.toLocaleString("es-ES") },
          { etiqueta: "Pendientes", valor: puntos.filter(p => p.estado === "pendiente").length.toLocaleString("es-ES") },
          { etiqueta: "Avance", valor: porcentaje(completados.length, total) }
        ]
      };

    case "calendario":
      return {
        ...base,
        cifras: [
          { etiqueta: "Inicio", valor: formatDate(campana.fecha_inicio) },
          { etiqueta: "Fin", valor: formatDate(campana.fecha_fin) },
          { etiqueta: "Días restantes", valor: kpis?.dias_restantes == null ? "—" : String(kpis.dias_restantes) }
        ]
      };

    case "avance_provincia": {
      const mapa = new Map<string, { total: number; completados: number }>();
      for (const punto of puntos) {
        const provincia = punto.provincia || "Sin provincia";
        const actual = mapa.get(provincia) || { total: 0, completados: 0 };
        actual.total += 1;
        if (punto.estado === "completado") actual.completados += 1;
        mapa.set(provincia, actual);
      }
      return {
        ...base,
        columnas: ["Provincia", "Puntos", "Completados", "Avance"],
        filas: Array.from(mapa.entries())
          .sort((a, b) => b[1].total - a[1].total)
          .map(([provincia, valores]) => ({
            Provincia: provincia,
            Puntos: valores.total,
            Completados: valores.completados,
            Avance: porcentaje(valores.completados, valores.total)
          }))
      };
    }

    case "avance_semanal": {
      const mapa = new Map<string, number>();
      for (const punto of completados) {
        const semana = semanaDe(punto.fecha_visita || "");
        if (!semana) continue;
        mapa.set(semana, (mapa.get(semana) || 0) + 1);
      }
      return {
        ...base,
        columnas: ["Semana del", "Puntos completados"],
        filas: Array.from(mapa.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([semana, cuantos]) => ({ "Semana del": formatDate(semana), "Puntos completados": cuantos }))
      };
    }

    case "incidencias_resumen":
      return {
        ...base,
        cifras: [
          { etiqueta: "Abiertas", valor: String(incidencias.filter(i => i.estado === "abierta").length) },
          { etiqueta: "En gestión", valor: String(incidencias.filter(i => i.estado === "en_gestion").length) },
          { etiqueta: "Resueltas", valor: String(incidencias.filter(i => i.estado === "resuelta").length) }
        ]
      };

    case "incidencias_detalle": {
      const nombre = new Map(puntos.map(punto => [punto.id, punto.nombre_comercial]));
      return {
        ...base,
        columnas: ["Punto", "Descripción", "Estado"],
        filas: incidencias.map(incidencia => ({
          Punto: nombre.get(String(incidencia.punto_id)) || "—",
          // La descripción es lo que escribió el gestor; no se incluye ningún dato
          // interno más (ni importes ni instalador).
          "Descripción": incidencia.descripcion || "—",
          Estado: incidencia.estado === "en_gestion" ? "En gestión" : incidencia.estado === "resuelta" ? "Resuelta" : "Abierta"
        }))
      };
    }

    case "puntos_completados":
      return {
        ...base,
        columnas: ["Punto", "Provincia", "Fecha"],
        filas: completados.map(punto => ({
          Punto: punto.nombre_comercial,
          Provincia: punto.provincia || "—",
          Fecha: formatDate(punto.fecha_visita)
        }))
      };

    case "cobertura_equipo": {
      // Cuenta, no nombres: quién trabaja para nosotros no es asunto del cliente.
      const personas = new Set(puntos.map(punto => punto.instalador_id || punto.instalador_nombre).filter(Boolean));
      const provincias = new Set(puntos.map(punto => punto.provincia).filter(Boolean));
      return {
        ...base,
        cifras: [
          { etiqueta: "Personas desplegadas", valor: String(personas.size) },
          { etiqueta: "Provincias cubiertas", valor: String(provincias.size) }
        ]
      };
    }

    case "coste_ejecutado":
      return { ...base, cifras: [{ etiqueta: "Coste ejecutado", valor: eur(kpis?.coste_ejecutado ?? 0) }] };

    case "importe_total":
      return { ...base, cifras: [{ etiqueta: "Importe total de los puntos", valor: eur(kpis?.importe_total ?? 0) }] };

    case "presupuesto":
      return { ...base, cifras: [{ etiqueta: "Presupuesto", valor: campana.presupuesto == null ? "Sin presupuesto" : eur(campana.presupuesto) }] };

    case "margen": {
      if (campana.presupuesto == null) {
        return { ...base, cifras: [{ etiqueta: "Margen sobre presupuesto", valor: "Sin presupuesto fijado" }] };
      }
      const margen = Number(campana.presupuesto) - Number(kpis?.coste_ejecutado ?? 0);
      return { ...base, cifras: [{ etiqueta: "Margen sobre presupuesto", valor: eur(margen) }] };
    }

    case "coste_medio_punto": {
      const coste = Number(kpis?.coste_ejecutado ?? 0);
      return {
        ...base,
        cifras: [{
          etiqueta: "Coste medio por punto completado",
          valor: completados.length ? eur(coste / completados.length) : "Sin puntos completados"
        }]
      };
    }

    case "regularizaciones_importe": {
      const resumen = resumirRegularizaciones(regularizaciones);
      return {
        ...base,
        cifras: [
          { etiqueta: "Aprobado en regularizaciones", valor: centimosAEuros(resumen.importeAprobado) },
          { etiqueta: "Refacturable al cliente", valor: centimosAEuros(resumen.refacturable) },
          { etiqueta: "Lo asume la empresa", valor: centimosAEuros(resumen.asumido) },
          { etiqueta: "Pendientes de aprobar", valor: String(resumen.pendientes) }
        ]
      };
    }

    case "detalle_pagos": {
      const mapa = new Map<string, { puntos: number; importe: number }>();
      for (const punto of completados) {
        const persona = punto.instalador_nombre || punto.gestor_nombre || "Sin instalador";
        const actual = mapa.get(persona) || { puntos: 0, importe: 0 };
        actual.puntos += 1;
        // v11.5 · Lo que vale el punto depende del modo de la campaña: en una
        // campaña por horas el `importe` está vacío y este bloque habría dicho
        // 0 € por cada trabajador con la campaña ya ejecutada.
        actual.importe += valorPuntoEur(punto, campana);
        mapa.set(persona, actual);
      }
      return {
        ...base,
        columnas: ["Trabajador", "Puntos", "Importe"],
        filas: Array.from(mapa.entries())
          .sort((a, b) => b[1].importe - a[1].importe)
          .map(([persona, valores]) => ({ Trabajador: persona, Puntos: valores.puntos, Importe: eur(valores.importe) }))
      };
    }

    default:
      return null;
  }
}

export function calcularBloques(claves: Array<ClaveBloque | string>, entrada: EntradaInforme): BloqueCalculado[] {
  return claves
    .map(clave => calcularBloque(clave as ClaveBloque, entrada))
    .filter((bloque): bloque is BloqueCalculado => bloque !== null);
}

/**
 * El candado (regla 2). Devuelve el motivo por el que un informe no se puede
 * emitir, o null si se puede. La base repite esta comprobación: esta capa está
 * para dar un mensaje decente, no para ser la defensa.
 */
export function validarInforme(claves: Array<ClaveBloque | string>, incluyeCostes: boolean): string | null {
  if (!claves.length) return "Elige al menos un bloque para el informe.";
  if (incluyeCostes) return null;
  const internos = claves.filter(clave => esBloqueInterno(clave));
  if (internos.length) {
    const nombres = internos.map(clave => definicionBloque(clave)?.etiqueta || clave).join(", ");
    return `Este informe va al cliente y contiene bloques internos (${nombres}). Quítalos, o márcalo como informe interno si es para uso propio.`;
  }
  return null;
}

export type Plantilla = {
  id: string;
  nombre: string;
  cliente_marca?: string | null;
  bloques: ClaveBloque[];
  encabezado?: string | null;
  incluye_costes: boolean;
  created_by_nombre?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type InformeEmitido = {
  id: string;
  campana_id: string;
  plantilla_id?: string | null;
  titulo: string;
  encabezado?: string | null;
  incluye_costes: boolean;
  datos: { bloques: BloqueCalculado[] };
  generado_por_nombre?: string | null;
  generado_at: string;
  notas?: string | null;
};

type Result<T> = { data: T; error?: string };

export async function fetchPlantillas(): Promise<Result<Plantilla[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("campana_informe_plantillas").select("*").order("nombre");
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as Plantilla[] };
}

export async function guardarPlantilla(plantilla: Omit<Plantilla, "id"> & { id?: string }, actor: string): Promise<Result<Plantilla | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const motivo = validarInforme(plantilla.bloques, plantilla.incluye_costes);
  if (motivo) return { data: null, error: motivo };
  const fila = {
    nombre: plantilla.nombre.trim(),
    cliente_marca: plantilla.cliente_marca || null,
    bloques: plantilla.bloques,
    encabezado: plantilla.encabezado || null,
    incluye_costes: plantilla.incluye_costes,
    created_by_nombre: actor,
    updated_at: new Date().toISOString()
  };
  if (!fila.nombre) return { data: null, error: "La plantilla necesita un nombre para poder reutilizarla." };
  const query = plantilla.id
    ? supabase.from("campana_informe_plantillas").update(fila).eq("id", plantilla.id).select().maybeSingle()
    : supabase.from("campana_informe_plantillas").insert(fila).select().maybeSingle();
  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data: data as Plantilla };
}

export async function borrarPlantilla(id: string): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("campana_informe_plantillas").delete().eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function fetchInformes(campanaId: string): Promise<Result<InformeEmitido[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("campana_informes")
    .select("*")
    .eq("campana_id", campanaId)
    .order("generado_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as InformeEmitido[] };
}

/**
 * Emite el informe: CONGELA las cifras calculadas y las guarda (regla 3). A
 * partir de aquí el informe ya no cambia aunque cambie la campaña.
 */
export async function emitirInforme(
  entrada: EntradaInforme,
  opciones: { titulo: string; encabezado?: string | null; claves: Array<ClaveBloque | string>; incluyeCostes: boolean; plantillaId?: string | null; notas?: string | null; actor: string }
): Promise<Result<InformeEmitido | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const motivo = validarInforme(opciones.claves, opciones.incluyeCostes);
  if (motivo) return { data: null, error: motivo };
  if (!opciones.titulo.trim()) return { data: null, error: "El informe necesita un título." };

  const calculados = calcularBloques(opciones.claves, entrada);
  const { data, error } = await supabase
    .from("campana_informes")
    .insert({
      campana_id: entrada.campana.id,
      plantilla_id: opciones.plantillaId || null,
      titulo: opciones.titulo.trim(),
      encabezado: opciones.encabezado || null,
      incluye_costes: opciones.incluyeCostes,
      datos: { bloques: calculados },
      generado_por_nombre: opciones.actor,
      notas: opciones.notas || null
    })
    .select()
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as InformeEmitido };
}
