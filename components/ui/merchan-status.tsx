export function MerchanStatusBadge({ status }: { status?: string | null }) {
  const label = status || "Pendiente asignar";
  const styles: Record<string, string> = {
    "Pendiente asignar": "bg-amber-50 text-amber-700 border-amber-200",
    "Asignado": "bg-blue-50 text-blue-700 border-blue-200",
    "Info enviada": "bg-sky-50 text-sky-700 border-sky-200",
    "Material pendiente": "bg-orange-50 text-orange-700 border-orange-200",
    "Material recibido": "bg-teal-50 text-teal-700 border-teal-200",
    "En ejecución": "bg-indigo-50 text-indigo-700 border-indigo-200",
    "Reportado": "bg-cyan-50 text-cyan-700 border-cyan-200",
    "Validado": "bg-green-50 text-green-700 border-green-200",
    "Incidencia": "bg-red-50 text-red-700 border-red-200",
    "Pagado": "bg-emerald-50 text-emerald-700 border-emerald-200"
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[label] || "bg-slate-50 text-slate-700 border-slate-200"}`}>{label}</span>;
}
