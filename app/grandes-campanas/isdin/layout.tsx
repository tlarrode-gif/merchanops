export default function IsdinSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="border-b bg-slate-50">
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-4 py-3 text-sm">
          <a className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-100" href="/grandes-campanas/isdin">ISDIN · Vinilos</a>
          <a className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-100" href="/grandes-campanas/isdin/dashboard">Dashboard KPIs ISDIN</a>
          <a className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-100" href="/grandes-campanas/isdin/facturacion">Facturación ISDIN</a>
        </nav>
      </div>
      {children}
    </>
  );
}
