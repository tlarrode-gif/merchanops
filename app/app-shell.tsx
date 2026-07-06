"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, Menu, X } from "lucide-react";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession, logoutAppUser, merchanopsSessionChangeEvent, sessionProvinceLabel, type AppPermissionKey } from "@/lib/access-control";

// Navegación global de MerchanOps (auditoría, bloque 7): UNA sola sidebar con
// todas las secciones y una top bar con breadcrumb + usuario. Sustituye a la
// antigua barra superior de píldoras, al subnav de ISDIN y a los tabs del Home,
// que se duplicaban entre sí.

type NavLink = { href: string; label: string; exact?: boolean; module?: AppPermissionKey; adminOnly?: boolean; tab?: string; excludePrefix?: string };
type NavGroup = { id: string; label: string | null; links: NavLink[] };

const groups: NavGroup[] = [
  {
    id: "principal", label: null, links: [
      { href: "/", label: "Panel", exact: true, tab: "panel" }
    ]
  },
  {
    id: "gestion", label: "Gestión", links: [
      { href: "/?tab=servicios", label: "Servicios", module: "servicios", tab: "servicios" },
      { href: "/?tab=calendario", label: "Calendario", module: "calendario", tab: "calendario" },
      { href: "/?tab=pagos", label: "Pagos", module: "pagos", tab: "pagos" },
      { href: "/grandes-campanas", label: "Grandes Campañas", module: "servicios", excludePrefix: "/grandes-campanas/isdin" }
    ]
  },
  {
    id: "isdin", label: "ISDIN", links: [
      { href: "/grandes-campanas/isdin", label: "Vinilos", exact: true, module: "isdin" },
      { href: "/grandes-campanas/isdin/llamadas", label: "Llamadas", module: "isdin" },
      { href: "/grandes-campanas/isdin/dashboard", label: "Dashboard KPIs", module: "isdin" },
      { href: "/grandes-campanas/isdin/facturacion", label: "Facturación", module: "isdin", adminOnly: true }
    ]
  },
  {
    id: "operativa", label: "Operativa", links: [
      { href: "/logistica", label: "Logística", module: "logistica" },
      { href: "/historial-economico", label: "Historial económico", module: "pagos" }
    ]
  },
  {
    id: "catalogos", label: "Catálogos", links: [
      { href: "/?tab=clientes", label: "Clientes", adminOnly: true, tab: "clientes" },
      { href: "/?tab=trabajadores", label: "Trabajadores", module: "servicios", tab: "trabajadores" }
    ]
  },
  {
    id: "config", label: "Configuración", links: [
      { href: "/?tab=usuarios", label: "Usuarios y permisos", adminOnly: true, tab: "usuarios" },
      { href: "/configuracion/sincronizacion", label: "Sincronización", adminOnly: true }
    ]
  }
];

// Etiquetas para el breadcrumb de la top bar.
const crumbLabels: Record<string, string> = {
  "grandes-campanas": "Grandes Campañas",
  isdin: "ISDIN · Vinilos",
  llamadas: "Llamadas",
  dashboard: "Dashboard KPIs",
  facturacion: "Facturación",
  nueva: "Nueva campaña",
  editar: "Editar",
  asignacion: "Asignación rápida",
  logistica: "Logística",
  solicitudes: "Solicitudes",
  "historial-economico": "Historial económico",
  "auditoria-pagos": "Historial económico",
  configuracion: "Configuración",
  sincronizacion: "Sincronización"
};
const homeTabLabels: Record<string, string> = { panel: "Panel", servicios: "Servicios", calendario: "Calendario", pagos: "Pagos", clientes: "Clientes", trabajadores: "Trabajadores", usuarios: "Usuarios y permisos", "nuevo-servicio": "Nuevo servicio", "nuevo-cliente": "Nuevo cliente", "nuevo-trabajador": "Nuevo trabajador" };

