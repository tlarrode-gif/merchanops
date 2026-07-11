/**
 * Escenario 15 de la auditoría (modo degradado) + retirada C2: el guardado en
 * bloque de logística ya NO existe. saveLogisticsState lanza SIEMPRE un error
 * claro — jamás acepta la operación en silencio ni reescribe tablas en bloque.
 * Las escrituras logísticas van por comandos RPC (v8_2/v8_7) o MerchanLOGS.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("guardado en bloque retirado (C2)", () => {
  it("con Supabase configurado, saveLogisticsState lanza error de retirada", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    vi.resetModules();
    const { saveLogisticsState } = await import("@/lib/logistics-store");
    const { seedLogistics } = await import("@/lib/logistics");
    await expect(saveLogisticsState(seedLogistics(), true)).rejects.toThrow(/retirado|NO se ha guardado/i);
  });

  it("también sin Supabase (ninguna ruta puede volver a escribir en bloque)", async () => {
    vi.resetModules();
    const { saveLogisticsState } = await import("@/lib/logistics-store");
    const { seedLogistics } = await import("@/lib/logistics");
    await expect(saveLogisticsState(seedLogistics(), false)).rejects.toThrow(/retirado/i);
  });
});
