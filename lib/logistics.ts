export const logisticsLocalKey = "merchanops_logistics_v1";

export type MaterialType = "vinilo_estandar" | "vinilo_medida" | "herramienta" | "consumible";
export type StockMoveType = "entrada" | "salida" | "reserva" | "liberacion" | "picking" | "entrega" | "consumo" | "devolucion" | "danio" | "perdida" | "ajuste" | "transferencia";
export type EntryStatus = "pendiente" | "recibido_parcial" | "recibido_completo" | "con_incidencia" | "rechazado" | "cerrado";
export type PickingStatus = "pendiente" | "en_preparacion" | "preparado" | "revisado" | "enviado" | "recibido" | "cerrado";
export type ShippingStatus = "pendiente" | "preparado" | "recogido" | "en_transito" | "entregado" | "fallido" | "extraviado" | "devuelto";
export type IncidentType = "sin_picking" | "medidas" | "danado" | "incorrecto" | "falta" | "exceso" | "perdida" | "entrega_fallida" | "defecto_produccion";
export type IncidentStatus = "nueva" | "en_revision" | "pend_proveedor" | "pend_produccion" | "pend_transporte" | "mat_enviado" | "resuelta" | "cancelada";
export type PendingStatus = "pend_proveedor" | "en_produccion" | "en_transito" | "recibido" | "asignado_picking" | "cerrado";
export type RequirementSourceType = "service" | "service_point" | "isdin_vinyl" | "campaign" | "incident" | "replacement" | "manual_request";
export type RequirementStatus = "pendiente_revision" | "aceptada" | "pendiente_stock" | "pendiente_produccion" | "pendiente_recepcion" | "parcialmente_disponible" | "disponible" | "reservada" | "en_picking" | "preparada" | "enviada" | "entregada" | "consumida" | "cancelada" | "bloqueada" | "con_incidencia";
export type RequestStatus = "borrador" | "enviada" | "pendiente_revision" | "aceptada" | "parcialmente_aceptada" | "rechazada" | "pendiente_material" | "en_preparacion" | "preparada" | "enviada_transporte" | "entregada" | "cerrada" | "cancelada" | "bloqueada";
export type LogisticsPriority = "critica" | "alta" | "media" | "baja";
export type IntegrationEventStatus = "pendiente" | "procesando" | "completado" | "error";

