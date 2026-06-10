"use client";

import type React from "react";
import { LogisticsState, RequirementSourceType, logisticsStatusLabel, materialName } from "@/lib/logistics";
import { logisticsSummaryForSource } from "@/lib/logistics-sync";

export function EstadoLogistico({ state, sourceType, sourceId, vin }: { state: LogisticsState; sourceType?: RequirementSourceType; sourceId?: string; vin?: string | null }) {
  const summary = sourceType && sourceId ? logisticsSummaryForSource(state, sourceType, sourceId) : null;
  const vinRow = vin ? state.vins.find(x => x.vin_id === vin) : null;
  const picking = summary?.picking || (vinRow?.picking_id ? state.pickings.find(x => x.id === vinRow.picking_id) : null);
  const shipment = summary?.shipment || (vinRow?.shipment_id ? state.shipments.find(x => x.id === vinRow.shipment_id) : null);
  const incident = summary?.incident || (vinRow?.incident_id ? state.incidents.find(x => x.id === vinRow.incident_id) : null) || (vin ? state.incidents.find(x => x.vin_id === vin && !["resuelta", "cancelada"].includes(x.estado)) : null);
  const pending = summary?.pending || (vinRow?.pending_arrival_id ? state.pendings.find(x => x.id === vinRow.pending_arrival_id) : null);
  const requirements = summary?.requirements || (vin ? state.requirements.filter(x => x.vin === vin) : []);
  const requirement = requirements[0];
  const label = vinRow?.estado ? logisticVinLabel(vinRow.estado) : summary?.label || logisticsStatusLabel(requirement?.status);
  const material = requirement?.material_id ? materialName(state, requirement.material_id) : requirement?.requested_material_name || "Sin material asignado";
  const request = requirement?.request_id ? state.requests.find(x => x.id === requirement.request_id) : summary?.request;
  const context = {
    origen: sourceLabel(sourceType || requirement?.source_type, sourceId || requirement?.source_id),
    cliente: firstText(requirement?.client_id, request?.client_id),
    campana: firstText(requirement?.campaign_id, request?.campaign_id),
    vinFarmacia: firstText(requirement?.vin, vinRow?.vin_id, vin) || firstText(requirement?.pharmacy_name, vinRow?.farmacia_nombre),
    provincia: firstText(requirement?.province, request?.province),
    fecha: firstText(requirement?.required_date, requirement?.installation_date, request?.required_date, request?.installation_date),
    destino: firstText(request?.installer_name, requirement?.installer_name, request?.delivery_address, requirement?.delivery_address, vinRow?.direccion)
  };

  return (
    <section className="rounded-2xl border bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Estado logístico</p>
          <h3 className="text-lg font-bold">{label}</h3>
          <p className="text-sm text-slate-500">{material}</p>
        </div>
        <span className={statusClass(label)}>{label}</span>
      </div>

      <div className="mt-3 rounded-2xl border bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Contexto operativo</p>
        <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
          <Read label="Origen" value={context.origen || "Sin origen"} />
          <Read label="Cliente / CECO" value={context.cliente || "Sin cliente/CECO"} />
          <Read label="Campaña" value={context.campana || "Sin campaña"} />
          <Read label="VIN / Farmacia" value={context.vinFarmacia || "Sin VIN/farmacia"} />
          <Read label="Provincia" value={context.provincia || "Sin provincia"} />
          <Read label="Fecha necesaria" value={context.fecha || "Sin fecha"} />
          <Read label="Destino" value={context.destino || "Sin destino"} />
          <Read label="Material" value={material} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <Read label="Picking" value={picking ? <a href={`/logistica/picking?id=${picking.id}`} className="font-semibold underline-offset-2 hover:underline">{picking.codigo}</a> : "Sin picking"} />
        <Read label="Envío" value={shipment ? <a href={`/logistica/envios?id=${shipment.id}`} className="font-semibold underline-offset-2 hover:underline">{shipment.transportista || "Transporte"} · {shipment.tracking || shipment.estado}</a> : "Sin envío"} />
        <Read label="Incidencia activa" value={incident ? <a href={`/logistica/incidencias?id=${incident.id}`} className="font-semibold underline-offset-2 hover:underline">{incident.codigo} · {incident.tipo}</a> : "Sin incidencia"} />
        <Read label="Pendiente llegada" value={pending ? <a href={`/logistica/pendientes?id=${pending.id}`} className="font-semibold underline-offset-2 hover:underline">{pending.fecha_prevista || pending.estado}</a> : "Sin pendiente"} />
      </div>
    </section>
  );
}

function Read({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl bg-white p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><div>{value}</div></div>;
}

function sourceLabel(sourceType?: string, sourceId?: string | null) {
  const labels: Record<string, string> = {
    service: "Servicio",
    service_point: "Punto de servicio",
    isdin_vinyl: "ISDIN Vinilos",
    campaign: "Campaña",
    incident: "Incidencia",
    replacement: "Reposición",
    manual_request: "Petición manual"
  };
  return [sourceType ? labels[sourceType] || sourceType : "", sourceId].filter(Boolean).join(" · ");
}

function firstText(...values: Array<string | number | null | undefined>) {
  return values.map(value => String(value ?? "").trim()).find(Boolean) || "";
}

function logisticVinLabel(status: string) {
  const labels: Record<string, string> = {
    pendiente_recepcion: "Pendiente recepción",
    pendiente_picking: "Pendiente picking",
    en_almacen: "En almacén",
    en_picking: "En picking",
    enviado: "En tránsito",
    entregado: "Entregado",
    con_incidencia: "Con incidencia",
    bloqueado: "Bloqueado",
    cancelado: "Cancelado"
  };
  return labels[status] || status;
}

function statusClass(label: string) {
  const text = label.toLowerCase();
  const tone = text.includes("incid") || text.includes("bloque") ? "bg-red-50 text-red-800 ring-red-200" : text.includes("tránsito") || text.includes("picking") ? "bg-blue-50 text-blue-800 ring-blue-200" : text.includes("entregado") ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200";
  return `inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${tone}`;
}
