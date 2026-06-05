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
  return Boolean(call.requires_operations_review) || [
    "Incidencia en llamada",
    "Pospuesto en llamada",
    "Cancelado en llamada",
    "Requiere revisión operaciones"
  ].includes(call.call_status);
}

export function callIsCompleted(status?: string | null) {
  return cleanCallStatus(status) !== "Pendiente de llamar";
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
