"use client";

/**
 * MerchanOps · RR.HH. — Cadenas y centros.
 *
 * QUÉ RESUELVE
 * Es el catálogo del que come la pantalla de accesos. Dos datos por cadena
 * deciden ahí todo el trabajo:
 *  - `modo_tramite`: si el acceso se pide centro a centro (5 centros = 5
 *    solicitudes) o de una vez para toda la cadena (5 centros = 1 solicitud);
 *  - `lead_time_dias`: con cuánta antelación hay que pedirlo, que es lo que
 *    convierte «pedir antes del 29/07» en verde o en «plazo vencido» en rojo.
 * Tocar aquí cambia lo que la gestora ve al otro lado, así que la pantalla dice
 * la consecuencia real de cada opción en vez de limitarse a nombrarla.
 *
 * QUIÉN PUEDE QUÉ
 * Cualquiera con permiso `rrhh` (los gestores lo tienen por defecto) CONSULTA el
 * catálogo: necesita saber cómo tramita cada cadena antes de pedir un acceso.
 * Solo RR.HH. o administración lo CAMBIA (`canManageRrhh`). Un gestor entra en
 * modo lectura y se le explica por qué, en lugar de ofrecerle botones que la RLS
 * de v10_5 va a rechazar con un 42501. La frontera de verdad es esa policy, no
 * esta pantalla: aquí solo se evita ofrecer lo que va a fallar.
 *
 * GUARDADO
 * Nada es optimista. Se envía, se espera la respuesta y solo entonces se pinta:
 * si falla, sale el mensaje real de Supabase y se recarga el catálogo, para que
 * lo que se ve en pantalla sea siempre lo que hay en la base y no lo que se
 * quiso escribir.
 *
 * BAJAS
 * Un centro no se borra nunca: se retira con `activo = false`. Las solicitudes
 * de acceso históricas lo referencian y un DELETE dejaría esa tabla apuntando a
 * la nada (por eso `centros.cadena_id` es ON DELETE RESTRICT).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Plus, RefreshCw, Save, Store } from "lucide-react";
import { AppSession, canAccessModule, canManageRrhh, getCurrentAppSession, merchanopsSessionChangeEvent } from "@/lib/access-control";
import { Cadena, Centro, ModoTramiteCadena, modoTramiteLabels } from "@/lib/rrhh/tipos";
import { desactivarCentro, guardarCadena, guardarCentro, listarCadenas, listarCentros } from "@/lib/rrhh/datos";

/** La consecuencia operativa de cada modo, en una línea. */
const CONSECUENCIA_MODO: Record<ModoTramiteCadena, string> = {
  centro: "Cada centro necesita su propia solicitud de acceso.",
  cadena: "Una sola solicitud vale para todos los centros de la cadena."
};

const CLASE_MODO: Record<ModoTramiteCadena, string> = {
  centro: "bg-sky-50 text-sky-700",
  cadena: "bg-emerald-50 text-emerald-700"
};

const MODOS = Object.keys(modoTramiteLabels) as ModoTramiteCadena[];

/** El formulario trabaja con texto: el input number devuelve string y el "" es válido mientras se teclea. */
type FormularioCadena = {
  nombre: string;
  modo_tramite: ModoTramiteCadena;
  lead_time_dias: string;
  contacto: string;
  email: string;
  instrucciones: string;
  activa: boolean;
};

const FORM_VACIO: FormularioCadena = {
  nombre: "",
  modo_tramite: "centro",
  lead_time_dias: "0",
  contacto: "",
  email: "",
  instrucciones: "",
  activa: true
};

function desdeCadena(cadena: Cadena): FormularioCadena {
  return {
    nombre: cadena.nombre,
    modo_tramite: cadena.modo_tramite,
    lead_time_dias: String(cadena.lead_time_dias ?? 0),
    contacto: cadena.contacto ?? "",
    email: cadena.email ?? "",
    instrucciones: cadena.instrucciones ?? "",
    activa: cadena.activa
  };
}

type FormularioCentro = { codigo: string; nombre: string; poblacion: string; provincia: string };
const CENTRO_VACIO: FormularioCentro = { codigo: "", nombre: "", poblacion: "", provincia: "" };

