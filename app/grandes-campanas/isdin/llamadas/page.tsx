"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppSession, canAccessModule, filterBySessionProvince, getCurrentAppSession } from "@/lib/access-control";
import {
  IsdinCall,
  IsdinCallStatus,
  IsdinVinylBase,
  applyCallPatch,
  buildCallSummary,
  callForDb,
  callNeedsOperationsAlert,
  cleanCallStatus,
  dateOnly,
  downloadCsv,
  filterIsdinCalls,
  getCallStats,
  groupCallsBy,
  isdinCallStatuses,
  mergeCallsWithVinyls,
  saveLocalCalls,
  syncLocalCallsFromVinyls,
  type CallsFilters as CallsFilterState
} from "@/lib/isdin-calls";
import {
  CallDrawer,
  CallsAnalyticsView,
  CallsFilters,
  CallsKpiSummary,
  CallsOperationalView,
  ModeTabs,
  Notice
} from "./ui";

const localVinylKey = "merchanops_isdin_local_v381";
const emptyFilters: CallsFilterState = {
  week: "",
  province: "",
  city: "",
  status: "",
  installer: "",
  backoffice: "",
  q: "",
  quick: "",
  from: "",
  to: ""
};

function localVinyls(): IsdinVinylBase[] {
  try {
    return JSON.parse(localStorage.getItem(localVinylKey) || "[]");
  } catch {
    return [];
  }
}

function nowLocalDatetime() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function baseChanged(a: IsdinCall, b: IsdinCall) {
  return [
    "vinyl_id",
    "isdin_vinyl_id",
    "pharmacy_name",
    "vinyl_campaign",
    "desired_installation_week",
    "desired_installation_date",
    "street",
    "street_number",
    "postal_code",
    "province",
    "city",
    "phone_number",
    "worker_name",
    "installer_name",
    "client_observations",
    "scaffold_required",
    "height",
    "width"
  ].some(key => (a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]);
}

