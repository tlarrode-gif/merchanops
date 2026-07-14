import { supabase } from "@/lib/supabase";

// Feature 2: direcciones de envio reutilizables por trabajador. El gestor elige
// una de estas al preparar el envio de material de una gran campana; la elegida
// se vuelca a Logistica como destino (ver lib/campanas.ts y la RPC de volcado).

export type WorkerAddress = {
  id: string;
  worker_id: string;
  etiqueta?: string | null;
  direccion: string;
  poblacion?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  predeterminada?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkerAddressInput = Omit<WorkerAddress, "id" | "worker_id" | "created_at" | "updated_at">;

type Result<T> = { data: T; error?: string };

// Direccion en una sola linea (snapshot para logistica / destino de envio).
export function formatDireccionEnvio(a: Pick<WorkerAddress, "direccion" | "codigo_postal" | "poblacion" | "provincia">): string {
  return [a.direccion, [a.codigo_postal, a.poblacion].filter(Boolean).join(" "), a.provincia]
    .map(s => (s || "").trim())
    .filter(Boolean)
    .join(", ");
}

export async function listWorkerAddresses(workerId: string): Promise<Result<WorkerAddress[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("worker_addresses")
    .select("*")
    .eq("worker_id", workerId)
    .order("predeterminada", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as WorkerAddress[] };
}

export async function addWorkerAddress(workerId: string, input: WorkerAddressInput): Promise<Result<WorkerAddress | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const direccion = String(input.direccion || "").trim();
  if (!direccion) return { data: null, error: "La dirección no puede estar vacía." };
  if (input.predeterminada) await supabase.from("worker_addresses").update({ predeterminada: false }).eq("worker_id", workerId);
  const { data, error } = await supabase.from("worker_addresses").insert({
    worker_id: workerId,
    etiqueta: input.etiqueta || null,
    direccion,
    poblacion: input.poblacion || null,
    provincia: input.provincia || null,
    codigo_postal: input.codigo_postal || null,
    predeterminada: !!input.predeterminada
  }).select().single();
  if (error) return { data: null, error: error.message };
  return { data: data as WorkerAddress };
}

export async function updateWorkerAddress(id: string, workerId: string, patch: Partial<WorkerAddressInput>): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  if (patch.predeterminada) await supabase.from("worker_addresses").update({ predeterminada: false }).eq("worker_id", workerId);
  const { error } = await supabase.from("worker_addresses").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function deleteWorkerAddress(id: string): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("worker_addresses").delete().eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}
