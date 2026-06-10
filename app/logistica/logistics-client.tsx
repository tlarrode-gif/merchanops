"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, FileDown, Plus, RefreshCw, Search, Send } from "lucide-react";
import { CrearIncidenciaModal } from "@/components/logistics/crear-incidencia-modal";
import { EstadoLogistico } from "@/components/logistics/estado-logistico";
import { createDomainEvent, publishDomainEvent, retryFailedIntegrationEvents } from "@/lib/domain-events";
import { LogisticsState, StockMovement, available, cancelLogisticsIncident, closePicking, confirmInstallerDelivery, createIncident, createMovement, createPickingFromPendingArrival, createPickingFromRequest, generateShipping, logisticsAlerts, logisticsKpis, logisticsStatusLabel, materialName, preparePickingLine, receiveEntry, receivePendingArrival, rejectLogisticsRequest, resolveLogisticsIncident, seedLogistics, setLogisticsIncidentStatus, today, uid, upsertLogisticsVin, upsertMaterialCatalog } from "@/lib/logistics";
import { loadLogisticsState, saveLogisticsState } from "@/lib/logistics-store";
import { acceptRequestAndReserve, detectLogisticsSyncIssues, materialDisplay, sourceHref } from "@/lib/logistics-sync";

const modules = [
  ["panel", "Panel logístico"],
  ["solicitudes", "Peticiones"],
  ["entradas", "Entradas de almacén"],
  ["stock", "Stock"],
  ["picking", "Picking"],
  ["envios", "Salidas y envíos"],
  ["incidencias", "Incidencias logísticas"],
  ["pendientes", "Pendientes de llegada"],
  ["sincronizacion", "Sincronización"]
] as const;
type Section = typeof modules[number][0];

export function LogisticsClient({ section, detailId }: { section: string; detailId?: string }) {
  const active = modules.some(([key]) => key === section) ? section as Section : "panel";
  const [state, setState] = useState<LogisticsState>(() => seedLogistics());
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState(false);
  const kpis = useMemo(() => logisticsKpis(state), [state]);
  const alerts = useMemo(() => logisticsAlerts(state), [state]);

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
    if (loaded.error) setError(`Modo local: ${loaded.error}`);
    else setError("");
    setLoading(false);
  }

  async function commit(mutator: (draft: LogisticsState) => void, message = "Guardado") {
    try {
      setSaving(true);
      const draft = structuredClone(state) as LogisticsState;
      mutator(draft);
      await saveLogisticsState(draft, remote);
      setState(draft);
      setError("");
      setNotice(message);
      setTimeout(() => setNotice(""), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operación");
    } finally {
      setSaving(false);
    }
  }

  const syncIssues = useMemo(() => detectLogisticsSyncIssues(state), [state]);
  const counts = { panel: alerts.length, solicitudes: kpis.openRequests, entradas: kpis.pendingEntries, stock: kpis.lowStock, picking: kpis.pendingPickings, envios: kpis.unconfirmedShipments, incidencias: kpis.openIncidents, pendientes: state.pendings.filter(x => !["cerrado", "recibido"].includes(x.estado)).length, sincronizacion: syncIssues.length };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-[1480px] gap-4 p-4">
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-72 shrink-0 rounded-2xl border bg-white p-3 shadow-sm lg:block">
          <div className="px-3 py-2"><p className="text-xs font-semibold uppercase text-slate-500">MerchanOps</p><h1 className="text-2xl font-bold">Logística</h1></div>
          <nav className="mt-3 space-y-1">{modules.map(([key, label]) => <a key={key} href={`/logistica${key === "panel" ? "" : `/${key}`}`} className={active === key ? "flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white" : "flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}><span>{label}</span>{!!counts[key] && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-900">{counts[key]}</span>}</a>)}</nav>
        </aside>

        <section className="min-w-0 flex-1 space-y-4">
          <header className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div><p className="text-sm text-slate-500">Logística / {modules.find(([key]) => key === active)?.[1]}</p><h2 className="text-3xl font-bold">{modules.find(([key]) => key === active)?.[1]}</h2></div>
              <div className="flex flex-wrap gap-2"><span className={remote ? "rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" : "rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"}>{remote ? "Supabase activo" : "Modo local"}</span><button disabled={saving} onClick={() => refresh()} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw className="mr-1 inline h-4 w-4" />Actualizar</button><a href="/grandes-campanas" className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold">Campañas</a></div>
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2"><Search className="h-4 w-4 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar material, VIN, campaña, albarán, tracking..." className="w-full bg-transparent text-sm outline-none" /></label>
          </header>
          {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {loading && <div className="rounded-2xl border bg-white p-4 text-sm text-slate-500">Cargando logística...</div>}
          {active === "panel" && <Panel state={state} />}
          {active === "solicitudes" && <Solicitudes state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "entradas" && <Entradas state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "stock" && <Stock state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "picking" && <Picking state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "envios" && <Envios state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "incidencias" && <Incidencias state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "pendientes" && <Pendientes state={state} q={q} detailId={detailId} commit={commit} />}
          {active === "sincronizacion" && <Sincronizacion state={state} q={q} commit={commit} />}
        </section>
      </div>
    </main>
  );
}

function Panel({ state }: { state: LogisticsState }) {
  const k = logisticsKpis(state);
  const rows = [["Solicitudes abiertas", k.openRequests, "/logistica/solicitudes"], ["Necesidades activas", k.openRequirements, "/logistica/solicitudes"], ["Pendientes de recibir", k.pendingEntries, "/logistica/entradas"], ["Entradas hoy", k.entriesToday, "/logistica/entradas"], ["Pickings pendientes", k.pendingPickings, "/logistica/picking"], ["Incidencias abiertas", k.openIncidents, "/logistica/incidencias"], ["Envíos sin confirmar", k.unconfirmedShipments, "/logistica/envios"], ["Referencias bajo mínimo", k.lowStock, "/logistica/stock"], ["Instalaciones bloqueadas", k.blockedInstalls, "/logistica/incidencias"], ["Pickings preparados", k.preparedPickings, "/logistica/picking"], ["Avisos sync", k.syncErrors, "/logistica/sincronizacion"]];
  const alerts = logisticsAlerts(state);
  return <div className="space-y-4"><div className="grid gap-3 md:grid-cols-4">{rows.map(([label, value, href]) => <a key={label} href={String(href)} className="rounded-2xl border bg-white p-4 shadow-sm hover:border-slate-400"><p className="text-sm text-slate-500">{label}</p><p className="text-3xl font-bold">{value}</p></a>)}</div><Card title="Alertas logísticas">{alerts.length ? alerts.map(a => <a key={`${a.href}-${a.text}`} href={a.href} className="flex items-center justify-between border-t py-3 text-sm"><span><Badge tone={a.level} /> {a.text}</span><ArrowRight className="h-4 w-4" /></a>) : <Empty text="Sin alertas activas." />}</Card><Card title="Últimas solicitudes">{state.requests.slice(0, 5).map(r => <a key={r.id} href={`/logistica/solicitudes?id=${r.id}`} className="block border-t py-3 text-sm"><b>{r.code}</b> · {r.source_type}<p className="text-slate-500">{r.status} · {r.installer_name || "Sin instalador"} · {r.delivery_address || "Sin dirección"}</p></a>)}{!state.requests.length && <Empty text="Aún no hay solicitudes logísticas." />}</Card></div>;
}

