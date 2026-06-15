"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, FileDown, RefreshCw, Search, Send, XCircle } from "lucide-react";
import { EstadoLogistico } from "@/components/logistics/estado-logistico";
import { LogisticsState, RequestStatus, available, createPickingFromRequest, logisticsKpis, logisticsStatusLabel, materialName, rejectLogisticsRequest, seedLogistics } from "@/lib/logistics";
import { cancelLogisticsRequest, updateLogisticsRequest } from "@/lib/logistics-actions";
import { loadLogisticsState, saveLogisticsState } from "@/lib/logistics-store";
import { acceptRequestAndReserve, materialDisplay, sourceHref } from "@/lib/logistics-sync";

type Request = LogisticsState["requests"][number];
type Requirement = LogisticsState["requirements"][number];

const modules = [
  ["", "Panel"],
  ["solicitudes", "Peticiones"],
  ["entradas", "Entradas"],
  ["stock", "Stock"],
  ["picking", "Picking"],
  ["envios", "Envíos"],
  ["incidencias", "Incidencias"],
  ["pendientes", "Pendientes"],
  ["sincronizacion", "Sincronización"]
] as const;

export function SolicitudesLogisticaClient({ detailId }: { detailId?: string }) {
  const [state, setState] = useState<LogisticsState>(() => seedLogistics());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const kpis = useMemo(() => logisticsKpis(state), [state]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    setLoading(true);
    const loaded = await loadLogisticsState();
    setState(loaded.state);
    setRemote(loaded.remote);
    setError(loaded.error ? `Modo local: ${loaded.error}` : "");
    setLoading(false);
  }

  async function commit(mutator: (draft: LogisticsState) => void, message: string) {
    try {
      setSaving(true);
      const draft = structuredClone(state) as LogisticsState;
      mutator(draft);
      await saveLogisticsState(draft, remote);
      setState(draft);
      setNotice(message);
      setError("");
      setTimeout(() => setNotice(""), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación");
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(() => state.requests.filter(request => {
    const requirements = requestRequirements(state, request);
    const primary = requirements[0];
    return matches([
      request.code,
      request.status,
      requestSourceLabel(request.source_type),
      request.client_id,
      request.campaign_id,
      request.province,
      request.city,
      request.installer_name,
      request.delivery_address,
      primary?.vin,
      primary?.pharmacy_name,
      primary?.requested_material_name,
      ...requirements.map(req => `${req.campaign_id || ""} ${req.client_id || ""} ${req.vin || ""} ${req.pharmacy_name || ""} ${req.requested_material_name || ""}`)
    ], q);
  }), [q, state]);
  const selected = state.requests.find(x => x.id === detailId) || rows[0];
  const selectedRequirements = selected ? requestRequirements(state, selected) : [];

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-[1480px] gap-4 p-4">
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-64 shrink-0 rounded-2xl border bg-white p-3 shadow-sm lg:block">
          <div className="px-3 py-2"><p className="text-xs font-semibold uppercase text-slate-500">MerchanOps</p><h1 className="text-2xl font-bold">Logística</h1></div>
          <nav className="mt-3 space-y-1">
            {modules.map(([key, label]) => <a key={key} href={`/logistica${key ? `/${key}` : ""}`} className={key === "solicitudes" ? "block rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white" : "block rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}>{label}</a>)}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 space-y-4">
          <header className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <a href="/logistica" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Panel logístico</a>
                <h2 className="mt-1 text-3xl font-bold">Peticiones de material</h2>
                <p className="text-sm text-slate-500">Vista operativa con campaña, cliente/CECO, VIN/farmacia, material y destino.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={remote ? "rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" : "rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"}>{remote ? "Supabase activo" : "Modo local"}</span>
                <button disabled={saving} onClick={refresh} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw className="mr-1 inline h-4 w-4" />Actualizar</button>
                <a href="/?tab=servicios" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Crear desde Servicios</a>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={q} onChange={event => setQ(event.target.value)} placeholder="Buscar por código, campaña, CECO, VIN, farmacia, material, provincia o destino..." className="w-full bg-transparent text-sm outline-none" />
            </label>
          </header>

          {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {loading && <div className="rounded-2xl border bg-white p-4 text-sm text-slate-500">Cargando peticiones...</div>}

          <div className="grid gap-3 md:grid-cols-4">
            <Kpi label="Peticiones abiertas" value={kpis.openRequests} />
            <Kpi label="Necesidades activas" value={kpis.openRequirements} />
            <Kpi label="Pickings pendientes" value={kpis.pendingPickings} />
            <Kpi label="Envíos sin confirmar" value={kpis.unconfirmedShipments} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_430px]">
            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-bold">Listado operativo</h3><span className="text-sm font-semibold text-slate-500">{rows.length} peticiones</span></div>
              <div className="overflow-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-900 text-white">{["Petición", "Contexto", "Estado", "Urgencia", "Material / fecha", "Destino"].map(header => <th key={header} className="p-3 text-left">{header}</th>)}</tr></thead>
                  <tbody>{rows.map(request => <RequestRow key={request.id} state={state} request={request} />)}</tbody>
                </table>
              </div>
              {!rows.length && <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No hay peticiones que coincidan con la búsqueda.</p>}
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl border bg-white p-4 shadow-sm">
                <h3 className="text-lg font-bold">Detalle petición</h3>
                {selected ? (
                  <div className="mt-3 space-y-3">
                    <Read label="Código" value={selected.code} />
                    <Read label="Campaña" value={firstText(selected.campaign_id, selectedRequirements[0]?.campaign_id, selectedRequirements[0]?.installation_week) || "Sin campaña"} />
                    <Read label="Cliente / CECO" value={firstText(selected.client_id, selectedRequirements[0]?.client_id) || "Sin cliente/CECO"} />
                    <Read label="Origen" value={<a className="font-semibold underline-offset-2 hover:underline" href={sourceHref(selectedRequirements[0] || { source_type: selected.source_type, source_id: selected.source_id } as Requirement)}>Abrir origen -&gt;</a>} />
                    <Read label="Estado visible en origen" value={logisticsStatusLabel(selectedRequirements[0]?.status)} />
                    <Read label="Instalador / dirección" value={`${selected.installer_name || selectedRequirements[0]?.installer_name || "Sin instalador"} · ${selected.delivery_address || selectedRequirements[0]?.delivery_address || "Sin dirección"}`} />
                    <Read label="Comentario logística" value={selected.logistics_comment || "Sin comentario"} />
                    {selected.rejection_reason && <Read label="Motivo rechazo" value={selected.rejection_reason} />}
                    {selected.lines.map(line => {
                      const req = state.requirements.find(x => x.id === line.material_requirement_id);
                      const stock = req?.material_id ? state.stock.find(s => s.material_id === req.material_id) : null;
                      return <Mini key={line.id} title={req ? materialDisplay(req, state) : "Línea"} text={`Solicitado ${line.requested_quantity} · Aprobado ${line.accepted_quantity} · Disponible ${available(stock)} · ${line.line_status}`} />;
                    })}
                    {editing && <RequestEditForm request={selected} onCancel={() => setEditing(false)} onSave={patch => commit(draft => updateLogisticsRequest(draft, selected.id, patch), "Petición actualizada").then(() => setEditing(false))} />}
                    <div className="grid gap-2">
                      <button onClick={() => setEditing(value => !value)} disabled={saving || ["entregada", "cerrada", "cancelada", "rechazada"].includes(selected.status)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-40">{editing ? "Cerrar edición" : "Editar petición"}</button>
                      <button onClick={() => exportPickingSheet(state, selected)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold"><FileDown className="mr-1 inline h-4 w-4" />Exportar hoja de picking</button>
                      <button onClick={() => commit(draft => acceptRequestAndReserve(draft, selected.id), "Petición aprobada y stock reservado")} disabled={saving || lockedForReserve(selected.status)} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 inline h-4 w-4" />Aprobar y reservar stock</button>
                      <button onClick={() => commit(draft => createPickingFromRequest(draft, selected.id), "Picking creado desde petición")} disabled={saving || !!selected.picking_id || ["rechazada", "cancelada", "bloqueada", "entregada", "cerrada"].includes(selected.status)} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Send className="mr-1 inline h-4 w-4" />{selected.picking_id ? "Picking ya creado" : "Convertir en picking"}</button>
                      <button onClick={() => rejectSelected(selected)} disabled={saving || !["borrador", "enviada", "pendiente_revision", "pendiente_material"].includes(selected.status)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40"><XCircle className="mr-1 inline h-4 w-4" />Rechazar petición</button>
                      <button onClick={() => cancelSelected(selected)} disabled={saving || !!selected.picking_id || ["entregada", "cerrada", "cancelada", "rechazada"].includes(selected.status)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">Archivar / cancelar</button>
                    </div>
                    {selected.picking_id && <a className="block rounded-xl border p-3 text-sm font-semibold" href={`/logistica/picking?id=${selected.picking_id}`}>Ver picking -&gt;</a>}
                    {selected.shipment_id && <a className="block rounded-xl border p-3 text-sm font-semibold" href={`/logistica/envios?id=${selected.shipment_id}`}>Ver envío -&gt;</a>}
                    <EstadoLogistico state={state} sourceType={selected.source_type} sourceId={selected.source_id} />
                  </div>
                ) : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Selecciona una petición para ver el detalle.</p>}
              </section>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );

  function rejectSelected(request: Request) {
    const reason = prompt("Motivo del rechazo");
    if (reason) commit(draft => rejectLogisticsRequest(draft, request.id, reason), "Petición rechazada");
  }
  function cancelSelected(request: Request) {
    const reason = prompt("Motivo para archivar o cancelar la petición");
    if (reason) commit(draft => cancelLogisticsRequest(draft, request.id, reason), "Petición cancelada");
  }
}

function RequestEditForm({ request, onSave, onCancel }: { request: Request; onSave: (patch: Partial<Request>) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    priority: request.priority || "media",
    required_date: request.required_date || "",
    installation_date: request.installation_date || "",
    destination_type: request.destination_type || "instalador",
    installer_name: request.installer_name || "",
    delivery_address: request.delivery_address || "",
    province: request.province || "",
    city: request.city || "",
    logistics_comment: request.logistics_comment || "",
    operations_comment: request.operations_comment || ""
  });
  const update = (key: keyof typeof form, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  return (
    <div className="rounded-2xl border bg-slate-50 p-3">
      <p className="mb-3 text-sm font-bold">Editar datos operativos</p>
      <div className="grid gap-2">
        <SelectEdit label="Prioridad" value={form.priority} onChange={value => update("priority", value)} options={["critica", "alta", "media", "baja"]} />
        <InputEdit label="Fecha necesaria" type="date" value={form.required_date} onChange={value => update("required_date", value)} />
        <InputEdit label="Fecha instalación" type="date" value={form.installation_date} onChange={value => update("installation_date", value)} />
        <SelectEdit label="Destino" value={form.destination_type} onChange={value => update("destination_type", value)} options={["instalador", "farmacia", "almacen", "otro"]} />
        <InputEdit label="Instalador" value={form.installer_name} onChange={value => update("installer_name", value)} />
        <InputEdit label="Dirección" value={form.delivery_address} onChange={value => update("delivery_address", value)} />
        <InputEdit label="Provincia" value={form.province} onChange={value => update("province", value)} />
        <InputEdit label="Ciudad" value={form.city} onChange={value => update("city", value)} />
        <TextEdit label="Comentario logística" value={form.logistics_comment} onChange={value => update("logistics_comment", value)} />
        <TextEdit label="Comentario operaciones" value={form.operations_comment} onChange={value => update("operations_comment", value)} />
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onSave(form as Partial<Request>)} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Guardar cambios</button>
        <button onClick={onCancel} className="rounded-xl border px-3 py-2 text-sm font-semibold">Cancelar</button>
      </div>
    </div>
  );
}
function RequestRow({ state, request }: { state: LogisticsState; request: Request }) {
  const requirements = requestRequirements(state, request);
  const primary = requirements[0];
  return (
    <tr onClick={() => { location.href = `/logistica/solicitudes?id=${encodeURIComponent(request.id)}`; }} className="cursor-pointer border-t hover:bg-slate-50">
      <td className="p-3 align-top"><p className="font-semibold">{request.code}</p><p className="text-xs text-slate-500">{requestSourceLabel(request.source_type)}</p></td>
      <td className="p-3 align-top"><p className="font-semibold">{firstText(request.campaign_id, primary?.campaign_id, primary?.installation_week) || "Sin campaña"}</p><p className="text-xs text-slate-500">{firstText(request.client_id, primary?.client_id) || "Sin cliente/CECO"}</p><p className="text-xs text-slate-500">{firstText(primary?.vin, primary?.pharmacy_name) || "Sin VIN/farmacia"}</p></td>
      <td className="p-3 align-top"><Status text={request.status} /></td>
      <td className="p-3 align-top"><Badge tone={request.priority === "critica" ? "critica" : request.priority === "alta" ? "alta" : "info"} /></td>
      <td className="p-3 align-top"><p className="font-medium">{requestMaterialSummary(state, requirements)}</p><p className="text-xs text-slate-500">{firstText(request.required_date, request.installation_date, primary?.required_date, primary?.installation_date) || "Sin fecha"}</p></td>
      <td className="p-3 align-top"><p>{firstText(request.installer_name, primary?.installer_name, request.delivery_address, primary?.delivery_address) || "Pendiente"}</p><p className="text-xs text-slate-500">{firstText(request.province, primary?.province, request.city, primary?.city) || "Sin provincia"}</p></td>
    </tr>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="text-3xl font-bold">{value}</p></div>;
}
function Read({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="border-b py-2 text-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><div>{value}</div></div>;
}
function Mini({ title, text }: { title: string; text: string }) {
  return <div className="rounded-xl border p-3 text-sm"><b>{title}</b><p>{text}</p></div>;
}
function InputEdit({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input type={type} value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-xl border bg-white px-3 py-2 text-sm" /></label>;
}
function SelectEdit({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><select value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-xl border bg-white px-3 py-2 text-sm">{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
}
function TextEdit({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><textarea value={value} onChange={event => onChange(event.target.value)} rows={3} className="w-full rounded-xl border bg-white px-3 py-2 text-sm" /></label>;
}
function Status({ text }: { text: string }) {
  const color = text.includes("resuelta") || text.includes("completo") || text.includes("entregado") || text.includes("preparado") ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : text.includes("pend") || text.includes("transito") || text.includes("preparacion") ? "bg-amber-50 text-amber-800 ring-amber-200" : text.includes("fall") || text.includes("extravi") || text.includes("incid") ? "bg-red-50 text-red-800 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-200";
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${color}`}>{text}</span>;
}
function Badge({ tone }: { tone: "critica" | "alta" | "info" }) {
  const cls = tone === "critica" ? "bg-red-100 text-red-800" : tone === "alta" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800";
  return <span className={`mr-2 rounded-full px-2 py-1 text-xs font-bold ${cls}`}>{tone}</span>;
}
function requestRequirements(state: LogisticsState, request: Request) {
  const byLine = request.lines.map(line => state.requirements.find(req => req.id === line.material_requirement_id)).filter((req): req is Requirement => Boolean(req));
  const byRequest = state.requirements.filter(req => req.request_id === request.id);
  const unique = new Map<string, Requirement>();
  [...byLine, ...byRequest].forEach(req => unique.set(req.id, req));
  return Array.from(unique.values());
}
function requestMaterialSummary(state: LogisticsState, requirements: Requirement[]) {
  if (!requirements.length) return "Sin material";
  const names = requirements.map(req => req.material_id ? materialName(state, req.material_id) : req.requested_material_name).filter(Boolean);
  const unique = Array.from(new Set(names));
  if (unique.length === 1) {
    const total = requirements.reduce((sum, req) => sum + Number(req.requested_quantity || 0), 0);
    return `${unique[0]}${total > 1 ? ` x${total}` : ""}`;
  }
  return `${unique[0]} +${unique.length - 1}`;
}
function requestSourceLabel(sourceType: string) {
  const labels: Record<string, string> = { service: "Servicio", service_point: "Punto de servicio", isdin_vinyl: "ISDIN Vinilos", campaign: "Campaña", incident: "Incidencia", replacement: "Reposición", manual_request: "Petición manual" };
  return labels[sourceType] || sourceType;
}
function firstText(...values: Array<string | number | null | undefined>) {
  return values.map(value => String(value ?? "").trim()).find(Boolean) || "";
}
function matches(values: unknown[], q: string) {
  return !q || values.join(" ").toLowerCase().includes(q.toLowerCase());
}
function lockedForReserve(status: RequestStatus) {
  return ["aceptada", "en_preparacion", "preparada", "enviada_transporte", "entregada", "cerrada", "rechazada"].includes(status);
}
function exportPickingSheet(state: LogisticsState, request: Request) {
  const rows = [["Código", "Campaña", "Instalador", "Material", "SKU", "VIN", "Cantidad", "Destino", "Estado"]];
  request.lines.forEach(line => {
    const req = state.requirements.find(x => x.id === line.material_requirement_id);
    const material = req?.material_id ? state.materials.find(x => x.id === req.material_id) : null;
    rows.push([request.code, request.campaign_id || req?.campaign_id || "", request.installer_name || req?.installer_name || "", material?.nombre || req?.requested_material_name || "Material pendiente", material?.sku || req?.requested_sku || "", req?.vin || "", String(line.accepted_quantity || line.requested_quantity || req?.requested_quantity || 0), request.delivery_address || req?.delivery_address || "", line.line_status || req?.status || request.status]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${request.code || "hoja-picking"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
