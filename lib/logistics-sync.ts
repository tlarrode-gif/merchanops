import {
  LogisticsAuditEntry,
  LogisticsNotification,
  LogisticsPriority,
  LogisticsRequest,
  LogisticsRequestLine,
  LogisticsState,
  MaterialRequirement,
  MaterialType,
  RequirementSourceType,
  RequirementStatus,
  available,
  createMovement,
  logisticsStatusLabel,
  materialName,
  today,
  uid
} from "@/lib/logistics";

type SourceBase = {
  id: string;
  client_id?: string | null;
  campaign_id?: string | null;
  client?: string | null;
  campaign?: string | null;
  service_id?: string | null;
  service_point_id?: string | null;
  pharmacy_name?: string | null;
  vinyl?: string | null;
  vin?: string | null;
  vinyl_record_type?: string | null;
  vinyl_campaign?: string | null;
  height?: number | null;
  width?: number | null;
  desired_installation_date?: string | null;
  desired_installation_week?: string | null;
  deadline?: string | null;
  province?: string | null;
  city?: string | null;
  street?: string | null;
  street_number?: string | null;
  address?: string | null;
  postal_code?: string | null;
  installer_id?: string | null;
  worker_id?: string | null;
  installer_name?: string | null;
  worker_name?: string | null;
  client_observations?: string | null;
  comments?: string | null;
  instructions?: string | null;
  priority?: string | null;
  material_name?: string | null;
  material_sku?: string | null;
  material_quantity?: number | null;
  material_type?: MaterialType | null;
  requires_material?: boolean | null;
};

export type SyncIssue = { id: string; severity: LogisticsPriority; text: string; sourceHref?: string; logisticsHref?: string; fix?: string };

export function sourceKey(sourceType: RequirementSourceType, sourceId: string, lineId?: string | null) {
  return `${sourceType}:${sourceId}:${lineId || "main"}`;
}

export function idempotencyKey(eventType: string, sourceType: string, sourceId: string, version = "1") {
  return `${eventType}:${sourceType}:${sourceId}:${version}`;
}

export function ensureIntegrationEvent(state: LogisticsState, eventType: string, sourceType: string, sourceId: string, payload: Record<string, unknown>, version = "1") {
  const key = idempotencyKey(eventType, sourceType, sourceId, version);
  const existing = state.events.find(x => x.idempotency_key === key);
  if (existing?.status === "completado") return existing;
  const event = existing || { id: uid("evt"), event_type: eventType, source_type: sourceType, source_id: sourceId, idempotency_key: key, payload, status: "pendiente" as const, attempts: 0, created_at: new Date().toISOString() };
  if (!existing) state.events.unshift(event);
  event.status = "procesando";
  event.attempts += 1;
  return event;
}

export function completeEvent(state: LogisticsState, eventId?: string | null) {
  const event = state.events.find(x => x.id === eventId);
  if (event) {
    event.status = "completado";
    event.processed_at = new Date().toISOString();
    event.last_error = null;
  }
}

export function failEvent(state: LogisticsState, eventId: string | undefined, error: unknown) {
  const event = state.events.find(x => x.id === eventId);
  if (event) {
    event.status = "error";
    event.last_error = error instanceof Error ? error.message : String(error);
  }
}

export function audit(state: LogisticsState, entry: Omit<LogisticsAuditEntry, "id" | "created_at">) {
  state.audit.unshift({ ...entry, id: uid("aud"), created_at: new Date().toISOString() });
}

export function notify(state: LogisticsState, note: Omit<LogisticsNotification, "id" | "created_at" | "read" | "resolved">) {
  state.notifications.unshift({ ...note, id: uid("not"), created_at: new Date().toISOString(), read: false, resolved: false });
}

export function calculatePriority(input: { required_date?: string | null; installation_date?: string | null; status?: string | null; hasIncident?: boolean }) {
  const date = input.installation_date || input.required_date;
  const days = date ? Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000) : 99;
  if (input.hasIncident || days <= 2) return "critica";
  if (days <= 5 || input.status === "pendiente_produccion" || input.status === "pendiente_recepcion") return "alta";
  if (days <= 15) return "media";
  return "baja";
}

