"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3, Bell, Building2, CalendarDays, ChevronDown, ClipboardList, CreditCard, FileText,
  History, KeyRound, LayoutGrid, Layers, LogOut, MapPin, Megaphone, Menu, Phone, RefreshCw,
  Search, ShieldCheck, Store, Truck, UserPlus, Users, WalletCards, X, type LucideIcon
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  AppSession, canAccessModule, canManageRrhh, ensureAuthSession, getCurrentAppSession, isAdminSession,
  logoutAppUser, merchanopsSessionChangeEvent, sessionProvinceLabel, sessionRoleLabel,
  type AppPermissionKey, type AppRole
} from "@/lib/access-control";
import { spanishProvinces } from "@/lib/provinces";
import {
  alertCounters, badgeValue, loadNavCounters, navCountersChangeEvent,
  type NavCounterKey, type NavCounters
} from "@/lib/shell/nav-counters";
import { getProvinceView, provinceViewChangeEvent, setProvinceView } from "@/lib/shell/province-view";
import { pageMeta } from "@/lib/shell/page-meta";
import {
  groupResults, searchDestinations, searchEntities, type SearchResult
} from "@/lib/shell/global-search";

// Navegación global de MerchanOps (auditoría, bloque 7): UNA sola sidebar con
// todas las secciones y una top bar con el nombre de la pantalla + usuario.
// Sustituye a la antigua barra superior de píldoras, al subnav de ISDIN y a los
// tabs del Home, que se duplicaban entre sí.
//
// El rediseño (agosto 2026) cambia SOLO la piel de este armazón: sidebar oscura
// con iconos y contadores, topbar con título en serif, buscador global y
// selector de provincia. Las reglas de visibilidad por rol, permiso y provincia,
// el enlace activo, el menú móvil, el cambio de contraseña y el cierre de sesión
// son exactamente los mismos de antes.

// hiddenForRoles: para perfiles que SOLO deben ver su módulo. El Panel no cuelga
// de ninguna clave de permiso, así que sin esto el perfil de RR.HH. vería en la
// sidebar una sección que no le corresponde.
type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  counter?: NavCounterKey;
  exact?: boolean;
  module?: AppPermissionKey;
  adminOnly?: boolean;
  rrhhManagerOnly?: boolean;
  hiddenForRoles?: AppRole[];
  tab?: string;
  /** Rutas que cuelgan de `href` pero tienen su propio enlace en la sidebar:
   *  sin esto se marcarían DOS enlaces activos a la vez. */
  excludePrefixes?: string[];
};
type NavGroup = { id: string; label: string | null; links: NavLink[] };