function Solicitudes({ state, q, detailId, commit }: ViewProps) {
  const rows = state.requests.filter(x => hay([x.code, x.status, x.source_type, x.installer_name, x.delivery_address, x.rejection_reason], q));
  const selected = rows.find(x => x.id === detailId);
  return (
    <Layout
      list={
        <Card title="Peticiones de material" action={<a href="/?tab=servicios" className="rounded-xl border px-3 py-2 text-sm font-semibold">Crear desde Servicios</a>}>
          <Table headers={["Código", "Origen", "Estado", "Urgencia", "Necesidad", "Destino"]}>
            {rows.map(x => (
              <Row key={x.id} section="solicitudes" id={x.id}>
                <td className="p-3 font-semibold">{x.code}</td>
                <td className="p-3">{x.source_type}</td>
                <td className="p-3"><Status text={x.status} /></td>
                <td className="p-3"><Badge tone={x.priority === "critica" ? "critica" : x.priority === "alta" ? "alta" : "info"} /></td>
                <td className="p-3">{x.required_date || "Sin fecha"}</td>
                <td className="p-3">{x.installer_name || x.delivery_address || "Pendiente"}</td>
              </Row>
            ))}
          </Table>
        </Card>
      }
      detail={
        <Detail title="Detalle petición" selected={selected}>
          {selected && (
            <div className="space-y-3">
              <Read label="Origen" value={<a href={sourceHref(state.requirements.find(x => x.request_id === selected.id) || { source_type: selected.source_type, source_id: selected.source_id } as any)}>Abrir origen -&gt;</a>} />
              <Read label="Estado visible en origen" value={logisticsStatusLabel(state.requirements.find(x => x.request_id === selected.id)?.status)} />
              <Read label="Instalador / dirección" value={`${selected.installer_name || "Sin instalador"} · ${selected.delivery_address || "Sin dirección"}`} />
              {selected.rejection_reason && <Read label="Motivo rechazo" value={selected.rejection_reason} />}
              {selected.lines.map(line => {
                const req = state.requirements.find(x => x.id === line.material_requirement_id);
                const stock = req?.material_id ? state.stock.find(s => s.material_id === req.material_id) : null;
                const free = available(stock);
                return <Mini key={line.id} title={req ? materialDisplay(req, state) : "Línea"} text={`Solicitado ${line.requested_quantity} · Aprobado ${line.accepted_quantity} · Disponible ${free} · ${line.line_status}`} />;
              })}
              <div className="grid gap-2">
                <button onClick={() => exportPickingSheet(state, { request: selected })} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold">
                  <FileDown className="mr-1 inline h-4 w-4" />
                  Exportar hoja de picking
                </button>
                <button onClick={() => commit(d => acceptRequestAndReserve(d, selected.id), "Petición aprobada y stock reservado")} disabled={["aceptada", "en_preparacion", "preparada", "enviada_transporte", "entregada", "cerrada", "rechazada"].includes(selected.status)} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Aprobar y reservar stock</button>
                <button onClick={() => commit(d => createPickingFromRequest(d, selected.id), "Picking creado desde petición")} disabled={!!selected.picking_id || ["rechazada", "cancelada", "bloqueada", "entregada", "cerrada"].includes(selected.status)} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{selected.picking_id ? "Picking ya creado" : "Convertir en picking"}</button>
                <button onClick={() => { const reason = prompt("Motivo del rechazo"); if (reason) commit(d => rejectLogisticsRequest(d, selected.id, reason), "Petición rechazada"); }} disabled={!["borrador", "enviada", "pendiente_revision", "pendiente_material"].includes(selected.status)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">Rechazar petición</button>
              </div>
              {selected.picking_id && <a className="block rounded-xl border p-3 text-sm font-semibold" href={`/logistica/picking?id=${selected.picking_id}`}>Ver picking -&gt;</a>}
              {selected.shipment_id && <a className="block rounded-xl border p-3 text-sm font-semibold" href={`/logistica/envios?id=${selected.shipment_id}`}>Ver envío -&gt;</a>}
              <EstadoLogistico state={state} sourceType={selected.source_type} sourceId={selected.source_id} />
            </div>
          )}
        </Detail>
      }
    />
  );
}

function Entradas({ state, q, detailId, commit }: ViewProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"selector" | "vin_bulk" | "references" | "manual">("selector");
  const [step, setStep] = useState(1);
  const [header, setHeader] = useState<any>({ proveedor_id: "", albaran: "", fecha_recepcion: today(), transportista: "MRW", tracking: "", bultos: 1, observaciones: "" });
  const [lines, setLines] = useState<any[]>([{ material_id: state.materials[0]?.id || "", sku: "", nombre: "", cantidad_esperada: 0, cantidad_recibida: 1, cantidad_correcta: 1, cantidad_danada: 0, estado_material: "correcto", vins: "" }]);
  const [bulkVinMeta, setBulkVinMeta] = useState({ cliente_id: "isdin", campana_id: "ISDIN", semana: "", sku: "", nombre: "", medidas: "", cantidad_esperada: 0 });
  const [bulkVinText, setBulkVinText] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceLines, setReferenceLines] = useState<any[]>([{ sku: "", nombre: "", cliente_id: "", tipo: "consumible", medidas: "", cantidad: 1, observaciones: "" }]);
  const rows = state.entries.filter(x => hay([x.albaran, x.estado, x.transportista], q));
  const selected = state.entries.find(x => x.id === detailId);
  const bulkVins = useMemo(() => parseBulkVins(bulkVinText), [bulkVinText]);
  const bulkVinUnits = bulkVins.reduce((total, row) => total + row.quantity, 0);
  const existingBulkVins = bulkVins.filter(row => state.vins.some(vin => vin.vin_id === row.vin)).length;

  function openEntry(mode: typeof entryMode = "selector") {
    setEntryMode(mode);
    setStep(1);
    setWizardOpen(true);
  }

  function addLine() {
    setLines(prev => [...prev, { material_id: state.materials[0]?.id || "", sku: "", nombre: "", cantidad_esperada: 0, cantidad_recibida: 1, cantidad_correcta: 1, cantidad_danada: 0, estado_material: "correcto", vins: "" }]);
  }

  function addReferenceLine() {
    setReferenceLines(prev => [...prev, { sku: "", nombre: "", cliente_id: "", tipo: "consumible", medidas: "", cantidad: 1, observaciones: "" }]);
  }

  function loadReferencePaste() {
    const parsed = parseReferencePaste(referenceText);
    if (parsed.length) setReferenceLines(parsed);
  }

  async function confirmBulkVins() {
    if (!bulkVins.length) {
      alert("No se han detectado VINs en el texto pegado.");
      return;
    }
    await commit(d => {
      const entryId = uid("ent");
      const entryCode = header.albaran || `ALB-${Date.now().toString().slice(-5)}`;
      const materialResult = upsertMaterialCatalog(d, {
        sku: bulkVinMeta.sku || buildSku("VIN", bulkVinMeta.campana_id, bulkVinMeta.semana || header.fecha_recepcion),
        nombre: bulkVinMeta.nombre || `Vinilos ${bulkVinMeta.campana_id || "campaña"} ${bulkVinMeta.semana || ""}`.trim(),
        cliente_id: bulkVinMeta.cliente_id || null,
        tipo: "vinilo_medida",
        medidas: bulkVinMeta.medidas || null,
        unidad_control: "uds",
        proveedor_id: header.proveedor_id || null
      });
      const expected = Number(bulkVinMeta.cantidad_esperada || bulkVinUnits);
      const entry: any = {
        id: entryId,
        albaran: entryCode,
        fecha_prevista: header.fecha_recepcion || today(),
        fecha_recepcion: header.fecha_recepcion || today(),
        proveedor_id: header.proveedor_id || null,
        transportista: header.transportista,
        tracking_number: header.tracking || null,
        num_bultos_esperado: Number(header.bultos || 1),
        num_bultos_recibido: Number(header.bultos || 1),
        estado: expected === bulkVinUnits ? "recibido_completo" : "con_incidencia",
        observaciones: [header.observaciones, bulkVinMeta.semana ? `Semana ${bulkVinMeta.semana}` : "", expected !== bulkVinUnits ? `Recuento esperado ${expected}, detectado ${bulkVinUnits}` : ""].filter(Boolean).join(" · "),
        lineas: []
      };
      const entryLine: any = {
        id: uid("eline"),
        entrada_id: entryId,
        material_id: materialResult.material.id,
        cantidad_esperada: expected,
        cantidad_recibida: bulkVinUnits,
        cantidad_correcta: bulkVinUnits,
        cantidad_danada: 0,
        diferencia: bulkVinUnits - expected,
        estado_material: expected === bulkVinUnits ? "correcto" : "a_revisar",
        vin_ids: bulkVins.map(row => row.vin),
        observations: bulkVins.map(row => row.quantity > 1 ? `${row.vin} (${row.quantity} ud)` : row.vin).join(", ")
      };
      if (expected !== bulkVinUnits) {
        const inc = createIncident(d, {
          tipo: "falta",
          material_id: materialResult.material.id,
          entrada_id: entryId,
          descripcion: `Entrada ${entryCode} con recuento distinto. Esperado ${expected}, detectado ${bulkVinUnits}.`,
          impacto: "Revisar albarán antes de preparar picking."
        });
        entryLine.incidencia_id = inc.id;
      } else {
        createMovement(d, { material_id: materialResult.material.id, tipo: "entrada", cantidad: bulkVinUnits, origen: entryCode, destino: "almacen", motivo: `Entrada masiva VIN ${entryCode}` });
      }
      bulkVins.forEach(row => {
        upsertLogisticsVin(d, {
          vin_id: row.vin,
          material_id: materialResult.material.id,
          campana_id: bulkVinMeta.campana_id || null,
          medidas: bulkVinMeta.medidas || null,
          estado: "en_almacen"
        });
      });
      entry.lineas.push(entryLine);
      d.entries.unshift(entry);
      publishDomainEvent(d, createDomainEvent("material.base_datos_importada", "logistica", {
        cliente_id: bulkVinMeta.cliente_id || null,
        albaran: entryCode,
        referencias_nuevas: materialResult.created ? 1 : 0,
        referencias_actualizadas: materialResult.created ? 0 : 1,
        materiales: [{ material_id: materialResult.material.id, sku: materialResult.material.sku, cantidad: bulkVinUnits, vins: bulkVins.map(row => row.vin) }]
      }, entry.id));
    }, "Entrada masiva de VINs registrada");
    setWizardOpen(false);
  }

  async function confirmReferenceEntry() {
    const validLines = referenceLines.filter(line => String(line.nombre || line.sku || "").trim() && Number(line.cantidad || 0) > 0);
    if (!validLines.length) {
      alert("Añade al menos una línea de material con cantidad.");
      return;
    }
    await commit(d => {
      const entryId = uid("ent");
      const entryCode = header.albaran || `ALB-${Date.now().toString().slice(-5)}`;
      const entry: any = {
        id: entryId,
        albaran: entryCode,
        fecha_prevista: header.fecha_recepcion || today(),
        fecha_recepcion: header.fecha_recepcion || today(),
        proveedor_id: header.proveedor_id || null,
        transportista: header.transportista,
        tracking_number: header.tracking || null,
        num_bultos_esperado: Number(header.bultos || 1),
        num_bultos_recibido: Number(header.bultos || 1),
        estado: "recibido_completo",
        observaciones: header.observaciones || "",
        lineas: []
      };
      const imported = validLines.map(line => {
        const materialResult = upsertMaterialCatalog(d, {
          sku: line.sku || buildSku("REF", line.nombre, line.medidas),
          nombre: line.nombre || line.sku || "Referencia logística",
          cliente_id: line.cliente_id || null,
          tipo: line.tipo || "consumible",
          medidas: line.medidas || null,
          unidad_control: "uds",
          proveedor_id: header.proveedor_id || null
        });
        const quantity = Number(line.cantidad || 0);
        createMovement(d, { material_id: materialResult.material.id, tipo: "entrada", cantidad: quantity, origen: entryCode, destino: "almacen", motivo: `Entrada rápida ${entryCode}` });
        entry.lineas.push({
          id: uid("eline"),
          entrada_id: entryId,
          material_id: materialResult.material.id,
          cantidad_esperada: quantity,
          cantidad_recibida: quantity,
          cantidad_correcta: quantity,
          cantidad_danada: 0,
          diferencia: 0,
          estado_material: "correcto",
          vin_ids: [],
          observations: line.observaciones || ""
        });
        return { material_id: materialResult.material.id, sku: materialResult.material.sku, cantidad: quantity, created: materialResult.created };
      });
      d.entries.unshift(entry);
      publishDomainEvent(d, createDomainEvent("material.base_datos_importada", "logistica", {
        cliente_id: validLines[0]?.cliente_id || null,
        albaran: entryCode,
        referencias_nuevas: imported.filter(line => line.created).length,
        referencias_actualizadas: imported.filter(line => !line.created).length,
        materiales: imported
      }, entry.id));
    }, "Entrada rápida registrada");
    setWizardOpen(false);
  }

  async function confirmEntry() {
    await commit(d => {
      const entryId = uid("ent");
      const entry: any = { id: entryId, albaran: header.albaran || `ALB-${Date.now().toString().slice(-5)}`, fecha_prevista: header.fecha_recepcion || today(), fecha_recepcion: header.fecha_recepcion || today(), proveedor_id: header.proveedor_id || null, transportista: header.transportista, tracking_number: header.tracking || null, num_bultos_esperado: Number(header.bultos || 1), num_bultos_recibido: Number(header.bultos || 1), estado: "recibido_completo", observaciones: header.observaciones || "", lineas: [] };
      lines.forEach(line => {
        let materialId = line.material_id;
        if (line.material_id === "__new") {
          const created = upsertMaterialCatalog(d, { sku: line.sku || `REF-${Date.now()}`, nombre: line.nombre || "Referencia nueva", tipo: "consumible", unidad_control: "uds" });
          materialId = created.material.id;
        }
        const diff = Number(line.cantidad_recibida || 0) - Number(line.cantidad_esperada || 0);
        const entryLine: any = { id: uid("eline"), entrada_id: entryId, material_id: materialId, cantidad_esperada: Number(line.cantidad_esperada || 0), cantidad_recibida: Number(line.cantidad_recibida || 0), cantidad_correcta: Number(line.cantidad_correcta || 0), cantidad_danada: Number(line.cantidad_danada || 0), diferencia: diff, estado_material: line.estado_material, vin_ids: String(line.vins || "").split(/[\s,;]+/).filter(Boolean) };
        if (entryLine.cantidad_danada > 0 || diff < 0 || line.estado_material !== "correcto") {
          const inc = createIncident(d, { tipo: entryLine.cantidad_danada > 0 ? "material_danado" : "falta", material_id: materialId, entrada_id: entryId, descripcion: `Entrada ${entry.albaran} con diferencia. Esperado ${entryLine.cantidad_esperada}, recibido ${entryLine.cantidad_recibida}, dañado ${entryLine.cantidad_danada}.`, impacto: "Stock retenido hasta resolución" });
          entryLine.incidencia_id = inc.id;
          entry.estado = "con_incidencia";
        } else if (entryLine.cantidad_correcta > 0) {
          createMovement(d, { material_id: materialId, tipo: "entrada", cantidad: entryLine.cantidad_correcta, origen: entry.albaran, destino: "almacen", motivo: `Entrada manual ${entry.albaran}` });
        }
        entryLine.vin_ids.forEach((vin: string) => upsertLogisticsVin(d, { vin_id: vin, material_id: materialId, estado: "en_almacen" }));
        entry.lineas.push(entryLine);
      });
      d.entries.unshift(entry);
      publishDomainEvent(d, createDomainEvent("material.base_datos_importada", "logistica", { cliente_id: null, materiales: lines.filter(line => line.material_id === "__new").map(line => ({ sku: line.sku, nombre: line.nombre })) }, entry.id));
    }, "Entrada registrada y sincronizada");
    setWizardOpen(false);
    setStep(1);
  }
  const commonHeader = (
    <div className="grid gap-3 md:grid-cols-3">
      <InputSmall label="Proveedor" value={header.proveedor_id} onChange={v => setHeader({ ...header, proveedor_id: v })} />
      <InputSmall label="Número de albarán" value={header.albaran} onChange={v => setHeader({ ...header, albaran: v })} />
      <InputSmall label="Fecha recepción" type="date" value={header.fecha_recepcion} onChange={v => setHeader({ ...header, fecha_recepcion: v })} />
      <SelectSmall label="Transportista" value={header.transportista} onChange={v => setHeader({ ...header, transportista: v })} options={["MRW", "SEUR", "DHL", "GLS", "Correos", "Propio", "Otro"]} />
      <InputSmall label="Tracking" value={header.tracking} onChange={v => setHeader({ ...header, tracking: v })} />
      <InputSmall label="Bultos recibidos" type="number" value={header.bultos} onChange={v => setHeader({ ...header, bultos: Number(v) })} />
      <div className="md:col-span-3"><InputSmall label="Observaciones" value={header.observaciones} onChange={v => setHeader({ ...header, observaciones: v })} /></div>
    </div>
  );
  const wizard = wizardOpen && (
    <Card title="Nueva entrada" action={<button onClick={() => setWizardOpen(false)} className="rounded-xl border px-3 py-2 text-sm">Cancelar</button>}>
      {entryMode === "selector" && (
        <div className="grid gap-3 md:grid-cols-3">
          <button onClick={() => setEntryMode("vin_bulk")} className="rounded-2xl border p-4 text-left hover:border-slate-400">
            <b>VINs en bloque</b>
            <p className="mt-1 text-sm text-slate-500">ISDIN, Sabadell y albaranes con muchos VINs.</p>
          </button>
          <button onClick={() => setEntryMode("references")} className="rounded-2xl border p-4 text-left hover:border-slate-400">
            <b>Material rápido</b>
            <p className="mt-1 text-sm text-slate-500">Foam, polyjet, vinilo genérico y referencias sin VIN.</p>
          </button>
          <button onClick={() => setEntryMode("manual")} className="rounded-2xl border p-4 text-left hover:border-slate-400">
            <b>Entrada completa</b>
            <p className="mt-1 text-sm text-slate-500">Dañados, diferencias, fotos o revisión detallada.</p>
          </button>
        </div>
      )}
      {entryMode === "vin_bulk" && (
        <div className="space-y-4">
          {commonHeader}
          <div className="grid gap-3 md:grid-cols-3">
            <InputSmall label="Cliente" value={bulkVinMeta.cliente_id} onChange={v => setBulkVinMeta({ ...bulkVinMeta, cliente_id: v })} />
            <InputSmall label="Campaña" value={bulkVinMeta.campana_id} onChange={v => setBulkVinMeta({ ...bulkVinMeta, campana_id: v })} />
            <InputSmall label="Semana instalación" value={bulkVinMeta.semana} onChange={v => setBulkVinMeta({ ...bulkVinMeta, semana: v })} />
            <InputSmall label="SKU material" value={bulkVinMeta.sku} onChange={v => setBulkVinMeta({ ...bulkVinMeta, sku: v })} />
            <InputSmall label="Nombre material" value={bulkVinMeta.nombre} onChange={v => setBulkVinMeta({ ...bulkVinMeta, nombre: v })} />
            <InputSmall label="Medidas" value={bulkVinMeta.medidas} onChange={v => setBulkVinMeta({ ...bulkVinMeta, medidas: v })} />
            <InputSmall label="Cantidad esperada" type="number" value={bulkVinMeta.cantidad_esperada} onChange={v => setBulkVinMeta({ ...bulkVinMeta, cantidad_esperada: Number(v) })} />
          </div>
          <TextAreaSmall label="VINs / texto del albarán" value={bulkVinText} onChange={setBulkVinText} rows={9} />
          <div className="grid gap-3 md:grid-cols-4">
            <Mini title="VINs detectados" text={String(bulkVins.length)} />
            <Mini title="Unidades" text={String(bulkVinUnits)} />
            <Mini title="Ya existen" text={String(existingBulkVins)} />
            <Mini title="Diferencia" text={String(bulkVinUnits - Number(bulkVinMeta.cantidad_esperada || bulkVinUnits))} />
          </div>
          {bulkVins.length > 0 && <div className="max-h-44 overflow-auto rounded-xl border p-3 text-xs">{bulkVins.map(row => <span key={row.vin} className="mr-2 inline-block rounded-full bg-slate-100 px-2 py-1">{row.vin}{row.quantity > 1 ? ` · ${row.quantity} ud` : ""}</span>)}</div>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEntryMode("selector")} className="rounded-xl border px-3 py-2 text-sm font-semibold">Cambiar tipo</button>
            <button onClick={confirmBulkVins} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Confirmar VINs en almacén</button>
          </div>
        </div>
      )}
      {entryMode === "references" && (
        <div className="space-y-4">
          {commonHeader}
          <TextAreaSmall label="Pegar líneas" value={referenceText} onChange={setReferenceText} rows={5} />
          <button onClick={loadReferencePaste} className="rounded-xl border px-3 py-2 text-sm font-semibold">Cargar líneas pegadas</button>
          <div className="space-y-3">
            {referenceLines.map((line, index) => (
              <div key={index} className="grid gap-2 rounded-2xl border p-3 md:grid-cols-6">
                <InputSmall label="SKU" value={line.sku} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, sku: v } : x))} />
                <div className="md:col-span-2"><InputSmall label="Material" value={line.nombre} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, nombre: v } : x))} /></div>
                <InputSmall label="Medidas" value={line.medidas} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, medidas: v } : x))} />
                <InputSmall label="Cantidad" type="number" value={line.cantidad} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, cantidad: Number(v) } : x))} />
                <SelectSmall label="Tipo" value={line.tipo} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, tipo: v } : x))} options={["consumible", "vinilo_estandar", "vinilo_medida", "herramienta"]} />
                <div className="md:col-span-2"><InputSmall label="Cliente" value={line.cliente_id} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, cliente_id: v } : x))} /></div>
                <div className="md:col-span-4"><InputSmall label="Observaciones" value={line.observaciones} onChange={v => setReferenceLines(prev => prev.map((x, i) => i === index ? { ...x, observaciones: v } : x))} /></div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={addReferenceLine} className="rounded-xl border px-3 py-2 text-sm font-semibold">Añadir línea</button>
            <button onClick={() => setEntryMode("selector")} className="rounded-xl border px-3 py-2 text-sm font-semibold">Cambiar tipo</button>
            <button onClick={confirmReferenceEntry} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Confirmar material</button>
          </div>
        </div>
      )}
      {entryMode === "manual" && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-500">Paso {step} de 3</p>
          {step === 1 && <div className="space-y-3">{commonHeader}<div className="flex gap-2"><button onClick={() => setEntryMode("selector")} className="rounded-xl border px-3 py-2 text-sm font-semibold">Cambiar tipo</button><button onClick={() => setStep(2)} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Continuar</button></div></div>}
          {step === 2 && <div className="space-y-3">{lines.map((line, index) => <div key={index} className="rounded-2xl border p-3"><div className="grid gap-2 md:grid-cols-4"><SelectSmall label="Material" value={line.material_id} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, material_id: v } : x))} options={[...state.materials.map(m => m.id), "__new"]} labels={{ ...Object.fromEntries(state.materials.map(m => [m.id, `${m.sku} · ${m.nombre}`])), "__new": "Crear referencia nueva" }} /><InputSmall label="SKU nueva" value={line.sku} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, sku: v } : x))} /><InputSmall label="Nombre nueva" value={line.nombre} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, nombre: v } : x))} /><SelectSmall label="Estado" value={line.estado_material} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, estado_material: v } : x))} options={["correcto", "dañado", "incorrecto", "a_revisar"]} /><InputSmall label="Esperada" type="number" value={line.cantidad_esperada} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, cantidad_esperada: Number(v) } : x))} /><InputSmall label="Recibida" type="number" value={line.cantidad_recibida} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, cantidad_recibida: Number(v), cantidad_correcta: Math.max(0, Number(v) - Number(x.cantidad_danada || 0)) } : x))} /><InputSmall label="Dañada" type="number" value={line.cantidad_danada} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, cantidad_danada: Number(v), cantidad_correcta: Math.max(0, Number(x.cantidad_recibida || 0) - Number(v)) } : x))} /><InputSmall label="VINs" value={line.vins} onChange={v => setLines(prev => prev.map((x, i) => i === index ? { ...x, vins: v } : x))} /></div>{Number(line.cantidad_recibida) < Number(line.cantidad_esperada) && <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs font-semibold text-red-800">Diferencia detectada: se propondrá incidencia automática.</p>}</div>)}<div className="flex gap-2"><button onClick={addLine} className="rounded-xl border px-3 py-2 text-sm">Añadir línea</button><button onClick={() => setStep(3)} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Revisar</button></div></div>}
          {step === 3 && <div className="space-y-3"><Mini title="Resumen" text={`${lines.length} líneas · ${lines.reduce((a, l) => a + Number(l.cantidad_recibida || 0), 0)} unidades recibidas · ${lines.filter(l => Number(l.cantidad_danada || 0) > 0 || Number(l.cantidad_recibida || 0) < Number(l.cantidad_esperada || 0) || l.estado_material !== "correcto").length} incidencias automáticas`} />{lines.map((line, index) => <Mini key={index} title={line.material_id === "__new" ? line.nombre || "Referencia nueva" : materialName(state, line.material_id)} text={`Stock +${line.estado_material === "correcto" && Number(line.cantidad_danada || 0) === 0 && Number(line.cantidad_recibida || 0) >= Number(line.cantidad_esperada || 0) ? Number(line.cantidad_correcta || 0) : 0} · VINs ${String(line.vins || "").split(/[\s,;]+/).filter(Boolean).length}`} />)}<button onClick={confirmEntry} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Confirmar entrada</button></div>}
        </div>
      )}
    </Card>
  );
  return <div className="space-y-4">{wizard}<Layout list={<Card title="Entradas de almacén" action={<button onClick={() => openEntry()} className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white"><Plus className="mr-1 inline h-4 w-4" />Nueva entrada</button>}><Table headers={["Albarán", "Estado", "Prevista", "Bultos"]}>{rows.map(x => <Row key={x.id} section="entradas" id={x.id}><td className="p-3 font-semibold">{x.albaran}</td><td className="p-3"><Status text={x.estado} /></td><td className="p-3">{x.fecha_prevista}</td><td className="p-3">{x.num_bultos_recibido}/{x.num_bultos_esperado}</td></Row>)}</Table></Card>} detail={<Detail title="Detalle entrada" selected={selected}>{selected && <div className="space-y-3"><Read label="Albarán" value={selected.albaran} /><Read label="Observaciones" value={selected.observaciones || "Sin observaciones"} />{selected.lineas.map(l => <Mini key={l.id} title={materialName(state, l.material_id)} text={`Esperado ${l.cantidad_esperada} · Recibido ${l.cantidad_recibida} · Dañado ${l.cantidad_danada}`} />)}{selected.estado === "pendiente" ? <button onClick={() => commit(d => receiveEntry(d, selected.id, "recibido_completo"), "Entrada recibida y stock actualizado")} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Marcar recibido completo</button> : <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">Entrada ya contabilizada o cerrada</div>}{selected.lineas.flatMap(l => l.incidencia_id ? [<a key={l.incidencia_id} href={`/logistica/incidencias?id=${l.incidencia_id}`} className="block rounded-xl border p-3 text-sm font-semibold">Ver incidencia →</a>] : [])}</div>}</Detail>} /></div>;
}

