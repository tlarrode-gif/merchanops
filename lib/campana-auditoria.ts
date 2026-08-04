/**
 * MerchanOps · Grandes Campañas — bitácora del punto de venta (v11.0).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * Las líneas de pago son inmutables y auditadas desde v8.0, pero el dato que
 * las alimenta —el importe y la fecha del punto— se podía cambiar sin dejar
 * rastro. Con la actualización masiva por Excel eso pasa de incómodo a
 * inaceptable: una subida reescribe cientos de puntos de una vez.
 *
 * QUÉ HACE
 * Lee `campana_punto_eventos`, que escribe un trigger de base de datos (nunca
 * la aplicación: el navegador no puede firmar un cambio con el nombre de otro),
 * y la traduce a frases que se puedan leer sin saber cómo se llaman las
 * columnas: «Marta cambió el importe de 25,00 € a 250,00 €».
 *
 * REGLAS DE LA CASA
 *  - Las funciones de formato son PURAS: sin Supabase, sin React, sin reloj.
 *    Se prueban en tests/campanas-auditoria.test.ts.
 *  - Los valores llegan siempre como texto (así los guarda la bitácora) y aquí
 *    se interpretan según el campo. Un valor que no se entiende se enseña tal
 *    cual antes que inventarse una traducción.
 */

import { supabase } from "@/lib/supabase";
import { eur, formatDate, puntoEstadoLabels, OrigenCambio, PuntoEstado } from "@/lib/campanas";

/**
 * Lo que puede traer la columna `origen` de la bitácora: los orígenes que emite
 * la aplicación, más 'desconocido' para las filas que escribió alguien que no lo
 * declaró (un UPDATE a mano desde el SQL editor, por ejemplo).
 */
export type OrigenEvento = OrigenCambio | "desconocido";

export type AccionEvento = "creado" | "actualizado" | "borrado";

export type PuntoEvento = {
  id: string;
  punto_id: string;
  campana_id?: string | null;
  punto_nombre?: string | null;
  accion: AccionEvento;
  campo?: string | null;
  valor_anterior?: string | null;
  valor_nuevo?: string | null;
  actor_id?: string | null;
  actor_nombre: string;
  origen: OrigenEvento | string;
  created_at: string;
};

/** Nombre humano de cada campo vigilado por el trigger. */
export const campoLabels: Record<string, string> = {
  estado: "el estado",
  importe: "el importe",
  fecha_visita: "la fecha de instalación",
  codigo: "el código",
  nombre_comercial: "el nombre",
  direccion: "la dirección",
  provincia: "la provincia",
  tipo: "el tipo",
  gestor_id: "el gestor (id)",
  gestor_nombre: "el gestor",
  instalador_id: "el instalador (id)",
  instalador_nombre: "el instalador",
  direccion_envio: "la dirección de envío",
  notas: "las notas",
  centro_id: "el centro",
  picking_cerrado_at: "la fecha de picking"
};

export const origenLabels: Record<string, string> = {
  pantalla: "a mano",
  importacion: "subiendo un archivo",
  masiva: "en una acción masiva",
  logistica: "desde Logística",
  sistema: "el sistema",
  desconocido: "origen no registrado"
};

/** Campos cuyo cambio mueve dinero: la pantalla los destaca. */
export const camposSensibles = new Set(["importe", "estado", "fecha_visita", "instalador_id", "instalador_nombre"]);

export function esCampoSensible(campo?: string | null) {
  return Boolean(campo && camposSensibles.has(campo));
}

/**
 * Traduce el valor de un campo a algo legible. Todo llega como texto porque así
 * lo guarda la bitácora; el campo decide cómo se interpreta.
 */
export function formatearValorEvento(campo: string | null | undefined, valor: string | null | undefined): string {
  const texto = String(valor ?? "").trim();
  if (!texto) return "vacío";
  switch (campo) {
    case "importe": {
      const numero = Number(texto);
      return Number.isFinite(numero) ? eur(numero) : texto;
    }
    case "fecha_visita":
    case "picking_cerrado_at":
      return formatDate(texto);
    case "estado":
      return puntoEstadoLabels[texto as PuntoEstado] || texto;
    default:
      // Las notas pueden ser largas: en el historial se corta, el detalle completo
      // sigue estando en el punto.
      return texto.length > 120 ? `${texto.slice(0, 117)}…` : texto;
  }
}

