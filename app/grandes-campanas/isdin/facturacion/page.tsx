"use client";
import {useEffect,useMemo,useState} from "react";
import {isSupabaseConfigured,supabase} from "@/lib/supabase";
import {canAccessModule,canViewFinancials,filterBySessionProvince,getCurrentAppSession} from "@/lib/access-control";

// La lógica de facturación (tipos, tarifas y líneas por estado) vive en lib/isdin-billing.ts
// para compartirla con el Historial económico.
import {ISDIN_CECO,ISDIN_CLIENT,isdinBillingLines,isdinVinylAddress,isdinVinylType,type IsdinBillingAdjustment,type IsdinBillingSettings,type IsdinVinylBilling} from "@/lib/isdin-billing";
type V=IsdinVinylBilling;
type S=IsdinBillingSettings;
type A=IsdinBillingAdjustment;
const CLIENT=ISDIN_CLIENT,CECO=ISDIN_CECO,localKey="merchanops_isdin_local_v381",legacyLocalKey="merchanops_isdin_local_v373",setKey="merchanops_isdin_billing_settings_v1",adjKey="merchanops_isdin_billing_adjustments_v1";
const typ=isdinVinylType,adr=isdinVinylAddress,lines=isdinBillingLines;
function euro(n:number){return new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n||0))+" €"}
function d(x?:string|null){return x?String(x).slice(0,10):""}
function localDate(){const x=new Date();return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`}
function cm(){return localDate().slice(0,7)}
function today(){return localDate()}
function csvq(x:any){return `"${String(x??"").replace(/"/g,'""')}"`}
function download(rows:any[][]){const b=new Blob(["\ufeff"+rows.map(r=>r.map(csvq).join(";")).join("\n")],{type:"text/csv;charset=utf-8;"});const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="facturacion_isdin.csv";a.click();URL.revokeObjectURL(u)}
function localItems(){try{return JSON.parse(localStorage.getItem(localKey)||localStorage.getItem(legacyLocalKey)||"[]")}catch{return[]}}
function localSet(){try{return JSON.parse(localStorage.getItem(setKey)||"")}catch{return{id:"global",standard_rate:0,custom_rate:0}}}
function localAdj(){try{return JSON.parse(localStorage.getItem(adjKey)||"[]")}catch{return[]}}
// A7 (auditoría de pagos): toda escritura financiera comprueba el resultado real de
// Supabase antes de anunciar éxito; los fallos revierten la pantalla y se muestran en
// rojo. Las regularizaciones nunca se borran físicamente: se anulan con motivo
// (irreversible, auditado por triggers de la migración v8_5).
export default function Page(){
const[items,setItems]=useState<V[]>([]),[s,setS]=useState<S>({id:"global",standard_rate:0,custom_rate:0}),[adjs,setAdjs]=useState<A[]>([]),[adj,setAdj]=useState({concept:"",amount:"",billing_week:"",billing_date:today()}),[msg,setMsg]=useState<{text:string;kind:"ok"|"error"}|null>(null),[flt,setFlt]=useState({month:cm(),from:"",to:"",week:"",province:"",status:"",q:""}),[vinSearch,setVinSearch]=useState("");
function flash(text:string,kind:"ok"|"error"="ok"){setMsg({text,kind});if(kind==="ok")setTimeout(()=>setMsg(null),1800)}
function actor(){return getCurrentAppSession()?.username??null}
async function load(){
  if(isSupabaseConfigured&&supabase){
    const[v,st,a]=await Promise.all([
      supabase.from("isdin_vinyls").select("*"),
      supabase.from("isdin_billing_settings").select("*").eq("id","global").maybeSingle(),
      supabase.from("isdin_billing_adjustments").select("*").order("created_at",{ascending:false})
    ]);
    const errs=[v.error,st.error,a.error].filter(Boolean)as{message:string}[];
    if(errs.length)return flash(`Error cargando la facturación: ${errs.map(e=>e.message).join(" · ")}. No se muestran datos parciales.`,"error");
    setItems((v.data||[])as V[]);setS((st.data as S)||{id:"global",standard_rate:0,custom_rate:0});setAdjs((a.data||[])as A[]);
  }else{setItems(localItems());setS(localSet());setAdjs(localAdj())}
}
useEffect(()=>{load()},[]);
async function save(){
  const n={id:"global",standard_rate:Number(s.standard_rate),custom_rate:Number(s.custom_rate)};
  if(!Number.isFinite(n.standard_rate)||!Number.isFinite(n.custom_rate)||n.standard_rate<0||n.custom_rate<0)return flash("Tarifas inválidas: deben ser números mayores o iguales que 0. NO se ha guardado nada.","error");
  if(supabase){
    const{data,error}=await supabase.from("isdin_billing_settings").upsert({...n,updated_at:new Date().toISOString(),updated_by:actor()}).select().single();
    if(error||!data)return flash(`NO se han guardado las tarifas: ${error?.message||"sin confirmación del servidor"}.`,"error");
    setS(data as S);
  }else{localStorage.setItem(setKey,JSON.stringify(n));setS(n)}
  flash("Tarifas guardadas");
}
async function up(v:V,p:Partial<V>){
  // Actualización optimista SOLO para no cortar el tecleo; si el servidor no
  // confirma, se revierte la fila y se avisa en rojo (nunca éxito silencioso).
  const prev=items;
  const nextItems=items.map(x=>x.id===v.id?{...x,...p}:x);
  setItems(nextItems);
  if(supabase){
    const{data,error}=await supabase.from("isdin_vinyls").update(p).eq("id",v.id).select("id").maybeSingle();
    if(error||!data){setItems(prev);flash(`NO se ha guardado el cambio del VIN ${v.vinyl||v.id}: ${error?.message||"registro no encontrado"}. Se ha revertido en pantalla.`,"error")}
  }else localStorage.setItem(localKey,JSON.stringify(nextItems));
}
async function addAdj(){
  const amount=parseFloat(String(adj.amount).replace(",","."));
  if(!adj.concept.trim())return flash("Falta el concepto. NO se ha creado la regularización.","error");
  if(!Number.isFinite(amount)||amount===0)return flash("Importe inválido: debe ser un número distinto de 0. NO se ha creado la regularización.","error");
  const row={concept:adj.concept.trim(),amount,billing_week:adj.billing_week||null,billing_date:adj.billing_date||today(),created_by:actor()};
  if(supabase){
    const{data,error}=await supabase.from("isdin_billing_adjustments").insert(row).select().single();
    if(error||!data)return flash(`NO se ha creado la regularización: ${error?.message||"sin confirmación del servidor"}.`,"error");
    setAdjs(a=>[data as A,...a]);
  }else{const n={id:String(Date.now()),...row}as A;const next=[n,...adjs];setAdjs(next);localStorage.setItem(adjKey,JSON.stringify(next))}
  setAdj({concept:"",amount:"",billing_week:"",billing_date:today()});
  flash("Regularización creada");
}
async function annulAdj(a:A){
  if(a.annulled_at)return;
  const reason=window.prompt(`Anular la regularización "${a.concept}" (${euro(Number(a.amount||0))}).\nNo se borra: queda anulada con tu motivo, auditada y fuera de totales y exports.\n\nMotivo de la anulación (obligatorio):`);
  if(reason===null)return;
  if(!reason.trim())return flash("La anulación requiere un motivo. NO se ha anulado.","error");
  const patch={annulled_at:new Date().toISOString(),annulled_by:actor(),annul_reason:reason.trim()};
  if(supabase){
    const{data,error}=await supabase.from("isdin_billing_adjustments").update(patch).eq("id",a.id).is("annulled_at",null).select().single();
    if(error||!data)return flash(`NO se ha anulado la regularización: ${error?.message||"ya estaba anulada o no existe"}.`,"error");
    setAdjs(x=>x.map(y=>y.id===a.id?(data as A):y));
  }else{const next=adjs.map(y=>y.id===a.id?{...y,...patch}:y);setAdjs(next);localStorage.setItem(adjKey,JSON.stringify(next))}
  flash("Regularización anulada");
}
const visibleItems=useMemo(()=>{const session=getCurrentAppSession();return canAccessModule(session,"isdin")?filterBySessionProvince(items,session):[]},[items]);const all=useMemo(()=>visibleItems.flatMap(v=>lines(v,s)),[visibleItems,s]);const weeks=Array.from(new Set([...all.map(x=>x.week),...adjs.map(a=>a.billing_week)].filter(Boolean))) as string[],provs=Array.from(new Set(visibleItems.map(x=>x.province).filter(Boolean)))as string[],stats=Array.from(new Set(visibleItems.map(x=>x.status||"Nuevo")));const baseItems=visibleItems.filter(v=>{const h=[v.pharmacy_name,v.vinyl,v.vinyl_campaign,v.vinyl_record_type,v.status,v.city,v.province,v.comments,v.client_observations,adr(v)].join(" ").toLowerCase();return(!flt.province||v.province===flt.province)&&(!flt.status||(v.status||"Nuevo")===flt.status)&&(!flt.q||h.includes(flt.q.toLowerCase()))});const out=baseItems.flatMap(v=>lines(v,s)).filter(l=>(!flt.week||l.week===flt.week)&&(!flt.month||d(l.date).slice(0,7)===flt.month)&&(!flt.from||d(l.date)>=flt.from)&&(!flt.to||d(l.date)<=flt.to));const adjOut=adjs.filter(a=>(!flt.week||a.billing_week===flt.week)&&(!flt.month||d(a.billing_date).slice(0,7)===flt.month)&&(!flt.from||d(a.billing_date)>=flt.from)&&(!flt.to||d(a.billing_date)<=flt.to));const adjActive=adjOut.filter(a=>!a.annulled_at);const vinIds=new Set(out.map(l=>l.row.id));const vinFiltrados=visibleItems.filter(v=>vinIds.has(v.id));const editItems=vinSearch.trim()?visibleItems.filter(v=>String(v.vinyl||"").toLowerCase().includes(vinSearch.toLowerCase().trim())):[];const total=out.reduce((a,x)=>a+x.total,0)+adjActive.reduce((a,x)=>a+Number(x.amount||0),0);const pospuestos=visibleItems.filter(v=>v.status==="Resuelto - Pendiente colocador").length;function exp(){download([["Cliente","CECO","Semana facturación","Fecha estado","VIN","Farmacia","Campaña","Tipo vinilo","Estado","Concepto","Dirección","Ciudad","Provincia","Tarifa","Extra maquinaria/andamio","Total","Observaciones internas","Observaciones ISDIN","Andamio","Revisitas"],...out.map(l=>[CLIENT,CECO,l.week,l.date,l.vin,l.farmacia,l.camp,l.tipo,l.estado,l.concept,l.dir,l.city,l.prov,l.tarifa,l.extra,l.total,l.obs,l.clientObs,l.andamio,l.revisitas]),...adjActive.map(a=>[CLIENT,CECO,a.billing_week||"Regularización",d(a.billing_date),"","","","","Regularización",a.concept,"","","",Number(a.amount||0),0,Number(a.amount||0),"","","",""])])}
// La facturación al cliente es información sensible: bloqueada también por URL directa.
const sessionActual=getCurrentAppSession();
if(!sessionActual?.active)return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto mt-10 max-w-2xl rounded-3xl border bg-white p-5 shadow-sm"><b>Inicia sesión</b> para acceder a MerchanOps.</section></main>;
if(!canViewFinancials(sessionActual))return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto mt-10 max-w-2xl rounded-3xl border bg-white p-5 shadow-sm">La <b>facturación al cliente</b> solo está disponible para administración. <a className="underline" href="/grandes-campanas/isdin">Volver a ISDIN</a>.</section></main>;
return <main className="isdin-page min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-7xl space-y-4"><h1 className="text-3xl font-bold">ISDIN · Facturación</h1>{msg&&<div className={msg.kind==="error"?"rounded-xl border border-red-200 bg-red-50 p-3 font-semibold text-red-700":"rounded-xl bg-emerald-50 p-3"}>{msg.text}</div>}<div className="rounded-3xl border bg-white p-5"><div className="grid gap-3 md:grid-cols-4"><Inp label="Tarifa standard" type="number" value={s.standard_rate} onChange={(v:string)=>setS({...s,standard_rate:Number(v)})}/><Inp label="Tarifa a medida" type="number" value={s.custom_rate} onChange={(v:string)=>setS({...s,custom_rate:Number(v)})}/><button onClick={save} className="self-end rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar tarifas</button><button onClick={exp} className="self-end rounded-2xl border bg-white px-4 py-2">Exportar CSV</button></div></div><div className="grid gap-3 md:grid-cols-5"><K label="Líneas facturables" v={out.length}/><K label="Regularizaciones" v={adjActive.length}/><K label="Total facturación" v={euro(total)}/><K label="VIN filtrados" v={vinFiltrados.length}/><K label="Vinilos pospuestos" v={pospuestos}/></div><div className="rounded-3xl border bg-white p-5"><div className="grid gap-2 md:grid-cols-4 lg:grid-cols-7"><Inp label="Mes" type="month" value={flt.month} onChange={(v:string)=>setFlt({...flt,month:v})}/><Inp label="Desde" type="date" value={flt.from} onChange={(v:string)=>setFlt({...flt,from:v})}/><Inp label="Hasta" type="date" value={flt.to} onChange={(v:string)=>setFlt({...flt,to:v})}/><Sel label="Semana" value={flt.week} onChange={(v:string)=>setFlt({...flt,week:v})} options={["",...weeks]}/><Sel label="Provincia" value={flt.province} onChange={(v:string)=>setFlt({...flt,province:v})} options={["",...provs]}/><Sel label="Estado" value={flt.status} onChange={(v:string)=>setFlt({...flt,status:v})} options={["",...stats]}/><Inp label="Buscar" value={flt.q} onChange={(v:string)=>setFlt({...flt,q:v})}/></div></div><div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-xl font-semibold">Regularización</h2><div className="grid gap-2 md:grid-cols-5"><Inp label="Concepto" value={adj.concept} onChange={(v:string)=>setAdj({...adj,concept:v})}/><Inp label="Importe +/-" type="number" value={adj.amount} onChange={(v:string)=>setAdj({...adj,amount:v})}/><Inp label="Fecha" type="date" value={adj.billing_date} onChange={(v:string)=>setAdj({...adj,billing_date:v})}/><Inp label="Semana" value={adj.billing_week} onChange={(v:string)=>setAdj({...adj,billing_week:v})}/><button onClick={addAdj} className="self-end rounded-2xl bg-slate-900 px-4 py-2 text-white">Añadir</button></div>{adjs.length>0&&<table className="mt-3 w-full text-sm"><tbody>{adjOut.map(a=><tr key={a.id} className={`border-t ${a.annulled_at?"text-slate-400":""}`}><td className={`p-2 ${a.annulled_at?"line-through":""}`}>{a.concept}</td><td className="p-2">{a.billing_week}</td><td className="p-2">{d(a.billing_date)}</td><td className={`p-2 text-right font-semibold ${a.annulled_at?"line-through":""}`}>{euro(Number(a.amount||0))}</td><td className="p-2 text-right">{a.annulled_at?<span className="inline-block max-w-xs truncate rounded-xl bg-red-50 px-2 py-1 text-xs text-red-600" title={`Anulada el ${d(a.annulled_at)}${a.annulled_by?` por ${a.annulled_by}`:""}. Motivo: ${a.annul_reason||"—"}`}>Anulada · {a.annul_reason}</span>:<button onClick={()=>annulAdj(a)} className="rounded-xl border px-3 py-1 text-red-600" title="No se borra: queda anulada con motivo y auditada">Anular</button>}</td></tr>)}</tbody></table>}</div><div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-xl font-semibold">Editar por código VIN</h2><div className="mb-3 max-w-md"><Inp label="Buscar VIN para editar" value={vinSearch} onChange={setVinSearch}/></div>{!vinSearch.trim()?<p className="text-sm text-slate-500">Escribe un VIN para modificar tipo, extra, observaciones, andamio o revisitas.</p>:<div className="overflow-auto"><table className="w-full min-w-[1400px] text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">VIN</th><th>Farmacia</th><th>Estado</th><th>Tipo</th><th>Extra</th><th>Fecha</th><th>Andamio</th><th>Revisitas</th><th>Observaciones ISDIN</th></tr></thead><tbody>{editItems.map(v=><tr key={v.id} className="border-t"><td className="p-2 font-mono text-xs">{v.vinyl}</td><td className="p-2">{v.pharmacy_name}</td><td className="p-2">{v.status}</td><td className="p-2"><select className="rounded-xl border p-1" value={v.billing_type_override||""} onChange={e=>up(v,{billing_type_override:e.target.value||null})}><option value="">Auto: {typ(v)}</option><option value="Vinilo standard">Vinilo standard</option><option value="Vinilo a medida">Vinilo a medida</option></select></td><td className="p-2"><input type="number" className="w-24 rounded-xl border p-1 text-right" value={Number(v.billing_extra_equipment||0)} onChange={e=>up(v,{billing_extra_equipment:Number(e.target.value)})}/></td><td className="p-2"><input type="date" className="rounded-xl border p-1" value={d(v.billing_last_status_date)} onChange={e=>up(v,{billing_last_status_date:e.target.value})}/></td><td className="p-2 text-center"><input type="checkbox" checked={!!v.scaffold_required} onChange={e=>up(v,{scaffold_required:e.target.checked})}/></td><td className="p-2"><input type="number" className="w-20 rounded-xl border p-1 text-right" value={Number(v.revisit_count||0)} onChange={e=>up(v,{revisit_count:Number(e.target.value)})}/></td><td className="p-2"><input className="w-72 rounded-xl border p-1" value={v.client_observations||""} onChange={e=>up(v,{client_observations:e.target.value})}/></td></tr>)}</tbody></table></div>}</div><div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-xl font-semibold">Líneas de facturación filtradas</h2><div className="overflow-auto"><table className="w-full min-w-[1500px] text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">Semana</th><th>Fecha</th><th>VIN</th><th>Farmacia</th><th>Campaña</th><th>Tipo</th><th>Estado</th><th>Concepto</th><th>Provincia</th><th className="text-right">Tarifa</th><th className="text-right">Extra</th><th className="text-right">Total</th><th>Andamio</th><th>Revisitas</th></tr></thead><tbody>{out.map((r,i)=><tr key={i} className="border-t"><td className="p-2">{r.week}</td><td>{r.date}</td><td className="font-mono text-xs">{r.vin}</td><td>{r.farmacia}</td><td>{r.camp}</td><td>{r.tipo}</td><td>{r.estado}</td><td>{r.concept}</td><td>{r.prov}</td><td className="text-right">{euro(r.tarifa)}</td><td className="text-right">{euro(r.extra)}</td><td className="text-right font-semibold">{euro(r.total)}</td><td>{r.andamio}</td><td>{r.revisitas}</td></tr>)}{adjActive.map(a=><tr key={a.id} className="border-t bg-amber-50"><td className="p-2">{a.billing_week||"Regularización"}</td><td>{d(a.billing_date)}</td><td></td><td>Regularización</td><td></td><td></td><td></td><td>{a.concept}</td><td></td><td className="text-right">{euro(Number(a.amount||0))}</td><td></td><td className="text-right font-semibold">{euro(Number(a.amount||0))}</td><td></td><td></td></tr>)}</tbody></table></div></div></section></main>}
function K({label,v}:{label:string;v:any}){return <div className="rounded-3xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{v}</p></div>}
function Inp({label,value,onChange,type="text"}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><input type={type} value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2"/></label>}
function Sel({label,value,onChange,options}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o:string)=><option key={o} value={o}>{o||"Todos"}</option>)}</select></label>}
