/**
 * MerchanOps · Grandes Campañas — delegaciones (v11.5).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * Algunos servicios se SUBCONTRATAN: en esas provincias no gestiona el gestor de
 * la casa, sino una empresa externa («delegación»). Pero la subcontrata no es
 * permanente ni total: se decide CAMPAÑA A CAMPAÑA y se eligen las delegaciones
 * una a una, porque no siempre entran todas. Una provincia cuya delegación no se
 * ha marcado la siguen llevando los gestores, exactamente igual que antes de esta
 * versión.
 *
 * REGLAS DE LA CASA
 *  - La lógica de reparto es PURA (sin Supabase) y se prueba en
 *    tests/campanas-delegaciones.test.ts. Aquí solo el acceso a datos usa la base.
 *  - Una delegación es un usuario de `app_users` con rol `delegacion`: su alcance
 *    real de lectura sigue siendo el de sus provincias, como cualquier gestor.
 *    Marcarla en una campaña NO le da acceso por sí solo; lo que se lo da es
 *    recibir los puntos (`puntos_venta_campana.gestor_id`), igual que a un gestor.
 */

import { AppUser } from "@/lib/access-control";
import { CandidatoGestor, mismaProvincia } from "@/lib/campana-asignacion";
import { normalizeProvince } from "@/lib/provinces";
import { supabase } from "@/lib/supabase";

export type CampanaDelegacion = {
  id?: string;
  campana_id?: string;
  delegacion_id?: string | null;
  delegacion_nombre?: string | null;
  /** Zonas subcontratadas EN ESTA campaña. Vacío = todas las de la delegación. */
  provincias: string[];
  assigned_at?: string | null;
};

type Result<T> = { data: T; error?: string };

/** Delegaciones marcadas en una campaña (sin mirar si el modo está activo). */
export async function fetchDelegacionesCampana(campanaId: string): Promise<Result<CampanaDelegacion[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("campana_delegaciones")
    .select("*")
    .eq("campana_id", campanaId)
    .order("assigned_at", { ascending: true });
  if (error) return { data: [], error: error.message };
  return {
    data: ((data || []) as CampanaDelegacion[]).map(fila => ({ ...fila, provincias: fila.provincias || [] }))
  };
}

/**
 * Reemplaza la lista de delegaciones de la campaña (borrar + insertar, igual que
 * `saveGestoresCampana`). Cada fila congela el nombre y las provincias del momento
 * para que el reparto no cambie solo porque alguien edite la ficha del usuario.
 */
export async function saveDelegacionesCampana(
  campanaId: string,
  delegaciones: Array<Pick<AppUser, "id" | "display_name" | "provinces">>
): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error: deleteError } = await supabase.from("campana_delegaciones").delete().eq("campana_id", campanaId);
  if (deleteError) return { data: false, error: deleteError.message };
  if (!delegaciones.length) return { data: true };
  const filas = delegaciones.map(delegacion => ({
    campana_id: campanaId,
    delegacion_id: delegacion.id,
    delegacion_nombre: delegacion.display_name,
    provincias: delegacion.provinces || []
  }));
  const { error } = await supabase.from("campana_delegaciones").insert(filas);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

/** Copia las delegaciones de una campaña a otra (usado al duplicar). */
export async function copyDelegacionesCampana(origenId: string, destinoId: string): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const origen = await fetchDelegacionesCampana(origenId);
  if (origen.error) return { data: false, error: origen.error };
  if (!origen.data.length) return { data: true };
  const { error } = await supabase.from("campana_delegaciones").insert(
    origen.data.map(fila => ({
      campana_id: destinoId,
      delegacion_id: fila.delegacion_id,
      delegacion_nombre: fila.delegacion_nombre,
      provincias: fila.provincias || []
    }))
  );
  if (error) return { data: false, error: error.message };
  return { data: true };
}

