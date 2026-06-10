import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  Entry,
  IntegrationEvent,
  LogisticsAuditEntry,
  LogisticsNotification,
  LogisticsRequest,
  LogisticsRequestLine,
  LogisticsState,
  LogisticsVin,
  Material,
  MaterialRequirement,
  PendingArrival,
  Picking,
  PickingLine,
  Shipping,
  Stock,
  StockMovement,
  addSyncLog,
  loadLogistics,
  logisticsStatusLabel,
  normalizeLogisticsState,
  saveLogistics,
  seedLogistics
} from "@/lib/logistics";

type Db = Record<string, unknown>;

function stripUndefined<T extends Db>(row: T) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

function materialForDb(row: Material) {
  return stripUndefined({ ...row });
}

function entryForDb(row: Entry) {
  const { lineas, ...entry } = row;
  void lineas;
  return stripUndefined(entry as Db);
}

function entryLineForDb(row: Entry["lineas"][number], entryId: string) {
  const { diferencia, ...line } = row;
  void diferencia;
  return stripUndefined({ ...line, entrada_id: entryId });
}

function pickingForDb(row: Picking) {
  const { lineas, ...picking } = row;
  void lineas;
  return stripUndefined(picking as Db);
}

function pickingLineForDb(row: PickingLine, pickingId: string) {
  return stripUndefined({ ...row, picking_id: pickingId });
}

function requestForDb(row: LogisticsRequest) {
  const { lines, ...request } = row;
  void lines;
  return stripUndefined(request as Db);
}

function requestLineForDb(row: LogisticsRequestLine, requestId: string) {
  return stripUndefined({ ...row, request_id: requestId });
}

function eventForDb(row: IntegrationEvent) {
  return stripUndefined(row as unknown as Db);
}

function auditForDb(row: LogisticsAuditEntry) {
  return stripUndefined({
    id: row.id,
    actor: row.actor,
    module: row.module,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    previous_value: row.previous_value ?? null,
    new_value: row.new_value ?? null,
    reason: row.reason,
    sync_event_id: row.sync_event_id,
    created_at: row.created_at
  });
}

function notificationForDb(row: LogisticsNotification) {
  return stripUndefined(row as unknown as Db);
}

function vinForDb(row: LogisticsVin) {
  return stripUndefined(row as unknown as Db);
}

function stockForDb(row: Stock) {
  const { disponible, ...stock } = row as Stock & { disponible?: number };
  void disponible;
  return stripUndefined(stock as unknown as Db);
}

