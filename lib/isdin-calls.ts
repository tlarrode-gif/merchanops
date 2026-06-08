export const isdinCallsLocalKey = "merchanops_isdin_calls_local_v4";

export const isdinCallStatuses = [
  "Pendiente de llamar",
  "Llamada realizada",
  "No contesta",
  "Confirmado",
  "Incidencia en llamada",
  "Pospuesto en llamada",
  "Cancelado en llamada",
  "Requiere revisión operaciones"
] as const;

export type IsdinCallStatus = typeof isdinCallStatuses[number];

export type IsdinCall = {
  id: string;
  vinyl_id?: string | null;
  isdin_vinyl_id?: string | null;
  vin: string;
  pharmacy_name: string;
  vinyl_campaign?: string | null;
  desired_installation_week?: string | null;
  desired_installation_date?: string | null;
  street?: string | null;
  street_number?: string | null;
  postal_code?: string | null;
  province?: string | null;
  city?: string | null;
  worker_name?: string | null;
  installer_name?: string | null;
  client_observations?: string | null;
  scaffold_required?: boolean | null;
  call_status: IsdinCallStatus;
  call_datetime?: string | null;
  call_time_slot?: string | null;
  contact_person?: string | null;
  phone_number?: string | null;
  call_comment?: string | null;
  backoffice_user?: string | null;
  next_visit_date?: string | null;
  next_visit_week?: string | null;
  requires_operations_review?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type IsdinVinylBase = {
  id: string;
  vinyl: string;
  pharmacy_name: string;
  vinyl_campaign?: string | null;
  desired_installation_week?: string | null;
  desired_installation_date?: string | null;
  street?: string | null;
  street_number?: string | null;
  postal_code?: string | null;
  province?: string | null;
  city?: string | null;
  installer_name?: string | null;
  client_observations?: string | null;
  scaffold_required?: boolean | null;
};

export type CallsFilters = {
  week: string;
  province: string;
  city: string;
  status: string;
  installer: string;
  backoffice: string;
  q: string;
  quick: string;
  from: string;
  to: string;
};

export const callAlertStatuses: IsdinCallStatus[] = [
  "Incidencia en llamada",
  "Pospuesto en llamada",
  "Cancelado en llamada",
  "Requiere revisión operaciones"
];

export const CALLS_DO_NOT_GENERATE_PAYMENTS = "Los estados de llamada son preventivos y no generan pagos ni visitas fallidas.";

export function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

export function dateOnly(value?: string | null) {
  return value ? String(value).slice(0, 10) : "";
}

export function cap(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isdinWeekLabel(date: string) {
  if (!date) return "";
  const d = new Date(`${dateOnly(date)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const jsDay = d.getDay();
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diff);
  const month = cap(new Intl.DateTimeFormat("es-ES", { month: "long" }).format(d));
  return `Semana ${d.getDate()} ${month} ${d.getFullYear()}`;
}

export function cleanCallStatus(value?: string | null): IsdinCallStatus {
  return isdinCallStatuses.includes(value as IsdinCallStatus) ? value as IsdinCallStatus : "Pendiente de llamar";
}

export function callNeedsOperationsAlert(call?: Pick<IsdinCall, "call_status" | "requires_operations_review"> | null) {
  if (!call) return false;
  return Boolean(call.requires_operations_review) || callAlertStatuses.includes(cleanCallStatus(call.call_status));
}

export function callIsCompleted(status?: string | null) {
  return cleanCallStatus(status) !== "Pendiente de llamar";
}

export function callStatusGroup(status?: string | null, requiresReview?: boolean | null) {
  const clean = cleanCallStatus(status);
  if (clean === "Pendiente de llamar") return "Pendiente";
  if (clean === "Llamada realizada") return "Contactada";
  if (clean === "Confirmado") return "Confirmada";
  if (clean === "No contesta") return "Sin respuesta";
  if (requiresReview || callAlertStatuses.includes(clean)) return "Alerta";
  return "Contactada";
}

export function callBaseFromVinyl(v: IsdinVinylBase): Omit<IsdinCall, "id" | "call_status"> {
  return {
    vinyl_id: v.id,
    isdin_vinyl_id: v.id,
    vin: v.vinyl,
    pharmacy_name: v.pharmacy_name,
    vinyl_campaign: v.vinyl_campaign || null,
    desired_installation_week: v.desired_installation_week || null,
    desired_installation_date: dateOnly(v.desired_installation_date) || null,
    street: v.street || null,
    street_number: v.street_number || null,
    postal_code: v.postal_code || null,
    province: v.province || null,
    city: v.city || null,
    worker_name: v.installer_name || null,
    installer_name: v.installer_name || null,
    client_observations: v.client_observations || null,
    scaffold_required: Boolean(v.scaffold_required)
  };
}

export function mergeCallBase(existing: IsdinCall, vinyl: IsdinVinylBase): IsdinCall {
  return {
    ...existing,
    ...callBaseFromVinyl(vinyl),
    id: existing.id,
    call_status: cleanCallStatus(existing.call_status),
    call_datetime: existing.call_datetime || null,
    call_time_slot: existing.call_time_slot || null,
    contact_person: existing.contact_person || null,
    phone_number: existing.phone_number || null,
    call_comment: existing.call_comment || null,
    backoffice_user: existing.backoffice_user || null,
    next_visit_date: existing.next_visit_date || null,
    next_visit_week: existing.next_visit_week || null,
    requires_operations_review: Boolean(existing.requires_operations_review),
    updated_at: new Date().toISOString()
  };
}

export function newCallFromVinyl(vinyl: IsdinVinylBase): IsdinCall {
  const now = new Date().toISOString();
  return {
    id: uid(),
    ...callBaseFromVinyl(vinyl),
    call_status: "Pendiente de llamar",
    call_datetime: null,
    call_time_slot: null,
    contact_person: null,
    phone_number: null,
    call_comment: null,
    backoffice_user: null,
    next_visit_date: null,
    next_visit_week: null,
    requires_operations_review: false,
    created_at: now,
    updated_at: now
  };
}

export function mergeCallsWithVinyls(calls: IsdinCall[], vinyls: IsdinVinylBase[]) {
  const byVin = new Map(calls.map(c => [c.vin, c]));
  return vinyls.map(v => byVin.has(v.vinyl) ? mergeCallBase(byVin.get(v.vinyl) as IsdinCall, v) : newCallFromVinyl(v));
}

export function callForDb(call: IsdinCall) {
  return {
    ...call,
    call_status: cleanCallStatus(call.call_status),
    call_datetime: call.call_datetime || null,
    desired_installation_date: dateOnly(call.desired_installation_date) || null,
    next_visit_date: dateOnly(call.next_visit_date) || null,
    requires_operations_review: Boolean(call.requires_operations_review)
  };
}

export function applyCallPatch(call: IsdinCall, patch: Partial<IsdinCall>): IsdinCall {
  const nextDate = patch.next_visit_date !== undefined ? dateOnly(patch.next_visit_date) : dateOnly(call.next_visit_date);
  const callStatus = patch.call_status ? cleanCallStatus(patch.call_status) : cleanCallStatus(call.call_status);
  const requiresReview = patch.requires_operations_review !== undefined
    ? Boolean(patch.requires_operations_review)
    : callStatus === "Requiere revisión operaciones" || Boolean(call.requires_operations_review);

  return {
    ...call,
    ...patch,
    call_status: callStatus,
    call_datetime: patch.call_datetime !== undefined ? patch.call_datetime || null : call.call_datetime || null,
    next_visit_date: nextDate || null,
    next_visit_week: nextDate ? isdinWeekLabel(nextDate) : patch.next_visit_week !== undefined ? patch.next_visit_week || null : call.next_visit_week || null,
    requires_operations_review: requiresReview,
    updated_at: new Date().toISOString()
  };
}

export function getCallStats(rows: IsdinCall[]) {
  const total = rows.length;
  const pendientes = rows.filter(x => cleanCallStatus(x.call_status) === "Pendiente de llamar").length;
  const realizadas = rows.filter(x => callIsCompleted(x.call_status)).length;
  const confirmados = rows.filter(x => cleanCallStatus(x.call_status) === "Confirmado").length;
  const noContesta = rows.filter(x => cleanCallStatus(x.call_status) === "No contesta").length;
  const incidencias = rows.filter(x => cleanCallStatus(x.call_status) === "Incidencia en llamada").length;
  const pospuestos = rows.filter(x => cleanCallStatus(x.call_status) === "Pospuesto en llamada").length;
  const cancelados = rows.filter(x => cleanCallStatus(x.call_status) === "Cancelado en llamada").length;
  const revision = rows.filter(x => cleanCallStatus(x.call_status) === "Requiere revisión operaciones" || x.requires_operations_review).length;
  const alertas = rows.filter(callNeedsOperationsAlert).length;
  return {
    total,
    pendientes,
    realizadas,
    contactadas: realizadas,
    confirmados,
    noContesta,
    incidencias,
    pospuestos,
    cancelados,
    revision,
    alertas,
    completado: total ? Math.round((realizadas / total) * 100) : 0,
    confirmacion: realizadas ? Math.round((confirmados / realizadas) * 100) : 0,
    problemasPreventivos: total ? Math.round((alertas / total) * 100) : 0
  };
}

export function groupCallsBy(rows: IsdinCall[], key: (row: IsdinCall) => string) {
  const out = new Map<string, number>();
  rows.forEach(row => {
    const name = key(row) || "Sin dato";
    out.set(name, (out.get(name) || 0) + 1);
  });
  return Array.from(out.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

export function filterIsdinCalls(rows: IsdinCall[], filters: CallsFilters) {
  return rows.filter(call => {
    const status = cleanCallStatus(call.call_status);
    const callDate = dateOnly(call.call_datetime);
    const hay = [call.vin, call.pharmacy_name, call.vinyl_campaign, call.province, call.city, call.call_status, call.installer_name, call.worker_name, call.contact_person, call.phone_number, call.backoffice_user, call.call_comment].join(" ").toLowerCase();
    const quickOk = !filters.quick
      || (filters.quick === "pendientes" && status === "Pendiente de llamar")
      || (filters.quick === "no-contesta" && status === "No contesta")
      || (filters.quick === "confirmadas" && status === "Confirmado")
      || (filters.quick === "alertas" && callNeedsOperationsAlert(call));

    return (!filters.week || call.desired_installation_week === filters.week)
      && (!filters.province || call.province === filters.province)
      && (!filters.city || call.city === filters.city)
      && (!filters.status || status === filters.status)
      && (!filters.installer || call.installer_name === filters.installer || call.worker_name === filters.installer)
      && (!filters.backoffice || call.backoffice_user === filters.backoffice)
      && (!filters.q || hay.includes(filters.q.toLowerCase()))
      && quickOk
      && (!filters.from || callDate >= filters.from)
      && (!filters.to || callDate <= filters.to);
  });
}

export function buildCallSummary(call: IsdinCall) {
  return [
    `ISDIN Backoffice · ${call.vin}`,
    `Farmacia: ${call.pharmacy_name}`,
    `Estado llamada: ${call.call_status}`,
    `Semana instalación: ${call.desired_installation_week || "Sin semana"}`,
    call.next_visit_date ? `Nueva fecha propuesta: ${dateOnly(call.next_visit_date)} (${call.next_visit_week || isdinWeekLabel(call.next_visit_date)})` : "",
    call.contact_person ? `Contacto: ${call.contact_person}` : "",
    call.call_comment ? `Comentario: ${call.call_comment}` : "",
    call.requires_operations_review ? "Requiere revisión de operaciones" : ""
  ].filter(Boolean).join("\n");
}

export function loadLocalCalls(): IsdinCall[] {
  try {
    return JSON.parse(localStorage.getItem(isdinCallsLocalKey) || "[]");
  } catch {
    return [];
  }
}

export function saveLocalCalls(calls: IsdinCall[]) {
  localStorage.setItem(isdinCallsLocalKey, JSON.stringify(calls));
}

export function syncLocalCallsFromVinyls(vinyls: IsdinVinylBase[]) {
  const next = mergeCallsWithVinyls(loadLocalCalls(), vinyls);
  saveLocalCalls(next);
  return next;
}

export function csvEscape(value: unknown) {
  const s = String(value ?? "");
  return s.includes(";") || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob(["\ufeff" + rows.map(r => r.map(csvEscape).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function callStatusClass(status?: string | null) {
  const s = cleanCallStatus(status);
  if (s === "Pendiente de llamar") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (s === "Llamada realizada") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (s === "No contesta") return "bg-slate-100 text-slate-700 ring-slate-200";
  if (s === "Confirmado") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (s === "Incidencia en llamada") return "bg-red-50 text-red-800 ring-red-200";
  if (s === "Pospuesto en llamada") return "bg-orange-50 text-orange-800 ring-orange-200";
  if (s === "Cancelado en llamada") return "bg-zinc-100 text-zinc-800 ring-zinc-200";
  return "bg-violet-50 text-violet-800 ring-violet-200";
}