export function matchMaterial(state: LogisticsState, source: SourceBase) {
  const sku = source.material_sku || "";
  if (sku) {
    const bySku = state.materials.find(x => x.sku.toLowerCase() === sku.toLowerCase());
    if (bySku) return bySku;
  }
  const isCustom = isCustomVinyl(source);
  if (isCustom) return null;
  const dimensions = [source.width, source.height].filter(Boolean).join("x");
  return state.materials.find(x => dimensions && x.medidas === dimensions) || state.materials.find(x => x.tipo === "vinilo_estandar") || null;
}

export function isCustomVinyl(source: SourceBase) {
  return String(source.vinyl_record_type || source.material_type || "").toLowerCase().includes("medida")
    || (!!source.width && !!source.height && ![120, 150].includes(Number(source.width)));
}

export function coverageStatus(state: LogisticsState, materialId: string | null | undefined, qty: number): RequirementStatus {
  if (!materialId) return "pendiente_produccion";
  const stock = state.stock.find(x => x.material_id === materialId);
  const free = available(stock);
  if (free >= qty) return "disponible";
  if (free > 0) return "parcialmente_disponible";
  return "pendiente_stock";
}

export function upsertMaterialRequirement(state: LogisticsState, input: {
  source_type: RequirementSourceType;
  source: SourceBase;
  source_line_id?: string | null;
  eventId?: string | null;
  requested_material_name?: string;
  quantity?: number;
  operations_notes?: string | null;
}) {
  const sourceId = input.source.id;
  const existing = state.requirements.find(x => x.source_type === input.source_type && x.source_id === sourceId && (x.source_line_id || null) === (input.source_line_id || null));
  const material = matchMaterial(state, input.source);
  const qty = Number(input.quantity || input.source.material_quantity || 1);
  const status = existing?.status && !["pendiente_revision", "pendiente_stock", "pendiente_produccion", "pendiente_recepcion", "disponible", "parcialmente_disponible"].includes(existing.status)
    ? existing.status
    : coverageStatus(state, material?.id, qty);
  const requiredDate = input.source.deadline || input.source.desired_installation_date || null;
  const requirement: MaterialRequirement = {
    ...(existing || {}),
    id: existing?.id || uid("req"),
    source_type: input.source_type,
    source_id: sourceId,
    source_line_id: input.source_line_id || null,
    client_id: input.source.client_id || null,
    campaign_id: input.source.campaign_id || input.source.vinyl_campaign || input.source.campaign || null,
    service_id: input.source.service_id || (input.source_type === "service" ? sourceId : null),
    service_point_id: input.source.service_point_id || (input.source_type === "service_point" ? sourceId : null),
    isdin_vinyl_id: input.source_type === "isdin_vinyl" ? sourceId : null,
    vin: input.source.vin || input.source.vinyl || null,
    pharmacy_name: input.source.pharmacy_name || null,
    material_id: material?.id || null,
    requested_material_name: input.requested_material_name || input.source.material_name || material?.nombre || (isCustomVinyl(input.source) ? "Vinilo a medida" : "Material pendiente de catalogar"),
    requested_sku: input.source.material_sku || material?.sku || null,
    material_type: input.source.material_type || (isCustomVinyl(input.source) ? "vinilo_medida" : material?.tipo || "consumible"),
    requested_quantity: qty,
    unit: material?.unidad_control || "uds",
    width: input.source.width || null,
    height: input.source.height || null,
    custom_specifications: input.source.client_observations || input.source.comments || input.source.instructions || null,
    required_date: requiredDate,
    installation_date: input.source.desired_installation_date || input.source.deadline || null,
    installation_week: input.source.desired_installation_week || null,
    province: input.source.province || null,
    city: input.source.city || null,
    delivery_address: input.source.address || [input.source.street, input.source.street_number, input.source.postal_code].filter(Boolean).join(" ") || null,
    installer_id: input.source.installer_id || input.source.worker_id || null,
    installer_name: input.source.installer_name || input.source.worker_name || null,
    priority: calculatePriority({ required_date: requiredDate, installation_date: input.source.desired_installation_date, status }),
    status,
    logistics_notes: existing?.logistics_notes || null,
    operations_notes: input.operations_notes || existing?.operations_notes || null,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: existing?.created_by || "sync",
    request_id: existing?.request_id || null,
    picking_id: existing?.picking_id || null,
    shipment_id: existing?.shipment_id || null,
    incident_id: existing?.incident_id || null,
    pending_arrival_id: existing?.pending_arrival_id || null,
    received_quantity: existing?.received_quantity || 0,
    reserved_quantity: existing?.reserved_quantity || 0,
    prepared_quantity: existing?.prepared_quantity || 0,
    delivered_quantity: existing?.delivered_quantity || 0,
    source_system: "merchanops",
    sync_event_id: input.eventId || existing?.sync_event_id || null
  };
  if (existing) {
    Object.assign(existing, requirement);
  } else {
    state.requirements.unshift(requirement);
  }
  audit(state, { module: "logistics-sync", entity_type: "requirement", entity_id: requirement.id, action: existing ? "requirement.updated" : "requirement.created", new_value: { source: sourceKey(input.source_type, sourceId, input.source_line_id), status: requirement.status }, sync_event_id: input.eventId || null });
  return requirement;
}