function Stock({ state, q, detailId, commit }: ViewProps) {
  const rows = state.stock.filter(s => hay([materialName(state, s.material_id)], q));
  const selected = rows.find(x => x.material_id === detailId);
  const byClient = clientHistory(state).filter(row => hay([row.client, row.materiales.join(" ")], q));
  return <div className="space-y-4"><Layout list={<Card title="Stock"><Table headers={["Material", "Físico", "Reservado", "Picking", "Bloqueado", "Disponible"]}>{rows.map(s => <Row key={s.id} section="stock" id={s.material_id}><td className="p-3 font-semibold">{materialName(state, s.material_id)}</td><td className="p-3">{s.cantidad_fisica}</td><td className="p-3">{s.cantidad_reservada}</td><td className="p-3">{s.cantidad_picking}</td><td className="p-3">{s.cantidad_bloqueada}</td><td className="p-3 font-bold">{available(s)}</td></Row>)}</Table></Card>} detail={<Detail title="Movimientos de stock" selected={selected}>{selected && <div className="space-y-3"><Read label="Disponible" value={available(selected)} /><button onClick={() => commit(d => createMovement(d, { material_id: selected.material_id, tipo: "ajuste", cantidad: 1, motivo: "Ajuste manual obligatorio" }), "Ajuste registrado")} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold">Crear ajuste +1</button><Movements state={state} rows={state.movements.filter(x => x.material_id === selected.material_id)} /></div>}</Detail>} /><Card title="Por cliente"><Table headers={["Cliente", "Recibido", "Consumido", "Incidencias", "Peticiones", "Referencias"]}>{byClient.map(row => <tr key={row.client} className="border-t"><td className="p-3 font-semibold">{row.client}</td><td className="p-3">{row.recibido}</td><td className="p-3">{row.consumido}</td><td className="p-3">{row.incidencias}</td><td className="p-3">{row.peticiones}</td><td className="p-3">{row.materiales.slice(0, 3).join(", ") || "Sin referencias"}</td></tr>)}</Table></Card></div>;
}

function Picking({ state, q, detailId, commit }: ViewProps) {
  const rows = state.pickings.filter(x => hay([x.codigo, x.estado, x.zona, x.campana_id], q));
  const selected = rows.find(x => x.id === detailId);
  return <Layout list={<Card title="Picking" action={<a href="/logistica/solicitudes" className="rounded-xl border px-3 py-2 text-sm font-semibold">Crear desde petición</a>}><Table headers={["Código", "Estado", "Campaña", "Puntos"]}>{rows.map(x => <Row key={x.id} section="picking" id={x.id}><td className="p-3 font-semibold">{x.codigo}</td><td className="p-3"><Status text={x.estado} /></td><td className="p-3">{x.campana_id || "Sin campaña"}</td><td className="p-3">{x.num_puntos}</td></Row>)}</Table></Card>} detail={<Detail title="Detalle picking" selected={selected}>{selected && <div className="space-y-3"><Read label="Código" value={selected.codigo} /><Read label="Envío" value={selected.envio_id ? <a href={`/logistica/envios?id=${selected.envio_id}`}>Ver envío</a> : "Sin envío"} />{selected.lineas.map(l => <Mini key={l.id} title={materialName(state, l.material_id)} text={`${l.cantidad_preparada}/${l.cantidad_esperada} · ${l.estado}`} action={<button onClick={() => commit(d => preparePickingLine(d, selected.id, l.id, l.cantidad_esperada), "Línea preparada")} disabled={l.estado === "listo"} className="mt-2 rounded-lg border px-2 py-1 text-xs disabled:opacity-40">{l.estado === "listo" ? "Listo" : "Marcar listo"}</button>} />)}<button onClick={() => exportPickingSheet(state, { picking: selected })} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold"><FileDown className="mr-1 inline h-4 w-4" />Exportar hoja de picking</button><button onClick={() => commit(d => generateShipping(d, selected.id), "Envío generado")} disabled={selected.estado !== "preparado" || !!selected.envio_id} className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Send className="mr-1 inline h-4 w-4" />{selected.envio_id ? "Envío ya generado" : "Generar envío"}</button><button onClick={() => commit(d => closePicking(d, selected.id), "Picking cerrado")} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold">Cerrar picking</button><Trace state={state} vin={selected.lineas.find(l => l.vin_id)?.vin_id} /></div>}</Detail>} />;
}

function Envios({ state, q, detailId, commit }: ViewProps) {
  const rows = state.shipments.filter(x => hay([x.tracking, x.estado, x.transportista], q));
  const selected = rows.find(x => x.id === detailId);
  return <Layout list={<Card title="Salidas y envíos"><Table headers={["Tracking", "Estado", "Transportista", "Confirmado"]}>{rows.map(x => <Row key={x.id} section="envios" id={x.id}><td className="p-3 font-semibold">{x.tracking || "Sin tracking"}</td><td className="p-3"><Status text={x.estado} /></td><td className="p-3">{x.transportista || "Pendiente"}</td><td className="p-3">{x.confirmado_por_instalador ? "Sí" : "No"}</td></Row>)}</Table></Card>} detail={<Detail title="Detalle envío" selected={selected}>{selected && <div className="space-y-3"><Read label="Picking" value={<a href={`/logistica/picking?id=${selected.picking_id}`}>Ver picking</a>} /><Read label="Tracking" value={selected.tracking || "Sin tracking"} /><button onClick={() => commit(d => confirmInstallerDelivery(d, selected.id), "Recepción confirmada")} disabled={selected.confirmado_por_instalador || selected.estado === "entregado"} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 inline h-4 w-4" />{selected.confirmado_por_instalador || selected.estado === "entregado" ? "Recepción confirmada" : "Confirmar recepción instalador"}</button></div>}</Detail>} />;
}

function Incidencias({ state, q, detailId, commit }: ViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const rows = state.incidents.filter(x => hay([x.codigo, x.tipo, x.estado, x.descripcion], q));
  const selected = rows.find(x => x.id === detailId);
  return <><CrearIncidenciaModal open={modalOpen} context={{}} onClose={() => setModalOpen(false)} onCreate={incident => commit(d => publishDomainEvent(d, createDomainEvent("servicio.incidencia_creada", "logistica", { ...incident, material_id: incident.material_id || d.materials[0]?.id }, incident.vin_id || incident.servicio_id || "manual")), "Incidencia creada")} /><Layout list={<Card title="Incidencias logísticas" action={<button onClick={() => setModalOpen(true)} className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white"><Plus className="mr-1 inline h-4 w-4" />Incidencia</button>}><Table headers={["Código", "Tipo", "Estado", "Material"]}>{rows.map(x => <Row key={x.id} section="incidencias" id={x.id}><td className="p-3 font-semibold">{x.codigo}</td><td className="p-3">{x.tipo}</td><td className="p-3"><Status text={x.estado} /></td><td className="p-3">{materialName(state, x.material_id)}</td></Row>)}</Table></Card>} detail={<Detail title="Detalle incidencia" selected={selected}>{selected && <div className="space-y-3"><Read label="Estado" value={<Status text={selected.estado} />} /><Read label="Descripción" value={selected.descripcion} /><Read label="Impacto" value={selected.impacto || "Sin impacto"} />{selected.resolution && <Read label="Resolución" value={selected.resolution} />}{selected.pendiente_llegada_id && <a className="block rounded-xl border p-3 text-sm font-semibold" href={`/logistica/pendientes?id=${selected.pendiente_llegada_id}`}>Ver pendiente de llegada →</a>}<div className="grid gap-2"><button onClick={() => commit(d => setLogisticsIncidentStatus(d, selected.id, "pend_produccion"), "Incidencia marcada pendiente de producción")} disabled={["resuelta", "cancelada"].includes(selected.estado)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-40">Pendiente producción</button><button onClick={() => commit(d => setLogisticsIncidentStatus(d, selected.id, "pend_transporte"), "Incidencia marcada pendiente de transporte")} disabled={["resuelta", "cancelada"].includes(selected.estado)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-40">Pendiente transporte</button><button onClick={() => commit(d => resolveLogisticsIncident(d, selected.id), "Incidencia resuelta")} disabled={selected.estado === "resuelta"} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 inline h-4 w-4" />Resolver incidencia</button><button onClick={() => { const reason = prompt("Motivo de cancelación"); if (reason) commit(d => cancelLogisticsIncident(d, selected.id, reason), "Incidencia cancelada"); }} disabled={["resuelta", "cancelada"].includes(selected.estado)} className="w-full rounded-xl border px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">Cancelar incidencia</button></div><Trace state={state} vin={selected.vin_id} /></div>}</Detail>} /></>;
}

function Pendientes({ state, q, detailId, commit }: ViewProps) {
  const rows = state.pendings.filter(x => hay([x.motivo, x.estado, x.vin_id], q));
  const selected = rows.find(x => x.id === detailId);
  const req = selected ? state.requirements.find(x => x.pending_arrival_id === selected.id) || state.requirements.find(x => selected.vin_id && x.vin === selected.vin_id) : null;
  const canReceive = !!selected && !["recibido", "asignado_picking", "cerrado"].includes(selected.estado);
  const canPick = !!selected && selected.estado === "recibido";
  return <Layout list={<Card title="Pendientes de llegada"><Table headers={["Motivo", "Estado", "Prevista", "VIN"]}>{rows.map(x => <Row key={x.id} section="pendientes" id={x.id}><td className="p-3 font-semibold">{x.motivo}</td><td className="p-3"><Status text={x.estado} /></td><td className="p-3">{x.fecha_prevista || "Sin fecha"}</td><td className="p-3">{x.vin_id || ""}</td></Row>)}</Table></Card>} detail={<Detail title="Detalle pendiente" selected={selected}>{selected && <div className="space-y-3"><Read label="Incidencia" value={<a href={`/logistica/incidencias?id=${selected.incidencia_id}`}>Ver incidencia</a>} /><Read label="Material" value={selected.material_id ? materialName(state, selected.material_id) : req?.requested_material_name || "Sin material"} /><Read label="Riesgo" value={selected.en_riesgo ? "En riesgo" : "Sin riesgo"} /><button onClick={() => commit(d => receivePendingArrival(d, selected.id), "Pendiente recibido y stock actualizado")} disabled={!canReceive} className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 inline h-4 w-4" />{canReceive ? "Registrar recepción" : "Recepción registrada"}</button><button onClick={() => commit(d => createPickingFromPendingArrival(d, selected.id), "Picking creado desde pendiente")} disabled={!canPick} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Send className="mr-1 inline h-4 w-4" />{selected.estado === "asignado_picking" ? "Picking ya asignado" : "Crear picking de reposición"}</button>{req?.picking_id && <a className="block rounded-xl border p-3 text-sm font-semibold" href={`/logistica/picking?id=${req.picking_id}`}>Ver picking →</a>}<Trace state={state} vin={selected.vin_id} /></div>}</Detail>} />;
}

function Sincronizacion({ state, q, commit }: ViewProps) {
  const issues = detectLogisticsSyncIssues(state).filter(x => hay([x.text, x.fix, x.severity], q));
  const logs = state.syncLogs.filter(x => hay([x.evento, x.origen_modulo, x.destino_modulo, x.resultado, x.error_message], q));
  return <div className="space-y-4"><Card title="Estado de sincronización logística" action={<button onClick={() => commit(d => { retryFailedIntegrationEvents(d); }, "Eventos reintentados")} disabled={!state.events.some(x => x.status === "error")} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40"><RefreshCw className="mr-1 inline h-4 w-4" />Reintentar errores</button>}><div className="grid gap-3 md:grid-cols-5"><Mini title="Eventos" text={String(state.events.length)} /><Mini title="Completados" text={String(state.events.filter(x => x.status === "completado").length)} /><Mini title="Errores" text={String(state.events.filter(x => x.status === "error").length)} /><Mini title="SyncLog" text={String(state.syncLogs.length)} /><Mini title="Avisos" text={String(issues.length)} /></div></Card><Card title="Diagnóstico">{issues.length ? issues.map(i => <div key={i.id} className="border-t py-3 text-sm"><Badge tone={i.severity === "critica" ? "critica" : i.severity === "alta" ? "alta" : "info"} /> <b>{i.text}</b><p className="mt-1 text-slate-500">{i.fix || "Revisión manual recomendada."}</p><div className="mt-2 flex gap-2">{i.sourceHref && <a className="rounded-xl border px-3 py-1" href={i.sourceHref}>Abrir origen</a>}{i.logisticsHref && <a className="rounded-xl border px-3 py-1" href={i.logisticsHref}>Abrir logística</a>}</div></div>) : <Empty text="No se detectan errores de sincronización." />}</Card><Card title="SyncLog">{logs.slice(0, 40).map(log => <div key={log.id} className="border-t py-2 text-xs"><b>{log.evento}</b> · {log.origen_modulo} → {log.destino_modulo} · {log.resultado}<p className="text-slate-500">{new Date(log.created_at).toLocaleString("es-ES")}{log.error_message ? ` · ${log.error_message}` : ""}</p></div>)}{!logs.length && <Empty text="Sin trazas de sincronización todavía." />}</Card><Card title="Eventos recientes">{state.events.slice(0, 20).map(e => <div key={e.id} className="border-t py-2 text-xs"><b>{e.event_type}</b> · {e.source_type}:{e.source_id} · {e.status}<p className="text-slate-500">{e.idempotency_key}{e.last_error ? ` · ${e.last_error}` : ""}</p></div>)}</Card></div>;
}

type ViewProps = { state: LogisticsState; q: string; detailId?: string; commit: (mutator: (draft: LogisticsState) => void, message?: string) => Promise<void> };
function Layout({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) { return <div className="grid gap-4 xl:grid-cols-[1fr_420px]">{list}{detail}</div>; }
function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) { return <section className="rounded-2xl border bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-lg font-bold">{title}</h3>{action}</div>{children}</section>; }
function Detail({ title, selected, children }: { title: string; selected: unknown; children: React.ReactNode }) { return <Card title={title}>{selected ? children : <Empty text="Selecciona una fila para ver el detalle." />}</Card>; }
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) { return <div className="overflow-auto rounded-xl border"><table className="w-full text-sm"><thead><tr className="bg-slate-900 text-white">{headers.map(h => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Row({ section, id, children }: { section: string; id: string; children: React.ReactNode }) { return <tr onClick={() => { location.href = `/logistica/${section}?id=${encodeURIComponent(id)}`; }} className="cursor-pointer border-t hover:bg-slate-50">{children}</tr>; }
function Read({ label, value }: { label: string; value: React.ReactNode }) { return <div className="border-b py-2 text-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><div>{value}</div></div>; }
function Mini({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="rounded-xl border p-3 text-sm"><b>{title}</b><p>{text}</p>{action}</div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{text}</p>; }
function Status({ text }: { text: string }) { const color = text.includes("resuelta") || text.includes("completo") || text.includes("entregado") || text.includes("preparado") ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : text.includes("pend") || text.includes("transito") || text.includes("preparacion") ? "bg-amber-50 text-amber-800 ring-amber-200" : text.includes("fall") || text.includes("extravi") || text.includes("incid") ? "bg-red-50 text-red-800 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-200"; return <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${color}`}>{text}</span>; }
function Badge({ tone }: { tone: "critica" | "alta" | "info" }) { const cls = tone === "critica" ? "bg-red-100 text-red-800" : tone === "alta" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"; return <span className={`mr-2 rounded-full px-2 py-1 text-xs font-bold ${cls}`}>{tone}</span>; }
function Movements({ state, rows }: { state: LogisticsState; rows: StockMovement[] }) { return <div className="max-h-72 space-y-2 overflow-auto">{rows.map(m => <div key={m.id} className="rounded-xl border p-3 text-xs"><b>{m.tipo}</b> · {m.cantidad} · {materialName(state, m.material_id)}<p className="text-slate-500">{m.motivo} · {new Date(m.created_at).toLocaleString("es-ES")}</p></div>)}</div>; }
function Trace({ state, vin }: { state: LogisticsState; vin?: string | null }) { if (!vin) return null; const picking = state.pickings.find(p => p.lineas.some(l => l.vin_id === vin)); const envio = picking?.envio_id ? state.shipments.find(x => x.id === picking.envio_id) : null; const incident = state.incidents.find(x => x.vin_id === vin && !["resuelta", "cancelada"].includes(x.estado)); const pending = state.pendings.find(x => x.vin_id === vin && !["cerrado", "recibido"].includes(x.estado)); return <Card title="Trazabilidad VIN"><Read label="VIN" value={vin} /><Read label="Campaña" value={picking?.campana_id || incident?.campana_id || "Sin campaña"} /><Read label="Picking" value={picking ? <a href={`/logistica/picking?id=${picking.id}`}>{picking.codigo}</a> : "Sin picking"} /><Read label="Envío" value={envio ? <a href={`/logistica/envios?id=${envio.id}`}>{envio.tracking || envio.estado}</a> : "Sin envío"} /><Read label="Incidencia activa" value={incident ? <a href={`/logistica/incidencias?id=${incident.id}`}>{incident.codigo}</a> : "Sin incidencia"} /><Read label="Pendiente llegada" value={pending ? <a href={`/logistica/pendientes?id=${pending.id}`}>Ver pendiente</a> : "Sin pendiente"} /><Movements state={state} rows={state.movements.filter(x => x.vin_id === vin)} /></Card>; }
function InputSmall({ label, value, onChange, type = "text" }: { label: string; value: any; onChange: (value: string) => void; type?: string }) { return <label className="block"><span className="text-sm font-medium">{label}</span><input type={type} value={value ?? ""} onChange={event => onChange(event.target.value)} className="w-full rounded-2xl border px-3 py-2" /></label>; }
function SelectSmall({ label, value, onChange, options, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) { return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value ?? ""} onChange={event => onChange(event.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map(option => <option key={option} value={option}>{labels[option] || option}</option>)}</select></label>; }
function TextAreaSmall({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) { return <label className="block"><span className="text-sm font-medium">{label}</span><textarea value={value} rows={rows} onChange={event => onChange(event.target.value)} className="w-full resize-y rounded-2xl border px-3 py-2 font-mono text-sm" /></label>; }
function parseBulkVins(text: string) {
  const byVin = new Map<string, { vin: string; quantity: number }>();
  const pattern = /\bVIN[-\s]?(\d+)\b(?:\s*\((\d+)\s*(?:ud|uds|unidades?)\))?/gi;
  let match = pattern.exec(text);
  while (match) {
    const vin = `VIN-${match[1]}`;
    const quantity = Math.max(1, Number(match[2] || 1));
    const current = byVin.get(vin);
    byVin.set(vin, { vin, quantity: (current?.quantity || 0) + quantity });
    match = pattern.exec(text);
  }
  return Array.from(byVin.values()).sort((a, b) => a.vin.localeCompare(b.vin, "es", { numeric: true }));
}
function buildSku(prefix: string, ...parts: unknown[]) {
  const raw = [prefix, ...parts].filter(Boolean).join("-");
  const slug = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
  return slug.slice(0, 48) || `${prefix}-${Date.now().toString().slice(-5)}`;
}
function parseReferencePaste(text: string) {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const columns = line.split(/\t|;/).map(value => value.trim()).filter(Boolean);
      if (columns.length >= 2) {
        const startsWithQty = /^\d+([,.]\d+)?$/.test(columns[0]);
        const quantity = startsWithQty ? Number(columns[0].replace(",", ".")) : Number(columns[columns.length - 1].replace(",", "."));
        const nombre = startsWithQty ? columns[1] : columns[0];
        const medidas = columns.find(value => /\d+\s*x\s*\d+/i.test(value)) || "";
        return { sku: "", nombre, cliente_id: "", tipo: /vinilo/i.test(nombre) ? "vinilo_medida" : "consumible", medidas, cantidad: Number.isFinite(quantity) ? quantity : 1, observaciones: columns.slice(startsWithQty ? 2 : 1).join(" · ") };
      }
      const qtyMatch = line.match(/^\s*(\d+(?:[,.]\d+)?)\s+(.+)$/);
      const quantity = qtyMatch ? Number(qtyMatch[1].replace(",", ".")) : 1;
      const nombre = qtyMatch ? qtyMatch[2] : line;
      const medidas = nombre.match(/\d+\s*x\s*\d+\s*(?:cm|mm|m)?/i)?.[0] || "";
      return { sku: "", nombre, cliente_id: "", tipo: /vinilo/i.test(nombre) ? "vinilo_medida" : "consumible", medidas, cantidad: quantity, observaciones: "" };
    });
}
function exportPickingSheet(state: LogisticsState, input: { request?: LogisticsState["requests"][number]; picking?: LogisticsState["pickings"][number] }) {
  const rows = [["Código", "Campaña", "Instalador", "Material", "SKU", "VIN", "Cantidad", "Destino", "Estado"]];
  if (input.request) {
    input.request.lines.forEach(line => {
      const req = state.requirements.find(x => x.id === line.material_requirement_id);
      const material = req?.material_id ? state.materials.find(x => x.id === req.material_id) : null;
      rows.push([
        input.request!.code,
        input.request!.campaign_id || req?.campaign_id || "",
        input.request!.installer_name || req?.installer_name || "",
        material?.nombre || req?.requested_material_name || "Material pendiente",
        material?.sku || req?.requested_sku || "",
        req?.vin || "",
        String(line.accepted_quantity || line.requested_quantity || req?.requested_quantity || 0),
        input.request!.delivery_address || req?.delivery_address || "",
        line.line_status || req?.status || input.request!.status
      ]);
    });
  }
  if (input.picking) {
    input.picking.lineas.forEach(line => rows.push([
      input.picking!.codigo,
      input.picking!.campana_id || "",
      input.picking!.instalador_id || "",
      materialName(state, line.material_id),
      state.materials.find(x => x.id === line.material_id)?.sku || "",
      line.vin_id || "",
      String(line.cantidad_esperada),
      input.picking!.zona || "",
      line.estado
    ]));
  }
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${input.picking?.codigo || input.request?.code || "hoja-picking"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
function clientHistory(state: LogisticsState) {
  const clients = new Map<string, { client: string; recibido: number; consumido: number; incidencias: number; peticiones: number; materiales: string[] }>();
  state.materials.forEach(material => {
    const client = material.cliente_id || "Sin cliente";
    if (!clients.has(client)) clients.set(client, { client, recibido: 0, consumido: 0, incidencias: 0, peticiones: 0, materiales: [] });
    clients.get(client)!.materiales.push(material.nombre);
  });
  state.movements.forEach(movement => {
    const material = state.materials.find(x => x.id === movement.material_id);
    const client = material?.cliente_id || "Sin cliente";
    if (!clients.has(client)) clients.set(client, { client, recibido: 0, consumido: 0, incidencias: 0, peticiones: 0, materiales: [] });
    if (movement.tipo === "entrada") clients.get(client)!.recibido += movement.cantidad;
    if (["consumo", "entrega", "salida"].includes(movement.tipo)) clients.get(client)!.consumido += movement.cantidad;
  });
  state.incidents.forEach(incident => {
    const material = state.materials.find(x => x.id === incident.material_id);
    const client = material?.cliente_id || incident.campana_id || "Sin cliente";
    if (!clients.has(client)) clients.set(client, { client, recibido: 0, consumido: 0, incidencias: 0, peticiones: 0, materiales: [] });
    clients.get(client)!.incidencias += 1;
  });
  state.requests.forEach(request => {
    const client = request.client_id || "Sin cliente";
    if (!clients.has(client)) clients.set(client, { client, recibido: 0, consumido: 0, incidencias: 0, peticiones: 0, materiales: [] });
    clients.get(client)!.peticiones += 1;
  });
  return Array.from(clients.values()).sort((a, b) => b.peticiones + b.recibido - (a.peticiones + a.recibido));
}
function hay(values: unknown[], q: string) { return !q || values.join(" ").toLowerCase().includes(q.toLowerCase()); }
