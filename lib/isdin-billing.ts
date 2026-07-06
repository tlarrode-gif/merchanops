// Lógica pura de facturación ISDIN, extraída de la página de facturación para
// poder reutilizarla en el Historial económico (eventos facturacion_cliente).
// Cualquier cambio en las reglas de facturación debe hacerse aquí, no en las páginas.

export type IsdinVinylBilling = {
  id: string;
  pharmacy_name: string;
  vinyl: string;
  status?: string | null;
  vinyl_record_type?: string | null;
  vinyl_campaign?: string | null;
  province?: string | null;
  city?: string | null;
  street?: string | null;
  street_number?: string | null;
  postal_code?: string | null;
  payment_week?: string | null;
  desired_installation_week?: string | null;
  incident_payment_week?: string | null;
  installation_payment_week?: string | null;
  incident_payment_date?: string | null;
  installation_payment_date?: string | null;
  incident_opened_at?: string | null;
  incident_resolved_at?: string | null;
  status_changed_at?: string | null;
  billing_last_status_date?: string | null;
  billing_extra_equipment?: number | null;
  billing_type_override?: string | null;
  comments?: string | null;
  client_observations?: string | null;
  scaffold_required?: boolean | null;
  revisit_count?: number | null;
};

export type IsdinBillingSettings = { id: string; standard_rate: number; custom_rate: number };

export type IsdinBillingAdjustment = { id: string; concept: string; amount: number; billing_week?: string | null; billing_date?: string | null };

export type IsdinBillingLine = {
  week: string;
  date: string;
  vin: string;
  farmacia: string;
  camp: string;
  tipo: string;
  estado: string;
  concept: string;
  dir: string;
  city: string;
  prov: string;
  tarifa: number;
  extra: number;
  total: number;
  obs: string;
  clientObs: string;
  andamio: string;
  revisitas: number;
  row: IsdinVinylBilling;
};

export const ISDIN_CLIENT = "ISDIN";
export const ISDIN_CECO = "3159";

function d(x?: string | null) { return x ? String(x).slice(0, 10) : ""; }

export function isdinVinylType(v: IsdinVinylBilling) {
  const r = String(v.billing_type_override || v.vinyl_record_type || "").toLowerCase();
  if (r.includes("medida")) return "Vinilo a medida";
  if (r.includes("standard") || r.includes("estandar") || r.includes("estándar")) return "Vinilo standard";
  return "Sin clasificar";
}

function tarifa(v: IsdinVinylBilling, s: IsdinBillingSettings) {
  const t = isdinVinylType(v);
  return t === "Vinilo a medida" ? Number(s.custom_rate || 0) : t === "Vinilo standard" ? Number(s.standard_rate || 0) : 0;
}

export function isdinVinylAddress(v: IsdinVinylBilling) {
  return [v.street, v.street_number, v.postal_code, v.city, v.province].filter(Boolean).join(", ");
}
const adr = isdinVinylAddress;

function fdate(v: IsdinVinylBilling) {
  return d(v.billing_last_status_date || v.status_changed_at || v.installation_payment_date || v.incident_payment_date || v.incident_opened_at);
}

function mk(v: IsdinVinylBilling, s: IsdinBillingSettings, concept: string, amount: number, week?: string | null, date?: string | null, extra = 0): IsdinBillingLine {
  return {
    week: week || v.payment_week || v.desired_installation_week || "Sin semana",
    date: d(date) || fdate(v),
    vin: v.vinyl,
    farmacia: v.pharmacy_name,
    camp: v.vinyl_campaign || "",
    tipo: isdinVinylType(v),
    estado: v.status || "Nuevo",
    concept,
    dir: adr(v),
    city: v.city || "",
    prov: v.province || "",
    tarifa: amount,
    extra,
    total: amount + extra,
    obs: v.comments || "",
    clientObs: v.client_observations || "",
    andamio: v.scaffold_required ? "Sí" : "No",
    revisitas: Number(v.revisit_count || 0),
    row: v
  };
}

// Líneas de facturación de un vinilo según su estado (mismas reglas que la
// página ISDIN · Facturación desde v3.8.1).
export function isdinBillingLines(v: IsdinVinylBilling, s: IsdinBillingSettings): IsdinBillingLine[] {
  const st = v.status || "Nuevo";
  const base = tarifa(v, s);
  const ex = Number(v.billing_extra_equipment || 0);
  const iw = v.incident_payment_week || v.payment_week || v.desired_installation_week || "Sin semana";
  const fw = v.installation_payment_week || v.payment_week || v.desired_installation_week || "Sin semana";
  const rv = Math.max(0, Number(v.revisit_count || 0));
  let out: IsdinBillingLine[] = [];
  if (st === "Nuevo" || st === "Incidencia llamada") return [];
  if (st === "Cancelado") {
    if (v.incident_payment_week) out = [mk(v, s, "Visita facturable previa a cancelación", base, iw, v.incident_payment_date || v.incident_opened_at, ex), mk(v, s, "Cambio de estado a cancelado", 0, v.payment_week || v.desired_installation_week || iw, v.billing_last_status_date || v.status_changed_at, 0)];
    else out = [mk(v, s, "Cancelación sin visita facturable", 0, iw, v.billing_last_status_date || v.status_changed_at, 0)];
    return out;
  }
  if (st === "Incidencia") out = [mk(v, s, "Visita facturable - incidencia", base, iw, v.incident_payment_date || v.incident_opened_at, ex)];
  else if (st === "Resuelto - Pendiente colocador") out = [mk(v, s, "Visita facturable - pospuesto", base, iw, v.incident_payment_date || v.status_changed_at, ex)];
  else if (st === "Finalizado" && v.incident_payment_week) out = [mk(v, s, "Visita facturable - incidencia/pospuesto inicial", base, iw, v.incident_payment_date || v.incident_opened_at, 0), mk(v, s, "Instalación facturable - resolución", base, fw, v.installation_payment_date || v.incident_resolved_at || v.status_changed_at, ex)];
  else if (st === "Finalizado") out = [mk(v, s, "Instalación facturable", base, fw, v.installation_payment_date || v.status_changed_at, ex)];
  const extras = Math.max(0, rv - out.filter(x => x.tarifa > 0).length);
  for (let i = 0; i < extras; i++) out.push(mk(v, s, `Revisita adicional ${out.filter(x => x.tarifa > 0).length + 1}`, base, fw, v.billing_last_status_date || v.status_changed_at, 0));
  return out;
}