export type Material = { id: string; sku: string; nombre: string; cliente_id?: string | null; tipo: MaterialType; medidas?: string | null; unidad_control: "uds" | "rollos" | "m2" | "cajas"; stock_minimo: number; stock_objetivo: number; proveedor_id?: string | null; coste?: number | null; activo: boolean };
export type EntryLine = { id: string; entrada_id: string; material_id: string; cantidad_esperada: number; cantidad_recibida: number; cantidad_correcta: number; cantidad_danada: number; diferencia: number; incidencia_id?: string | null };
export type Entry = { id: string; albaran: string; fecha_prevista: string; fecha_recepcion?: string | null; proveedor_id?: string | null; transportista?: string | null; num_bultos_esperado: number; num_bultos_recibido: number; estado: EntryStatus; observaciones?: string | null; creado_por?: string | null; lineas: EntryLine[] };
export type Stock = { id: string; material_id: string; cantidad_fisica: number; cantidad_reservada: number; cantidad_picking: number; cantidad_bloqueada: number };
export type StockMovement = { id: string; material_id: string; tipo: StockMoveType; cantidad: number; origen?: string | null; destino?: string | null; usuario_id?: string | null; campana_id?: string | null; vin_id?: string | null; motivo: string; created_at: string };
export type PickingLine = { id: string; picking_id: string; material_id: string; vin_id?: string | null; cantidad_esperada: number; cantidad_preparada: number; estado: "pendiente" | "listo" | "faltante"; justificacion_faltante?: string | null };
export type Picking = { id: string; codigo: string; instalador_id?: string | null; campana_id?: string | null; zona?: string | null; fecha_salida_prevista?: string | null; estado: PickingStatus; num_puntos: number; lineas: PickingLine[]; envio_id?: string | null };
export type Shipping = { id: string; picking_id: string; fecha_salida?: string | null; transportista?: string | null; tracking?: string | null; destinatario_id?: string | null; instalador_id?: string | null; num_bultos: number; fecha_estimada_entrega?: string | null; fecha_real_entrega?: string | null; confirmado_por_instalador: boolean; estado: ShippingStatus };
export type Incident = { id: string; codigo: string; tipo: IncidentType; material_id?: string | null; vin_id?: string | null; campana_id?: string | null; farmacia_id?: string | null; picking_id?: string | null; envio_id?: string | null; entrada_id?: string | null; responsable_id?: string | null; fecha_deteccion: string; descripcion: string; impacto?: string | null; fecha_limite?: string | null; estado: IncidentStatus; pendiente_llegada_id?: string | null };
export type PendingArrival = { id: string; incidencia_id: string; vin_id?: string | null; material_id?: string | null; motivo: string; fecha_solicitud: string; fecha_prevista?: string | null; fecha_instalacion?: string | null; proveedor_id?: string | null; estado: PendingStatus; en_riesgo?: boolean };
export type MaterialRequirement = { id: string; source_type: RequirementSourceType; source_id: string; source_line_id?: string | null; client_id?: string | null; campaign_id?: string | null; service_id?: string | null; service_point_id?: string | null; isdin_vinyl_id?: string | null; vin?: string | null; pharmacy_id?: string | null; pharmacy_name?: string | null; material_id?: string | null; requested_material_name: string; requested_sku?: string | null; material_type: MaterialType; requested_quantity: number; unit: "uds" | "rollos" | "m2" | "cajas"; width?: number | null; height?: number | null; custom_specifications?: string | null; required_date?: string | null; installation_date?: string | null; installation_week?: string | null; province?: string | null; city?: string | null; delivery_address?: string | null; installer_id?: string | null; installer_name?: string | null; priority: LogisticsPriority; status: RequirementStatus; logistics_notes?: string | null; operations_notes?: string | null; created_at: string; updated_at: string; created_by?: string | null; request_id?: string | null; picking_id?: string | null; shipment_id?: string | null; incident_id?: string | null; pending_arrival_id?: string | null; received_quantity?: number; reserved_quantity?: number; prepared_quantity?: number; delivered_quantity?: number; source_system?: string | null; sync_event_id?: string | null };
export type LogisticsRequestLine = { id: string; request_id: string; material_requirement_id: string; material_id?: string | null; requested_quantity: number; accepted_quantity: number; prepared_quantity: number; delivered_quantity: number; missing_quantity: number; substitution_material_id?: string | null; substitution_status?: "propuesta" | "aceptada" | "rechazada" | null; line_status: RequirementStatus; comment?: string | null };
export type LogisticsRequest = { id: string; code: string; source_type: RequirementSourceType; source_id: string; client_id?: string | null; campaign_id?: string | null; service_id?: string | null; requested_by?: string | null; requested_at: string; required_date?: string | null; installation_date?: string | null; priority: LogisticsPriority; destination_type: "instalador" | "farmacia" | "almacen" | "otro"; installer_id?: string | null; installer_name?: string | null; delivery_address?: string | null; province?: string | null; city?: string | null; status: RequestStatus; accepted_by?: string | null; accepted_at?: string | null; rejection_reason?: string | null; logistics_comment?: string | null; operations_comment?: string | null; picking_id?: string | null; shipment_id?: string | null; created_at: string; updated_at: string; lines: LogisticsRequestLine[]; source_system?: string | null; sync_event_id?: string | null; requires_review?: boolean };
export type IntegrationEvent = { id: string; event_type: string; source_type: string; source_id: string; idempotency_key: string; payload: Record<string, unknown>; status: IntegrationEventStatus; attempts: number; last_error?: string | null; created_at: string; processed_at?: string | null };
export type LogisticsAuditEntry = { id: string; actor?: string | null; module: string; entity_type: string; entity_id: string; action: string; previous_value?: unknown; new_value?: unknown; reason?: string | null; sync_event_id?: string | null; created_at: string };
export type LogisticsNotification = { id: string; type: string; priority: LogisticsPriority; responsible?: string | null; entity_type: string; entity_id: string; href: string; message: string; read: boolean; resolved: boolean; created_at: string };
export type LogisticsState = { materials: Material[]; entries: Entry[]; stock: Stock[]; movements: StockMovement[]; pickings: Picking[]; shipments: Shipping[]; incidents: Incident[]; pendings: PendingArrival[]; requirements: MaterialRequirement[]; requests: LogisticsRequest[]; events: IntegrationEvent[]; audit: LogisticsAuditEntry[]; notifications: LogisticsNotification[] };