export function createOrUpdateRequestForRequirement(state: LogisticsState, requirement: MaterialRequirement, source: SourceBase, eventId?: string | null) {
  let request = requirement.request_id ? state.requests.find(x => x.id === requirement.request_id) : state.requests.find(x => x.source_type === requirement.source_type && x.source_id === requirement.source_id);
  const now = new Date().toISOString();
  if (!request) {
    request = {
      id: uid("logreq"),
      code: `LOG-${new Date().getFullYear()}-${String(state.requests.length + 1).padStart(4, "0")}`,
      source_type: requirement.source_type,
      source_id: requirement.source_id,
      client_id: requirement.client_id || null,
      campaign_id: requirement.campaign_id || null,
      service_id: requirement.service_id || null,
      requested_by: "Operaciones",
      requested_at: now,
      required_date: requirement.required_date,
      installation_date: requirement.installation_date,
      priority: requirement.priority,
      destination_type: requirement.installer_id || requirement.installer_name ? "instalador" : "farmacia",
      installer_id: requirement.installer_id || null,
      installer_name: requirement.installer_name || null,
      delivery_address: requirement.delivery_address || null,
      province: requirement.province || null,
      city: requirement.city || null,
      status: "pendiente_revision",
      created_at: now,
      updated_at: now,
      lines: [],
      source_system: "merchanops",
      sync_event_id: eventId || null
    };
    state.requests.unshift(request);
  }
  requirement.request_id = request.id;
  request.updated_at = now;
  request.installer_id = requirement.installer_id || request.installer_id || null;
  request.installer_name = requirement.installer_name || request.installer_name || null;
  request.delivery_address = requirement.delivery_address || request.delivery_address || null;
  request.required_date = requirement.required_date;
  request.installation_date = requirement.installation_date;
  request.priority = requirement.priority;
  const line = request.lines.find(x => x.material_requirement_id === requirement.id);
  const nextLine: LogisticsRequestLine = {
    ...(line || {}),
    id: line?.id || uid("logline"),
    request_id: request.id,
    material_requirement_id: requirement.id,
    material_id: requirement.material_id || null,
    requested_quantity: requirement.requested_quantity,
    accepted_quantity: line?.accepted_quantity || 0,
    prepared_quantity: requirement.prepared_quantity || line?.prepared_quantity || 0,
    delivered_quantity: requirement.delivered_quantity || line?.delivered_quantity || 0,
    missing_quantity: Math.max(0, requirement.requested_quantity - (requirement.delivered_quantity || line?.delivered_quantity || 0)),
    substitution_material_id: line?.substitution_material_id || null,
    substitution_status: line?.substitution_status || null,
    line_status: requirement.status,
    comment: line?.comment || source.client_observations || source.instructions || null
  };
  if (line) Object.assign(line, nextLine);
  else request.lines.push(nextLine);
  audit(state, { module: "logistics-sync", entity_type: "request", entity_id: request.id, action: "request.upserted", new_value: { code: request.code, source: sourceKey(requirement.source_type, requirement.source_id) }, sync_event_id: eventId || null });
  return request;
}

