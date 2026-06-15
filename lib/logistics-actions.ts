import {
  Entry,
  LogisticsRequest,
  LogisticsState,
  Picking,
  Shipping,
  addSyncLog,
  createMovement,
  upsertLogisticsVin
} from "@/lib/logistics";

export function updateLogisticsRequest(
  state: LogisticsState,
  requestId: string,
  patch: Partial<Pick<LogisticsRequest, "priority" | "required_date" | "installation_date" | "destination_type" | "installer_id" | "installer_name" | "delivery_address" | "province" | "city" | "logistics_comment" | "operations_comment">>,
  actor = "Logística"
) {
  const request = state.requests.find(x => x.id === requestId);
  if (!request) throw new Error("Solicitud no encontrada");
  if (["entregada", "cerrada", "cancelada", "rechazada"].includes(request.status)) throw new Error("Esta solicitud ya está cerrada y no se puede editar.");
  const now = new Date().toISOString();
  Object.assign(request, patch, { updated_at: now });
  state.requirements.filter(req => req.request_id === request.id).forEach(req => {
    req.priority = patch.priority ?? req.priority;
    req.required_date = patch.required_date ?? req.required_date;
    req.installation_date = patch.installation_date ?? req.installation_date;
    req.installer_id = patch.installer_id ?? req.installer_id;
    req.installer_name = patch.installer_name ?? req.installer_name;
    req.delivery_address = patch.delivery_address ?? req.delivery_address;
    req.province = patch.province ?? req.province;
    req.city = patch.city ?? req.city;
    req.logistics_notes = patch.logistics_comment ?? req.logistics_notes;
    req.operations_notes = patch.operations_comment ?? req.operations_notes;
    req.updated_at = now;
  });
  addSyncLog(state, { evento: "logistica.peticion_editada", origen_modulo: "logistica", destino_modulo: "servicios_isdin", entidad_id: request.id, usuario_id: actor, payload: patch as Record<string, unknown>, resultado: "ok" });
}

export function cancelLogisticsRequest(state: LogisticsState, requestId: string, reason: string, actor = "Logística") {
  const request = state.requests.find(x => x.id === requestId);
  if (!request) throw new Error("Solicitud no encontrada");
  if (request.picking_id || request.shipment_id) throw new Error("La solicitud ya tiene picking o envío. Cancela primero esa preparación desde su detalle.");
  if (!reason.trim()) throw new Error("Indica un motivo para cancelar la solicitud.");
  const now = new Date().toISOString();
  request.lines.forEach(line => {
    const req = state.requirements.find(x => x.id === line.material_requirement_id);
    const materialId = line.material_id || req?.material_id;
    const reserved = Number(req?.reserved_quantity || line.accepted_quantity || 0);
    if (materialId && reserved > 0) createMovement(state, { material_id: materialId, tipo: "liberacion", cantidad: reserved, campana_id: request.campaign_id || req?.campaign_id || null, vin_id: req?.vin || null, motivo: `Cancelación ${request.code}: ${reason}`, usuario_id: actor });
    line.accepted_quantity = 0;
    line.missing_quantity = Number(line.requested_quantity || 0);
    line.line_status = "cancelada";
    line.comment = [line.comment, `Cancelada: ${reason}`].filter(Boolean).join(" | ");
    if (req) {
      req.reserved_quantity = 0;
      req.status = "cancelada";
      req.logistics_notes = reason;
      req.updated_at = now;
      if (req.vin) upsertLogisticsVin(state, { vin_id: req.vin, estado: "cancelado" });
    }
  });
  request.status = "cancelada";
  request.logistics_comment = [request.logistics_comment, `Cancelada: ${reason}`].filter(Boolean).join(" | ");
  request.updated_at = now;
  addSyncLog(state, { evento: "logistica.peticion_cancelada", origen_modulo: "logistica", destino_modulo: "servicios_isdin", entidad_id: request.id, usuario_id: actor, payload: { request_id: request.id, motivo: reason }, resultado: "ok" });
}

export function updateEntry(state: LogisticsState, entryId: string, patch: Partial<Pick<Entry, "albaran" | "fecha_prevista" | "fecha_recepcion" | "proveedor_id" | "transportista" | "num_bultos_esperado" | "num_bultos_recibido" | "observaciones">>) {
  const entry = state.entries.find(x => x.id === entryId);
  if (!entry) throw new Error("Entrada no encontrada");
  if (!["pendiente", "rechazado"].includes(entry.estado)) throw new Error("La entrada ya está contabilizada. Solo se puede editar antes de recibir stock.");
  Object.assign(entry, patch);
}

export function closeEntryLogically(state: LogisticsState, entryId: string, reason: string) {
  const entry = state.entries.find(x => x.id === entryId);
  if (!entry) throw new Error("Entrada no encontrada");
  if (entry.estado !== "pendiente" && entry.estado !== "rechazado") throw new Error("No se puede archivar una entrada que ya ha movido stock.");
  entry.estado = "cerrado";
  entry.observaciones = [entry.observaciones, `Archivada: ${reason || "Sin motivo"}`].filter(Boolean).join(" | ");
}