function crumbFor(segment: string) {
  if (crumbLabels[segment]) return crumbLabels[segment];
  // UUIDs y otros ids dinámicos.
  if (/^[0-9a-f-]{16,}$/i.test(segment)) return "Detalle";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState("panel");
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    const syncSession = () => setSession(getCurrentAppSession());
    syncSession();
    setReady(true);
    window.addEventListener(merchanopsSessionChangeEvent, syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener(merchanopsSessionChangeEvent, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
    if (typeof window !== "undefined") setCurrentTab(new URLSearchParams(window.location.search).get("tab") || "panel");
  }, [pathname]);

  // Sin sesión (o durante la hidratación) no hay navegación: la home muestra el login.
  if (!ready || !session?.active) return <>{children}</>;

  const admin = isAdminSession(session);
  const canSee = (link: NavLink) => (!link.module || canAccessModule(session, link.module)) && (!link.adminOnly || admin);
  const visibleGroups = groups.map(group => ({ ...group, links: group.links.filter(canSee) })).filter(group => group.links.length);

  function isActive(link: NavLink) {
    if (link.tab) return pathname === "/" && currentTab === link.tab;
    if (link.exact) return pathname === link.href;
    if (link.excludePrefix && pathname.startsWith(link.excludePrefix)) return false;
    return pathname === link.href || pathname.startsWith(`${link.href}/`);
  }

  function toggleGroup(id: string) {
    setCollapsed(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function signOut() {
    logoutAppUser();
    window.location.href = "/";
  }

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = pathname === "/"
    ? ["Inicio", ...(currentTab !== "panel" && homeTabLabels[currentTab] ? [homeTabLabels[currentTab]] : [])]
    : ["Inicio", ...segments.map(crumbFor)];

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-4">
        <a href="/" className="text-lg font-extrabold tracking-tight">Merchan<span className="text-slate-400">Ops</span></a>
        <button className="rounded-xl border p-1.5 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X className="h-4 w-4" /></button>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {visibleGroups.map(group => {
          const isCollapsed = group.label ? collapsed.includes(group.id) : false;
          const groupActive = group.links.some(isActive);
          return (
            <div key={group.id}>
              {group.label && (
                <button onClick={() => toggleGroup(group.id)} className="mb-1 flex w-full items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
                  {group.label}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                </button>
              )}
              {(!isCollapsed || groupActive) && (
                <div className="space-y-0.5">
                  {group.links.filter(link => !isCollapsed || isActive(link)).map(link => {
                    const active = isActive(link);
                    return (
                      <a
                        key={link.href + link.label}
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-xl px-3 py-2 text-sm font-medium ${active ? "bg-slate-900 text-white shadow-sm shadow-slate-900/10" : "text-slate-700 hover:bg-slate-100"}`}
                      >
                        {link.label}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t px-4 py-3">
        <p className="truncate text-sm font-semibold">{session.display_name}</p>
        <p className="truncate text-xs text-slate-500">{admin ? "Administración" : "Gestor"} · {sessionProvinceLabel(session)}</p>
        <button onClick={signOut} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border bg-white px-3 py-1.5 text-sm hover:bg-slate-50"><LogOut className="h-4 w-4" />Salir</button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar escritorio */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-white lg:block">{sidebar}</aside>
      {/* Sidebar móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r bg-white shadow-2xl">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <button className="rounded-xl border p-1.5 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu className="h-4 w-4" /></button>
              <nav className="truncate text-sm text-slate-500">
                {crumbs.map((crumb, index) => (
                  <span key={index}>
                    {index > 0 && <span className="mx-1.5 text-slate-300">/</span>}
                    <span className={index === crumbs.length - 1 ? "font-semibold text-slate-900" : ""}>{crumb}</span>
                  </span>
                ))}
              </nav>
            </div>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{session.display_name} · {admin ? "Administración" : "Gestor"} · {sessionProvinceLabel(session)}</p>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