/** «3 días de antelación» / «sin plazo»: el 0 no es un plazo, es su ausencia. */
function textoPlazo(dias: number) {
  if (!dias) return "sin plazo";
  return `${dias} ${dias === 1 ? "día" : "días"} de antelación`;
}

export function CadenasClient() {
  const [session, setSession] = useState<AppSession | null>(null);

  const [cadenas, setCadenas] = useState<Cadena[]>([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [seleccionId, setSeleccionId] = useState("");
  const [modoNuevo, setModoNuevo] = useState(false);

  const [form, setForm] = useState<FormularioCadena>(FORM_VACIO);
  const [guardandoCadena, setGuardandoCadena] = useState(false);

  const [centros, setCentros] = useState<Centro[]>([]);
  const [cargandoCentros, setCargandoCentros] = useState(false);
  const [formCentro, setFormCentro] = useState<FormularioCentro>(CENTRO_VACIO);
  const [guardandoCentro, setGuardandoCentro] = useState(false);
  const [centroOcupadoId, setCentroOcupadoId] = useState("");

  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Qué cadena estaba elegida cuando se dispara una recarga. En una ref y no en
  // el estado para que `cargarCatalogo` no cambie de identidad en cada render.
  const seleccionRef = useRef("");
  seleccionRef.current = seleccionId;

  // La sesión se lee en un efecto, nunca en el render inicial: el servidor no
  // tiene localStorage y leerlo antes de montar rompe la hidratación.
  useEffect(() => {
    const sincroniza = () => setSession(getCurrentAppSession());
    sincroniza();
    window.addEventListener(merchanopsSessionChangeEvent, sincroniza);
    window.addEventListener("storage", sincroniza);
    return () => {
      window.removeEventListener(merchanopsSessionChangeEvent, sincroniza);
      window.removeEventListener("storage", sincroniza);
    };
  }, []);

  function elegir(cadena: Cadena) {
    setModoNuevo(false);
    setSeleccionId(cadena.id);
    setForm(desdeCadena(cadena));
    setFormCentro(CENTRO_VACIO);
  }

  const cargarCatalogo = useCallback(async (preferidaId?: string) => {
    setCargandoCatalogo(true);
    try {
      const lista = await listarCadenas();
      setCadenas(lista);
      setError("");
      const buscada = preferidaId ?? seleccionRef.current;
      const elegida = lista.find(cadena => cadena.id === buscada) ?? lista[0] ?? null;
      if (elegida) {
        setModoNuevo(false);
        setSeleccionId(elegida.id);
        setForm(desdeCadena(elegida));
        setFormCentro(CENTRO_VACIO);
      } else {
        setSeleccionId("");
        setForm(FORM_VACIO);
        setCentros([]);
      }
    } catch (err) {
      setCadenas([]);
      setError(`No se pudo cargar el catálogo de cadenas: ${mensaje(err)}`);
    } finally {
      setCargandoCatalogo(false);
    }
  }, []);

  const activa = Boolean(session?.active);
  // Se calcula ANTES de los gates porque los manejadores de eventos lo consultan:
  // quien solo lee el catálogo tampoco recibe el aviso de «cambios sin guardar».
  const puedeEditar = canManageRrhh(session);

  useEffect(() => {
    if (!activa) return;
    void cargarCatalogo();
  }, [activa, cargarCatalogo]);

  // Centros de la cadena elegida. Se recargan a mano tras cada escritura para no
  // pintar nunca un centro que la base no haya confirmado.
  const cargarCentros = useCallback(async (cadenaId: string) => {
    if (!cadenaId) {
      setCentros([]);
      return;
    }
    setCargandoCentros(true);
    try {
      setCentros(await listarCentros(cadenaId));
      setError("");
    } catch (err) {
      setCentros([]);
      setError(`No se pudieron cargar los centros de la cadena: ${mensaje(err)}`);
    } finally {
      setCargandoCentros(false);
    }
  }, []);

  useEffect(() => {
    if (!activa) return;
    void cargarCentros(seleccionId);
  }, [activa, seleccionId, cargarCentros]);

  const cadenaSeleccionada = useMemo(
    () => cadenas.find(cadena => cadena.id === seleccionId) ?? null,
    [cadenas, seleccionId]
  );

  // Cambios sin guardar: se compara el formulario con lo que hay en la base para
  // avisar antes de saltar a otra cadena y perder lo tecleado.
  const hayCambios = useMemo(() => {
    const base = cadenaSeleccionada ? desdeCadena(cadenaSeleccionada) : FORM_VACIO;
    return JSON.stringify(base) !== JSON.stringify(form);
  }, [cadenaSeleccionada, form]);

  function actualiza<K extends keyof FormularioCadena>(campo: K, valor: FormularioCadena[K]) {
    setForm(previo => ({ ...previo, [campo]: valor }));
  }

  function anuncia(texto: string) {
    setAviso(texto);
    setTimeout(() => setAviso(""), 4000);
  }

  function pedirCambioDeCadena(cadena: Cadena) {
    if (cadena.id === seleccionId && !modoNuevo) return;
    if (puedeEditar && hayCambios && !window.confirm("Hay cambios sin guardar en esta cadena. ¿Los descartas?")) return;
    setError("");
    elegir(cadena);
  }

  function nuevaCadena() {
    if (puedeEditar && hayCambios && !window.confirm("Hay cambios sin guardar en esta cadena. ¿Los descartas?")) return;
    setError("");
    setModoNuevo(true);
    setSeleccionId("");
    setForm(FORM_VACIO);
    setFormCentro(CENTRO_VACIO);
    setCentros([]);
  }

  async function guardar() {
    const nombre = form.nombre.trim();
    if (!nombre) {
      setError("La cadena necesita un nombre.");
      return;
    }
    const dias = Number(form.lead_time_dias);
    if (!Number.isFinite(dias) || dias < 0) {
      setError("Los días de antelación tienen que ser un número igual o mayor que cero.");
      return;
    }
    setGuardandoCadena(true);
    setError("");
    try {
      const guardada = await guardarCadena({
        ...(seleccionId ? { id: seleccionId } : {}),
        nombre,
        modo_tramite: form.modo_tramite,
        lead_time_dias: Math.round(dias),
        contacto: form.contacto.trim() || null,
        email: form.email.trim() || null,
        instrucciones: form.instrucciones.trim() || null,
        activa: form.activa
      });
      anuncia(`«${guardada.nombre}» guardada: ${modoTramiteLabels[guardada.modo_tramite].toLowerCase()} · ${textoPlazo(guardada.lead_time_dias)}.`);
      await cargarCatalogo(guardada.id);
    } catch (err) {
      // Nada de optimismo: se enseña el error real y se vuelve a leer la base
      // para que el formulario no siga mostrando algo que no se ha guardado.
      setError(`No se pudo guardar la cadena: ${mensaje(err)}`);
      await cargarCatalogo(seleccionId || undefined);
    } finally {
      setGuardandoCadena(false);
    }
  }

  async function anadirCentro() {
    if (!seleccionId) return;
    const nombre = formCentro.nombre.trim();
    if (!nombre) {
      setError("El centro necesita un nombre.");
      return;
    }
    setGuardandoCentro(true);
    setError("");
    try {
      const creado = await guardarCentro({
        cadena_id: seleccionId,
        nombre,
        codigo: formCentro.codigo.trim() || null,
        poblacion: formCentro.poblacion.trim() || null,
        provincia: formCentro.provincia.trim() || null
      });
      setFormCentro(CENTRO_VACIO);
      anuncia(`Centro «${creado.nombre}» añadido.`);
      await cargarCentros(seleccionId);
    } catch (err) {
      setError(`No se pudo añadir el centro: ${mensaje(err)}`);
      await cargarCentros(seleccionId);
    } finally {
      setGuardandoCentro(false);
    }
  }

  async function retirarCentro(centro: Centro) {
    if (!window.confirm(`¿Retirar «${centro.nombre}»? Dejará de poder pedirse, pero se conserva en las solicitudes ya hechas.`)) return;
    setCentroOcupadoId(centro.id);
    setError("");
    try {
      await desactivarCentro(centro.id);
      anuncia(`Centro «${centro.nombre}» retirado.`);
    } catch (err) {
      setError(`No se pudo retirar el centro: ${mensaje(err)}`);
    } finally {
      setCentroOcupadoId("");
      await cargarCentros(seleccionId);
    }
  }

  async function reactivarCentro(centro: Centro) {
    setCentroOcupadoId(centro.id);
    setError("");
    try {
      await guardarCentro({ id: centro.id, activo: true });
      anuncia(`Centro «${centro.nombre}» reactivado.`);
    } catch (err) {
      setError(`No se pudo reactivar el centro: ${mensaje(err)}`);
    } finally {
      setCentroOcupadoId("");
      await cargarCentros(seleccionId);
    }
  }

  if (!session?.active) return <Gate texto="Inicia sesión en MerchanOps para acceder a RR.HH." />;
  if (!canAccessModule(session, "rrhh")) return <Gate texto="No tienes permiso para acceder al módulo de RR.HH." />;

  const hayFormulario = Boolean(seleccionId) || modoNuevo;
  const claseCampo = `mt-1 w-full rounded-2xl border px-3 py-2 text-sm ${puedeEditar ? "bg-white" : "bg-slate-50 text-slate-500"}`;

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold">Cadenas y centros</h1>
            <p className="text-sm text-slate-500">Cómo tramita los accesos cada cadena y con cuánta antelación.</p>
          </div>
          <button
            onClick={() => void cargarCatalogo()}
            disabled={cargandoCatalogo}
            className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw className="mr-1 inline h-4 w-4" />
            Actualizar
          </button>
        </div>

        {!puedeEditar && (
          <div className="rounded-3xl border bg-white p-4 text-sm shadow-sm">
            <p className="font-semibold">Estás viendo el catálogo en modo lectura.</p>
            <p className="mt-1 text-slate-500">
              Consúltalo para saber cómo tramita cada cadena antes de pedir un acceso. Cambiar el modo de trámite, el plazo o los
              centros le corresponde a RR.HH. y a administración, porque afecta a las solicitudes de todos los gestores.
            </p>
          </div>
        )}

        {aviso && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-3xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Cadenas</h2>
              {puedeEditar && (
                <button onClick={nuevaCadena} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                  <Plus className="mr-1 inline h-4 w-4" />
                  Nueva cadena
                </button>
              )}
            </div>

            {cargandoCatalogo && <p className="mt-3 text-sm text-slate-500">Cargando catálogo...</p>}

            {!cargandoCatalogo && !cadenas.length && (
              <div className="mt-3 rounded-2xl border p-3">
                <p className="font-semibold">Todavía no hay ninguna cadena.</p>
                <p className="mt-1 text-sm text-slate-500">
                  {puedeEditar
                    ? "Crea la primera con «Nueva cadena»: hasta que exista, la pantalla de accesos no tiene nada que ofrecer."
                    : "Hasta que RR.HH. dé de alta las cadenas, la pantalla de accesos no tiene nada que ofrecer."}
                </p>
              </div>
            )}

            <div className="mt-3 space-y-2">
              {cadenas.map(cadena => {
                const elegida = cadena.id === seleccionId && !modoNuevo;
                return (
                  <button
                    key={cadena.id}
                    onClick={() => pedirCambioDeCadena(cadena)}
                    className={`w-full rounded-2xl border p-3 text-left ${elegida ? "border-slate-900 bg-slate-50" : "bg-white hover:bg-slate-50"}`}
                  >
                    <p className={`font-semibold ${cadena.activa ? "" : "text-slate-400"}`}>{cadena.nombre}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CLASE_MODO[cadena.modo_tramite]}`}>
                        {modoTramiteLabels[cadena.modo_tramite]}
                      </span>
                      {!cadena.activa && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Inactiva</span>}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{textoPlazo(cadena.lead_time_dias)}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            {!hayFormulario && (
              <div className="rounded-3xl border bg-white p-4 shadow-sm">
                <p className="font-semibold">Elige una cadena para ver su ficha.</p>
                <p className="mt-1 text-sm text-slate-500">
                  De cada cadena se guarda cómo tramita los accesos, con cuánta antelación hay que pedirlos y qué centros tiene.
                </p>
              </div>
            )}

            {hayFormulario && (
              <div className="rounded-3xl border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    <Building2 className="mr-1 inline h-5 w-5 text-slate-400" />
                    {modoNuevo ? "Nueva cadena" : cadenaSeleccionada?.nombre || "Cadena"}
                  </h2>
                  {puedeEditar && hayCambios && <span className="text-xs font-semibold text-amber-700">Cambios sin guardar</span>}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block text-sm md:col-span-2">
                    <span className="font-medium">Nombre</span>
                    <input
                      value={form.nombre}
                      onChange={event => actualiza("nombre", event.target.value)}
                      disabled={!puedeEditar}
                      placeholder="Alcampo, Media Markt, El Corte Inglés..."
                      className={claseCampo}
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium">Modo de trámite</span>
                    <select
                      value={form.modo_tramite}
                      onChange={event => actualiza("modo_tramite", event.target.value as ModoTramiteCadena)}
                      disabled={!puedeEditar}
                      className={claseCampo}
                    >
                      {MODOS.map(modo => (
                        <option key={modo} value={modo}>
                          {modoTramiteLabels[modo]}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-slate-500">
                      Por centro: cada centro necesita su propia solicitud. Por cadena: una sola solicitud vale para todos los centros.
                    </span>
                    <span className="mt-1 block text-xs font-semibold text-slate-600">{CONSECUENCIA_MODO[form.modo_tramite]}</span>
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium">Días de antelación</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={form.lead_time_dias}
                      onChange={event => actualiza("lead_time_dias", event.target.value)}
                      disabled={!puedeEditar}
                      className={claseCampo}
                    />
                    <span className="mt-1 block text-xs text-slate-500">
                      {Number(form.lead_time_dias) > 0
                        ? `La solicitud tiene que salir ${textoPlazo(Math.round(Number(form.lead_time_dias)))} respecto a la fecha de trabajo.`
                        : "Sin plazo: la cadena acepta la solicitud el mismo día del trabajo."}
                    </span>
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium">Contacto</span>
                    <input
                      value={form.contacto}
                      onChange={event => actualiza("contacto", event.target.value)}
                      disabled={!puedeEditar}
                      placeholder="Persona o departamento"
                      className={claseCampo}
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={event => actualiza("email", event.target.value)}
                      disabled={!puedeEditar}
                      placeholder="accesos@cadena.com"
                      className={claseCampo}
                    />
                  </label>

                  <label className="block text-sm md:col-span-2">
                    <span className="font-medium">Instrucciones</span>
                    <textarea
                      value={form.instrucciones}
                      onChange={event => actualiza("instrucciones", event.target.value)}
                      disabled={!puedeEditar}
                      rows={3}
                      placeholder="Cómo pide esta cadena los accesos: formulario, correo, teléfono..."
                      className={claseCampo}
                    />
                  </label>

                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.activa}
                      onChange={event => actualiza("activa", event.target.checked)}
                      disabled={!puedeEditar}
                    />
                    <span className="font-medium">Cadena activa</span>
                    <span className="text-xs text-slate-500">Si se desactiva, deja de ofrecerse al pedir accesos.</span>
                  </label>
                </div>

                {puedeEditar && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void guardar()}
                      disabled={guardandoCadena}
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Save className="mr-1 inline h-4 w-4" />
                      {guardandoCadena ? "Guardando..." : modoNuevo ? "Crear cadena" : "Guardar cambios"}
                    </button>
                    {hayCambios && (
                      <button
                        onClick={() => {
                          setError("");
                          if (cadenaSeleccionada) setForm(desdeCadena(cadenaSeleccionada));
                          else setForm(FORM_VACIO);
                        }}
                        disabled={guardandoCadena}
                        className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                      >
                        Descartar cambios
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {hayFormulario && (
              <div className="rounded-3xl border bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    <Store className="mr-1 inline h-5 w-5 text-slate-400" />
                    Centros
                  </h2>
                  {!modoNuevo && (
                    <span className="text-sm text-slate-500">
                      {centros.filter(centro => centro.activo).length} activo(s) de {centros.length}
                    </span>
                  )}
                </div>

                {modoNuevo && (
                  <div className="mt-3 rounded-2xl border p-3">
                    <p className="font-semibold">Guarda la cadena antes de añadir centros.</p>
                    <p className="mt-1 text-sm text-slate-500">Un centro necesita una cadena a la que colgarse; sin ella quedaría huérfano.</p>
                  </div>
                )}

                {!modoNuevo && cargandoCentros && <p className="mt-3 text-sm text-slate-500">Cargando centros...</p>}

                {!modoNuevo && !cargandoCentros && (
                  <div className="mt-3 overflow-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="p-2 text-left">Código</th>
                          <th className="p-2 text-left">Nombre</th>
                          <th className="p-2 text-left">Población</th>
                          <th className="p-2 text-left">Provincia</th>
                          <th className="p-2 text-left">Activo</th>
                          {puedeEditar && <th className="p-2 text-left">Acciones</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {!centros.length && (
                          <tr className="border-t">
                            <td className="p-2 text-slate-500" colSpan={puedeEditar ? 6 : 5}>
                              <p className="font-semibold text-slate-900">Esta cadena todavía no tiene centros.</p>
                              <p className="mt-1">
                                {puedeEditar
                                  ? "Añade el primero en la fila de abajo: los centros son los chips que se marcan al pedir un acceso."
                                  : "Los centros son los chips que se marcan al pedir un acceso; los da de alta RR.HH."}
                              </p>
                            </td>
                          </tr>
                        )}

                        {centros.map(centro => (
                          <tr key={centro.id} className={`border-t ${centro.activo ? "" : "bg-slate-50 text-slate-400"}`}>
                            <td className="p-2 font-mono text-xs">{centro.codigo || "—"}</td>
                            <td className="p-2 font-semibold">{centro.nombre}</td>
                            <td className="p-2">{centro.poblacion || "—"}</td>
                            <td className="p-2">{centro.provincia || "—"}</td>
                            <td className="p-2">
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${centro.activo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                              >
                                {centro.activo ? "Activo" : "Retirado"}
                              </span>
                            </td>
                            {puedeEditar && (
                              <td className="p-2">
                                {centro.activo ? (
                                  <button
                                    onClick={() => void retirarCentro(centro)}
                                    disabled={centroOcupadoId === centro.id}
                                    className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                                  >
                                    Desactivar
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => void reactivarCentro(centro)}
                                    disabled={centroOcupadoId === centro.id}
                                    className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                  >
                                    Reactivar
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}

                        {puedeEditar && (
                          <tr className="border-t bg-slate-50">
                            <td className="p-2">
                              <input
                                value={formCentro.codigo}
                                onChange={event => setFormCentro(previo => ({ ...previo, codigo: event.target.value }))}
                                placeholder="Código"
                                className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                value={formCentro.nombre}
                                onChange={event => setFormCentro(previo => ({ ...previo, nombre: event.target.value }))}
                                placeholder="Nombre del centro"
                                className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                value={formCentro.poblacion}
                                onChange={event => setFormCentro(previo => ({ ...previo, poblacion: event.target.value }))}
                                placeholder="Población"
                                className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                value={formCentro.provincia}
                                onChange={event => setFormCentro(previo => ({ ...previo, provincia: event.target.value }))}
                                placeholder="Provincia"
                                className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
                              />
                            </td>
                            <td className="p-2 text-xs text-slate-500">Nace activo</td>
                            <td className="p-2">
                              <button
                                onClick={() => void anadirCentro()}
                                disabled={guardandoCentro || !formCentro.nombre.trim()}
                                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              >
                                <Plus className="mr-1 inline h-4 w-4" />
                                {guardandoCentro ? "Añadiendo..." : "Añadir"}
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {!modoNuevo && puedeEditar && (
                  <p className="mt-3 text-xs text-slate-500">
                    Los centros no se borran: se retiran. Las solicitudes de acceso ya hechas siguen apuntando a ellos.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Gate({ texto }: { texto: string }) {
  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">Cadenas y centros</h1>
          <p className="mt-2 text-sm text-slate-600">{texto}</p>
        </div>
      </section>
    </main>
  );
}

/** Ningún error se traga: siempre sale su mensaje real. */
function mensaje(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "error desconocido");
}