export function uid(prefix = "id") {
  return `${prefix}_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function available(stock?: Stock | null) {
  return stock ? stock.cantidad_fisica - stock.cantidad_reservada - stock.cantidad_picking - stock.cantidad_bloqueada : 0;
}

export function seedLogistics(): LogisticsState {
  const m1: Material = { id: "mat_vin_120", sku: "VIN-STD-120", nombre: "Vinilo estándar 120x150", tipo: "vinilo_estandar", medidas: "120x150", unidad_control: "uds", stock_minimo: 8, stock_objetivo: 25, proveedor_id: "prov_isdin", coste: 15, activo: true };
  const m2: Material = { id: "mat_kit", sku: "KIT-INST", nombre: "Kit instalación vinilo", tipo: "herramienta", unidad_control: "cajas", stock_minimo: 3, stock_objetivo: 10, proveedor_id: "prov_tools", coste: 22, activo: true };
  return { materials: [m1, m2], entries: [], stock: [{ id: "stock_1", material_id: m1.id, cantidad_fisica: 14, cantidad_reservada: 2, cantidad_picking: 0, cantidad_bloqueada: 0 }, { id: "stock_2", material_id: m2.id, cantidad_fisica: 2, cantidad_reservada: 0, cantidad_picking: 0, cantidad_bloqueada: 0 }], movements: [], pickings: [], shipments: [], incidents: [], pendings: [], requirements: [], requests: [], events: [], audit: [], notifications: [] };
}

export function loadLogistics(): LogisticsState {
  try {
    return normalizeLogisticsState(JSON.parse(localStorage.getItem(logisticsLocalKey) || "null") || seedLogistics());
  } catch {
    return seedLogistics();
  }
}

export function normalizeLogisticsState(raw: Partial<LogisticsState> | null | undefined): LogisticsState {
  const seed = seedLogistics();
  return {
    materials: raw?.materials || seed.materials,
    entries: raw?.entries || [],
    stock: raw?.stock || seed.stock,
    movements: raw?.movements || [],
    pickings: raw?.pickings || [],
    shipments: raw?.shipments || [],
    incidents: raw?.incidents || [],
    pendings: raw?.pendings || [],
    requirements: raw?.requirements || [],
    requests: raw?.requests || [],
    events: raw?.events || [],
    audit: raw?.audit || [],
    notifications: raw?.notifications || []
  };
}

export function saveLogistics(state: LogisticsState) {
  localStorage.setItem(logisticsLocalKey, JSON.stringify(normalizeLogisticsState(state)));
}

export function materialName(state: LogisticsState, id?: string | null) {
  return state.materials.find(x => x.id === id)?.nombre || "Sin material";
}

function ensureStock(state: LogisticsState, materialId: string) {
  let row = state.stock.find(x => x.material_id === materialId);
  if (!row) {
    row = { id: uid("stock"), material_id: materialId, cantidad_fisica: 0, cantidad_reservada: 0, cantidad_picking: 0, cantidad_bloqueada: 0 };
    state.stock.push(row);
  }
  return row;
}

export function createMovement(state: LogisticsState, movement: Omit<StockMovement, "id" | "created_at">) {
  const row = ensureStock(state, movement.material_id);
  if (movement.tipo === "entrada" || movement.tipo === "devolucion") row.cantidad_fisica += movement.cantidad;
  if (movement.tipo === "danio" || movement.tipo === "perdida" || movement.tipo === "salida") row.cantidad_fisica -= movement.cantidad;
  if (movement.tipo === "reserva") row.cantidad_reservada += movement.cantidad;
  if (movement.tipo === "liberacion") row.cantidad_reservada -= movement.cantidad;
  if (movement.tipo === "picking") { row.cantidad_reservada -= movement.cantidad; row.cantidad_picking += movement.cantidad; }
  if (movement.tipo === "entrega" || movement.tipo === "consumo") { row.cantidad_picking -= movement.cantidad; row.cantidad_fisica -= movement.cantidad; }
  if (movement.tipo === "ajuste") row.cantidad_fisica += movement.cantidad;
  if (available(row) < 0 || row.cantidad_fisica < 0 || row.cantidad_reservada < 0 || row.cantidad_picking < 0 || row.cantidad_bloqueada < 0) throw new Error(`Stock insuficiente para ${materialName(state, movement.material_id)}. Déficit: ${Math.abs(Math.min(available(row), row.cantidad_fisica, row.cantidad_reservada, row.cantidad_picking, row.cantidad_bloqueada))}`);
  state.movements.unshift({ ...movement, id: uid("mov"), created_at: new Date().toISOString() });
}

export function createIncident(state: LogisticsState, data: Omit<Incident, "id" | "codigo" | "fecha_deteccion" | "estado"> & { estado?: IncidentStatus }) {
  const inc: Incident = { ...data, id: uid("inc"), codigo: `INC-${new Date().getFullYear()}-${String(state.incidents.length + 1).padStart(4, "0")}`, fecha_deteccion: today(), estado: data.estado || "nueva" };
  state.incidents.unshift(inc);
  if (["medidas", "danado", "incorrecto", "falta", "perdida", "defecto_produccion"].includes(inc.tipo)) {
    const pending: PendingArrival = { id: uid("pend"), incidencia_id: inc.id, vin_id: inc.vin_id, material_id: inc.material_id, motivo: inc.descripcion, fecha_solicitud: today(), fecha_prevista: inc.fecha_limite || "", fecha_instalacion: inc.fecha_limite || "", proveedor_id: null, estado: "pend_proveedor" };
    pending.en_riesgo = !!pending.fecha_prevista && !!pending.fecha_instalacion && pending.fecha_prevista > addDays(pending.fecha_instalacion, -2);
    state.pendings.unshift(pending);
    inc.pendiente_llegada_id = pending.id;
  }
  return inc;
}

export function receiveEntry(state: LogisticsState, entryId: string, status: EntryStatus) {
  const entry = state.entries.find(x => x.id === entryId);
  if (!entry) return;
  entry.estado = status;
  entry.fecha_recepcion = today();
  if (!["recibido_completo", "recibido_parcial"].includes(status)) return;
  entry.lineas.forEach(line => {
    line.diferencia = line.cantidad_recibida - line.cantidad_esperada;
    if (line.cantidad_correcta > 0) createMovement(state, { material_id: line.material_id, tipo: "entrada", cantidad: line.cantidad_correcta, origen: entry.albaran, destino: "almacen", motivo: `Recepción ${entry.albaran}` });
    if (line.diferencia < 0 || line.cantidad_danada > 0) {
      const inc = createIncident(state, { tipo: line.cantidad_danada > 0 ? "danado" : "falta", material_id: line.material_id, entrada_id: entry.id, descripcion: `Diferencia en entrada ${entry.albaran}. Esperado ${line.cantidad_esperada}, recibido ${line.cantidad_recibida}, dañado ${line.cantidad_danada}.`, impacto: "Stock no disponible hasta resolución." });
      line.incidencia_id = inc.id;
      entry.estado = "con_incidencia";
    }
  });
}

export function createPicking(state: LogisticsState, data: Pick<Picking, "instalador_id" | "campana_id" | "zona" | "fecha_salida_prevista" | "num_puntos"> & { lineas: Omit<PickingLine, "id" | "picking_id" | "estado" | "cantidad_preparada">[] }) {
  data.lineas.forEach(line => {
    const deficit = line.cantidad_esperada - available(ensureStock(state, line.material_id));
    if (deficit > 0) throw new Error(`No hay stock suficiente para ${materialName(state, line.material_id)}. Déficit: ${deficit}`);
  });
  const picking: Picking = { id: uid("pick"), codigo: `PK-${new Date().getFullYear()}-${String(state.pickings.length + 1).padStart(4, "0")}`, estado: "pendiente", instalador_id: data.instalador_id, campana_id: data.campana_id, zona: data.zona, fecha_salida_prevista: data.fecha_salida_prevista, num_puntos: data.num_puntos, lineas: [] };
  picking.lineas = data.lineas.map(line => ({ ...line, id: uid("pline"), picking_id: picking.id, cantidad_preparada: 0, estado: "pendiente" }));
  picking.lineas.forEach(line => createMovement(state, { material_id: line.material_id, tipo: "reserva", cantidad: line.cantidad_esperada, campana_id: picking.campana_id, vin_id: line.vin_id, motivo: `Reserva ${picking.codigo}` }));
  state.pickings.unshift(picking);
  return picking;
}

export function preparePickingLine(state: LogisticsState, pickingId: string, lineId: string, qty: number, missingReason = "") {
  const picking = state.pickings.find(x => x.id === pickingId);
  const line = picking?.lineas.find(x => x.id === lineId);
  if (!picking || !line) return;
  line.cantidad_preparada = qty;
  line.estado = qty >= line.cantidad_esperada ? "listo" : "faltante";
  line.justificacion_faltante = line.estado === "faltante" ? missingReason : "";
  if (qty > 0) createMovement(state, { material_id: line.material_id, tipo: "picking", cantidad: qty, campana_id: picking.campana_id, vin_id: line.vin_id, motivo: `Preparación ${picking.codigo}` });
  picking.estado = picking.lineas.every(x => x.estado === "listo") ? "preparado" : "en_preparacion";
}

export function closePicking(state: LogisticsState, pickingId: string) {
  const picking = state.pickings.find(x => x.id === pickingId);
  if (!picking) return;
  const blocked = picking.lineas.find(x => x.estado === "faltante" && !x.justificacion_faltante?.trim());
  if (blocked) throw new Error("No se puede cerrar el picking con líneas faltantes sin justificación escrita.");
  picking.estado = "cerrado";
}

export function generateShipping(state: LogisticsState, pickingId: string) {
  const picking = state.pickings.find(x => x.id === pickingId);
  if (!picking || !["preparado", "revisado"].includes(picking.estado)) throw new Error("El picking debe estar preparado para generar envío.");
  const envio: Shipping = { id: uid("env"), picking_id: picking.id, transportista: "Pendiente", tracking: "", instalador_id: picking.instalador_id, num_bultos: 1, confirmado_por_instalador: false, estado: "pendiente" };
  state.shipments.unshift(envio);
  picking.envio_id = envio.id;
  picking.estado = "enviado";
  return envio;
}

export function confirmInstallerDelivery(state: LogisticsState, shippingId: string) {
  const envio = state.shipments.find(x => x.id === shippingId);
  const picking = envio ? state.pickings.find(x => x.id === envio.picking_id) : null;
  if (!envio || !picking) return;
  envio.confirmado_por_instalador = true;
  envio.estado = "entregado";
  envio.fecha_real_entrega = today();
  picking.estado = "recibido";
  picking.lineas.forEach(line => line.cantidad_preparada > 0 && createMovement(state, { material_id: line.material_id, tipo: "entrega", cantidad: line.cantidad_preparada, campana_id: picking.campana_id, vin_id: line.vin_id, motivo: `Entrega ${picking.codigo}` }));
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(date?: string | null) {
  if (!date) return 9999;
  return Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
}

export function logisticsKpis(state: LogisticsState) {
  const openIncidents = state.incidents.filter(x => !["resuelta", "cancelada"].includes(x.estado));
  const openRequests = state.requests.filter(x => !["cerrada", "cancelada", "rechazada"].includes(x.status));
  return {
    pendingEntries: state.entries.filter(x => x.estado === "pendiente").length,
    entriesToday: state.entries.filter(x => x.fecha_recepcion === today()).length,
    pendingPickings: state.pickings.filter(x => ["pendiente", "en_preparacion"].includes(x.estado)).length,
    openIncidents: openIncidents.length,
    unconfirmedShipments: state.shipments.filter(x => !x.confirmado_por_instalador && !["fallido", "extraviado", "devuelto"].includes(x.estado)).length,
    lowStock: state.stock.filter(s => available(s) < (state.materials.find(m => m.id === s.material_id)?.stock_minimo || 0)).length,
    blockedInstalls: openIncidents.filter(x => x.vin_id || x.campana_id).length,
    preparedPickings: state.pickings.filter(x => x.estado === "preparado").length,
    openRequirements: state.requirements.filter(x => !["cancelada", "consumida", "entregada"].includes(x.status)).length,
    openRequests: openRequests.length,
    syncErrors: state.events.filter(x => x.status === "error").length
  };
}

export function logisticsAlerts(state: LogisticsState) {
  const alerts: { level: "critica" | "alta" | "info"; text: string; href: string }[] = [];
  state.pendings.filter(x => !["recibido", "cerrado"].includes(x.estado)).forEach(p => {
    if (p.fecha_prevista && p.fecha_prevista < today()) alerts.push({ level: "critica", text: `Pendiente de llegada vencido: ${materialName(state, p.material_id)}`, href: `/logistica/pendientes?id=${p.id}` });
    else if (daysUntil(p.fecha_instalacion) <= 2) alerts.push({ level: "critica", text: `Instalación en 48h sin material recibido`, href: `/logistica/pendientes?id=${p.id}` });
    else if (daysUntil(p.fecha_instalacion) <= 5 && p.estado === "pend_proveedor") alerts.push({ level: "alta", text: `Material pendiente de proveedor antes de instalación`, href: `/logistica/pendientes?id=${p.id}` });
  });
  state.stock.forEach(s => {
    const m = state.materials.find(x => x.id === s.material_id);
    if (m && available(s) < m.stock_minimo) alerts.push({ level: "alta", text: `${m.nombre} bajo mínimo`, href: `/logistica/stock?id=${s.material_id}` });
  });
  state.shipments.filter(x => !x.confirmado_por_instalador && ["en_transito", "entregado"].includes(x.estado)).forEach(s => alerts.push({ level: "info", text: `Envío sin confirmar por instalador`, href: `/logistica/envios?id=${s.id}` }));
  state.requirements.filter(x => ["pendiente_stock", "pendiente_produccion", "pendiente_recepcion", "bloqueada", "con_incidencia"].includes(x.status)).forEach(r => {
    const level = r.priority === "critica" || r.status === "bloqueada" ? "critica" : r.priority === "alta" ? "alta" : "info";
    alerts.push({ level, text: `${r.requested_material_name}: ${logisticsStatusLabel(r.status)}`, href: `/logistica/solicitudes?id=${r.request_id || r.id}` });
  });
  return alerts;
}

export function logisticsStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pendiente_revision: "Solicitud logística enviada",
    aceptada: "Solicitud aceptada",
    pendiente_stock: "Pendiente de stock",
    pendiente_produccion: "Material en producción",
    pendiente_recepcion: "Material pendiente de llegada",
    parcialmente_disponible: "Parcialmente disponible",
    disponible: "Material disponible",
    reservada: "Material reservado",
    en_picking: "Picking en preparación",
    preparada: "Picking preparado",
    enviada: "Material enviado",
    entregada: "Material entregado",
    consumida: "Material consumido",
    cancelada: "Solicitud cancelada",
    bloqueada: "Instalación bloqueada por Logística",
    con_incidencia: "Incidencia logística"
  };
  return labels[String(status || "")] || "Sin estado logístico";
}
