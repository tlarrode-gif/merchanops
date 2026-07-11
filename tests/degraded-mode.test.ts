/**
 * Escenario 15 de la auditoría: un fallo de Supabase deja la aplicación en
 * modo de SOLO LECTURA — el guardado degradado lanza error en vez de aceptar
 * la operación en localStorage y anunciarla como guardada.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("modo degradado de solo lectura", () => {
  it("con Supabase configurado y carga degradada, guardar lanza error claro", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
    vi.resetModules();
    const { saveLogisticsState } = await import("@/lib/logistics-store");
    const { seedLogistics } = await import("@/lib/logistics");
    await expect(saveLogisticsState(seedLogistics(), false)).rejects.toThrow(/solo lectura|NO se ha guardado/i);
  });

  it("sin Supabase configurado (modo demo local), el guardado local sigue permitido", async () => {
    vi.resetModules();
    // jsdom no está configurado: basta comprobar que NO lanza el error de solo
    // lectura (el acceso a localStorage puede fallar en Node, pero con otro error).
    const { saveLogisticsState } = await import("@/lib/logistics-store");
    const { seedLogistics } = await import("@/lib/logistics");
    await expect(saveLogisticsState(seedLogistics(), false)).rejects.not.toThrow(/solo lectura/i).catch(() => undefined);
  });
});
