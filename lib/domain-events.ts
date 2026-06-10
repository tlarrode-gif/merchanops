import { IncidentType, LogisticsState, MaterialType, RequirementSourceType, addSyncLog, createIncident, createPickingFromRequest, rejectLogisticsRequest, uid, upsertLogisticsVin, upsertMaterialCatalog } from "@/lib/logistics";
import { acceptRequestAndReserve, createServiceLogisticsRequest, ensureIntegrationEvent, failEvent, notify, syncInstallerChange, syncIsdinVinylToLogistics } from "@/lib/logistics-sync";

export type DomainEventName =
  | "material.base_datos_importada"
  | "servicio.material_asignado"
  | "servicio.instalador_cambiado"
  | "servicio.incidencia_creada"
  | "servicio.peticion_material_creada"
  | "servicio.material_recibido_campo"
  | "logistica.picking_creado"
  | "logistica.envio_realizado"
  | "logistica.material_entregado"
  | "logistica.incidencia_resuelta"
  | "logistica.stock_bajo_minimo"
  | "logistica.peticion_aprobada"
  | "logistica.peticion_rechazada";

export type DomainEvent<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  name: DomainEventName;
  originModule: "servicios" | "isdin" | "logistica" | "sistema";
  entityId?: string | null;
  userId?: string | null;
  payload: T;
  createdAt: string;
};

type ImportedMaterial = {
  sku?: string | null;
  nombre?: string | null;
  name?: string | null;
  cliente_id?: string | null;
  tipo?: MaterialType | null;
  medidas?: string | null;
  unidad_control?: "uds" | "rollos" | "m2" | "cajas" | null;
  proveedor_id?: string | null;
  vin?: string | null;
  vin_id?: string | null;
  campana_id?: string | null;
  farmacia_id?: string | null;
  farmacia_nombre?: string | null;
  pharmacy_name?: string | null;
  direccion?: string | null;
  address?: string | null;
  telefono?: string | null;
  responsable?: string | null;
  instalador_id?: string | null;
  instalador_nombre?: string | null;
  medidas_vin?: string | null;
};

export function createDomainEvent<T extends Record<string, unknown>>(name: DomainEventName, originModule: DomainEvent["originModule"], payload: T, entityId?: string | null, userId?: string | null): DomainEvent<T> {
  return { id: uid("dom"), name, originModule, entityId, userId, payload, createdAt: new Date().toISOString() };
}