export function updatePicking(state: LogisticsState, pickingId: string, patch: Partial<Pick<Picking, "instalador_id" | "campana_id" | "zona" | "fecha_salida_prevista" | "num_puntos">>) {
  const picking = state.pickings.find(x => x.id === pickingId);
  if (!picking) throw new Error("Picking no encontrado");
  if (["enviado", "recibido", "cerrado"].includes(picking.estado)) throw new Error("Este picking ya está avanzado y no se puede editar desde esta vista.");
  Object.assign(picking, patch);
  state.requests.filter(req => req.picking_id === picking.id).forEach(req => {
    req.installer_id = patch.instalador_id ?? req.installer_id;
    req.campaign_id = patch.campana_id ?? req.campaign_id;
    req.province = patch.zona ?? req.province;
    req.required_date = patch.fecha_salida_prevista ?? req.required_date;
    req.updated_at = new Date().toISOString();
  });
}

export function cancelPicking(state: LogisticsState, pickingId: string, reason: string, actor = "Logística") {
  const picking = state.pickings.find(x => x.id === pickingId);
  if (!picking) throw new Error("Picking no encontrado");
  if (picking.envio_id || ["enviado", "recibido", "cerrado"].includes(picking.estado)) throw new Error("No se puede cancelar un picking con envío o ya cerrado.");
  if (!reason.trim()) throw new Error("Indica un motivo para cancelar el picking.");
  const prepared = picking.lineas.some(line => Number(line.cantidad_preparada || 0) > 0);
  if (prepared) throw new Error("Este picking ya tiene líneas preparadas. Revisa el stock antes de cancelarlo.");
  picking.lineas.forEach(line => {
    createMovement(state, { material_id: line.material_id, tipo: "liberacion", cantidad: line.cantidad_esperada, campana_id: picking.campana_id, vin_id: line.vin_id, motivo: `Cancelación ${picking.codigo}: ${reason}`, usuario_id: actor });
    line.estado = "faltante";
    line.justificacion_faltante = `Cancelado: ${reason}`;
  });
  picking.estado = "cerrado";
  state.requests.filter(req => req.picking_id === picking.id).forEach(req => {
    req.picking_id = null;
    req.status = "cancelada";
    req.logistics_comment = [req.logistics_comment, `Picking cancelado ${picking.codigo}: ${reason}`].filter(Boolean).join(" | ");
    req.updated_at = new Date().toISOString();
  });
  state.requirements.filter(req => req.picking_id === picking.id).forEach(req => {
    req.picking_id = null;
    req.reserved_quantity = 0;
    req.status = "cancelada";
    req.logistics_notes = reason;
    req.updated_at = new Date().toISOString();
    if (req.vin) upsertLogisticsVin(state, { vin_id: req.vin, estado: "cancelado", picking_id: null });
  });
  addSyncLog(state, { evento: "logistica.picking_cancelado", origen_modulo: "logistica", destino_modulo: "servicios_isdin", entidad_id: picking.id, usuario_id: actor, payload: { picking_id: picking.id, motivo: reason }, resultado: "ok" });
}

export function updateShipping(state: LogisticsState, shippingId: string, patch: Partial<Pick<Shipping, "fecha_salida" | "transportista" | "tracking" | "destinatario_id" | "instalador_id" | "num_bultos" | "fecha_estimada_entrega" | "estado">>) {
  const envio = state.shipments.find(x => x.id === shippingId);
  if (!envio) throw new Error("Envío no encontrado");
  if (envio.confirmado_por_instalador || envio.estado === "entregado") throw new Error("El envío ya está confirmado por el instalador y no se puede editar.");
  Object.assign(envio, patch);
}

export function cancelShipping(state: LogisticsState, shippingId: string, reason: string, actor = "Logística") {
  const envio = state.shipments.find(x => x.id === shippingId);
  const picking = envio ? state.pickings.find(x => x.id === envio.picking_id) : null;
  if (!envio || !picking) throw new Error("Envío no encontrado");
  if (envio.confirmado_por_instalador || envio.estado === "entregado") throw new Error("No se puede cancelar un envío ya confirmado.");
  if (!reason.trim()) throw new Error("Indica un motivo para cancelar el envío.");
  envio.estado = "devuelto";
  envio.tracking = [envio.tracking, `Cancelado: ${reason}`].filter(Boolean).join(" | ");
  picking.estado = "revisado";
  picking.envio_id = null;
  state.requests.filter(req => req.shipment_id === envio.id).forEach(req => {
    req.shipment_id = null;
    req.status = "preparada";
    req.logistics_comment = [req.logistics_comment, `Envío cancelado: ${reason}`].filter(Boolean).join(" | ");
    req.updated_at = new Date().toISOString();
  });
  state.requirements.filter(req => req.shipment_id === envio.id).forEach(req => {
    req.shipment_id = null;
    req.status = "preparada";
    req.logistics_notes = [req.logistics_notes, `Envío cancelado: ${reason}`].filter(Boolean).join(" | ");
    req.updated_at = new Date().toISOString();
    if (req.vin) upsertLogisticsVin(state, { vin_id: req.vin, estado: "en_picking", shipment_id: null });
  });
  addSyncLog(state, { evento: "logistica.envio_cancelado", origen_modulo: "logistica", destino_modulo: "servicios_isdin", entidad_id: envio.id, usuario_id: actor, payload: { envio_id: envio.id, motivo: reason }, resultado: "ok" });
}
