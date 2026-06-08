"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { createIncident, loadLogistics, saveLogistics } from "@/lib/logistics";
import { syncIsdinVinylToLogistics } from "@/lib/logistics-sync";
import {
  IsdinCall,
  IsdinCallStatus,
  IsdinVinylBase,
  applyCallPatch,
  buildCallSummary,
  callForDb,
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

function syncCallLogisticsImpact(call: IsdinCall) {
  if (!call.requires_logistics_action) return;
  const logistics = loadLogistics();
  const { requirement } = syncIsdinVinylToLogistics(logistics, {
    id: call.isdin_vinyl_id || call.vin,
    vinyl: call.vin,
    pharmacy_name: call.pharmacy_name,
    vinyl_campaign: call.vinyl_campaign,
    height: call.height,
    width: call.width,
    desired_installation_date: call.logistics_required_date || call.next_visit_date || call.desired_installation_date,
    desired_installation_week: call.next_visit_week || call.desired_installation_week,
    province: call.province,
    city: call.city,
    street: call.street,
    street_number: call.street_number,
    postal_code: call.postal_code,
    installer_name: call.installer_name || call.worker_name,
    client_observations: call.client_observations,
    comments: [call.call_comment, call.logistics_comment].filter(Boolean).join("\n"),
    material_name: call.logistics_need_type || "Actuación logística desde llamada",
    material_type: "vinilo_medida"
  }, `call-${call.updated_at || call.call_datetime || call.vin}`);
  if (!requirement.incident_id && cleanCallStatus(call.call_status) === "Incidencia en llamada") {
    const incident = createIncident(logistics, {
      tipo: call.logistics_need_type === "cambio_medidas" ? "medidas" : "falta",
      material_id: requirement.material_id,
      vin_id: call.vin,
      campana_id: call.vinyl_campaign,
      descripcion: call.logistics_comment || call.call_comment || "Incidencia de llamada con impacto logístico.",
      impacto: "Backoffice solicita actuación logística preventiva.",
      fecha_limite: dateOnly(call.logistics_required_date || call.next_visit_date || call.desired_installation_date)
    });
    requirement.incident_id = incident.id;
    requirement.pending_arrival_id = incident.pendiente_llegada_id || null;
    requirement.status = "con_incidencia";
  }
  saveLogistics(logistics);
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
      await supabase.from("isdin_calls").upsert(rowsToWrite.map(callForDb), { onConflict: "vin" });
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
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => filterIsdinCalls(calls, filters), [calls, filters]);
  const stats = useMemo(() => getCallStats(filtered), [filtered]);
  const selectedCall = selectedCallId ? calls.find(call => call.id === selectedCallId) || null : null;
  const weeks = Array.from(new Set(calls.map(x => x.desired_installation_week).filter(Boolean))) as string[];
  const provinces = Array.from(new Set(calls.map(x => x.province).filter(Boolean))) as string[];
  const cities = Array.from(new Set(calls.map(x => x.city).filter(Boolean))) as string[];
  const installers = Array.from(new Set(calls.map(x => x.installer_name || x.worker_name).filter(Boolean))) as string[];
  const backofficeUsers = Array.from(new Set(calls.map(x => x.backoffice_user).filter(Boolean))) as string[];
  const analytics = {
    byProvince: groupCallsBy(filtered, x => x.province || "Sin provincia"),
    byWeek: groupCallsBy(filtered, x => x.desired_installation_week || "Sin semana"),
    byStatus: groupCallsBy(filtered, x => cleanCallStatus(x.call_status)),
    byBackoffice: groupCallsBy(filtered, x => x.backoffice_user || "Sin operador")
  };

  async function persistCall(call: IsdinCall, next: IsdinCall, message = "Llamada guardada") {
    setSaving(true);
    setError("");

    const nextCalls = calls.map(row => row.id === call.id ? next : row);
    setCalls(nextCalls);

    if (isSupabaseConfigured && supabase) {
      const { error: saveError } = await supabase.from("isdin_calls").upsert(callForDb(next), { onConflict: "vin" });
      if (saveError) {
        setError(saveError.message);
        setCalls(calls);
        setSaving(false);
        return false;
      }
    } else {
      saveLocalCalls(nextCalls);
      syncCallLogisticsImpact(next);
    }

    flash(message);
    setSaving(false);
    return true;
  }

  function validatePatch(call: IsdinCall, patch: Partial<IsdinCall>) {
    const nextStatus = cleanCallStatus(patch.call_status || call.call_status);
    const comment = String(patch.call_comment ?? call.call_comment ?? "").trim();
    const nextDate = dateOnly(patch.next_visit_date !== undefined ? patch.next_visit_date : call.next_visit_date);

    if ((nextStatus === "Incidencia en llamada" || nextStatus === "Cancelado en llamada") && !comment) {
      return "Este estado requiere comentario.";
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
            <h1 className="text-3xl font-bold">ISDIN · Llamadas Backoffice</h1>
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