export function publishDomainEvent(state: LogisticsState, event: DomainEvent) {
  const integration = ensureIntegrationEvent(state, event.name, event.originModule, event.entityId || event.id, event.payload, event.id);
  try {
    applyDomainEventToLogistics(state, event);
    const row = state.events.find(x => x.id === integration.id);
    if (row) {
      row.status = "completado";
      row.processed_at = new Date().toISOString();
      row.last_error = null;
    }
  } catch (error) {
    failEvent(state, integration.id, error);
    addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: event.entityId || null, usuario_id: event.userId || null, payload: event.payload, resultado: "error", error_message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function retryFailedIntegrationEvents(state: LogisticsState) {
  const failed = state.events.filter(event => event.status === "error");
  failed.forEach(integration => {
    integration.status = "procesando";
    integration.attempts += 1;
    integration.last_error = null;
    try {
      if (isDomainEventName(integration.event_type)) {
        applyDomainEventToLogistics(state, {
          id: integration.id,
          name: integration.event_type,
          originModule: originModule(integration.source_type),
          entityId: integration.source_id,
          payload: integration.payload || {},
          createdAt: integration.created_at
        });
      } else if (integration.event_type === "isdin_vinyl.updated") {
        syncIsdinVinylToLogistics(state, { ...(integration.payload as Record<string, unknown>), id: integration.source_id } as any, eventVersion(integration));
      } else if (integration.event_type === "service.material_requested") {
        createServiceLogisticsRequest(state, { ...(integration.payload as Record<string, unknown>), id: integration.source_id } as any, [], eventVersion(integration));
      } else {
        throw new Error(`Tipo de evento no reintentable: ${integration.event_type}`);
      }
      integration.status = "completado";
      integration.processed_at = new Date().toISOString();
      integration.last_error = null;
      addSyncLog(state, { evento: integration.event_type, origen_modulo: integration.source_type, destino_modulo: "logistica", entidad_id: integration.source_id, payload: integration.payload, resultado: "ok" });
    } catch (error) {
      integration.status = "error";
      integration.last_error = error instanceof Error ? error.message : String(error);
      addSyncLog(state, { evento: integration.event_type, origen_modulo: integration.source_type, destino_modulo: "logistica", entidad_id: integration.source_id, payload: integration.payload, resultado: "error", error_message: integration.last_error });
    }
  });
  return failed.length;
}

export function applyDomainEventToLogistics(state: LogisticsState, event: DomainEvent) {
  switch (event.name) {
    case "material.base_datos_importada":
      syncImportedMaterials(state, event);
      break;
    case "servicio.material_asignado":
      syncMaterialAssigned(state, event);
      break;
    case "servicio.instalador_cambiado":
      syncInstallerChange(state, sourceType(event.payload.source_type), sourceId(event), {
        installer_id: text(event.payload.instalador_id_nuevo || event.payload.installer_id),
        installer_name: text(event.payload.instalador_nombre || event.payload.installer_name),
        delivery_address: text(event.payload.delivery_address || event.payload.direccion)
      }, text(event.userId) || "Operaciones");
      addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: event.entityId || sourceId(event), usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
      break;
    case "servicio.incidencia_creada":
      routeServiceIncident(state, event);
      break;
    case "servicio.peticion_material_creada":
      createServiceLogisticsRequest(state, event.payload as Record<string, unknown> as any, Array.isArray(event.payload.materiales) ? event.payload.materiales as any[] : [], event.id);
      addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: event.entityId || sourceId(event), usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
      break;
    case "servicio.material_recibido_campo":
      syncFieldReception(state, event);
      break;
    case "logistica.peticion_aprobada":
      if (text(event.payload.peticion_id)) {
        acceptRequestAndReserve(state, text(event.payload.peticion_id), text(event.userId) || "Logística");
        createPickingFromRequest(state, text(event.payload.peticion_id), text(event.userId) || "Logística");
      }
      break;
    case "logistica.peticion_rechazada":
      if (text(event.payload.peticion_id)) rejectLogisticsRequest(state, text(event.payload.peticion_id), text(event.payload.motivo) || "Rechazada por Logística", text(event.userId) || "Logística");
      break;
    case "logistica.picking_creado":
    case "logistica.envio_realizado":
    case "logistica.material_entregado":
    case "logistica.incidencia_resuelta":
    case "logistica.stock_bajo_minimo":
      addSyncLog(state, { evento: event.name, origen_modulo: "logistica", destino_modulo: "servicios_isdin", entidad_id: event.entityId || null, usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
      break;
  }
}

function syncImportedMaterials(state: LogisticsState, event: DomainEvent) {
  const materials = Array.isArray(event.payload.materiales) ? event.payload.materiales as ImportedMaterial[] : [];
  let created = 0;
  let updated = 0;
  materials.forEach(item => {
    const sku = text(item.sku || item.vin || item.vin_id);
    const name = text(item.nombre || item.name || item.pharmacy_name || item.farmacia_nombre || sku);
    if (!sku || !name) return;
    const result = upsertMaterialCatalog(state, {
      sku,
      nombre: name,
      cliente_id: text(item.cliente_id || event.payload.cliente_id),
      tipo: item.tipo || (item.vin || item.vin_id ? "vinilo_medida" : "consumible"),
      medidas: text(item.medidas),
      unidad_control: item.unidad_control || "uds",
      proveedor_id: text(item.proveedor_id)
    });
    if (result.created) created += 1;
    else updated += 1;
    const vin = text(item.vin || item.vin_id);
    if (vin) upsertLogisticsVin(state, {
      vin_id: vin,
      material_id: result.material.id,
      campana_id: text(item.campana_id || event.payload.campana_id),
      farmacia_id: text(item.farmacia_id),
      farmacia_nombre: text(item.farmacia_nombre || item.pharmacy_name),
      direccion: text(item.direccion || item.address),
      telefono: text(item.telefono),
      responsable: text(item.responsable),
      instalador_id: text(item.instalador_id),
      instalador_nombre: text(item.instalador_nombre),
      medidas: text(item.medidas_vin || item.medidas),
      estado: "pendiente_picking"
    });
  });
  notify(state, { type: "material_imported", priority: "alta", entity_type: "catalog", entity_id: event.entityId || event.id, href: "/logistica/stock", message: `Nueva base de datos importada - ${created} referencias nuevas, ${updated} actualizadas` });
  addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: event.entityId || null, usuario_id: event.userId || null, payload: { created, updated }, resultado: "ok" });
}

function syncMaterialAssigned(state: LogisticsState, event: DomainEvent) {
  const source = event.payload as Record<string, unknown>;
  if (text(source.vin_id || source.vin)) {
    upsertLogisticsVin(state, {
      vin_id: text(source.vin_id || source.vin),
      campana_id: text(source.campana_id),
      farmacia_id: text(source.farmacia_id),
      farmacia_nombre: text(source.farmacia_nombre || source.pharmacy_name),
      direccion: text(source.direccion || source.address),
      telefono: text(source.telefono),
      responsable: text(source.responsable),
      instalador_id: text(source.instalador_id),
      instalador_nombre: text(source.instalador_nombre || source.installer_name),
      estado: "pendiente_picking"
    });
  }
  if (source.source_type === "isdin_vinyl" || source.vin_id || source.vin) syncIsdinVinylToLogistics(state, { ...source, id: text(source.vinyl_id || source.id || source.vin_id || source.vin), vin: text(source.vin_id || source.vin) } as any, event.id);
  else createServiceLogisticsRequest(state, { ...source, id: sourceId(event) } as any, [], event.id);
  addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: event.entityId || sourceId(event), usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
}

function routeServiceIncident(state: LogisticsState, event: DomainEvent) {
  const type = text(event.payload.tipo) as IncidentType;
  const logisticsTypes = ["material_no_recibido", "medidas_incorrectas", "material_danado", "vin_equivocado", "entrega_fallida", "material_sobrante", "medidas", "danado", "incorrecto", "falta"];
  if (!logisticsTypes.includes(type)) {
    addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "servicios", entidad_id: event.entityId || sourceId(event), usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
    return;
  }
  const incident = createIncident(state, {
    tipo: type || "falta",
    material_id: text(event.payload.material_id) || null,
    vin_id: text(event.payload.vin_id || event.payload.vin) || null,
    campana_id: text(event.payload.campana_id) || null,
    farmacia_id: text(event.payload.farmacia_id) || null,
    descripcion: text(event.payload.descripcion || event.payload.comment || event.payload.motivo) || "Incidencia recibida desde Servicios",
    impacto: "Requiere acción logística",
    fecha_limite: text(event.payload.fecha_limite || event.payload.required_date) || null
  });
  if (incident.vin_id) upsertLogisticsVin(state, { vin_id: incident.vin_id, estado: "con_incidencia", incident_id: incident.id, pending_arrival_id: incident.pendiente_llegada_id || null });
  notify(state, { type: "cross_module_incident", priority: "critica", entity_type: "incident", entity_id: incident.id, href: `/logistica/incidencias?id=${incident.id}`, message: `Incidencia logística desde ${event.originModule}: ${incident.codigo}` });
  addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: incident.id, usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
}

function syncFieldReception(state: LogisticsState, event: DomainEvent) {
  const vin = text(event.payload.vin_id || event.payload.vin);
  const status = text(event.payload.estado);
  if (!vin) return;
  upsertLogisticsVin(state, { vin_id: vin, instalador_id: text(event.payload.instalador_id), estado: status === "recibido" ? "entregado" : "con_incidencia" });
  addSyncLog(state, { evento: event.name, origen_modulo: event.originModule, destino_modulo: "logistica", entidad_id: vin, usuario_id: event.userId || null, payload: event.payload, resultado: "ok" });
}

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function sourceId(event: DomainEvent) {
  if (sourceType(event.payload.source_type) === "service_point") return text(event.payload.service_point_id || event.payload.point_id || event.payload.id || event.entityId || event.id);
  return text(event.payload.servicio_id || event.payload.service_id || event.payload.vinyl_id || event.payload.vin_id || event.payload.id || event.entityId || event.id);
}

function sourceType(value: unknown): RequirementSourceType {
  const allowed = ["service", "service_point", "isdin_vinyl", "campaign", "incident", "replacement", "manual_request"];
  return allowed.includes(text(value)) ? text(value) as RequirementSourceType : "service";
}

function isDomainEventName(value: string): value is DomainEventName {
  return [
    "material.base_datos_importada",
    "servicio.material_asignado",
    "servicio.instalador_cambiado",
    "servicio.incidencia_creada",
    "servicio.peticion_material_creada",
    "servicio.material_recibido_campo",
    "logistica.picking_creado",
    "logistica.envio_realizado",
    "logistica.material_entregado",
    "logistica.incidencia_resuelta",
    "logistica.stock_bajo_minimo",
    "logistica.peticion_aprobada",
    "logistica.peticion_rechazada"
  ].includes(value);
}

function originModule(value: string): DomainEvent["originModule"] {
  return value === "servicios" || value === "isdin" || value === "logistica" || value === "sistema" ? value : "sistema";
}

function eventVersion(event: { event_type: string; source_type: string; source_id: string; idempotency_key: string; id: string }) {
  const prefix = `${event.event_type}:${event.source_type}:${event.source_id}:`;
  return event.idempotency_key.startsWith(prefix) ? event.idempotency_key.slice(prefix.length) || event.id : event.id;
}