// ---------------------------------------------------------------------------
// Lógica pura del reparto por zona
// ---------------------------------------------------------------------------

/**
 * Convierte las filas de `campana_delegaciones` en candidatos de reparto.
 * La provincia de la fila manda sobre la de la ficha del usuario: si al firmar la
 * campaña la delegación cubría 3 provincias, el reparto usa esas 3 aunque después
 * alguien le añada una cuarta en «Usuarios y permisos».
 */
export function delegacionesComoCandidatos(
  delegaciones: CampanaDelegacion[],
  usuarios: Array<Pick<AppUser, "id" | "display_name" | "provinces" | "active">> = []
): CandidatoGestor[] {
  const porId = new Map(usuarios.map(usuario => [usuario.id, usuario]));
  return delegaciones
    .filter(fila => fila.delegacion_id)
    .map(fila => {
      const usuario = porId.get(String(fila.delegacion_id));
      const provincias = (fila.provincias || []).length ? fila.provincias : (usuario?.provinces || []);
      return {
        id: String(fila.delegacion_id),
        display_name: fila.delegacion_nombre || usuario?.display_name || String(fila.delegacion_id),
        provinces: provincias,
        role: "delegacion",
        // Una delegación desactivada en «Usuarios y permisos» deja de repartir:
        // seguir mandándole puntos sería asignárselos a quien ya no entra.
        active: usuario ? usuario.active !== false : true
      };
    });
}

/** Provincias que, en esta campaña, gestiona una delegación en lugar del gestor. */
export function provinciasDelegadas(delegaciones: CandidatoGestor[]): string[] {
  const zonas = new Set<string>();
  for (const delegacion of delegaciones) {
    if (delegacion.active === false) continue;
    for (const provincia of delegacion.provinces || []) {
      const normalizada = normalizeProvince(provincia);
      if (normalizada) zonas.add(normalizada);
    }
  }
  return Array.from(zonas).sort((a, b) => a.localeCompare(b, "es"));
}

/** true si esa provincia está subcontratada en esta campaña. */
export function esProvinciaDelegada(provincia: string | null | undefined, delegadas: string[]): boolean {
  return delegadas.some(zona => mismaProvincia(zona, provincia));
}

/**
 * Lista final de responsables de zona de una campaña.
 *
 * Regla, que es TODA la funcionalidad pedida en una frase: en las provincias
 * cubiertas por una delegación marcada manda la delegación; en el resto, los
 * gestores de siempre. Por eso a los gestores se les recortan las provincias
 * delegadas en lugar de excluirlos: un gestor con seis provincias, dos de ellas
 * subcontratadas, sigue trabajando las otras cuatro.
 *
 * Con `activas = false` (campaña normal) las delegaciones se ignoran por
 * completo, aunque haya filas guardadas: así activar y desactivar el modo no
 * pierde la configuración.
 */
export function responsablesDeZona(
  gestores: CandidatoGestor[],
  delegaciones: CandidatoGestor[],
  activas: boolean
): { candidatos: CandidatoGestor[]; delegadas: string[] } {
  if (!activas || !delegaciones.length) return { candidatos: gestores, delegadas: [] };
  const delegadas = provinciasDelegadas(delegaciones);
  const gestoresRecortados = gestores
    .map(gestor => ({
      ...gestor,
      provinces: (gestor.provinces || []).filter(provincia => !esProvinciaDelegada(provincia, delegadas))
    }))
    // Un gestor cuyas provincias están TODAS subcontratadas se queda fuera del
    // reparto de esta campaña; si no, `sugerirGestoresPorPunto` lo descartaría
    // igualmente por no cubrir ninguna zona, pero así el aviso de la pantalla
    // («estas provincias las lleva la delegación») dice la verdad.
    .filter(gestor => (gestor.provinces || []).length > 0);
  return { candidatos: [...gestoresRecortados, ...delegaciones.filter(d => d.active !== false)], delegadas };
}