async function upsertMany(table: string, rows: Db[]) {
  if (!supabase || rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw error;
}

async function replaceChildren(table: string, foreignKey: string, ownerIds: string[], rows: Db[]) {
  if (!supabase) return;
  if (ownerIds.length) {
    const { error: deleteError } = await supabase.from(table).delete().in(foreignKey, ownerIds);
    if (deleteError) throw deleteError;
  }
  await upsertMany(table, rows);
}

async function insertNewMovements(rows: Db[]) {
  if (!supabase || rows.length === 0) return;
  const ids = rows.map(row => String(row.id));
  const { data, error } = await supabase.from("logistics_stock_movements").select("id").in("id", ids);
  if (error) throw error;
  const existing = new Set((data || []).map(row => String(row.id)));
  const missing = rows.filter(row => !existing.has(String(row.id)));
  if (missing.length) {
    const { error: insertError } = await supabase.from("logistics_stock_movements").insert(missing);
    if (insertError) throw insertError;
  }
}

function shipmentForRequirement(state: LogisticsState, req: MaterialRequirement) {
  const shipmentId = req.shipment_id || (req.request_id ? state.requests.find(request => request.id === req.request_id)?.shipment_id : null);
  return shipmentId ? state.shipments.find(shipment => shipment.id === shipmentId) : null;
}

function requestForRequirement(state: LogisticsState, req: MaterialRequirement) {
  return req.request_id ? state.requests.find(request => request.id === req.request_id) : null;
}

async function syncLogisticsBackToSources(state: LogisticsState) {
  if (!supabase) return;
  const now = new Date().toISOString();
  const serviceUpdates = new Map<string, Db>();
  const pointUpdates = new Map<string, Db>();
  const isdinUpdates = new Map<string, Db>();

  state.requirements.forEach(req => {
    const request = requestForRequirement(state, req);
    const shipment = shipmentForRequirement(state, req);
    const status = request?.status || req.status;
    const update: Db = {
      logistics_status: status,
      logistics_request_id: req.request_id || request?.id || null,
      logistics_last_sync_at: now,
      logistics_sync_event_id: req.sync_event_id || request?.sync_event_id || null
    };

    if (req.service_id) {
      serviceUpdates.set(req.service_id, {
        ...serviceUpdates.get(req.service_id),
        ...update,
        material_status: logisticsStatusLabel(req.status),
        tracking: shipment?.tracking || (serviceUpdates.get(req.service_id)?.tracking as string | undefined) || null
      });
    }

    if (req.service_point_id) {
      pointUpdates.set(req.service_point_id, {
        ...pointUpdates.get(req.service_point_id),
        logistics_status: req.status,
        logistics_request_id: req.request_id || null,
        logistics_incident_id: req.incident_id || null,
        has_logistics_impact: ["bloqueada", "con_incidencia", "pendiente_stock", "pendiente_produccion", "pendiente_recepcion"].includes(req.status),
        affected_material_id: req.material_id || null,
        affected_quantity: req.requested_quantity || null
      });
    }

    if (req.isdin_vinyl_id) {
      isdinUpdates.set(req.isdin_vinyl_id, {
        ...isdinUpdates.get(req.isdin_vinyl_id),
        logistics_status: req.status,
        logistics_request_id: req.request_id || null,
        logistics_material_requirement_id: req.id,
        logistics_picking_id: req.picking_id || null,
        logistics_shipment_id: req.shipment_id || request?.shipment_id || null,
        logistics_incident_id: req.incident_id || null,
        logistics_pending_arrival_id: req.pending_arrival_id || null,
        logistics_blocked: ["bloqueada", "con_incidencia", "pendiente_stock", "pendiente_produccion", "pendiente_recepcion"].includes(req.status),
        logistics_last_sync_at: now,
        logistics_sync_event_id: req.sync_event_id || null
      });
    }
  });

  await Promise.all([
    ...Array.from(serviceUpdates, ([id, patch]) => updateSourceMirror(state, "services", id, patch)),
    ...Array.from(pointUpdates, ([id, patch]) => updateSourceMirror(state, "points", id, patch)),
    ...Array.from(isdinUpdates, ([id, patch]) => updateSourceMirror(state, "isdin_vinyls", id, patch))
  ]);
}

async function updateSourceMirror(state: LogisticsState, table: string, id: string, patch: Db) {
  if (!supabase) return;
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (!error) return;
  addSyncLog(state, {
    evento: "logistica.reverse_sync",
    origen_modulo: "logistica",
    destino_modulo: table,
    entidad_id: id,
    payload: patch,
    resultado: "error",
    error_message: error.message
  });
}

export async function loadLogisticsState(): Promise<{ state: LogisticsState; remote: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { state: loadLogistics(), remote: false };

  const [
    materials,
    entries,
    entryLines,
    stock,
    movements,
    pickings,
    pickingLines,
    shipments,
    incidents,
    pendings,
    requirements,
    requests,
    requestLines,
    events,
    audit,
    notifications,
    vins,
    syncLogs
  ] = await Promise.all([
    supabase.from("logistics_materials").select("*").order("nombre"),
    supabase.from("logistics_entries").select("*").order("created_at", { ascending: false }),
    supabase.from("logistics_entry_lines").select("*"),
    supabase.from("logistics_stock").select("*"),
    supabase.from("logistics_stock_movements").select("*").order("created_at", { ascending: false }),
    supabase.from("logistics_pickings").select("*").order("created_at", { ascending: false }),
    supabase.from("logistics_picking_lines").select("*"),
    supabase.from("logistics_shipments").select("*"),
    supabase.from("logistics_incidents").select("*").order("fecha_deteccion", { ascending: false }),
    supabase.from("logistics_pending_arrivals").select("*"),
    supabase.from("logistics_material_requirements").select("*").order("updated_at", { ascending: false }),
    supabase.from("logistics_requests").select("*").order("updated_at", { ascending: false }),
    supabase.from("logistics_request_lines").select("*"),
    supabase.from("integration_events").select("*").order("created_at", { ascending: false }),
    supabase.from("logistics_audit_log").select("*").order("created_at", { ascending: false }),
    supabase.from("logistics_notifications").select("*").order("created_at", { ascending: false }),
    supabase.from("logistics_vins").select("*").order("updated_at", { ascending: false }),
    supabase.from("sync_logs").select("*").order("created_at", { ascending: false })
  ]);

  const failed = [materials, entries, entryLines, stock, movements, pickings, pickingLines, shipments, incidents, pendings, requirements, requests, requestLines, events, audit, notifications, vins, syncLogs].find(result => result.error);
  if (failed?.error) return { state: loadLogistics(), remote: false, error: failed.error.message };

  const seed = seedLogistics();
  const dbMaterials = (materials.data || []) as Material[];
  const mergedMaterials = dbMaterials.length ? dbMaterials : seed.materials;
  const dbStock = (stock.data || []) as Stock[];
  const mergedStock = dbStock.length ? dbStock : seed.stock;

  const entryRows = ((entries.data || []) as Entry[]).map(entry => ({
    ...entry,
    lineas: ((entryLines.data || []) as Entry["lineas"]).filter(line => line.entrada_id === entry.id)
  }));
  const pickingRows = ((pickings.data || []) as Picking[]).map(picking => ({
    ...picking,
    lineas: ((pickingLines.data || []) as PickingLine[]).filter(line => line.picking_id === picking.id)
  }));
  const requestRows = ((requests.data || []) as LogisticsRequest[]).map(request => ({
    ...request,
    lines: ((requestLines.data || []) as LogisticsRequestLine[]).filter(line => line.request_id === request.id)
  }));

  return {
    remote: true,
    state: normalizeLogisticsState({
      materials: mergedMaterials,
      entries: entryRows,
      stock: mergedStock,
      movements: (movements.data || []) as StockMovement[],
      pickings: pickingRows,
      shipments: (shipments.data || []) as Shipping[],
      incidents: (incidents.data || []) as LogisticsState["incidents"],
      pendings: (pendings.data || []) as PendingArrival[],
      requirements: (requirements.data || []) as MaterialRequirement[],
      requests: requestRows,
      events: (events.data || []) as IntegrationEvent[],
      audit: ((audit.data || []) as Db[]).map(row => ({
        id: String(row.id),
        actor: row.actor as string | null,
        module: String(row.module),
        entity_type: String(row.entity_type),
        entity_id: String(row.entity_id),
        action: String(row.action),
        previous_value: row.previous_value,
        new_value: row.new_value,
        reason: row.reason as string | null,
        sync_event_id: row.sync_event_id as string | null,
        created_at: String(row.created_at)
      })),
      notifications: (notifications.data || []) as LogisticsNotification[],
      vins: (vins.data || []) as LogisticsVin[],
      syncLogs: (syncLogs.data || []) as LogisticsState["syncLogs"]
    })
  };
}

export async function saveLogisticsState(state: LogisticsState, remote: boolean) {
  const normalized = normalizeLogisticsState(state);
  if (!remote || !isSupabaseConfigured || !supabase) {
    saveLogistics(normalized);
    return;
  }

  await upsertMany("logistics_materials", normalized.materials.map(materialForDb));
  await upsertMany("logistics_stock", normalized.stock.map(stockForDb));
  await insertNewMovements(normalized.movements.map(row => stripUndefined(row as unknown as Db)));
  await upsertMany("logistics_entries", normalized.entries.map(entryForDb));
  await replaceChildren("logistics_entry_lines", "entrada_id", normalized.entries.map(x => x.id), normalized.entries.flatMap(entry => entry.lineas.map(line => entryLineForDb(line, entry.id))));
  await upsertMany("logistics_pickings", normalized.pickings.map(pickingForDb));
  await replaceChildren("logistics_picking_lines", "picking_id", normalized.pickings.map(x => x.id), normalized.pickings.flatMap(picking => picking.lineas.map(line => pickingLineForDb(line, picking.id))));
  await upsertMany("logistics_shipments", normalized.shipments.map(row => stripUndefined(row as unknown as Db)));
  await upsertMany("logistics_incidents", normalized.incidents.map(row => stripUndefined(row as unknown as Db)));
  await upsertMany("logistics_pending_arrivals", normalized.pendings.map(row => stripUndefined(row as unknown as Db)));
  await upsertMany("logistics_material_requirements", normalized.requirements.map(row => stripUndefined(row as unknown as Db)));
  await upsertMany("logistics_requests", normalized.requests.map(requestForDb));
  await replaceChildren("logistics_request_lines", "request_id", normalized.requests.map(x => x.id), normalized.requests.flatMap(request => request.lines.map(line => requestLineForDb(line, request.id))));
  await upsertMany("integration_events", normalized.events.map(eventForDb));
  await upsertMany("logistics_audit_log", normalized.audit.map(auditForDb));
  await upsertMany("logistics_notifications", normalized.notifications.map(notificationForDb));
  await upsertMany("logistics_vins", normalized.vins.map(vinForDb));
  await syncLogisticsBackToSources(normalized);
  await upsertMany("sync_logs", normalized.syncLogs.map(row => stripUndefined(row as unknown as Db)));
}