// C2: comandos transaccionales en la base en vez del guardado en bloque.
async function syncCallLogisticsImpact(call: IsdinCall) {
  if (!call.requires_logistics_action || !supabase) return;
  const fecha = dateOnly(call.logistics_required_date || call.next_visit_date || call.desired_installation_date) || null;
  const dateOk = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
  const version = `call:${call.call_status || ""}:${dateOk || ""}:${call.logistics_need_type || ""}:${call.installer_name || call.worker_name || ""}`;
  const { error } = await supabase.rpc("sync_isdin_vinyl_requests", {
    p_vinyls: [{
      id: call.isdin_vinyl_id || call.vin,
      vin: call.vin,
      version,
      pharmacy_name: call.pharmacy_name,
      campaign: call.vinyl_campaign || null,
      record_type: "Vinilo a medida",
      width: call.width ?? null,
      height: call.height ?? null,
      installation_date: dateOk,
      installation_week: call.next_visit_week || call.desired_installation_week || null,
      province: call.province || null,
      city: call.city || null,
      address: [call.street, call.street_number, call.postal_code].filter(Boolean).join(" ") || null,
      installer_name: call.installer_name || call.worker_name || null,
      observations: call.client_observations || null,
      material_name: call.logistics_need_type || "Actuación logística desde llamada"
    }],
    p_actor: "Backoffice ISDIN"
  });
  if (error) throw new Error(`Sincronización logística fallida: ${error.message}`);
  if (cleanCallStatus(call.call_status) === "Incidencia en llamada") {
    // Incidencia en llamada es preventiva y no genera pago de visita fallida.
    const { error: incError } = await supabase.rpc("create_logistics_incident_ops", {
      p: {
        tipo: call.logistics_need_type === "cambio_medidas" ? "medidas_incorrectas" : "material_no_recibido",
        vin_id: call.vin,
        campana_id: call.vinyl_campaign || null,
        descripcion: call.logistics_comment || call.call_comment || "Incidencia de llamada con impacto logístico.",
        impacto: "Backoffice solicita actuación logística preventiva.",
        fecha_limite: dateOk,
        source_type: "isdin_vinyl",
        source_id: call.isdin_vinyl_id || call.vin
      },
      p_actor: "Backoffice ISDIN"
    });
    if (incError) throw new Error(`Incidencia logística no creada: ${incError.message}`);
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export default function IsdinCallsPage() {
  const [calls, setCalls] = useState<IsdinCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"operativa" | "analisis">("operativa");
  const [filters, setFilters] = useState<CallsFilterState>(emptyFilters);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [session, setSession] = useState<AppSession | null>(() => getCurrentAppSession());

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 1400);
  }

  async function syncMissingOrChangedCalls(vinyls: IsdinVinylBase[], rawCalls: IsdinCall[]) {
    const existingByVin = new Map(rawCalls.map(call => [call.vin, call]));
    const merged = mergeCallsWithVinyls(rawCalls, vinyls);
    const rowsToWrite = merged.filter(call => {
      const existing = existingByVin.get(call.vin);
      return !existing || baseChanged(existing, call);
    });

    if (rowsToWrite.length && supabase) {
      const { error: upsertError } = await supabase.from("isdin_calls").upsert(rowsToWrite.map(callForDb), { onConflict: "vin" });
      if (upsertError) setError(`No se pudieron sincronizar ${rowsToWrite.length} llamadas con la base de datos: ${upsertError.message}`);
    }

    return merged;
  }

  async function refresh() {
    setLoading(true);
    setError("");

    if (isSupabaseConfigured && supabase) {
      const [{ data: vinyls, error: vinylError }, { data: rawCalls, error: callError }] = await Promise.all([
        supabase.from("isdin_vinyls").select("*").order("desired_installation_week", { ascending: true }),
        supabase.from("isdin_calls").select("*").order("desired_installation_week", { ascending: true })
      ]);

      if (vinylError || callError) {
        setError(callError?.message || vinylError?.message || "No se pudieron cargar llamadas");
        setCalls([]);
      } else {
        setCalls(await syncMissingOrChangedCalls((vinyls || []) as IsdinVinylBase[], (rawCalls || []) as IsdinCall[]));
      }
    } else {
      const synced = syncLocalCallsFromVinyls(localVinyls());
      setCalls(synced);
    }

    setLoading(false);
  }

  useEffect(() => {
    setSession(getCurrentAppSession());
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCalls = useMemo(() => canAccessModule(session, "isdin") ? filterBySessionProvince(calls, session) : [], [calls, session]);
  const filtered = useMemo(() => filterIsdinCalls(visibleCalls, filters), [visibleCalls, filters]);
  const stats = useMemo(() => getCallStats(filtered), [filtered]);
  const selectedCall = selectedCallId ? visibleCalls.find(call => call.id === selectedCallId) || null : null;
  const weeks = Array.from(new Set(visibleCalls.map(x => x.desired_installation_week).filter(Boolean))) as string[];
  const provinces = Array.from(new Set(visibleCalls.map(x => x.province).filter(Boolean))) as string[];
  const cities = Array.from(new Set(visibleCalls.map(x => x.city).filter(Boolean))) as string[];
  const installers = Array.from(new Set(visibleCalls.map(x => x.installer_name || x.worker_name).filter(Boolean))) as string[];
  const backofficeUsers = Array.from(new Set(visibleCalls.map(x => x.backoffice_user).filter(Boolean))) as string[];
  const analytics = {
    byProvince: groupCallsBy(filtered, x => x.province || "Sin provincia"),
    byWeek: groupCallsBy(filtered, x => x.desired_installation_week || "Sin semana"),
    byStatus: groupCallsBy(filtered, x => cleanCallStatus(x.call_status)),
    byBackoffice: groupCallsBy(filtered, x => x.backoffice_user || "Sin operador")
  };

  async function persistCall(call: IsdinCall, next: IsdinCall, message = "Llamada guardada") {
    const previousCalls = calls;
    const nextCalls = calls.map(row => row.id === call.id ? next : row);
    setSaving(true);
    setError("");
    setCalls(nextCalls);
    let mirrorWarning = "";

    try {
      if (isSupabaseConfigured && supabase) {
        const { error: saveError } = await supabase.from("isdin_calls").upsert(callForDb(next), { onConflict: "vin" });
        if (saveError) {
          setCalls(previousCalls);
          setError(`No se pudo guardar la llamada: ${saveError.message}`);
          return false;
        }
        const mirrorError = await syncCallToVinylMirror(next);
        if (mirrorError) {
          mirrorWarning = `Llamada guardada, pero Vinilos no se actualizó: ${mirrorError}`;
        }
      } else {
        saveLocalCalls(nextCalls);
      }

      try {
        await syncCallLogisticsImpact(next);
      } catch (logisticsError) {
        console.error("Error sincronizando llamada con Logística", logisticsError);
        flash(`Llamada guardada. Revisa Logística: ${errorMessage(logisticsError, "sincronización pendiente")}`);
        return true;
      }

      setError(mirrorWarning);
      flash(message);
      return true;
    } catch (unknownError) {
      setCalls(previousCalls);
      setError(`No se pudo completar el guardado: ${errorMessage(unknownError, "error inesperado")}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function syncCallToVinylMirror(call: IsdinCall) {
    if (!isSupabaseConfigured || !supabase || !call.vin) return "";
    const mirror = {
      call_status: cleanCallStatus(call.call_status),
      call_last_datetime: call.call_datetime || null,
      call_contact_person: call.contact_person || null,
      call_alert: callNeedsOperationsAlert(call),
      call_comment: call.call_comment || null,
      call_next_visit_date: call.next_visit_date ? dateOnly(call.next_visit_date) : null,
      call_next_visit_week: call.next_visit_week || null,
      requires_operations_review: Boolean(call.requires_operations_review)
    };
    // A-02: el espejo apuntaba a `.eq("vinyl", call.vin)`. Un mismo VIN puede tener
    // varias filas en `isdin_vinyls` —es correcto: representan visitas en fechas
    // distintas, p. ej. VIN-31552 en mayo y en junio—, así que esa consulta escribía
    // el estado de la llamada en TODAS las visitas de ese vinilo. Se direcciona por
    // clave primaria cuando se conoce, que es siempre que la llamada se creó desde
    // un vinilo (callBaseFromVinyl fija isdin_vinyl_id); solo se recurre al VIN para
    // filas legadas sin ese vínculo.
    const vinylId = call.isdin_vinyl_id || call.vinyl_id || null;
    const query = supabase.from("isdin_vinyls").update(mirror);
    const { error } = vinylId ? await query.eq("id", vinylId) : await query.eq("vinyl", call.vin);
    return error?.message || "";
  }

  function validatePatch(call: IsdinCall, patch: Partial<IsdinCall>) {
    const nextStatus = cleanCallStatus(patch.call_status || call.call_status);
    const comment = String(patch.call_comment ?? call.call_comment ?? "").trim();
    const nextDate = dateOnly(patch.next_visit_date !== undefined ? patch.next_visit_date : call.next_visit_date);

    if ((nextStatus === "Incidencia en llamada" || nextStatus === "Cancelado en llamada") && !comment) {
      return "Este estado requiere comentario antes de guardar.";
    }
    if (nextStatus === "Pospuesto en llamada" && !nextDate && !comment) {
      return "Pospuesto requiere nueva fecha o comentario justificativo.";
    }
    return "";
  }

  async function saveCall(call: IsdinCall, patch: Partial<IsdinCall>, message?: string) {
    const validation = validatePatch(call, patch);
    if (validation) {
      setError(validation);
      return false;
    }

    // Los estados de llamada son preventivos y no generan pagos ni visitas fallidas.
    const next = applyCallPatch(call, patch);
    return persistCall(call, next, message);
  }

  async function saveAndNext(call: IsdinCall, patch: Partial<IsdinCall>) {
    const ok = await saveCall(call, patch, "Llamada guardada. Siguiente pendiente abierto.");
    if (!ok) return;

    const activeIds = filtered.map(row => row.id);
    const currentIndex = activeIds.indexOf(call.id);
    const nextPending = filtered.slice(currentIndex + 1).concat(filtered.slice(0, Math.max(currentIndex, 0))).find(row => cleanCallStatus(row.call_status) === "Pendiente de llamar");
    setSelectedCallId(nextPending?.id || null);
  }

  async function quickStatus(call: IsdinCall, status: IsdinCallStatus) {
    const datetime = status === "No contesta" || status === "Confirmado" || status === "Llamada realizada" ? nowLocalDatetime() : call.call_datetime || nowLocalDatetime();
    const attempt = status === "No contesta" ? `Intento sin respuesta: ${new Date().toLocaleString("es-ES")}` : "";
    const comment = attempt ? [call.call_comment, attempt].filter(Boolean).join("\n") : call.call_comment || "";
    const patch: Partial<IsdinCall> = {
      call_status: status,
      call_datetime: datetime,
      call_comment: comment,
      requires_operations_review: status === "Requiere revisión operaciones" || call.requires_operations_review
    };
    await saveCall(call, patch, status);
  }

  async function copySummary(call: IsdinCall) {
    try {
      await navigator.clipboard?.writeText(buildCallSummary(call));
      flash("Resumen copiado");
    } catch {
      setError("No se pudo copiar el resumen");
    }
  }

  function exportCalls() {
    downloadCsv("isdin_llamadas_backoffice.csv", [
      ["VIN", "Farmacia", "Campaña", "Semana instalación", "Fecha prevista", "Provincia", "Ciudad", "Instalador", "Estado llamada", "Fecha/hora llamada", "Franja horaria", "Persona contactada", "Teléfono", "Operador Backoffice", "Comentario", "Nueva fecha propuesta", "Nueva semana", "Requiere revisión"],
      ...filtered.map(call => [
        call.vin,
        call.pharmacy_name,
        call.vinyl_campaign || "",
        call.desired_installation_week || "",
        dateOnly(call.desired_installation_date),
        call.province || "",
        call.city || "",
        call.installer_name || call.worker_name || "",
        call.call_status,
        call.call_datetime || "",
        call.call_time_slot || "",
        call.contact_person || "",
        call.phone_number || "",
        call.backoffice_user || "",
        call.call_comment || "",
        dateOnly(call.next_visit_date),
        call.next_visit_week || "",
        call.requires_operations_review ? "Sí" : "No"
      ])
    ]);
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="mo-page-title text-3xl font-bold">ISDIN · Llamadas Backoffice</h1>
            <p className="text-sm text-slate-500">Gestión preventiva de llamadas previas a instalación</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/grandes-campanas/isdin" className="rounded-2xl border bg-white px-4 py-2">Vinilos</a>
            <a href="/grandes-campanas/isdin/dashboard" className="rounded-2xl border bg-white px-4 py-2">KPIs ISDIN</a>
            <a href="/grandes-campanas/isdin/facturacion" className="rounded-2xl border bg-white px-4 py-2">Facturación</a>
            <button onClick={exportCalls} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">
              <FileDown className="mr-1 inline h-4 w-4" />
              Exportar llamadas
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-5 p-4">
        <Notice notice={notice} error={error} />
        {!isSupabaseConfigured && <div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local: las llamadas se guardan en este navegador y se sincronizan con los vinilos locales.</div>}

        <ModeTabs mode={mode} setMode={setMode} />
        <CallsKpiSummary stats={stats} mode={mode} />
        <CallsFilters
          filters={filters}
          setFilters={setFilters}
          emptyFilters={emptyFilters}
          weeks={weeks}
          statuses={isdinCallStatuses}
          provinces={provinces}
          cities={cities}
          installers={installers}
          backofficeUsers={backofficeUsers}
        />

        {mode === "operativa" ? (
          <CallsOperationalView
            calls={filtered}
            loading={loading}
            onOpen={call => setSelectedCallId(call.id)}
            onQuickStatus={quickStatus}
            onCopySummary={copySummary}
          />
        ) : (
          <CallsAnalyticsView stats={stats} analytics={analytics} total={filtered.length} />
        )}
      </section>

      {selectedCall && (
        <CallDrawer
          call={selectedCall}
          saving={saving}
          onClose={() => setSelectedCallId(null)}
          onSave={patch => saveCall(selectedCall, patch, "Llamada guardada")}
          onSaveAndNext={patch => saveAndNext(selectedCall, patch)}
          onQuickStatus={status => quickStatus(selectedCall, status)}
          onCopySummary={() => copySummary(selectedCall)}
        />
      )}
    </main>
  );
}