/**
 * Frase completa del evento, sin el nombre del actor (lo pinta la pantalla
 * aparte para poder darle formato).
 */
export function describirEvento(evento: Pick<PuntoEvento, "accion" | "campo" | "valor_anterior" | "valor_nuevo">): string {
  if (evento.accion === "creado") return "creó el punto";
  if (evento.accion === "borrado") return "borró el punto";
  const campo = campoLabels[String(evento.campo)] || `«${evento.campo}»`;
  const antes = formatearValorEvento(evento.campo, evento.valor_anterior);
  const despues = formatearValorEvento(evento.campo, evento.valor_nuevo);
  if (antes === "vacío") return `puso ${campo} en ${despues}`;
  if (despues === "vacío") return `borró ${campo} (era ${antes})`;
  return `cambió ${campo} de ${antes} a ${despues}`;
}

/** Etiqueta del origen, para el «· subiendo un archivo» del final de la línea. */
export function describirOrigen(origen?: string | null): string {
  return origenLabels[String(origen || "desconocido")] || String(origen);
}

export type DiaEventos = { dia: string; eventos: PuntoEvento[] };

/**
 * Día LOCAL del evento en ISO. Tiene que ser local porque la hora que se pinta al
 * lado también lo es: cortando el ISO en UTC, un cambio hecho a la 01:30 en
 * España aparecía bajo la cabecera del día anterior con la hora «01:30».
 */
export function diaLocalEvento(evento: Pick<PuntoEvento, "created_at">): string {
  const fecha = new Date(evento.created_at);
  if (Number.isNaN(fecha.getTime())) return String(evento.created_at || "").slice(0, 10);
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/**
 * Agrupa por día local (más reciente primero) conservando dentro de cada día el
 * orden que traiga la consulta.
 */
export function agruparEventosPorDia(eventos: PuntoEvento[]): DiaEventos[] {
  const mapa = new Map<string, PuntoEvento[]>();
  for (const evento of eventos) {
    const dia = diaLocalEvento(evento);
    const lista = mapa.get(dia);
    if (lista) lista.push(evento);
    else mapa.set(dia, [evento]);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dia, lista]) => ({ dia, eventos: lista }));
}

/** Hora HH:MM del evento, para la columna izquierda del historial. */
export function horaEvento(evento: Pick<PuntoEvento, "created_at">): string {
  const fecha = new Date(evento.created_at);
  if (Number.isNaN(fecha.getTime())) return "--:--";
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

export type ResumenAuditoria = {
  total: number;
  sensibles: number;
  porActor: Array<{ actor: string; cambios: number }>;
  porOrigen: Array<{ origen: string; cambios: number }>;
};

/** Cifras de cabecera del historial. */
export function resumirEventos(eventos: PuntoEvento[]): ResumenAuditoria {
  const porActor = new Map<string, number>();
  const porOrigen = new Map<string, number>();
  let sensibles = 0;
  for (const evento of eventos) {
    if (esCampoSensible(evento.campo)) sensibles += 1;
    const actor = evento.actor_nombre || "Sistema";
    porActor.set(actor, (porActor.get(actor) || 0) + 1);
    const origen = describirOrigen(evento.origen);
    porOrigen.set(origen, (porOrigen.get(origen) || 0) + 1);
  }
  const ordenar = <T extends string>(mapa: Map<T, number>) =>
    Array.from(mapa.entries()).sort((a, b) => b[1] - a[1]);
  return {
    total: eventos.length,
    sensibles,
    porActor: ordenar(porActor).map(([actor, cambios]) => ({ actor, cambios })),
    porOrigen: ordenar(porOrigen).map(([origen, cambios]) => ({ origen, cambios }))
  };
}

type Result<T> = { data: T; error?: string };

/** Tope por consulta: una campaña con 1.000 puntos genera bitácora de sobra. */
export const LIMITE_EVENTOS = 500;

export async function fetchEventosCampana(campanaId: string, limite = LIMITE_EVENTOS): Promise<Result<PuntoEvento[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("campana_punto_eventos")
    .select("*")
    .eq("campana_id", campanaId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as PuntoEvento[] };
}

export async function fetchEventosPunto(puntoId: string, limite = 100): Promise<Result<PuntoEvento[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("campana_punto_eventos")
    .select("*")
    .eq("punto_id", puntoId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as PuntoEvento[] };
}