const groups: NavGroup[] = [
  {
    id: "principal", label: null, links: [
      { href: "/", label: "Panel", icon: LayoutGrid, exact: true, tab: "panel", hiddenForRoles: ["rrhh"] }
    ]
  },
  {
    id: "gestion", label: "Gestión", links: [
      { href: "/?tab=servicios", label: "Servicios", icon: ClipboardList, counter: "servicios", module: "servicios", tab: "servicios" },
      { href: "/?tab=calendario", label: "Calendario", icon: CalendarDays, module: "calendario", tab: "calendario" },
      { href: "/?tab=pagos", label: "Pagos", icon: CreditCard, module: "pagos", tab: "pagos" },
      { href: "/pagos/obligaciones", label: "Aprobación de pagos", icon: WalletCards, counter: "obligaciones", module: "pagos" },
      { href: "/grandes-campanas", label: "Grandes Campañas", icon: Megaphone, counter: "campanas", module: "servicios", excludePrefixes: ["/grandes-campanas/isdin", "/grandes-campanas/mi-zona"] },
      { href: "/grandes-campanas/mi-zona", label: "Mi zona", icon: MapPin, module: "servicios" }
    ]
  },
  {
    id: "isdin", label: "ISDIN", links: [
      { href: "/grandes-campanas/isdin", label: "Vinilos", icon: Layers, counter: "vinilos", exact: true, module: "isdin" },
      { href: "/grandes-campanas/isdin/llamadas", label: "Llamadas", icon: Phone, counter: "llamadas", module: "isdin" },
      { href: "/grandes-campanas/isdin/dashboard", label: "Dashboard KPIs", icon: BarChart3, module: "isdin" },
      { href: "/grandes-campanas/isdin/facturacion", label: "Facturación", icon: FileText, module: "isdin", adminOnly: true }
    ]
  },
  {
    id: "operativa", label: "Operativa", links: [
      { href: "/logistica", label: "Logística", icon: Truck, counter: "logistica", module: "logistica" },
      { href: "/historial-economico", label: "Historial económico", icon: History, module: "pagos" }
    ]
  },
  {
    id: "rrhh", label: "RRHH", links: [
      { href: "/rrhh/altas", label: "Altas laborales", icon: UserPlus, counter: "rrhhAltas", module: "rrhh" },
      { href: "/rrhh/accesos", label: "Accesos a centro", icon: KeyRound, counter: "rrhhAccesos", module: "rrhh" },
      { href: "/rrhh/cadenas", label: "Cadenas y centros", icon: Building2, module: "rrhh", rrhhManagerOnly: true }
    ]
  },
  {
    id: "catalogos", label: "Catálogos", links: [
      { href: "/?tab=clientes", label: "Clientes", icon: Store, adminOnly: true, tab: "clientes" },
      { href: "/?tab=trabajadores", label: "Trabajadores", icon: Users, module: "servicios", tab: "trabajadores" }
    ]
  },
  {
    id: "config", label: "Configuración", links: [
      { href: "/?tab=usuarios", label: "Usuarios y permisos", icon: ShieldCheck, adminOnly: true, tab: "usuarios" },
      { href: "/configuracion/sincronizacion", label: "Sincronización", icon: RefreshCw, counter: "sincronizacion", adminOnly: true },
      { href: "/configuracion/avisos", label: "Avisos del sistema", icon: Bell, adminOnly: true }
    ]
  }
];

/**
 * Pantallas que NO se remontan al cambiar de provincia.
 *
 * Remontar es lo que hace que una lista vuelva a pedir sus datos con el nuevo
 * alcance, pero se lleva por delante el estado local. Aquí no compensa:
 *
 *  · formularios de alta y edición, asignación e informes: hay trabajo escrito
 *    sin guardar;
 *  · RR.HH.: su ámbito es nacional, no se filtra por provincia, y en «Altas
 *    laborales» se pierde toda la selección de trabajos marcados —que puede ser
 *    de decenas de filas— sin filtrar nada a cambio;
 *  · Logística: los datos son de almacén, tampoco dependen de la provincia;
 *  · Configuración: es global.
 */
function keepsLocalState(pathname: string, tab: string) {
  if (pathname === "/") return tab.startsWith("nuevo-");
  if (/^\/(rrhh|logistica|configuracion)(\/|$)/.test(pathname)) return true;
  return /\/(nueva|editar|asignacion|informe)$/.test(pathname);
}