export function syncIsdinVinylToLogistics(state: LogisticsState, vinyl: SourceBase, version = "1") {
  const event = ensureIntegrationEvent(state, "isdin_vinyl.updated", "isdin_vinyl", vinyl.id, vinyl as Record<string, unknown>, version);
  try {
    const requirement = upsertMaterialRequirement(state, { source_type: "isdin_vinyl", source: vinyl, eventId: event.id });
    const request = createOrUpdateRequestForRequirement(state, requirement, vinyl, event.id);
    completeEvent(state, event.id);
    return { requirement, request };
  } catch (err) {
    failEvent(state, event.id, err);
    throw err;
  }
}

export function createServiceLogisticsRequest(state: LogisticsState, service: SourceBase, lines: SourceBase[] = [], version = "1") {
  const event = ensureIntegrationEvent(state, "service.material_requested", "service", service.id, service as Record<string, unknown>, version);
  try {
    const sources = lines.length ? lines : [service];
    const requirements = sources.map((line, index) => upsertMaterialRequirement(state, { source_type: line.service_point_id || line.id !== service.id ? "service_point" : "service", source: { ...service, ...line, service_id: service.id }, source_line_id: line.service_point_id || line.id || String(index), eventId: event.id }));
    const request = createOrUpdateRequestForRequirement(state, requirements[0], service, event.id);
    requirements.slice(1).forEach(req => {
      req.request_id = request.id;
      createOrUpdateRequestForRequirement(state, req, service, event.id);
    });
    completeEvent(state, event.id);
    notify(state, { type: "logistics_request_created", priority: request.priority, entity_type: "request", entity_id: request.id, href: `/logistica/solicitudes?id=${request.id}`, message: `Nueva solicitud logística ${request.code}` });
    return request;
  } catch (err) {
    failEvent(state, event.id, err);
    throw err;
  }
}

export function acceptRequestAndReserve(state: LogisticsState, requestId: string, actor = "Logística") {
  const request = state.requests.find(x => x.id === requestId);
  if (!request) return;
  request.lines.forEach(line => {
    const req = state.requirements.find(x => x.id === line.material_requirement_id);
    if (!req?.material_id) return;
    const alreadyReserved = Math.max(Number(req.reserved_quantity || 0), Number(line.accepted_quantity || 0));
    const pendingQuantity = Math.max(0, Number(req.requested_quantity || 0) - alreadyReserved);
    if (pendingQuantity <= 0) {
      req.status = alreadyReserved >= req.requested_quantity ? "reservada" : req.status;
      line.accepted_quantity = alreadyReserved;
      line.missing_quantity = Math.max(0, req.requested_quantity - alreadyReserved);
      line.line_status = req.status;
      return;
    }
    const qty = Math.min(pendingQuantity, available(state.stock.find(x => x.material_id === req.material_id)));
    if (qty <= 0) {
      req.status = "pendiente_stock";
      line.line_status = "pendiente_stock";
      return;
    }
    createMovement(state, { material_id: req.material_id, tipo: "reserva", cantidad: qty, campana_id: req.campaign_id, vin_id: req.vin, motivo: `Reserva solicitud ${request.code}` });
    req.reserved_quantity = alreadyReserved + qty;
    req.status = req.reserved_quantity >= req.requested_quantity ? "reservada" : "parcialmente_disponible";
    line.accepted_quantity = req.reserved_quantity;
    line.missing_quantity = Math.max(0, req.requested_quantity - req.reserved_quantity);
    line.line_status = req.status;
  });
  request.status = request.lines.every(x => x.line_status === "reservada") ? "aceptada" : "parcialmente_aceptada";
  request.accepted_by = actor;
  request.accepted_at = new Date().toISOString();
  request.updated_at = new Date().toISOString();
  audit(state, { actor, module: "logistics", entity_type: "request", entity_id: request.id, action: "request.accepted", new_value: request.status, reason: "Reserva desde solicitud logística" });
}

