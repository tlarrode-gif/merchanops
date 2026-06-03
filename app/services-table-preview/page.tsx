"use client";

import { useState } from "react";
import { ServicesTable } from "@/components/services/ServicesTable";

const serviceStatuses = ["Pendiente asignar", "Asignado", "Info enviada", "Material pendiente", "Material recibido", "En ejecución", "Reportado", "Validado", "Incidencia", "Pagado"];
const pointStatuses = ["Pendiente", "Revisado", "Reportado", "Incidencia", "Pospuesto", "Finalizado", "Pendiente recepción post-incidencia"];
const workers = [
  { id: "w1", name: "Sara Álvarez", phone: "34600000000" },
  { id: "w2", name: "María Loya", phone: "34611111111" },
  { id: "w3", name: "Nico Siero", phone: "34622222222" }
];
const clients = [{ id: "c1", name: "ISDIN" }];

function eur(value: number) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)) + " €";
}

function todayISO() {
  return new Date().toISOString();
}

function colorFor(service: any) {
  const colors: any = { blue: { bg: "#2563eb" }, red: { bg: "#dc2626" }, green: { bg: "#16a34a" }, slate: { bg: "#0f172a" } };
  return colors[service.calendar_color || "slate"] || colors.slate;
}

function pointStatus(point: any) {
  return point.point_status || point.status || "Pendiente";
}

function isIncidentActive(point: any) {
  return pointStatus(point) === "Incidencia" && point.incident_status !== "Resuelta";
}

function pointOriginal(point: any) {
  return Number(point.original_fee ?? point.fee ?? 0);
}

function pointPay(point: any) {
  if (isIncidentActive(point)) return 8.56;
  return Number(point.fee || 0);
}

function serviceTotal(service: any) {
  return (service.points || []).reduce((acc: number, point: any) => acc + pointPay(point), 0);
}

function isOverdue(service: any) {
  return !!service.deadline && !["Validado", "Pagado"].includes(service.status || "") && new Date(service.deadline + "T23:59:59").getTime() < Date.now();
}

function buildWhatsApp(service: any) {
  return `*${service.client} – ${service.campaign}*\nTotal: ${eur(serviceTotal(service))}`;
}

const initialServices = [
  {
    id: "s1",
    client_id: "c1",
    client: "ISDIN",
    ceco: "3159",
    campaign: "Semana 1 Junio 2026",
    province: "Asturias",
    deadline: "2026-06-07",
    worker_id: "w1",
    worker_name: "Sara Álvarez",
    status: "Asignado",
    payment_type: "Puntos",
    calendar_color: "blue",
    points: [
      { id: "p1", name: "Farmacia Oviedo", address: "Gil de Jaz", report_code: "VIN-001", fee: 18, point_status: "Pendiente" },
      { id: "p2", name: "Farmacia Gijón", address: "Menéndez Pelayo", report_code: "VIN-002", fee: 18, point_status: "Incidencia", incident_status: "Abierta", original_fee: 18, incident_fee: 8.56 }
    ]
  },
  {
    id: "s2",
    client_id: "c1",
    client: "ISDIN",
    ceco: "3159",
    campaign: "Semana 15 Junio 2026",
    province: "Alicante",
    deadline: "2026-06-21",
    worker_id: "w2",
    worker_name: "María Loya",
    status: "Reportado",
    payment_type: "Puntos",
    calendar_color: "green",
    points: [
      { id: "p3", name: "Farmacia Elche", address: "El Salvador 25", report_code: "VIN-003", fee: 18, point_status: "Finalizado" }
    ]
  }
];

export default function ServicesTablePreviewPage() {
  const [services, setServices] = useState<any[]>(initialServices);

  function updateService(service: any, patch: any) {
    setServices(prev => prev.map(item => item.id === service.id ? { ...item, ...patch } : item));
  }

  function updatePoint(point: any, patch: any) {
    setServices(prev => prev.map(service => ({
      ...service,
      points: (service.points || []).map((item: any) => item.id === point.id ? { ...item, ...patch } : item)
    })));
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-[1480px] space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Preview · Servicios como tabla real</h1>
          <p className="text-sm text-slate-500">Laboratorio visual aislado. No toca datos reales ni Supabase.</p>
        </div>
        <ServicesTable
          services={services}
          clients={clients}
          workers={workers}
          serviceStatuses={serviceStatuses}
          pointStatuses={pointStatuses}
          colorFor={colorFor}
          eur={eur}
          serviceTotal={serviceTotal}
          isOverdue={isOverdue}
          buildWhatsApp={buildWhatsApp}
          todayISO={todayISO}
          updateService={updateService}
          updatePoint={updatePoint}
          editService={(service) => alert(`Editar ${service.client} · ${service.campaign}`)}
          duplicateService={(service) => setServices(prev => [{ ...service, id: crypto.randomUUID(), campaign: service.campaign + " (copia)" }, ...prev])}
          deleteService={(service) => setServices(prev => prev.filter(item => item.id !== service.id))}
          pointStatus={pointStatus}
          pointPay={pointPay}
          pointOriginal={pointOriginal}
          isIncidentActive={isIncidentActive}
        />
      </div>
    </main>
  );
}