/** Iniciales para el avatar: «Laura Méndez» -> «LM». */
function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // La navegación es client-side (next/link), así que la pestaña activa NO se
  // puede leer una sola vez de window.location: al ir de ?tab=servicios a
  // ?tab=pagos el pathname no cambia y el enlace activo se quedaba congelado.
  // useSearchParams sí reacciona al cambio de query.
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "panel";
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [counters, setCounters] = useState<NavCounters>({});
  const [province, setProvince] = useState("");

  useEffect(() => {
    const syncSession = () => setSession(getCurrentAppSession());
    syncSession();
    setReady(true);
    // C1: si la sesión local no tiene detrás una sesión real de Supabase Auth
    // (caducada o anterior a la migración), se cierra y se vuelve al login.
    void ensureAuthSession().then(ok => { if (!ok) syncSession(); });
    window.addEventListener(merchanopsSessionChangeEvent, syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener(merchanopsSessionChangeEvent, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, currentTab]);

  // La provincia elegida vive en localStorage (lib/shell/province-view) para
  // sobrevivir al refresco; aquí solo se refleja en el estado de React.
  useEffect(() => {
    const sync = () => setProvince(getProvinceView());
    sync();
    window.addEventListener(provinceViewChangeEvent, sync);
    return () => window.removeEventListener(provinceViewChangeEvent, sync);
  }, []);

  // Contadores de la sidebar. Se recargan al cambiar de sección, al cambiar la
  // provincia y cuando una pantalla avisa de que ha mutado algo
  // (refreshNavCounters()). Cada carga son consultas `head` de solo recuento.
  useEffect(() => {
    if (!session?.active) { setCounters({}); return; }
    let alive = true;
    const load = () => { void loadNavCounters(session).then(next => { if (alive) setCounters(next); }); };
    load();
    window.addEventListener(navCountersChangeEvent, load);
    return () => { alive = false; window.removeEventListener(navCountersChangeEvent, load); };
  }, [session, pathname, province]);

  const meta = useMemo(() => pageMeta(pathname, currentTab, counters), [pathname, currentTab, counters]);

  // Sin sesión (o durante la hidratación) no hay navegación: la home muestra el
  // login. Se mantiene `mo-app` para que el login herede el sistema visual.
  if (!ready || !session?.active) return <div className="mo-app mo-app--bare">{children}</div>;

  const admin = isAdminSession(session);
  const canSee = (link: NavLink) =>
    (!link.module || canAccessModule(session, link.module))
    && (!link.adminOnly || admin)
    && (!link.rrhhManagerOnly || canManageRrhh(session))
    && !(link.hiddenForRoles || []).includes(session.role);
  const visibleGroups = groups.map(group => ({ ...group, links: group.links.filter(canSee) })).filter(group => group.links.length);

  function isActive(link: NavLink) {
    if (link.tab) return pathname === "/" && currentTab === link.tab;
    if (link.exact) return pathname === link.href;
    if ((link.excludePrefixes || []).some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
    return pathname === link.href || pathname.startsWith(`${link.href}/`);
  }

  function toggleGroup(id: string) {
    setCollapsed(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function signOut() {
    logoutAppUser();
    window.location.href = "/";
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center">
        <Link href="/" className="mo-sidebar__brand">
          <span className="mo-sidebar__mark" aria-hidden>M</span>
          <span className="min-w-0">
            <span className="mo-sidebar__name">MerchanOps</span>
            <span className="mo-sidebar__tagline">Trade marketing</span>
          </span>
        </Link>
        <button className="mo-sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú">
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="mo-sidebar__nav mo-scroll-dark">
        {visibleGroups.map(group => {
          const isCollapsed = group.label ? collapsed.includes(group.id) : false;
          const groupActive = group.links.some(isActive);
          return (
            <div key={group.id} className="mo-sidebar__group">
              {group.label && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="mo-sidebar__group-label"
                  aria-expanded={!isCollapsed}
                >
                  {group.label}
                  <ChevronDown className={`mo-sidebar__group-chevron ${isCollapsed ? "mo-sidebar__group-chevron--collapsed" : ""}`} />
                </button>
              )}
              {(!isCollapsed || groupActive) && (
                <div className="mo-sidebar__links">
                  {group.links.filter(link => !isCollapsed || isActive(link)).map(link => {
                    const active = isActive(link);
                    const Icon = link.icon;
                    const badge = badgeValue(counters, link.counter);
                    const isAlert = link.counter ? alertCounters.includes(link.counter) : false;
                    return (
                      <Link
                        key={link.href + link.label}
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={`mo-sidebar__link ${active ? "mo-sidebar__link--active" : ""}`}
                      >
                        <Icon className="mo-sidebar__link-icon" />
                        <span className="mo-sidebar__link-label">{link.label}</span>
                        {badge !== null && (
                          <span className={`mo-sidebar__badge ${isAlert ? "mo-sidebar__badge--alert" : ""}`}>{badge}</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mo-sidebar__footer">
        <div className="mo-sidebar__user">
          <span className="mo-sidebar__avatar" aria-hidden>{initials(session.display_name)}</span>
          <span className="mo-sidebar__user-text">
            <span className="mo-sidebar__user-name" title={session.display_name}>{session.display_name}</span>
            <span className="mo-sidebar__user-role" title={`${sessionRoleLabel(session)} · ${sessionProvinceLabel(session)}`}>
              {sessionRoleLabel(session)}
            </span>
          </span>
          <button onClick={() => setShowPassword(true)} className="mo-sidebar__icon-btn" title="Cambiar contraseña" aria-label="Cambiar contraseña">
            <KeyRound className="h-4 w-4" />
          </button>
          <button onClick={signOut} className="mo-sidebar__icon-btn" title="Salir" aria-label="Salir">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mo-app">
      {/* Sidebar escritorio */}
      <aside className="mo-sidebar mo-sidebar--desktop">{sidebar}</aside>
      {/* Sidebar móvil */}
      {mobileOpen && (
        <div className="mo-sidebar__scrim lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="mo-sidebar mo-sidebar--mobile" onClick={event => event.stopPropagation()}>{sidebar}</aside>
        </div>
      )}

      <div className="mo-app__main">
        <header className="mo-topbar">
          <button className="mo-topbar__menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menú">
            <Menu className="h-4 w-4" />
          </button>
          <div className="mo-topbar__heading">
            <h1 className="mo-topbar__title">{meta.title}</h1>
            {meta.subtitle && <span className="mo-topbar__subtitle">{meta.subtitle}</span>}
          </div>
          <div className="mo-topbar__spacer" />
          <div className="mo-topbar__actions">
            <GlobalSearch session={session} onNavigate={href => router.push(href)} />
            <ProvinceSelector session={session} value={province} onChange={setProvinceView} />
          </div>
        </header>

        {/*
          Al cambiar de provincia hay que volver a pedir los datos: si no, la
          pantalla se queda enseñando el alcance anterior. La forma de forzarlo
          sin tocar las 40 pantallas es remontar el subárbol con una clave.

          Pero remontar tira el estado local, y en un formulario a medio
          rellenar eso es perder trabajo escrito. Así que en las pantallas de
          alta y edición la clave se congela: ahí el filtro de provincia no
          aporta nada —se está trabajando sobre UNA entidad concreta— y el
          riesgo de perder lo tecleado sí es real.
        */}
        <div className="mo-app__content" key={keepsLocalState(pathname, currentTab) ? "view:estable" : `view:${province}`}>
          <Breadcrumbs pathname={pathname} />
          {children}
        </div>
      </div>

      {showPassword && <PasswordModal onClose={() => setShowPassword(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Migas de pan                                                            */
/* ---------------------------------------------------------------------- */

// Etiquetas de la ruta. El título de la pantalla lo pone ahora la topbar, así
// que la miga solo aparece cuando hay más de un nivel y sirve para VOLVER: a
// diferencia de la versión anterior, cada tramo es un enlace real.
const crumbLabels: Record<string, string> = {
  "grandes-campanas": "Grandes Campañas",
  isdin: "ISDIN · Vinilos",
  llamadas: "Llamadas",
  dashboard: "Dashboard KPIs",
  facturacion: "Facturación",
  nueva: "Nueva campaña",
  editar: "Editar",
  asignacion: "Asignación rápida",
  informe: "Informe",
  "mi-zona": "Mi zona",
  logistica: "Logística",
  solicitudes: "Solicitudes",
  pagos: "Pagos",
  obligaciones: "Aprobación de pagos",
  "historial-economico": "Historial económico",
  "auditoria-pagos": "Historial económico",
  configuracion: "Configuración",
  avisos: "Avisos del sistema",
  sincronizacion: "Sincronización",
  rrhh: "RRHH",
  altas: "Altas laborales",
  accesos: "Accesos a centro",
  cadenas: "Cadenas y centros"
};

function crumbFor(segment: string) {
  if (crumbLabels[segment]) return crumbLabels[segment];
  // UUIDs y otros ids dinámicos.
  if (/^[0-9a-f-]{16,}$/i.test(segment)) return "Detalle";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

// Tramos que no son una pantalla propia: «/configuracion» y «/rrhh» no existen
// como página, así que se muestran sin enlace para no llevar a un 404.
const nonRoutableSegments = new Set(["configuracion", "rrhh", "pagos"]);

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return (
    <nav className="mo-breadcrumbs" aria-label="Ruta">
      <Link href="/">Inicio</Link>
      {segments.map((segment, index) => {
        const href = `/${segments.slice(0, index + 1).join("/")}`;
        const last = index === segments.length - 1;
        const label = crumbFor(segment);
        return (
          <span key={href} className="flex items-center gap-1">
            <span className="mo-breadcrumbs__sep" aria-hidden>/</span>
            {last || nonRoutableSegments.has(segment)
              ? <span className={last ? "mo-breadcrumbs__current" : undefined}>{label}</span>
              : <Link href={href}>{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}

/* ---------------------------------------------------------------------- */
/* Buscador global                                                         */
/* ---------------------------------------------------------------------- */

const resultIcons: Record<SearchResult["icon"], LucideIcon> = {
  panel: LayoutGrid,
  campana: Megaphone,
  punto: MapPin,
  servicio: ClipboardList,
  vinilo: Layers,
  persona: Users,
  cliente: Store
};

function GlobalSearch({ session, onNavigate }: { session: AppSession; onNavigate: (href: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K abre el buscador desde cualquier pantalla.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  // Consulta con retardo: los destinos de navegación se resuelven al instante
  // (son una lista en memoria) y las entidades esperan a que se deje de teclear.
  useEffect(() => {
    const local = searchDestinations(query, session);
    setResults(local);
    setHighlight(0);
    const term = query.trim();
    if (term.length < 2) { setBusy(false); return; }
    setBusy(true);
    let alive = true;
    const timer = setTimeout(() => {
      void searchEntities(term, session)
        .then(remote => { if (alive) setResults([...local, ...remote]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, session]);

  const groupedResults = useMemo(() => groupResults(results), [results]);
  const flat = useMemo(() => groupedResults.flatMap(entry => entry.items), [groupedResults]);

  const go = useCallback((result: SearchResult) => {
    setOpen(false);
    setQuery("");
    onNavigate(result.href);
  }, [onNavigate]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlight(h => Math.min(h + 1, flat.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (event.key === "Enter" && flat[highlight]) { event.preventDefault(); go(flat[highlight]); }
  }

  const term = query.trim();

  return (
    <div className="mo-search" ref={boxRef}>
      <Search className="mo-search__icon" aria-hidden />
      <input
        ref={inputRef}
        className="mo-search__input"
        value={query}
        onChange={event => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Buscar campaña, punto, instalador…"
        aria-label="Buscador global"
      />
      <span className="mo-search__kbd" aria-hidden>⌘K</span>

      {open && term.length > 0 && (
        <div className="mo-search__panel" role="listbox">
          {groupedResults.map(entry => (
            <div key={entry.group}>
              <div className="mo-search__group-label">{entry.group}</div>
              {entry.items.map(item => {
                const index = flat.indexOf(item);
                const Icon = resultIcons[item.icon];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    className={`mo-search__result ${index === highlight ? "mo-search__result--active" : ""}`}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => go(item)}
                  >
                    <Icon className="mo-search__result-icon" aria-hidden />
                    <span className="mo-search__result-text">
                      <span className="mo-search__result-title">{item.title}</span>
                      {item.subtitle && <span className="mo-search__result-sub">{item.subtitle}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!flat.length && (
            <p className="mo-search__hint">
              {busy ? "Buscando…" : term.length < 2 ? "Escribe al menos dos letras." : `Sin resultados para «${term}».`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Selector de provincia                                                   */
/* ---------------------------------------------------------------------- */

function ProvinceSelector({ session, value, onChange }: { session: AppSession; value: string; onChange: (province: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Un gestor solo puede mirar dentro de SUS provincias: el selector nunca
  // ofrece más alcance del que la sesión ya tiene.
  const options = useMemo(
    () => (isAdminSession(session) ? [...spanishProvinces] : [...(session.provinces || [])]).sort((a, b) => a.localeCompare(b, "es")),
    [session]
  );

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  // Con una sola provincia asignada no hay nada que elegir: se muestra como
  // etiqueta y no como desplegable.
  if (options.length <= 1) {
    return (
      <span className="mo-province">
        <span className="mo-province__button" style={{ cursor: "default" }} title={sessionProvinceLabel(session)}>
          <MapPin className="mo-province__icon" aria-hidden />
          <span className="mo-province__label">{sessionProvinceLabel(session)}</span>
        </span>
      </span>
    );
  }

  // Para un admin «todas» son las 52 provincias; para un gestor son las suyas.
  const allLabel = isAdminSession(session) ? "Todas las provincias" : "Todas mis provincias";

  const visible = filter.trim()
    ? options.filter(p => p.toLowerCase().includes(filter.trim().toLowerCase()))
    : options;

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setFilter("");
  }

  return (
    <div className="mo-province" ref={boxRef}>
      <button
        type="button"
        className={`mo-province__button ${value ? "mo-province__button--filtered" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title={value ? `Viendo solo ${value}` : allLabel}
      >
        <MapPin className="mo-province__icon" aria-hidden />
        <span className="mo-province__label">{value || allLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
      </button>

      {open && (
        <div className="mo-province__panel">
          <div className="mo-province__search">
            <input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder="Filtrar provincia…"
              aria-label="Filtrar provincia"
              autoFocus
            />
          </div>
          <button type="button" className={`mo-province__option ${!value ? "mo-province__option--active" : ""}`} onClick={() => choose("")}>
            {allLabel}
          </button>
          {visible.map(option => (
            <button
              key={option}
              type="button"
              className={`mo-province__option ${value === option ? "mo-province__option--active" : ""}`}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
          {!visible.length && <p className="mo-search__hint">Sin coincidencias.</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Cambio de contraseña                                                    */
/* ---------------------------------------------------------------------- */

/**
 * Cambio de contraseña en autoservicio (v9_4): pide la contraseña actual y la
 * verifica EN EL SERVIDOR (rpc merchan_change_own_password), que actualiza el
 * hash de app_users y el de Supabase Auth en la misma transacción.
 */
function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next.length < 8) return setError("La contraseña nueva debe tener al menos 8 caracteres.");
    if (next !== repeat) return setError("Las contraseñas nuevas no coinciden.");
    if (!supabase) return setError("No disponible en modo local.");
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("merchan_change_own_password", { p_current: current, p_new: next });
    setBusy(false);
    if (rpcError) return setError(`No se pudo cambiar: ${rpcError.message}`);
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (result.error || !result.ok) return setError(result.error || "No se pudo cambiar la contraseña.");
    setDone(true);
  }

  return (
    <div className="mo-modal-scrim" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="mo-modal space-y-3">
        <h2 className="mo-modal__title">Cambiar mi contraseña</h2>
        {done ? (
          <>
            <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">Contraseña cambiada. Úsala en el próximo inicio de sesión (también en MerchanLOGS).</p>
            <button type="button" onClick={onClose} className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Cerrar</button>
          </>
        ) : (
          <>
            {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <label className="block text-sm"><span className="font-medium">Contraseña actual</span>
              <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className="mt-1 w-full rounded-2xl border px-3 py-2" /></label>
            <label className="block text-sm"><span className="font-medium">Contraseña nueva (mín. 8)</span>
              <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className="mt-1 w-full rounded-2xl border px-3 py-2" /></label>
            <label className="block text-sm"><span className="font-medium">Repite la contraseña nueva</span>
              <input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} className="mt-1 w-full rounded-2xl border px-3 py-2" /></label>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="w-full rounded-2xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button disabled={busy} className="w-full rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Cambiando..." : "Cambiar"}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