export function syncInstallerChange(state: LogisticsState, sourceType: RequirementSourceType, sourceId: string, next: { installer_id?: string | null; installer_name?: string | null; delivery_address?: string | null }, actor = "Operaciones") {
  const affected = state.requirements.filter(x => x.source_type === sourceType && x.source_id === sourceId);
  affected.forEach(req => {
    const previous = { installer_id: req.installer_id, installer_name: req.installer_name, delivery_address: req.delivery_address };
    req.installer_id = next.installer_id || null;
    req.installer_name = next.installer_name || null;
    req.delivery_address = next.delivery_address || req.delivery_address || null;
    req.updated_at = new Date().toISOString();
    const request = req.request_id ? state.requests.find(x => x.id === req.request_id) : null;
    const picking = req.picking_id ? state.pickings.find(x => x.id === req.picking_id) : request?.picking_id ? state.pickings.find(x => x.id === request.picking_id) : null;
    const shipment = req.shipment_id ? state.shipments.find(x => x.id === req.shipment_id) : request?.shipment_id ? state.shipments.find(x => x.id === request.shipment_id) : null;
    if (request) {
      request.installer_id = req.installer_id;
      request.installer_name = req.installer_name;
      request.delivery_address = req.delivery_address;
      request.updated_at = req.updated_at;
    }
    if (picking && ["pendiente", "en_preparacion"].includes(picking.estado)) {
      picking.instalador_id = req.installer_id;
      notify(state, { type: "installer_changed_pending_picking", priority: "alta", entity_type: "picking", entity_id: picking.id, href: `/logistica/picking?id=${picking.id}`, message: `Instalador actualizado en ${picking.codigo}` });
    } else if (picking && picking.estado === "preparado") {
      if (request) request.requires_review = true;
      notify(state, { type: "installer_changed_prepared_picking", priority: "critica", entity_type: "picking", entity_id: picking.id, href: `/logistica/picking?id=${picking.id}`, message: `Cambio de instalador con picking preparado: ${picking.codigo}` });
    }
    if (shipment && ["recogido", "en_transito"].includes(shipment.estado)) {
      notify(state, { type: "installer_changed_shipment_in_transit", priority: "critica", entity_type: "shipment", entity_id: shipment.id, href: `/logistica/envios?id=${shipment.id}`, message: "Cambio de destinatario con envío en tránsito. Requiere intervención manual." });
    }
    audit(state, { actor, module: "logistics-sync", entity_type: "requirement", entity_id: req.id, action: "installer_or_address.changed", previous_value: previous, new_value: next, reason: "Cambio procedente del módulo origen" });
  });
}

export function cancelSourceLogistics(state: LogisticsState, sourceType: RequirementSourceType, sourceId: string, reason: string, actor = "Operaciones") {
  state.requirements.filter(x => x.source_type === sourceType && x.source_id === sourceId && x.status !== "cancelada").forEach(req => {
    if (req.material_id && (req.reserved_quantity || 0) > 0) createMovement(state, { material_id: req.material_id, tipo: "liberacion", cantidad: req.reserved_quantity || 0, campana_id: req.campaign_id, vin_id: req.vin, motivo: `Cancelación origen: ${reason}` });
    req.status = "cancelada";
    req.updated_at = new Date().toISOString();
    const request = req.request_id ? state.requests.find(x => x.id === req.request_id) : null;
    if (request && request.lines.every(line => line.material_requirement_id === req.id || state.requirements.find(r => r.id === line.material_requirement_id)?.status === "cancelada")) request.status = "cancelada";
    audit(state, { actor, module: "logistics-sync", entity_type: "requirement", entity_id: req.id, action: "requirement.cancelled", reason });
  });
}

export function logisticsSummaryForSource(state: LogisticsState, sourceType: RequirementSourceType, sourceId: string) {
  const requirements = state.requirements.filter(x => x.source_type === sourceType && x.source_id === sourceId);
  const request = requirements.map(x => x.request_id).filter(Boolean).map(id => state.requests.find(r => r.id === id)).find(Boolean);
  const picking = requirements.map(x => x.picking_id).filter(Boolean).map(id => state.pickings.find(p => p.id === id)).find(Boolean) || (request?.picking_id ? state.pickings.find(p => p.id === request.picking_id) : null);
  const shipment = requirements.map(x => x.shipment_id).filter(Boolean).map(id => state.shipments.find(s => s.id === id)).find(Boolean) || (request?.shipment_id ? state.shipments.find(s => s.id === request.shipment_id) : null);
  const incident = requirements.map(x => x.incident_id).filter(Boolean).map(id => state.incidents.find(i => i.id === id)).find(Boolean);
  const pending = requirements.map(x => x.pending_arrival_id).filter(Boolean).map(id => state.pendings.find(p => p.id === id)).find(Boolean);
  const status = requirements.some(x => ["bloqueada", "con_incidencia"].includes(x.status)) ? "bloqueada" : requirements[0]?.status || null;
  return { requirements, request, picking, shipment, incident, pending, status, label: logisticsStatusLabel(status) };
}

export function detectLogisticsSyncIssues(state: LogisticsState): SyncIssue[] {
  const issues: SyncIssue[] = [];
  const seen = new Map<string, MaterialRequirement[]>();
  state.requirements.forEach(req => {
    const key = sourceKey(req.source_type, req.source_id, req.source_line_id);
    seen.set(key, [...(seen.get(key) || []), req]);
    if (!req.material_id && req.status !== "pendiente_produccion") issues.push({ id: `no-material-${req.id}`, severity: "alta", text: `Necesidad sin material enlazado: ${req.requested_material_name}`, logisticsHref: `/logistica/solicitudes?id=${req.request_id || req.id}`, fix: "Catalogar material o confirmar producción a medida." });
    if (req.request_id && !state.requests.some(x => x.id === req.request_id)) issues.push({ id: `orphan-req-${req.id}`, severity: "critica", text: `Necesidad huérfana sin solicitud válida`, logisticsHref: `/logistica/solicitudes?id=${req.id}` });
  });
  seen.forEach((rows, key) => {
    if (rows.length > 1) issues.push({ id: `dup-${key}`, severity: "critica", text: `Necesidades duplicadas para ${key}`, logisticsHref: `/logistica/sincronizacion`, fix: "Fusionar manualmente y conservar historial." });
  });
  state.requests.filter(x => !x.lines.length).forEach(req => issues.push({ id: `empty-request-${req.id}`, severity: "alta", text: `Solicitud ${req.code} sin líneas`, logisticsHref: `/logistica/solicitudes?id=${req.id}` }));
  state.pendings.filter(x => !state.incidents.some(i => i.id === x.incidencia_id)).forEach(p => issues.push({ id: `pending-no-inc-${p.id}`, severity: "alta", text: "Pendiente de llegada sin incidencia enlazada", logisticsHref: `/logistica/pendientes?id=${p.id}` }));
  state.events.filter(x => x.status === "error").forEach(e => issues.push({ id: `event-${e.id}`, severity: "alta", text: `Evento con error: ${e.event_type}`, logisticsHref: "/logistica/sincronizacion", fix: e.last_error || "Reintentar sincronización." }));
  return issues;
}

export function sourceHref(req: MaterialRequirement) {
  if (req.source_type === "isdin_vinyl") return `/grandes-campanas/isdin?vin=${encodeURIComponent(req.vin || req.source_id)}`;
  if (req.source_type === "service" || req.source_type === "service_point") return `/?tab=servicios&service=${encodeURIComponent(req.service_id || req.source_id)}`;
  return "/logistica";
}

export function materialDisplay(req: MaterialRequirement, state: LogisticsState) {
  return req.material_id ? materialName(state, req.material_id) : req.requested_material_name;
}
