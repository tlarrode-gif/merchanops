"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Copy, CreditCard, Edit3, FileDown, MessageCircle, Package, Plus, Trash2, Users, X } from "lucide-react";
import { MoActionList, MoActionRow, MoBadge, MoBars, MoCard, MoColumns, MoDonut, MoEmpty, MoKpi, MoKpiGrid, MoLegend, statusTone, type MoTone } from "@/components/ui/mo";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppPermissionKey, AppSession, AppUser, adminPermissions, canAccessModule, defaultPermissions, ensureAuthSession, filterBySessionProvince, getCurrentAppSession, isAdminSession, loadInternalUsers, loginAppUser, normalizeUser, saveCurrentAppSession, saveInternalUsers, userCanSeeProvince } from "@/lib/access-control";
import { provinceOptions, provinceScopeValues } from "@/lib/provinces";
import { WorkerAddress, listWorkerAddresses, addWorkerAddress, updateWorkerAddress, deleteWorkerAddress, formatDireccionEnvio } from "@/lib/direcciones-envio";

type Client={id:string;name:string;ceco?:string|null;notes?:string|null};
type Worker={id:string;name:string;phone?:string|null;email?:string|null;province?:string|null;capacity?:number|null;active_hours?:number|null;skills?:string|null};
type Point={id:string;service_id?:string|null;name:string;address?:string|null;province?:string|null;fee:number;report_code?:string|null;notes?:string|null;status?:string|null;point_status?:string|null;point_comment?:string|null;original_fee?:number|null;incident_fee?:number|null;incident_status?:string|null;incident_comment?:string|null;incident_opened_at?:string|null;incident_resolved_at?:string|null;incident_next_action?:string|null;incident_due_date?:string|null};
type Service={id:string;client_id?:string|null;client:string;ceco?:string|null;campaign:string;province?:string|null;created_by_user_id?:string|null;created_by_user_name?:string|null;start_date?:string|null;deadline?:string|null;priority?:string|null;service_type?:string|null;reporting_channel?:string|null;worker_id?:string|null;worker_name?:string|null;status?:string|null;material_status?:string|null;logistics_status?:string|null;logistics_request_id?:string|null;tracking?:string|null;default_point_fee?:number|null;estimated_hours?:number|null;instructions?:string|null;communication_sent_at?:string|null;validated_at?:string|null;incident_note?:string|null;resolved_at?:string|null;payment_type?:string|null;hourly_rate?:number|null;hours_worked?:number|null;calendar_color?:string|null;points?:Point[]};

type Data={clients:Client[];workers:Worker[];services:Service[]};
import { FAILED_VISIT_FEE_EUR as INCIDENT_FEE } from "@/lib/payments/constants";
import { pointPayEur, serviceTotalsEur } from "@/lib/payments/display";
const localKey="merchanops_local_v362";
const provinces=["Asturias","Huesca","Teruel","Zaragoza","Alicante","Castellón","Valencia","Lleida","Sevilla","Córdoba","Jaén","Almería"];
const serviceStatuses=["Pendiente asignar","Asignado","Info enviada","Material pendiente","Material recibido","En ejecución","Reportado","Validado","Incidencia","Pagado"];
const pointStatuses=["Pendiente","Revisado","Reportado","Incidencia","Pospuesto","Finalizado","Pendiente recepción post-incidencia"];
const payableFailedPointStatuses=["Incidencia","Pospuesto"];
const paymentTypes=["Puntos","Horas","Mixto"];
const calendarColors:any={slate:{label:"Gris",bg:"#0f172a"},blue:{label:"Azul",bg:"#2563eb"},sky:{label:"Celeste",bg:"#0284c7"},violet:{label:"Violeta",bg:"#7c3aed"},pink:{label:"Rosa",bg:"#db2777"},orange:{label:"Naranja",bg:"#ea580c"},green:{label:"Verde",bg:"#16a34a"},amber:{label:"Ámbar",bg:"#d97706"},red:{label:"Rojo",bg:"#dc2626"},teal:{label:"Turquesa",bg:"#0d9488"}};
function uid(){return typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random())}
function todayISO(){return new Date().toISOString()}
function dateOnly(v?:string|null){return v?String(v).slice(0,10):""}
function eur(v:number){return new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0))+" €"}
function pct(n:number,d:number){return d?Math.round((n/d)*100):0}
function monthStart(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`}
function monthEnd(){const d=new Date(),last=new Date(d.getFullYear(),d.getMonth()+1,0);return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`}
function isValidated(s:Service){return s.status==="Validado"||s.status==="Pagado"}
function isOverdue(s:Service){return !!(s.deadline&&!isValidated(s)&&new Date(s.deadline+"T23:59:59").getTime()<Date.now())}
function onTime(s:Service){return !!(s.validated_at&&s.deadline&&dateOnly(s.validated_at)<=dateOnly(s.deadline))}
function olderValidated(s:Service){return !!(s.validated_at&&Date.now()-new Date(dateOnly(s.validated_at)+"T00:00:00").getTime()>10*86400000)}
function pStatus(p:Point){return p.point_status||p.status||"Pendiente"}
function isPayableFailedStatus(status:string){return payableFailedPointStatuses.includes(status)}
function isPostIncidentPending(p:Point){return pStatus(p)==="Pendiente recepción post-incidencia"}
function isIncActive(p:Point){return isPayableFailedStatus(pStatus(p))&&p.incident_status!=="Resuelta"&&!p.incident_resolved_at}
function isIncResolved(p:Point){return p.incident_status==="Resuelta"||!!p.incident_resolved_at}
function pOriginal(p:Point){return Number(p.original_fee??p.fee??0)}
// M-03: el importe de un punto y los totales de un servicio salen del motor
// único (céntimos enteros, bloqueo explícito) en vez de recalcularse aquí en
// coma flotante convirtiendo los datos ausentes en 0 silencioso.
function pPay(p:Point){return pointPayEur(p)}
function pointTotal(s:Service){return serviceTotalsEur(s,s.points||[]).pointsEur}
function allowedProvinceOptions(session:AppSession|null|undefined){return isAdminSession(session)?provinceOptions:(session?.provinces?.length?session.provinces:[])}
function hourTotal(s:Service){return serviceTotalsEur(s,s.points||[]).hoursEur}
function serviceTotal(s:Service){return serviceTotalsEur(s,s.points||[]).totalEur}
/** true si algún importe del servicio falta o es inválido: el motor lo bloquearía. */
function hasAmountIssue(s:Service){return serviceTotalsEur(s,s.points||[]).amountIssue}
function colorFor(s:Service){return calendarColors[s.calendar_color||"slate"]||calendarColors.slate}
function loadLocal():Data{try{return JSON.parse(localStorage.getItem(localKey)||"")}catch{return{clients:[],workers:[],services:[]}}}
function csvEscape(v:any){const s=String(v??"");return s.includes(";")||s.includes("\n")||s.includes('"')?`"${s.replace(/"/g,'""')}"`:s}
function downloadCSV(name:string,rows:any[][]){const b=new Blob(["\ufeff"+rows.map(r=>r.map(csvEscape).join(";")).join("\n")],{type:"text/csv;charset=utf-8;"});const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
function parsePointsText(text:string,defaultFee=0):Point[]{return text.split("\n").map(l=>l.trim()).filter(Boolean).map(line=>{const[name,address,fee,code,...notes]=line.split(";");const parsedFee=Number(fee||defaultFee||0);return{id:uid(),name:name||"Punto sin nombre",address:address||"",fee:Number.isFinite(parsedFee)?parsedFee:0,report_code:code||"",notes:notes.join(";")||"",point_status:"Pendiente",incident_fee:INCIDENT_FEE}})}
function buildWhatsApp(s:Service){const list=(s.points||[]).map((p,i)=>`${i+1}. ${p.name} — ${p.address||"Dirección pendiente"}${p.report_code?` — Código: ${p.report_code}`:""}`).join("\n");return `*${s.client.toUpperCase()} – ${s.campaign}*\n\nTienes asignado este servicio en *${s.province||"zona pendiente"}*.\n\n*Total a pagar:* ${eur(serviceTotal(s))}\n*Tipo de pago:* ${s.payment_type||"Puntos"}\n*Total de puntos:* ${(s.points||[]).length}\n*Fecha inicio:* ${s.start_date||"Pendiente"}\n*Fecha límite:* ${s.deadline||"Pendiente"}\n*Reporte:* ${s.reporting_channel||"WhatsApp"}\n\n*Puntos a visitar:*\n${list}\n\n*Indicaciones:*\n${s.instructions||"Revisar briefing y reportar al finalizar."}\n\nConfirma recepción del servicio y avisa si hay incidencias.`}
function delayMessage(s:Service){return `Hola ${s.worker_name||""}, te recuerdo que el servicio *${s.client} – ${s.campaign}* sigue pendiente. La fecha límite era *${s.deadline||"sin fecha"}*. Por favor, actualiza el estado/reporting o indícanos si hay alguna incidencia. Gracias.`}
function activePointIncidents(services:Service[]){return services.flatMap(service=>(service.points||[]).filter(isIncActive).map(point=>({service,point})))}
function sortedServices(list:Service[]){return[...list].sort((a,b)=>{const av=isValidated(a)?1:0,bv=isValidated(b)?1:0;if(av!==bv)return av-bv;return(a.deadline||"9999-12-31").localeCompare(b.deadline||"9999-12-31")})}
function groupSum<T>(items:T[],key:(x:T)=>string,val:(x:T)=>number){const o:any={};items.forEach(x=>{const k=key(x)||"Sin dato";o[k]=(o[k]||0)+val(x)});return Object.entries(o).sort((a:any,b:any)=>b[1]-a[1]) as [string,number][]}
function moneyData(x:[string,number][]) {return x.map(([label,value])=>({label,value,displayValue:eur(value)}))}

// useSearchParams() obliga a un límite de Suspense en el App Router: sin él,
// `next build` falla al prerenderizar esta ruta.
export default function Page(){return <Suspense fallback={<main className="min-h-screen bg-slate-100"/>}><Home/></Suspense>}

function Home(){const searchParams=useSearchParams(),urlTab=searchParams.get("tab")||"panel";const[tab,setTab]=useState(urlTab),[clients,setClients]=useState<Client[]>([]),[workers,setWorkers]=useState<Worker[]>([]),[services,setServices]=useState<Service[]>([]),[users,setUsers]=useState<AppUser[]>([]),[session,setSession]=useState<AppSession|null>(()=>typeof window!=="undefined"?getCurrentAppSession():null),[notice,setNotice]=useState(""),[loading,setLoading]=useState(true),[editingClient,setEditingClient]=useState<Client|null>(null),[editingWorker,setEditingWorker]=useState<Worker|null>(null),[editingService,setEditingService]=useState<Service|null>(null),[editingUser,setEditingUser]=useState<AppUser|null>(null);
async function refresh(scopeSession?:AppSession|null){setLoading(true);const scope=scopeSession??session??getCurrentAppSession();if(isSupabaseConfigured&&supabase){if(!scope?.active){setClients([]);setWorkers([]);setServices([]);setLoading(false);return}const scopedProvinces=!isAdminSession(scope)?provinceScopeValues(scope.provinces||[]):[];let workerQuery=supabase.from("workers").select("*").order("name");if(scopedProvinces.length)workerQuery=workerQuery.in("province",scopedProvinces);let serviceQuery=supabase.from("services").select("*").order("created_at",{ascending:false});if(scopedProvinces.length)serviceQuery=serviceQuery.in("province",scopedProvinces);const[{data:c},{data:w},{data:s}]=await Promise.all([supabase.from("clients").select("*").order("name"),workerQuery,serviceQuery]);const loadedServices=(s||[])as Service[],serviceIds=loadedServices.map(x=>x.id).filter(Boolean);let pts:Point[]=[];if(serviceIds.length){const{data:p}=await supabase.from("points").select("*").in("service_id",serviceIds);pts=(p||[])as Point[]}setClients((c||[])as Client[]);setWorkers((w||[])as Worker[]);setServices(loadedServices.map(x=>({...x,points:pts.filter(p=>p.service_id===x.id)})))}else{const l=loadLocal();setClients(l.clients);setWorkers(isAdminSession(scope)?l.workers:l.workers.filter(w=>userCanSeeProvince(scope,w.province)));setServices(filterBySessionProvince(l.services,scope))}setLoading(false)}
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(()=>{ensureAuthSession().then(ok=>{if(!ok)setSession(null)});loadInternalUsers().then(setUsers);refresh(session)},[]);
// La sidebar navega con next/link: al cambiar solo la query (?tab=) no hay
// recarga de página, así que la pestaña activa se sincroniza desde la URL.
// setTab sigue existiendo para las transiciones locales (botones "Nuevo ...").
useEffect(()=>{setTab(urlTab)},[urlTab]);useEffect(()=>{if(!isSupabaseConfigured)localStorage.setItem(localKey,JSON.stringify({clients,workers,services}))},[clients,workers,services]);function saved(t="Guardado"){setNotice(t);setTimeout(()=>setNotice(""),1200)}function patchServiceLocal(id:string,patch:Partial<Service>){setServices(prev=>prev.map(s=>s.id===id?{...s,...patch}:s))}function patchPointLocal(id:string,patch:Partial<Point>){setServices(prev=>prev.map(s=>({...s,points:(s.points||[]).map(p=>p.id===id?{...p,...patch}:p)})))}
async function addClient(c:Omit<Client,"id">){const clean={...c,name:String(c.name||"").trim()};if(!clean.name)return saved("Falta nombre de cliente");if(supabase){const{data,error}=await supabase.from("clients").insert(clean).select().single();if(error)return saved(error.message);if(data)setClients(p=>[data as Client,...p])}else setClients(p=>[{id:uid(),...clean},...p]);saved("Cliente creado")}
async function updateClient(c:Client){const prev=clients;setClients(p=>p.map(x=>x.id===c.id?c:x));setEditingClient(null);if(supabase){const{error}=await supabase.from("clients").update({name:c.name,ceco:c.ceco,notes:c.notes}).eq("id",c.id);if(error){setClients(prev);return saved(`ERROR: el cliente NO se ha guardado: ${error.message}`)}}saved("Cliente actualizado")}
async function delClient(c:Client){if(!confirm(`¿Borrar cliente ${c.name}?`))return;const prev=clients;setClients(p=>p.filter(x=>x.id!==c.id));if(supabase){const{error}=await supabase.from("clients").delete().eq("id",c.id);if(error){setClients(prev);return saved(`ERROR: el cliente NO se ha borrado: ${error.message}`)}}saved("Cliente borrado")}
async function addWorker(w:Omit<Worker,"id">){const clean={...w,name:String(w.name||"").trim()};if(!clean.name)return saved("Falta nombre de trabajador");if(supabase){const{data,error}=await supabase.from("workers").insert(clean).select().single();if(error)return saved(error.message);if(data)setWorkers(p=>[data as Worker,...p])}else setWorkers(p=>[{id:uid(),...clean},...p]);saved("Trabajador creado")}
async function updateWorker(w:Worker){const prev=workers;setWorkers(p=>p.map(x=>x.id===w.id?w:x));setEditingWorker(null);if(supabase){const{error}=await supabase.from("workers").update({name:w.name,phone:w.phone,email:w.email,province:w.province,capacity:w.capacity,active_hours:w.active_hours,skills:w.skills}).eq("id",w.id);if(error){setWorkers(prev);return saved(`ERROR: el trabajador NO se ha guardado: ${error.message}`)}}saved("Trabajador actualizado")}
async function delWorker(w:Worker){if(!confirm(`¿Borrar trabajador ${w.name}?`))return;const prev=workers;setWorkers(p=>p.filter(x=>x.id!==w.id));if(supabase){const{error}=await supabase.from("workers").delete().eq("id",w.id);if(error){setWorkers(prev);return saved(`ERROR: el trabajador NO se ha borrado: ${error.message}`)}}saved("Trabajador borrado")}
async function addService(s:Omit<Service,"id">,pts:Point[]){const clean={...s,client:String(s.client||"").trim(),campaign:String(s.campaign||"").trim()};if(!clean.client||!clean.campaign)return saved("Faltan cliente y campaña");if(clean.payment_type!=="Horas"&&!pts.length)return saved("Añade al menos un punto");const servicePoints=pts.map(p=>({...p,province:p.province||clean.province||null}));if(supabase){const{data,error}=await supabase.from("services").insert(clean).select().single();if(error){saved(error.message);return}const ins=data as Service;if(servicePoints.length){const{data:pd,error:pointError}=await supabase.from("points").insert(servicePoints.map(p=>({service_id:ins.id,name:p.name,address:p.address,province:p.province,fee:p.fee,report_code:p.report_code,notes:p.notes,point_status:p.point_status,incident_fee:INCIDENT_FEE}))).select();if(pointError){await supabase.from("services").delete().eq("id",ins.id);return saved(pointError.message)}ins.points=(pd||[])as Point[]}setServices(p=>[ins,...p])}else setServices(p=>[{id:uid(),...clean,points:servicePoints}as Service,...p]);saved("Servicio creado")}
async function duplicateService(source:Service){const{id,points,validated_at,communication_sent_at,resolved_at,material_status,logistics_status,logistics_request_id,tracking,...copy}=source as any;await addService({...copy,campaign:`${source.campaign} (copia)`,status:source.worker_id?"Asignado":"Pendiente asignar",validated_at:null,communication_sent_at:null,resolved_at:null},(points||[]).map((p:Point)=>({id:uid(),name:p.name,address:p.address||"",province:p.province||source.province||null,fee:pOriginal(p),report_code:p.report_code||"",notes:p.notes||"",point_status:"Pendiente",incident_fee:INCIDENT_FEE})));saved("Servicio duplicado")}
async function updateService(s:Service,patch:Partial<Service>){const next:any={...patch};const installerChanged=patch.worker_id!==undefined&&patch.worker_id!==s.worker_id;if(patch.status&&["Validado","Pagado"].includes(patch.status)&&!s.validated_at)next.validated_at=todayISO();if(patch.status&&! ["Validado","Pagado"].includes(patch.status))next.validated_at=null;const prev=services;patchServiceLocal(s.id,next);if(supabase){const{error}=await supabase.from("services").update(next).eq("id",s.id);if(error){setServices(prev);return saved(`ERROR: el servicio NO se ha guardado: ${error.message}`)}}if(installerChanged&&supabase){try{await supabase.rpc("sync_logistics_installer",{p_sources:[{source_type:"service",source_id:s.id},...(s.points||[]).map(p=>({source_type:"service_point",source_id:p.id}))],p_next:{installer_id:next.worker_id||null,installer_name:next.worker_name||null,delivery_address:(s.points||[])[0]?.address||null},p_actor:getCurrentAppSession()?.username||"Operaciones"})}catch{}}saved()}
async function updateServiceFull(s:Service){const next:any={...s};if(next.status&&["Validado","Pagado"].includes(next.status)&&!next.validated_at)next.validated_at=todayISO();if(next.status&&! ["Validado","Pagado"].includes(next.status))next.validated_at=null;const{points,...db}=next;const prev=services;setServices(p=>p.map(x=>x.id===s.id?{...next,points:x.points}:x));setEditingService(null);if(supabase){const{error}=await supabase.from("services").update(db).eq("id",s.id);if(error){setServices(prev);return saved(`ERROR: el servicio NO se ha guardado: ${error.message}`)}}saved("Servicio actualizado")}
async function updatePoint(p:Point,patch:Partial<Point>){const extra:any={};if(patch.point_status&&isPayableFailedStatus(patch.point_status)&&!isIncActive(p)&&!isIncResolved(p)){extra.original_fee=Number(p.original_fee??p.fee??0);extra.incident_fee=INCIDENT_FEE;extra.fee=INCIDENT_FEE;extra.incident_status="Abierta";extra.incident_opened_at=todayISO();extra.incident_comment=patch.point_comment||p.point_comment||p.incident_comment||""}if(patch.point_status&&patch.point_status==="Pendiente recepción post-incidencia"&&isIncActive(p)){extra.fee=0;extra.incident_status=null}if(patch.point_status&&!isPayableFailedStatus(patch.point_status)&&isIncActive(p)&&!patch.incident_status&&!patch.incident_resolved_at)extra.incident_status=null;const finalPatch={...patch,...extra};const prev=services;patchPointLocal(p.id,finalPatch);if(supabase){const{error}=await supabase.from("points").update(finalPatch).eq("id",p.id);if(error){setServices(prev);return saved(`ERROR: el punto NO se ha guardado: ${error.message}`)}}saved()}
async function requestMaterial(s:Service){try{saved("Creando petición logística...");if(s.logistics_request_id){window.location.assign(`/logistica/solicitudes?id=${s.logistics_request_id}`);return}if(!supabase)return saved("Logística no disponible en modo local");const sku=`SERV-${String(s.client_id||s.client||"GEN").replace(/[^A-Z0-9]/gi,"").slice(0,10).toUpperCase()}-${String(s.service_type||"MAT").replace(/[^A-Z0-9]/gi,"").slice(0,10).toUpperCase()}`;const dateOk=(x?:string|null)=>x&&/^\d{4}-\d{2}-\d{2}/.test(x)?x.slice(0,10):null;const{data,error}=await supabase.rpc("create_logistics_request_service",{p_service:{id:s.id,client_id:s.client_id||s.client||null,campaign_id:s.campaign||null,province:s.province||null,installer_id:s.worker_id||null,installer_name:s.worker_name||null,required_date:dateOk(s.deadline),address:(s.points||[])[0]?.address||null,material:{sku,name:s.service_type||"Material del servicio",type:"consumible",unit:"uds"}},p_lines:(s.points||[]).map(p=>({id:p.id,pharmacy_name:p.name,address:p.address||null,province:p.province||null,quantity:1})),p_actor:getCurrentAppSession()?.username||"Operaciones"});if(error)throw new Error(error.message);const result=data as {request_id?:string;status?:string;existing?:boolean}|null;const requestId=result?.request_id;if(!requestId)throw new Error("La petición logística no devolvió un identificador.");await updateService(s,{material_status:"Solicitud logística enviada",logistics_status:result?.status||"pendiente_revision",logistics_request_id:requestId});saved(result?.existing?"Este servicio ya tenía una petición: abriéndola":"Petición enviada a Logística");window.location.assign(`/logistica/solicitudes?id=${requestId}`)}catch(err){saved(err instanceof Error?`Error logística: ${err.message}`:"Error creando petición logística")}}
// M-03: el importe que se PERSISTE al resolver una incidencia (original + visita
// fallida) también sale del motor. Antes se sumaba en coma flotante y el valor
// inexacto quedaba escrito en la base, no solo pintado.
async function resolveIncident(service:Service,p:Point){const resuelto={...p,point_status:"Finalizado",incident_status:"Resuelta"};await updatePoint(p,{point_status:"Finalizado",incident_status:"Resuelta",incident_resolved_at:todayISO(),fee:pointPayEur(resuelto),point_comment:p.point_comment||p.incident_comment||"Incidencia finalizada"});saved("Incidencia finalizada")}
async function addPoint(s:Service,p:Omit<Point,"id">){const clean={...p,province:p.province||s.province||null,name:String(p.name||"").trim(),fee:Number.isFinite(Number(p.fee))?Number(p.fee):0};if(!clean.name)return saved("Falta nombre del punto");if(supabase){const{data,error}=await supabase.from("points").insert({...clean,service_id:s.id,incident_fee:INCIDENT_FEE}).select().single();if(error)return saved(error.message);if(data)setServices(prev=>prev.map(x=>x.id===s.id?{...x,points:[...(x.points||[]),data as Point]}:x))}else setServices(prev=>prev.map(x=>x.id===s.id?{...x,points:[...(x.points||[]),{id:uid(),...clean,incident_fee:INCIDENT_FEE}]}:x));saved("Punto añadido")}
async function delPoint(p:Point){if(!confirm("¿Borrar punto?"))return;const prev=services;setServices(list=>list.map(s=>({...s,points:(s.points||[]).filter(x=>x.id!==p.id)})));if(supabase){const{error}=await supabase.from("points").delete().eq("id",p.id);if(error){setServices(prev);return saved(`ERROR: el punto NO se ha borrado: ${error.message}`)}}saved("Punto borrado")}
async function delService(s:Service){if(!confirm(`¿Borrar servicio ${s.client} · ${s.campaign}?`))return;const prev=services;setServices(p=>p.filter(x=>x.id!==s.id));if(supabase){const{error}=await supabase.from("services").delete().eq("id",s.id);if(error){setServices(prev);return saved(`ERROR: el servicio NO se ha borrado: ${error.message}`)}}saved("Servicio borrado")}
async function handleLogin(username:string,password:string){const logged=await loginAppUser(username,password);if(!logged)return saved("Usuario o contraseña incorrectos");setSession(logged);await refresh(logged);saved(`Sesión iniciada: ${logged.display_name}`)}
async function saveUsers(nextUsers:AppUser[]){try{const savedUsers=await saveInternalUsers(nextUsers.map(normalizeUser));setUsers(savedUsers);if(session){const current=savedUsers.find(u=>u.id===session.id);if(current){const nextSession={...session,...current,permissions:current.permissions,provinces:current.provinces};setSession(nextSession);saveCurrentAppSession(nextSession)}}setEditingUser(null);saved("Usuarios actualizados")}catch(err){saved(err instanceof Error?`ERROR guardando usuarios: ${err.message}`:"ERROR guardando usuarios")}}
async function addServiceScoped(s:Omit<Service,"id">,pts:Point[]){if(!isAdminSession(session)&&!userCanSeeProvince(session,s.province))return saved("No puedes crear servicios fuera de tus provincias asignadas");const nextService={...s,created_by_user_id:session?.id||null,created_by_user_name:session?.display_name||null};const nextPoints=pts.map(p=>({...p,province:p.province||s.province||null}));await addService(nextService,nextPoints)}
// La navegación entre secciones (Panel, Servicios, Calendario, Pagos, Clientes,
// Trabajadores, Usuarios) vive ahora en la sidebar global (app-shell.tsx); esta
// página solo pinta la sección activa según ?tab=. Cerrar sesión también está
// en la sidebar.
const tabTitles:Record<string,string>={panel:"Panel",servicios:"Servicios",calendario:"Calendario instalador",clientes:"Clientes",trabajadores:"Trabajadores",pagos:"Pagos",usuarios:"Usuarios y permisos","nuevo-servicio":"Nuevo servicio","nuevo-cliente":"Nuevo cliente","nuevo-trabajador":"Nuevo trabajador"};
const scopedServices=filterBySessionProvince(services,session),scopedWorkers=isAdminSession(session)?workers:workers.filter(w=>userCanSeeProvince(session,w.province)),overdue=scopedServices.filter(isOverdue),incidents=scopedServices.filter(s=>s.status==="Incidencia"&&!s.resolved_at),pointIncidents=activePointIncidents(scopedServices),currentEditingService=editingService?services.find(s=>s.id===editingService.id)||editingService:null;
if(!session)return <LoginScreen onLogin={handleLogin}/>;
// El perfil de RR.HH. solo ve su módulo: ni panel, ni servicios, ni catálogos.
// La sidebar ya le oculta el resto, pero la home es alcanzable por URL directa.
if(session.role==="rrhh")return <RrhhOnlyHome/>;
return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><h1 className="mo-page-title text-3xl font-bold">{tabTitles[tab]||"Panel"}</h1></div><div className="flex flex-wrap gap-2">{canAccessModule(session,"servicios")&&<button onClick={()=>setTab("nuevo-servicio")} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-1 inline h-4 w-4"/>Nuevo servicio</button>}{isAdminSession(session)&&<button onClick={()=>setTab("nuevo-cliente")} className="rounded-2xl border bg-white px-4 py-2">Nuevo cliente</button>}{isAdminSession(session)&&<button onClick={()=>setTab("nuevo-trabajador")} className="rounded-2xl border bg-white px-4 py-2">Nuevo trabajador</button>}</div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{notice&&<div className="fixed right-4 top-24 z-50 rounded-2xl border bg-emerald-50 px-4 py-2 text-sm shadow">{notice}</div>}{loading?<Card>Cargando...</Card>:<>{tab==="panel"&&<Panel services={scopedServices} workers={scopedWorkers} overdue={overdue} incidents={incidents} pointIncidents={pointIncidents} updateService={updateService} updatePoint={updatePoint} resolveIncident={resolveIncident}/>} {tab==="servicios"&&canAccessModule(session,"servicios")&&<Services services={scopedServices} clients={clients} workers={scopedWorkers} updateService={updateService} updatePoint={updatePoint} deleteService={delService} editService={setEditingService} duplicateService={duplicateService} requestMaterial={requestMaterial}/>} {tab==="calendario"&&canAccessModule(session,"calendario")&&<CalendarByWorker services={scopedServices} workers={scopedWorkers}/>} {tab==="clientes"&&isAdminSession(session)&&<Clients clients={clients} edit={setEditingClient} del={delClient}/>} {tab==="trabajadores"&&canAccessModule(session,"servicios")&&<Workers workers={scopedWorkers} services={scopedServices} edit={isAdminSession(session)?setEditingWorker:()=>{}} del={isAdminSession(session)?delWorker:()=>{}}/>} {tab==="pagos"&&canAccessModule(session,"pagos")&&<Payments services={scopedServices} workers={scopedWorkers} clients={clients}/>} {tab==="usuarios"&&isAdminSession(session)&&<UsersAdmin users={users} onSave={saveUsers} onEdit={setEditingUser}/>} {tab==="nuevo-cliente"&&isAdminSession(session)&&<ClientForm save={addClient}/>} {tab==="nuevo-trabajador"&&isAdminSession(session)&&<WorkerForm save={addWorker}/>} {tab==="nuevo-servicio"&&canAccessModule(session,"servicios")&&<ServiceForm clients={clients} workers={scopedWorkers} save={addServiceScoped} session={session}/>}</>}</section>{editingClient&&<Modal title="Editar cliente" onClose={()=>setEditingClient(null)}><ClientEditor value={editingClient} save={updateClient}/></Modal>}{editingWorker&&<Modal title="Editar trabajador" onClose={()=>setEditingWorker(null)}><WorkerEditor value={editingWorker} save={updateWorker}/></Modal>}{editingUser&&<Modal title="Editar usuario" onClose={()=>setEditingUser(null)}><UserEditor value={editingUser} users={users} save={saveUsers}/></Modal>}{currentEditingService&&<Modal title="Editar servicio" onClose={()=>setEditingService(null)}><ServiceEditor value={currentEditingService} clients={clients} workers={scopedWorkers} save={updateServiceFull} addPoint={addPoint} updatePoint={updatePoint} deletePoint={delPoint} session={session}/></Modal>}</main>}

/** Aterrizaje del perfil de RR.HH.: se le lleva a su módulo en vez de enseñarle el panel general. */
function RrhhOnlyHome(){useEffect(()=>{window.location.replace("/rrhh/altas")},[]);return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-7xl"><Card><h2 className="text-xl font-semibold">Módulo de RR.HH.</h2><p className="mt-1 text-sm text-slate-500">Tu perfil solo tiene acceso a Altas laborales y Accesos a centro. Abriendo el módulo...</p><a href="/rrhh/altas" className="mt-3 inline-block rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Ir a Altas laborales</a></Card></section></main>}
/*
  Panel — rediseño de agosto 2026.

  El Panel pasa de ser un cuadro de mando pasivo a la BANDEJA DE TRABAJO del
  día, que es lo que pide el mockup. La regla al reescribirlo ha sido no perder
  nada: las incidencias de punto editables en línea, los avisos por demora con
  su mensaje copiable y las incidencias de servicio siguen exactamente donde
  estaban y con las mismas acciones. Lo nuevo se añade ENCIMA:

    · «Requiere tu acción hoy», que reúne en una sola lista ordenada por riesgo
      lo que hoy había que ir a buscar por cinco sitios distintos;
    · cumplimiento del mes y validado por semana, las dos cifras con las que se
      cierra el mes;
    · embudo operativo y carga por instalador, que ya existían como gráficos de
      barras y ahora se leen de un vistazo.

  Cada fila de la bandeja lleva al sitio donde se resuelve: las que se arreglan
  aquí mismo saltan al bloque de más abajo; las que se arreglan en otra pantalla
  navegan a ella.
*/

/** Lunes de la semana ISO a la que pertenece una fecha. */
function weekStart(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const weekday = (date.getDay() + 6) % 7; // 0 = lunes
  date.setDate(date.getDate() - weekday);
  return date;
}

function weekKey(value: Date) {
  const monday = weekStart(value);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function weekLabel(value: Date) {
  const monday = weekStart(value);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `S${week}`;
}

/** Importe corto para las barras: 18.412,50 € se lee mal en 40 px. */
function eurShort(value: number) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000) return `${Math.round(amount / 100) / 10}k`;
  return String(Math.round(amount));
}

type PanelObligation = { obligation_key: string; concept?: string | null; amount_cents?: number | null; blocked_reasons?: unknown; worker_name?: string | null };

function Panel({ services, workers, overdue, incidents, pointIncidents, updateService, updatePoint, resolveIncident }: any) {
  const validated = services.filter(isValidated);
  const active = services.filter((s: Service) => !isValidated(s));
  const avg = validated
    .map((s: Service) => s.start_date && s.validated_at
      ? Math.max(0, Math.round((new Date(dateOnly(s.validated_at)).getTime() - new Date(s.start_date).getTime()) / 86400000))
      : null)
    .filter((x: any) => x !== null) as number[];

  // Obligaciones bloqueadas: la única categoría de la bandeja que no sale de los
  // servicios ya cargados. Es una consulta de solo lectura y acotada; si falla
  // (permisos, tabla sin migrar) la categoría simplemente no aparece.
  const [blockedPayments, setBlockedPayments] = useState<PanelObligation[]>([]);
  useEffect(() => {
    let alive = true;
    const session = getCurrentAppSession();
    if (!canAccessModule(session, "pagos") || !isSupabaseConfigured || !supabase) return;
    void supabase
      .from("payment_obligations")
      .select("obligation_key,concept,amount_cents,blocked_reasons,worker_name")
      .eq("payable", false)
      .eq("status", "calculado")
      .order("obligation_key")
      .limit(8)
      .then(({ data, error }) => { if (alive && !error && data) setBlockedPayments(data as PanelObligation[]); });
    return () => { alive = false; };
  }, []);

  /* --- Bandeja de acciones --------------------------------------------- */

  type InboxItem = {
    id: string;
    group: "incidencias" | "sin-asignar" | "fuera-de-plazo" | "por-validar" | "pagos";
    tone: MoTone;
    badge: string;
    title: string;
    meta: string;
    amount?: string;
    cta: string;
    href: string;
    /** Peso de urgencia: cuanto más alto, más arriba en la bandeja. */
    weight: number;
  };

  const inbox: InboxItem[] = [
    ...pointIncidents.map(({ service, point }: any) => ({
      id: `inc-punto-${point.id}`,
      group: "incidencias" as const,
      tone: "risk" as MoTone,
      badge: "Incidencia",
      title: `${point.name} · ${service.campaign}`,
      meta: [point.province, service.worker_name || "Sin instalador", point.incident_due_date ? `prevista ${point.incident_due_date}` : null]
        .filter(Boolean).join(" · "),
      amount: eur(Number(point.incident_fee ?? point.fee ?? 0)),
      cta: "Resolver",
      href: "#mo-incidencias-puntos",
      weight: 100
    })),
    ...overdue.map((service: Service) => ({
      id: `demora-${service.id}`,
      group: "fuera-de-plazo" as const,
      tone: "risk" as MoTone,
      badge: "Fuera de plazo",
      title: `${service.client} · ${service.campaign}`,
      meta: [service.worker_name || "Sin instalador", service.deadline ? `límite ${service.deadline}` : "sin fecha límite", service.province]
        .filter(Boolean).join(" · "),
      amount: eur(serviceTotal(service)),
      cta: "Avisar",
      href: "#mo-avisos-demora",
      weight: 90
    })),
    ...incidents.map((service: Service) => ({
      id: `inc-servicio-${service.id}`,
      group: "incidencias" as const,
      tone: "risk" as MoTone,
      badge: "Incidencia",
      title: `${service.client} · ${service.campaign}`,
      meta: [service.worker_name || "Sin instalador", service.province, service.incident_note ? "con nota" : "sin nota"]
        .filter(Boolean).join(" · "),
      amount: eur(serviceTotal(service)),
      cta: "Revisar",
      href: "#mo-incidencias-servicio",
      weight: 80
    })),
    ...active
      .filter((service: Service) => !service.worker_id)
      .map((service: Service) => ({
        id: `sin-asignar-${service.id}`,
        group: "sin-asignar" as const,
        tone: "warn" as MoTone,
        badge: "Sin instalador",
        title: `${service.client} · ${service.campaign}`,
        meta: [service.province, `${(service.points || []).length} puntos`, service.deadline ? `límite ${service.deadline}` : null]
          .filter(Boolean).join(" · "),
        amount: eur(serviceTotal(service)),
        cta: "Asignar",
        href: "/?tab=servicios",
        weight: 70
      })),
    ...services
      .filter((service: Service) => service.status === "Reportado" && !isValidated(service))
      .map((service: Service) => ({
        id: `validar-${service.id}`,
        group: "por-validar" as const,
        tone: "info" as MoTone,
        badge: "Por validar",
        title: `${service.client} · ${service.campaign}`,
        meta: [service.worker_name || "Sin instalador", service.province, `${(service.points || []).length} puntos`]
          .filter(Boolean).join(" · "),
        amount: eur(serviceTotal(service)),
        cta: "Validar",
        href: "/?tab=servicios",
        weight: 60
      })),
    ...blockedPayments.map(obligation => ({
      id: `pago-${obligation.obligation_key}`,
      group: "pagos" as const,
      tone: "gold" as MoTone,
      badge: "Pagos",
      title: obligation.concept || obligation.obligation_key,
      meta: [obligation.worker_name, Array.isArray(obligation.blocked_reasons) && obligation.blocked_reasons.length
        ? `bloqueada: ${obligation.blocked_reasons.join(", ")}`
        : "pendiente de validar"].filter(Boolean).join(" · "),
      amount: eur(Number(obligation.amount_cents || 0) / 100),
      cta: "Aprobar",
      href: "/pagos/obligaciones",
      weight: 50
    }))
  ].sort((a, b) => b.weight - a.weight);

  const inboxFilters: Array<{ key: string; label: string }> = [
    { key: "todo", label: "Todo" },
    { key: "incidencias", label: "Incidencias" },
    { key: "sin-asignar", label: "Sin asignar" },
    { key: "fuera-de-plazo", label: "Fuera de plazo" },
    { key: "por-validar", label: "Por validar" },
    { key: "pagos", label: "Pagos" }
  ];
  const [inboxFilter, setInboxFilter] = useState("todo");
  const [showAll, setShowAll] = useState(false);
  const filteredInbox = inboxFilter === "todo" ? inbox : inbox.filter(item => item.group === inboxFilter);
  const visibleInbox = showAll ? filteredInbox : filteredInbox.slice(0, 7);

  /* --- Cumplimiento del mes -------------------------------------------- */

  const month = new Date().toISOString().slice(0, 7);
  const validatedThisMonth = validated.filter((s: Service) => dateOnly(s.validated_at).slice(0, 7) === month);
  const onTimeCount = validatedThisMonth.filter(onTime).length;
  const lateCount = validatedThisMonth.length - onTimeCount;
  const compliance = pct(onTimeCount, validatedThisMonth.length);

  /* --- Validado por semana (últimas 8) ---------------------------------- */

  const weeks: Array<{ key: string; label: string; value: number }> = [];
  for (let back = 7; back >= 0; back -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - back * 7);
    const key = weekKey(day);
    if (!weeks.some(w => w.key === key)) weeks.push({ key, label: weekLabel(day), value: 0 });
  }
  validated.forEach((service: Service) => {
    const iso = dateOnly(service.validated_at);
    if (!iso) return;
    const bucket = weeks.find(w => w.key === weekKey(new Date(`${iso}T00:00:00`)));
    if (bucket) bucket.value += serviceTotal(service);
  });
  const validatedTotal = weeks.reduce((sum, week) => sum + week.value, 0);

  /* --- Embudo operativo ------------------------------------------------- */

  const funnel = serviceStatuses
    .map(status => ({ label: status, value: services.filter((s: Service) => s.status === status).length }))
    .filter(entry => entry.value > 0);
  const funnelTotal = funnel.reduce((sum, entry) => sum + entry.value, 0);

  /* --- Carga por instalador --------------------------------------------- */

  const loadByWorker = workers
    .map((worker: Worker) => ({
      label: worker.name,
      value: active.filter((s: Service) => s.worker_id === worker.id).reduce((sum: number, s: Service) => sum + (s.points || []).length, 0),
      capacity: Number(worker.capacity || 0)
    }))
    .filter((entry: any) => entry.value > 0)
    .sort((a: any, b: any) => b.value - a.value);

  return (
    <div className="space-y-4">
      <MoKpiGrid>
        <MoKpi label="Servicios activos" value={active.length} hint={`${services.length} en total`} accent="ink" icon={CheckCircle2} />
        <MoKpi label="Fuera de plazo" value={overdue.length} hint={overdue.length ? "requieren aviso hoy" : "ninguno vencido"} accent="risk" icon={AlertTriangle} />
        <MoKpi label="Cumplimiento del mes" value={`${compliance}%`} hint={`${onTimeCount} de ${validatedThisMonth.length} a tiempo`} accent="ok" icon={CheckCircle2} />
        <MoKpi label="Total validado" value={eur(validated.reduce((a: number, s: Service) => a + serviceTotal(s), 0))} hint="acumulado" accent="gold" icon={CreditCard} />
        <MoKpi label="Tiempo medio cierre" value={avg.length ? `${Math.round(avg.reduce((a, b) => a + b, 0) / avg.length)} días` : "—"} hint="de inicio a validación" icon={CalendarDays} />
      </MoKpiGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* Bandeja de acciones */}
        <MoCard
          title="Requiere tu acción hoy"
          subtitle="Ordenado por riesgo económico y días de retraso"
          actions={<MoBadge tone={inbox.length ? "risk" : "ok"}>{inbox.length} {inbox.length === 1 ? "abierta" : "abiertas"}</MoBadge>}
          bodyClassName="mo-card__body--flush"
        >
          <div className="mo-chips" style={{ padding: "0 1.125rem 0.75rem" }}>
            {inboxFilters.map(filter => {
              const count = filter.key === "todo" ? inbox.length : inbox.filter(item => item.group === filter.key).length;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => { setInboxFilter(filter.key); setShowAll(false); }}
                  className={inboxFilter === filter.key ? "bg-slate-900" : ""}
                  aria-pressed={inboxFilter === filter.key}
                >
                  {filter.label}
                  {count > 0 && <span className="mo-chip-count">{count}</span>}
                </button>
              );
            })}
          </div>

          {visibleInbox.length === 0 ? (
            <MoEmpty
              title="Nada pendiente por aquí"
              hint={inboxFilter === "todo"
                ? "No hay incidencias, demoras ni servicios sin asignar en tu ámbito."
                : "No hay nada en esta categoría. Prueba con «Todo»."}
            />
          ) : (
            <MoActionList>
              {visibleInbox.map(item => (
                <MoActionRow
                  key={item.id}
                  tone={item.tone}
                  title={item.title}
                  badge={<MoBadge tone={item.tone}>{item.badge}</MoBadge>}
                  meta={item.meta}
                  amount={item.amount}
                  action={<a href={item.href}>{item.cta} →</a>}
                />
              ))}
            </MoActionList>
          )}

          {filteredInbox.length > 7 && (
            <div className="flex items-center justify-between gap-3 border-t px-[1.125rem] py-2.5 text-xs text-slate-500">
              <span>Se actualiza al cerrar cada acción.</span>
              <button type="button" onClick={() => setShowAll(v => !v)} className="font-medium text-slate-900 hover:underline">
                {showAll ? "Ver solo las 7 primeras" : `Ver las ${filteredInbox.length} abiertas`}
              </button>
            </div>
          )}
        </MoCard>

        <div className="space-y-4">
          <MoCard title="Cumplimiento del mes" subtitle="Servicios validados dentro de plazo">
            <div className="flex items-center gap-4">
              <MoDonut
                size={112}
                centerValue={`${compliance}%`}
                centerLabel="a tiempo"
                segments={[
                  { label: "A tiempo", value: onTimeCount, color: "var(--mo-green)" },
                  { label: "Con retraso", value: lateCount, color: "var(--mo-burgundy)" },
                  { label: "En curso", value: active.length, color: "var(--mo-surface-sunken)" }
                ]}
              />
              <MoLegend
                items={[
                  { label: "Cerrados a tiempo", value: onTimeCount, color: "var(--mo-green)" },
                  { label: "Cerrados con retraso", value: lateCount, color: "var(--mo-burgundy)" },
                  { label: "En curso", value: active.length, color: "#c9ced6" }
                ]}
              />
            </div>
          </MoCard>

          <MoCard title="Validado por semana" subtitle="Últimas 8 semanas">
            <MoColumns data={weeks} formatValue={eurShort} height={94} />
            <div className="mt-3 flex items-baseline justify-between border-t pt-2.5">
              <span className="text-xs text-slate-500">Total del periodo</span>
              <span className="font-mono text-sm">{eur(validatedTotal)}</span>
            </div>
          </MoCard>
        </div>
      </div>

      <div id="mo-incidencias-puntos">
        <ActiveIncidents items={pointIncidents} updatePoint={updatePoint} resolveIncident={resolveIncident} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MoCard title="Embudo operativo" subtitle={`${funnelTotal} servicios en curso, del alta al pago`}>
          {funnel.length === 0
            ? <MoEmpty title="Sin servicios" hint="Todavía no hay servicios en ningún estado." />
            : <MoBars
                data={funnel.map(entry => ({ label: entry.label, value: entry.value, total: funnelTotal, tone: statusTone(entry.label) }))}
                formatValue={(value, total) => <>{value} <span className="text-slate-400">· {pct(value, total || 1)}%</span></>}
              />}
        </MoCard>

        <MoCard title="Carga por instalador" subtitle="Puntos asignados en servicios activos">
          {loadByWorker.length === 0
            ? <MoEmpty title="Sin carga asignada" hint="Ningún instalador tiene puntos en servicios activos." />
            : <MoBars
                data={loadByWorker.map((entry: any) => ({
                  label: entry.label,
                  value: entry.value,
                  total: Math.max(entry.capacity || 0, ...loadByWorker.map((x: any) => x.value)),
                  tone: entry.capacity && entry.value > entry.capacity ? "risk" : "ink"
                }))}
                formatValue={(value) => `${value} puntos`}
              />}
        </MoCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div id="mo-avisos-demora">
          <AlertBox title="Avisos por demora" items={overdue} empty="No hay demoras." render={(s: Service) => <>
            <b>{s.client} · {s.campaign}</b>
            <p className="text-sm text-slate-500">{s.worker_name || "Sin trabajador"} · límite {s.deadline}</p>
            <textarea readOnly value={delayMessage(s)} className="mt-2 w-full rounded-xl border p-2 text-sm" />
            <button onClick={() => navigator.clipboard.writeText(delayMessage(s))} className="mt-2 rounded-xl border px-3 py-1 text-sm">Copiar aviso</button>
          </>} />
        </div>
        <div id="mo-incidencias-servicio">
          <AlertBox title="Incidencias de servicio" items={incidents} empty="No hay incidencias generales." render={(s: Service) => <>
            <b>{s.client} · {s.campaign}</b>
            <textarea value={s.incident_note || ""} onChange={e => updateService(s, { incident_note: e.target.value })} className="mt-2 w-full rounded-xl border p-2 text-sm" />
            <button onClick={() => updateService(s, { resolved_at: todayISO(), status: "Reportado" })} className="mt-2 rounded-xl border px-3 py-1 text-sm">Marcar resuelta</button>
          </>} />
        </div>
      </div>
    </div>
  );
}

function ActiveIncidents({items,updatePoint,resolveIncident}:any){return <Card><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Incidencias activas de puntos</h2><span className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-700">{items.length}</span></div>{items.length===0?<p className="text-sm text-slate-500">No hay incidencias activas.</p>:items.map(({service,point}:any)=><div key={point.id} className="border-t py-3"><div className="grid gap-3 lg:grid-cols-4"><div><b>{service.client} · {service.campaign}</b><p className="text-sm text-slate-500">{service.worker_name||"Sin trabajador"} · {service.province}</p><p>{point.name}</p></div><div className="text-sm"><p>Original: <b>{eur(pOriginal(point))}</b></p><p>Incidencia: <b>{eur(Number(point.incident_fee||INCIDENT_FEE))}</b></p><p>Pago actual: <b>{eur(pPay(point))}</b></p></div><div><Input label="Próxima acción" value={point.incident_next_action||""} onChange={(v:any)=>updatePoint(point,{incident_next_action:v})}/><Input label="Fecha prevista" type="date" value={point.incident_due_date||""} onChange={(v:any)=>updatePoint(point,{incident_due_date:v})}/></div><div><Textarea label="Comentario" value={point.incident_comment||point.point_comment||""} onChange={(v:any)=>updatePoint(point,{incident_comment:v,point_comment:v})}/><button onClick={()=>resolveIncident(service,point)} className="mt-2 w-full rounded-2xl bg-slate-900 px-4 py-2 text-white">Finalizar incidencia</button></div></div></div>)}</Card>}
function Services({services,clients,workers,updateService,updatePoint,deleteService,editService,duplicateService,requestMaterial}:any){const deepServiceId=typeof window!=="undefined"?new URLSearchParams(window.location.search).get("service")||"":"";const[q,setQ]=useState(()=>typeof window!=="undefined"?new URLSearchParams(window.location.search).get("q")||"":""),[cw,setCw]=useState(""),[cc,setCc]=useState(""),[st,setSt]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[quick,setQuick]=useState("");const hasFilter=!!(q||cw||cc||st||from||to||quick||deepServiceId);const list=sortedServices(services.filter((s:Service)=>{const archived=isValidated(s)&&olderValidated(s);return(hasFilter||!archived)&&(!deepServiceId||s.id===deepServiceId||(s.points||[]).some((p:Point)=>p.id===deepServiceId))&&(!q||[s.client,s.campaign,s.province,s.worker_name,s.ceco].some(x=>String(x||"").toLowerCase().includes(q.toLowerCase())))&&(!cw||s.worker_id===cw)&&(!cc||s.client_id===cc)&&(!st||s.status===st)&&(!from||dateOnly(s.deadline)>=from)&&(!to||dateOnly(s.deadline)<=to)&&quickFilter(s,quick)}));return <div className="space-y-4"><Card><div className="grid gap-2 md:grid-cols-6"><Input label="Buscar" value={q} onChange={setQ}/><Select label="Instalador" value={cw} onChange={setCw} options={["",...workers.map((w:Worker)=>w.id)]} labels={{"":"Todos",...Object.fromEntries(workers.map((w:Worker)=>[w.id,w.name]))}}/><Select label="Cliente" value={cc} onChange={setCc} options={["",...clients.map((c:Client)=>c.id)]} labels={{"":"Todos",...Object.fromEntries(clients.map((c:Client)=>[c.id,c.name]))}}/><Select label="Estado" value={st} onChange={setSt} options={["",...serviceStatuses]} labels={{"":"Todos"}}/><Input label="Desde límite" type="date" value={from} onChange={setFrom}/><Input label="Hasta límite" type="date" value={to} onChange={setTo}/></div><div className="mo-chips mt-3">{[["","Todos"],["sin-trabajador","Sin trabajador"],["fuera-plazo","Fuera de plazo"],["incidencia","Con incidencia"],["reportado-no-validado","Reportado no validado"],["validado-no-pagado","Validado no pagado"],["horas","Pago por horas"]].map(([id,label])=>{const count=services.filter((s:Service)=>quickFilter(s,id)).length;return <button key={id} onClick={()=>setQuick(id)} aria-pressed={quick===id} className={quick===id?"bg-slate-900":""}>{label}{count>0&&<span className="mo-chip-count">{count}</span>}</button>})}</div><p className="mt-2 text-xs text-slate-500">Los servicios validados hace más de 10 días se ocultan por defecto, pero aparecen al buscar o filtrar.</p></Card>{!list.length&&<Card><p className="font-semibold">No hay servicios visibles.</p><p className="mt-1 text-sm text-slate-500">Crea un servicio nuevo o ajusta los filtros para ver servicios archivados.</p></Card>}{list.map((s:Service)=><Card key={s.id}><div className="flex flex-col gap-3 md:flex-row md:justify-between"><div><h3 className="text-xl font-semibold"><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{backgroundColor:colorFor(s).bg}}/>{s.client} · {s.campaign}</h3><p className="text-sm text-slate-500">{s.province} · {s.worker_name||"Sin asignar"} · límite {s.deadline||"—"} · total {eur(serviceTotal(s))} · {s.payment_type||"Puntos"}</p><MaterialStatusPill service={s}/></div><div className="flex flex-wrap gap-2"><SelectMini value={s.worker_id||""} onChange={(v:string)=>{const w=workers.find((x:Worker)=>x.id===v);updateService(s,{worker_id:v,worker_name:w?.name||"",status:v?"Asignado":"Pendiente asignar"})}} options={["",...workers.map((w:Worker)=>w.id)]} labels={{"":"Asignar",...Object.fromEntries(workers.map((w:Worker)=>[w.id,w.name]))}}/><SelectMini value={s.status||""} onChange={(v:string)=>updateService(s,{status:v})} options={serviceStatuses}/><button title={s.logistics_request_id?"Ver petición logística":"Solicitar material a Logística"} aria-label={s.logistics_request_id?"Ver petición logística":"Solicitar material a Logística"} className={s.logistics_request_id?"rounded-xl bg-slate-900 px-3 py-1 text-sm font-semibold text-white":"rounded-xl border px-3 py-1 text-sm font-semibold"} onClick={()=>requestMaterial(s)}><Package className="mr-1 inline h-4 w-4"/>{s.logistics_request_id?"Ver petición":"Solicitar material"}</button><button title="Editar servicio" aria-label="Editar servicio" className="rounded-xl border px-3" onClick={()=>editService(s)}><Edit3 className="inline h-4 w-4"/></button><button title="Duplicar servicio" aria-label="Duplicar servicio" className="rounded-xl border px-3" onClick={()=>duplicateService(s)}><Copy className="inline h-4 w-4"/></button><button title="Copiar y enviar WhatsApp" aria-label="Copiar y enviar WhatsApp" className="rounded-xl border px-3" onClick={()=>{const w=workers.find((x:Worker)=>x.id===s.worker_id);const msg=buildWhatsApp(s);navigator.clipboard.writeText(msg);if(w?.phone)window.open(`https://wa.me/${String(w.phone).replace(/[^0-9]/g,"")}?text=${encodeURIComponent(msg)}`,"_blank");updateService(s,{communication_sent_at:todayISO(),status:"Info enviada"})}}><MessageCircle className="inline h-4 w-4"/></button><button title="Borrar servicio" aria-label="Borrar servicio" onClick={()=>deleteService(s)} className="rounded-xl border px-3 text-red-600"><Trash2 className="h-4 w-4"/></button></div></div><HourlyBox s={s} updateService={updateService}/><PointTable s={s} updatePoint={updatePoint}/></Card>)}</div>}
function quickFilter(s:Service,q:string){if(!q)return true;if(q==="sin-trabajador")return!s.worker_id;if(q==="fuera-plazo")return isOverdue(s);if(q==="incidencia")return s.status==="Incidencia"||(s.points||[]).some(isIncActive);if(q==="reportado-no-validado")return s.status==="Reportado"&&!isValidated(s);if(q==="validado-no-pagado")return s.status==="Validado";if(q==="horas")return["Horas","Mixto"].includes(s.payment_type||"");return true}
function PointTable({s,updatePoint}:any){return <div className="mt-4 overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Punto</th><th className="p-2 text-left">Código</th><th className="p-2 text-left">Estado punto</th><th className="p-2 text-left">Comentario</th><th className="p-2 text-right">Pago</th></tr></thead><tbody>{(s.points||[]).map((p:Point)=><tr key={p.id} className={`border-t ${isIncActive(p)?"bg-red-50":""}`}><td className="p-2">{p.name}<br/><span className="text-slate-500">{p.address}</span></td><td className="p-2">{p.report_code}</td><td className="p-2"><SelectMini value={pStatus(p)} onChange={(v:string)=>updatePoint(p,{point_status:v})} options={pointStatuses}/></td><td className="p-2"><input disabled={!['Incidencia','Pospuesto'].includes(pStatus(p))} value={p.point_comment||p.incident_comment||""} onChange={e=>updatePoint(p,{point_comment:e.target.value,incident_comment:e.target.value})} className="w-full rounded-xl border px-2 py-1 disabled:bg-slate-100"/></td><td className="p-2 text-right"><b>{eur(pPay(p))}</b>{isIncActive(p)&&<p className="text-xs text-slate-500">Original {eur(pOriginal(p))}</p>}</td></tr>)}</tbody></table></div>}
function MaterialStatusPill({service}:any){const status=service.logistics_status||service.material_status||"Sin asignar";const cls=status.includes("incid")||status.includes("bloque")?"bg-red-50 text-red-800 ring-red-200":status.includes("envi")||status.includes("picking")?"bg-blue-50 text-blue-800 ring-blue-200":status.includes("entreg")||status.includes("recib")?"bg-emerald-50 text-emerald-800 ring-emerald-200":"bg-slate-100 text-slate-700 ring-slate-200";const href=service.logistics_request_id?`/logistica/solicitudes?id=${service.logistics_request_id}`:"";return href?<a href={href} className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>Material: {status}</a>:<span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>Material: {status}</span>}
function HourlyBox({s,updateService}:any){if(!["Horas","Mixto"].includes(s.payment_type||""))return null;return <div className="mt-4 grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-3"><Input label="Precio/hora" type="number" value={s.hourly_rate||0} onChange={(v:any)=>updateService(s,{hourly_rate:Number(v)})}/><Input label="Horas trabajadas" type="number" value={s.hours_worked||0} onChange={(v:any)=>updateService(s,{hours_worked:Number(v)})}/><div><p className="text-sm font-medium">Total horas</p><p className="text-xl font-bold">{eur(hourTotal(s))}</p></div></div>}
function CalendarByWorker({services,workers}:any){const[m,setM]=useState(new Date().toISOString().slice(0,7));return <div className="space-y-4"><Card><Input label="Mes" type="month" value={m} onChange={setM}/></Card>{workers.map((w:Worker)=><Card key={w.id}><h3 className="font-semibold">{w.name}</h3><div className="mt-2 grid gap-2 md:grid-cols-4">{services.filter((s:Service)=>s.worker_id===w.id&&(dateOnly(s.start_date).startsWith(m)||dateOnly(s.deadline).startsWith(m))).map((s:Service)=><div key={s.id} className="rounded-2xl border p-3 text-sm" style={{borderColor:colorFor(s).bg}}><b>{s.client} · {s.campaign}</b><p>{s.start_date||"—"} → {s.deadline||"—"}</p><p>{s.status}</p></div>)}</div></Card>)}</div>}
function Clients({clients,edit,del}:any){return <div className="grid gap-4 md:grid-cols-3">{clients.map((c:Client)=><Card key={c.id}><h3 className="text-lg font-semibold">{c.name}</h3><p className="mt-2 rounded-xl bg-slate-50 p-2 font-mono">{c.ceco||"Sin CECO"}</p><p className="mt-2 text-sm text-slate-500">{c.notes}</p><div className="mt-3 flex gap-2"><button onClick={()=>edit(c)} className="rounded-xl border px-3 py-1">Editar</button><button onClick={()=>del(c)} className="rounded-xl border px-3 py-1 text-red-600">Borrar</button></div></Card>)}</div>}
function Workers({workers,services,edit,del}:any){const[month,setMonth]=useState(new Date().toISOString().slice(0,7));const year=Number(month.slice(0,4)),monthNum=Number(month.slice(5,7)),from=`${month}-01`,to=`${year}-${String(monthNum).padStart(2,"0")}-${String(new Date(year,monthNum,0).getDate()).padStart(2,"0")}`;return <div className="space-y-4"><Card><Input label="Mes para importes" type="month" value={month} onChange={setMonth}/></Card><div className="grid gap-4 md:grid-cols-3">{workers.map((w:Worker)=>{const ws=services.filter((s:Service)=>s.worker_id===w.id),val=ws.filter(isValidated),m=ws.filter((s:Service)=>isValidated(s)&&s.validated_at&&dateOnly(s.validated_at)>=from&&dateOnly(s.validated_at)<=to);return <Card key={w.id}><Users className="mb-2 h-5 w-5"/><h3 className="text-lg font-semibold">{w.name}</h3><p className="text-sm text-slate-500">{w.phone} · {w.province}</p>{w.email&&<p className="text-sm text-slate-500 break-all">{w.email}</p>}<p className="mt-2 text-sm">{w.skills}</p><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><Mini label="Activos" value={ws.filter((s:Service)=>!isValidated(s)).length}/><Mini label="A tiempo" value={pct(val.filter(onTime).length,val.length)+"%"}/><Mini label="Mes" value={eur(m.reduce((a:number,s:Service)=>a+serviceTotal(s),0))}/><Mini label="Validados mes" value={m.length}/></div><div className="mt-3 flex gap-2"><button onClick={()=>edit(w)} className="rounded-xl border px-3 py-1">Editar</button><button onClick={()=>del(w)} className="rounded-xl border px-3 py-1 text-red-600">Borrar</button></div></Card>})}</div></div>}
function Payments({services,workers,clients}:any){const[from,setFrom]=useState(monthStart()),[to,setTo]=useState(monthEnd()),[wid,setWid]=useState(""),[cid,setCid]=useState(""),[campaignPayments,setCampaignPayments]=useState<any[]>([]);useEffect(()=>{async function loadCampaignPayments(){const sessionNow=getCurrentAppSession();if(!canAccessModule(sessionNow,"pagos")){setCampaignPayments([]);return}if(isSupabaseConfigured&&supabase){let pointQuery=supabase.from("big_campaign_points").select("*");if(!isAdminSession(sessionNow)&&sessionNow?.provinces?.length)pointQuery=pointQuery.in("province",provinceScopeValues(sessionNow.provinces));const{data:points}=await pointQuery;const campaignIds=Array.from(new Set(((points||[])as any[]).map(point=>point.big_campaign_id).filter(Boolean))) as string[];let campaigns:any[]=[];if(campaignIds.length){const{data}=await supabase.from("big_campaigns").select("*").in("id",campaignIds);campaigns=(data||[]) as any[]}const byCampaign=new Map(campaigns.map((c:any)=>[c.id,c]));setCampaignPayments(((points||[])as any[]).map(point=>{const campaign:any=byCampaign.get(point.big_campaign_id)||{};return buildBigCampaignPaymentRow(point,campaign,sessionNow)}).filter(Boolean))}else setCampaignPayments([])}loadCampaignPayments()},[]);function buildBigCampaignPaymentRow(point:any,campaign:any,sessionNow:AppSession|null){const province=point.province||campaign.province||"";if(!isAdminSession(sessionNow)&&!userCanSeeProvince(sessionNow,province))return null;const status=point.point_status||"Pendiente",incidentActive=isPayableFailedStatus(status)&&point.incident_status!=="Resuelta"&&!point.incident_resolved_at,incidentResolved=point.incident_status==="Resuelta"||!!point.incident_resolved_at;if(!["Finalizado","Incidencia","Pospuesto"].includes(status)&&!incidentResolved)return null;const incident=Number(point.incident_fee||INCIDENT_FEE),original=Number(point.original_fee??point.fee??0),total=incidentActive?incident:incidentResolved?original+incident:Number(point.fee||0),paymentDate=dateOnly(point.validated_at||point.finished_at||point.incident_resolved_at||point.reported_at||campaign.deadline||campaign.start_date||todayISO());return{id:`big-${point.id}`,source:"Gran campaña",date:paymentDate,worker_id:point.worker_id||null,worker_name:point.worker_name||"Sin instalador",client_id:campaign.client_id||null,client:campaign.client||"Gran campaña",ceco:campaign.ceco||"",campaign:campaign.name||"Gran campaña",payment_type:status==="Incidencia"||status==="Pospuesto"?"Incidencia":"Puntos",total,province}}const serviceRows=services.filter((s:Service)=>isValidated(s)&&s.validated_at).map((s:Service)=>({id:`service-${s.id}`,source:"Servicio",date:dateOnly(s.validated_at),worker_id:s.worker_id,worker_name:s.worker_name,client_id:s.client_id,client:s.client,ceco:s.ceco,campaign:s.campaign,payment_type:s.payment_type||"Puntos",total:serviceTotal(s),pointsTotal:pointTotal(s),hoursTotal:hourTotal(s)}));const campaignRows=campaignPayments.map(row=>({...row,pointsTotal:row.total,hoursTotal:0}));const valid=[...serviceRows,...campaignRows].filter(row=>(!from||row.date>=from)&&(!to||row.date<=to)&&(!wid||row.worker_id===wid)&&(!cid||row.client_id===cid));const total=valid.reduce((a:number,row:any)=>a+Number(row.total||0),0),totalHours=valid.reduce((a:number,row:any)=>a+Number(row.hoursTotal||0),0),totalPoints=valid.reduce((a:number,row:any)=>a+Number(row.pointsTotal||0),0);function exp(){downloadCSV("pagos.csv",[["Origen","Fecha","Trabajador","Cliente","CECO","Campaña","Tipo pago","Total"],...valid.map((row:any)=>[row.source,row.date,row.worker_name,row.client,row.ceco,row.campaign,row.payment_type,row.total])])}const workerTotals=workers.map((w:Worker)=>[w.name,valid.filter((row:any)=>row.worker_id===w.id).reduce((a:number,row:any)=>a+Number(row.total||0),0)]as[string,number]);const unassigned=valid.filter((row:any)=>!row.worker_id).reduce((a:number,row:any)=>a+Number(row.total||0),0);const payByWorker=moneyData([...workerTotals,...(unassigned>0?[["Sin instalador",unassigned] as [string,number]]:[])].filter(x=>x[1]>0));return <div className="space-y-4"><Card><div className="grid gap-2 md:grid-cols-5"><Input label="Desde" type="date" value={from} onChange={setFrom}/><Input label="Hasta" type="date" value={to} onChange={setTo}/><Select label="Trabajador" value={wid} onChange={setWid} options={["",...workers.map((w:Worker)=>w.id)]} labels={{"":"Todos",...Object.fromEntries(workers.map((w:Worker)=>[w.id,w.name]))}}/><Select label="Cliente" value={cid} onChange={setCid} options={["",...clients.map((c:Client)=>c.id)]} labels={{"":"Todos",...Object.fromEntries(clients.map((c:Client)=>[c.id,c.name]))}}/><button onClick={exp} className="self-end rounded-2xl bg-slate-900 px-4 py-2 text-white"><FileDown className="mr-1 inline h-4 w-4"/>Exportar</button></div></Card><div className="grid gap-3 md:grid-cols-5"><Kpi label="Total periodo" value={eur(total)} icon={CreditCard}/><Kpi label="Líneas pago" value={valid.length} icon={CheckCircle2}/><Kpi label="Grandes campañas" value={valid.filter((row:any)=>row.source==="Gran campaña").length} icon={Users}/><Kpi label="Importe puntos" value={eur(totalPoints)} icon={Package}/><Kpi label="Importe horas" value={eur(totalHours)} icon={CalendarDays}/></div><BarChart title="Pagos por trabajador" data={payByWorker}/><Card><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Origen</th><th className="p-2 text-left">Fecha</th><th>Trabajador</th><th>Cliente</th><th>Campaña</th><th>Tipo</th><th className="text-right">Total</th></tr></thead><tbody>{valid.map((row:any)=><tr key={row.id} className="border-t"><td className="p-2">{row.source}</td><td className="p-2">{row.date}</td><td>{row.worker_name}</td><td>{row.client}</td><td>{row.campaign}</td><td>{row.payment_type}</td><td className="text-right font-semibold">{eur(row.total)}</td></tr>)}</tbody></table></div></Card></div>}
function ServiceForm({clients,workers,save,session}:any){const provinceChoices=allowedProvinceOptions(session);const[form,setForm]=useState<any>({client_id:"",client:"",ceco:"",campaign:"",province:provinceChoices[0]||"",start_date:"",deadline:"",priority:"Media",service_type:"Vinilo",reporting_channel:"WhatsApp",worker_id:"",worker_name:"",status:"Pendiente asignar",material_status:"Pendiente",payment_type:"Puntos",hourly_rate:0,hours_worked:0,default_point_fee:0,estimated_hours:1,instructions:"",calendar_color:"slate"});const[txt,setTxt]=useState("Punto 1;Dirección;17;COD001;Notas");const pts=parsePointsText(txt,Number(form.default_point_fee||0));return <Card><h2 className="mb-3 text-xl font-semibold">Nuevo servicio</h2><ServiceFields form={form} setForm={setForm} clients={clients} workers={workers} provinceOptionsForForm={provinceChoices}/><Textarea label="Instrucciones" value={form.instructions} onChange={(v:any)=>setForm({...form,instructions:v})}/><Textarea label="Puntos: Nombre;Dirección;Importe;Código de reporte;Notas" value={txt} onChange={setTxt}/><div className="rounded-2xl bg-slate-50 p-3">Total previsto: <b>{eur(serviceTotalsEur(form,pts).totalEur)}</b></div><button onClick={()=>save(form,pts)} className="mt-3 rounded-2xl bg-slate-900 px-4 py-2 text-white">Crear servicio</button></Card>}
function ServiceEditor({value,clients,workers,save,addPoint,updatePoint,deletePoint,session}:any){const[form,setForm]=useState<Service>(value),[newPoint,setNewPoint]=useState<any>({name:"",address:"",fee:0,report_code:"",notes:"",point_status:"Pendiente"});useEffect(()=>setForm(value),[value]);return <div className="max-h-[75vh] space-y-4 overflow-auto pr-2"><ServiceFields form={form} setForm={setForm} clients={clients} workers={workers} provinceOptionsForForm={allowedProvinceOptions(session)}/><Textarea label="Instrucciones" value={form.instructions} onChange={(v:any)=>setForm({...form,instructions:v})}/><button onClick={()=>save(form)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar cambios del servicio</button><div className="rounded-2xl bg-slate-50 p-3"><h3 className="mb-2 font-semibold">Añadir punto</h3><div className="grid gap-2 md:grid-cols-5"><Input label="Nombre" value={newPoint.name} onChange={(v:any)=>setNewPoint({...newPoint,name:v})}/><Input label="Dirección" value={newPoint.address} onChange={(v:any)=>setNewPoint({...newPoint,address:v})}/><Input label="Importe" type="number" value={newPoint.fee} onChange={(v:any)=>setNewPoint({...newPoint,fee:Number(v)})}/><Input label="Código" value={newPoint.report_code} onChange={(v:any)=>setNewPoint({...newPoint,report_code:v})}/><button className="self-end rounded-xl border px-3 py-2" onClick={()=>{addPoint(value,newPoint);setNewPoint({name:"",address:"",fee:0,report_code:"",notes:"",point_status:"Pendiente"})}}>Añadir</button></div></div><div className="overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Nombre</th><th>Dirección</th><th>Importe</th><th>Código</th><th></th></tr></thead><tbody>{(value.points||[]).map((p:Point)=><tr key={p.id} className="border-t"><td className="p-2"><input className="w-full rounded-xl border px-2" value={p.name} onChange={e=>updatePoint(p,{name:e.target.value})}/></td><td><input className="w-full rounded-xl border px-2" value={p.address||""} onChange={e=>updatePoint(p,{address:e.target.value})}/></td><td><input className="w-28 rounded-xl border px-2" type="number" value={pPay(p)} onChange={e=>updatePoint(p,{fee:Number(e.target.value),original_fee:isIncActive(p)?pOriginal(p):undefined})}/></td><td><input className="w-28 rounded-xl border px-2" value={p.report_code||""} onChange={e=>updatePoint(p,{report_code:e.target.value})}/></td><td><button onClick={()=>deletePoint(p)} className="text-red-600"><Trash2 className="h-4 w-4"/></button></td></tr>)}</tbody></table></div></div>}
function ServiceFields({form,setForm,clients,workers,provinceOptionsForForm}:any){return <div className="grid gap-3 md:grid-cols-3"><Select label="Cliente existente" value={form.client_id} onChange={(v:string)=>{const c=clients.find((x:Client)=>x.id===v);setForm({...form,client_id:v,client:c?.name||form.client,ceco:c?.ceco||form.ceco})}} options={["",...clients.map((c:Client)=>c.id)]} labels={{"":"Seleccionar",...Object.fromEntries(clients.map((c:Client)=>[c.id,c.name]))}}/><Input label="Cliente" value={form.client} onChange={(v:any)=>setForm({...form,client:v})}/><Input label="CECO" value={form.ceco} onChange={(v:any)=>setForm({...form,ceco:v})}/><Input label="Campaña" value={form.campaign} onChange={(v:any)=>setForm({...form,campaign:v})}/><Select label="Provincia" value={form.province} onChange={(v:any)=>setForm({...form,province:v})} options={provinceOptionsForForm??provinceOptions}/><Select label="Tipo pago" value={form.payment_type} onChange={(v:any)=>setForm({...form,payment_type:v})} options={paymentTypes}/><Select label="Color calendario" value={form.calendar_color||"slate"} onChange={(v:any)=>setForm({...form,calendar_color:v})} options={Object.keys(calendarColors)} labels={Object.fromEntries(Object.entries(calendarColors).map(([k,v]:any)=>[k,v.label]))}/><Select label="Trabajador" value={form.worker_id} onChange={(v:string)=>{const w=workers.find((x:Worker)=>x.id===v);setForm({...form,worker_id:v,worker_name:w?.name||""})}} options={["",...workers.map((w:Worker)=>w.id)]} labels={{"":"Sin asignar",...Object.fromEntries(workers.map((w:Worker)=>[w.id,w.name]))}}/><Select label="Estado" value={form.status} onChange={(v:any)=>setForm({...form,status:v})} options={serviceStatuses}/><Input label="Inicio" type="date" value={form.start_date} onChange={(v:any)=>setForm({...form,start_date:v})}/><Input label="Límite" type="date" value={form.deadline} onChange={(v:any)=>setForm({...form,deadline:v})}/><Input label="Precio/hora" type="number" value={form.hourly_rate} onChange={(v:any)=>setForm({...form,hourly_rate:Number(v)})}/><Input label="Horas trabajadas" type="number" value={form.hours_worked} onChange={(v:any)=>setForm({...form,hours_worked:Number(v)})}/></div>}
function ClientForm({save}:any){const[v,setV]=useState<any>({name:"",ceco:"",notes:""});return <Card><Input label="Cliente" value={v.name} onChange={(x:any)=>setV({...v,name:x})}/><Input label="CECO" value={v.ceco} onChange={(x:any)=>setV({...v,ceco:x})}/><Textarea label="Notas" value={v.notes} onChange={(x:any)=>setV({...v,notes:x})}/><button onClick={()=>save(v)} className="mt-3 rounded-2xl bg-slate-900 px-4 py-2 text-white">Crear cliente</button></Card>}
function ClientEditor({value,save}:any){const[v,setV]=useState<Client>(value);return <div className="space-y-3"><Input label="Cliente" value={v.name} onChange={(x:any)=>setV({...v,name:x})}/><Input label="CECO" value={v.ceco||""} onChange={(x:any)=>setV({...v,ceco:x})}/><Textarea label="Notas" value={v.notes||""} onChange={(x:any)=>setV({...v,notes:x})}/><button onClick={()=>save(v)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar</button></div>}
function WorkerForm({save}:any){const[v,setV]=useState<any>({name:"",phone:"",email:"",province:"",capacity:0,active_hours:0,skills:""});return <Card><WorkerFields v={v} setV={setV}/><button onClick={()=>save(v)} className="mt-3 rounded-2xl bg-slate-900 px-4 py-2 text-white">Crear trabajador</button></Card>}
function WorkerEditor({value,save}:any){const[v,setV]=useState<Worker>(value);return <div><WorkerFields v={v} setV={setV}/><button onClick={()=>save(v)} className="mt-3 rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar</button>{value.id&&<WorkerAddresses workerId={value.id}/>}</div>}
// Feature 2: direcciones de envio reutilizables del trabajador (para envios de material).
function WorkerAddresses({workerId}:{workerId:string}){
  const[list,setList]=useState<WorkerAddress[]>([]);
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState("");
  const empty={etiqueta:"",direccion:"",codigo_postal:"",poblacion:"",provincia:"",predeterminada:false};
  const[nueva,setNueva]=useState<any>(empty);
  async function load(){setLoading(true);const r=await listWorkerAddresses(workerId);if(r.error)setErr(r.error);setList(r.data);setLoading(false)}
  useEffect(()=>{load()},[workerId]);
  async function add(){if(!String(nueva.direccion||"").trim()){setErr("La dirección no puede estar vacía.");return}setErr("");const r=await addWorkerAddress(workerId,nueva);if(r.error){setErr(r.error);return}setNueva(empty);await load()}
  async function quitar(id:string){const r=await deleteWorkerAddress(id);if(r.error){setErr(r.error);return}await load()}
  async function marcar(id:string){const r=await updateWorkerAddress(id,workerId,{predeterminada:true});if(r.error){setErr(r.error);return}await load()}
  if(!isSupabaseConfigured)return <div className="mt-5 rounded-2xl border border-dashed p-4 text-sm text-slate-500">Las direcciones de envío requieren conexión con la base de datos (no disponibles en modo local).</div>;
  return <div className="mt-6 border-t pt-4">
    <h3 className="mb-1 text-lg font-semibold">Direcciones de envío</h3>
    <p className="mb-3 text-sm text-slate-500">Para el envío de material. La marcada como predeterminada se propondrá por defecto en las campañas.</p>
    {err&&<p className="mb-2 text-sm text-red-600">{err}</p>}
    {loading?<p className="text-sm text-slate-500">Cargando...</p>:list.length?<ul className="mb-3 space-y-2">{list.map(a=><li key={a.id} className="flex items-start justify-between gap-3 rounded-2xl border p-3"><div className="text-sm"><p className="font-medium">{a.etiqueta||"Dirección"}{a.predeterminada&&<span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Predeterminada</span>}</p><p className="text-slate-600 break-words">{formatDireccionEnvio(a)}</p></div><div className="flex shrink-0 gap-2">{!a.predeterminada&&<button onClick={()=>marcar(a.id)} className="rounded-xl border px-2 py-1 text-xs">Predeterminada</button>}<button onClick={()=>quitar(a.id)} className="rounded-xl border px-2 py-1 text-xs text-red-600">Borrar</button></div></li>)}</ul>:<p className="mb-3 text-sm text-slate-500">Sin direcciones todavía.</p>}
    <div className="rounded-2xl border bg-slate-50 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Etiqueta (ej. Casa, Almacén)" value={nueva.etiqueta} onChange={(x:any)=>setNueva({...nueva,etiqueta:x})}/>
        <Input label="Dirección" value={nueva.direccion} onChange={(x:any)=>setNueva({...nueva,direccion:x})}/>
        <Input label="Código postal" value={nueva.codigo_postal} onChange={(x:any)=>setNueva({...nueva,codigo_postal:x})}/>
        <Input label="Población" value={nueva.poblacion} onChange={(x:any)=>setNueva({...nueva,poblacion:x})}/>
        <Select label="Provincia" value={nueva.provincia} onChange={(x:any)=>setNueva({...nueva,provincia:x})} options={["",...provinceOptions]} labels={{"":"Sin provincia"}}/>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={nueva.predeterminada} onChange={e=>setNueva({...nueva,predeterminada:e.target.checked})}/>Marcar como predeterminada</label>
      </div>
      <button onClick={add} className="mt-3 rounded-2xl bg-slate-900 px-4 py-2 text-white">Añadir dirección</button>
    </div>
  </div>;
}
function WorkerFields({v,setV}:any){return <div className="grid gap-3 md:grid-cols-2"><Input label="Nombre" value={v.name} onChange={(x:any)=>setV({...v,name:x})}/><Input label="Teléfono" value={v.phone||""} onChange={(x:any)=>setV({...v,phone:x})}/><Input label="Email" type="email" value={v.email||""} onChange={(x:any)=>setV({...v,email:x})}/><Select label="Provincia" value={v.province||""} onChange={(x:any)=>setV({...v,province:x})} options={["",...provinceOptions]} labels={{"":"Sin provincia"}}/><Input label="Capacidad" type="number" value={v.capacity||0} onChange={(x:any)=>setV({...v,capacity:Number(x)})}/><Input label="Horas activas" type="number" value={v.active_hours||0} onChange={(x:any)=>setV({...v,active_hours:Number(x)})}/><Input label="Skills" value={v.skills||""} onChange={(x:any)=>setV({...v,skills:x})}/></div>}
function LoginScreen({onLogin}:any){const[username,setUsername]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState("");async function submit(e:any){e.preventDefault();setError("");try{await onLogin(username,password)}catch(err:any){setError(err?.message||"No se ha podido iniciar sesión")}}return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><div className="mx-auto flex min-h-[90vh] max-w-md items-center"><Card><form onSubmit={submit} className="space-y-4"><div><h1 className="text-2xl font-bold">MerchanOps</h1><p className="text-sm text-slate-500">Acceso interno de administración y gestores.</p></div>{error&&<div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<Input label="Usuario" value={username} onChange={setUsername}/><Input label="Contraseña" type="password" value={password} onChange={setPassword}/><button className="w-full rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white">Entrar</button></form></Card></div></main>}
function UsersAdmin({users,onSave,onEdit}:any){function add(){onEdit(normalizeUser({id:uid(),username:"nuevo_gestor",password:"",display_name:"Nuevo gestor",role:"manager",active:true,provinces:[],permissions:defaultPermissions}))}function toggle(user:AppUser){onSave(users.map((x:AppUser)=>x.id===user.id?{...x,active:!x.active}:x))}return <div className="space-y-4"><Card><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h2 className="text-xl font-semibold">Usuarios y permisos</h2><p className="text-sm text-slate-500">El administrador ve todo. Cada gestor ve Servicios, ISDIN, Calendario y Pagos solo de sus provincias asignadas.</p></div><button onClick={add} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-1 inline h-4 w-4"/>Nuevo usuario</button></div></Card><Card><div className="overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Usuario</th><th>Rol</th><th>Provincias</th><th>Módulos</th><th>Estado</th><th></th></tr></thead><tbody>{users.map((user:AppUser)=><tr key={user.id} className="border-t"><td className="p-2"><b>{user.display_name}</b><p className="text-xs text-slate-500">{user.username}</p></td><td className="p-2 text-center">{user.role==="admin"?"Administrador":user.role==="almacen"?"Almacén":user.role==="rrhh"?"RR.HH.":"Gestor"}</td><td className="p-2">{user.role==="admin"?"Todas":user.role==="almacen"?"—":user.role==="rrhh"?"Ámbito nacional":(user.provinces?.length?user.provinces.join(", "):"Sin provincias")}</td><td className="p-2">{user.role==="admin"?"Todos":Object.entries(user.permissions||{}).filter(([,v])=>v).map(([k])=>k).join(", ")}</td><td className="p-2 text-center"><button onClick={()=>toggle(user)} className={`rounded-full px-3 py-1 text-xs font-semibold ${user.active?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-500"}`}>{user.active?"Activo":"Inactivo"}</button></td><td className="p-2 text-right"><button onClick={()=>onEdit(user)} className="rounded-xl border px-3 py-2"><Edit3 className="mr-1 inline h-4 w-4"/>Editar</button></td></tr>)}</tbody></table></div></Card></div>}
function UserEditor({value,users,save}:any){/* La contraseña nunca se muestra (puede estar hasheada): campo vacío = mantener la actual. */const[user,setUser]=useState<AppUser>(()=>({...normalizeUser(value),password:""}));const permissionKeys=["servicios","calendario","pagos","isdin","logistica","rrhh","usuarios"] as const;function persist(){const normalized=normalizeUser({...user,password:user.password||String(value?.password||"")});save(users.some((x:AppUser)=>x.id===normalized.id)?users.map((x:AppUser)=>x.id===normalized.id?normalized:x):[...users,normalized])}function toggleProvince(province:string){setUser(u=>({...u,provinces:u.provinces?.includes(province)?u.provinces.filter(p=>p!==province):[...(u.provinces||[]),province]}))}function togglePermission(key:AppPermissionKey){setUser(u=>({...u,permissions:{...u.permissions,[key]:!u.permissions?.[key]}}))}/* Roles con matriz de permisos y provincias fijas por código: no se editan a mano. */const sinAmbitoEditable=user.role==="admin"||user.role==="almacen"||user.role==="rrhh";const isAdmin=sinAmbitoEditable;return <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2"><Input label="Nombre visible" value={user.display_name} onChange={(v:any)=>setUser({...user,display_name:v})}/><Input label="Usuario" value={user.username} onChange={(v:any)=>setUser({...user,username:v})}/><Input label="Contraseña (en blanco = mantener la actual)" type="password" value={user.password} onChange={(v:any)=>setUser({...user,password:v})}/><Select label="Rol" value={user.role} onChange={(v:any)=>setUser({...user,role:v,permissions:v==="admin"?adminPermissions:user.permissions})} options={["admin","manager","almacen","rrhh"]} labels={{admin:"Administrador",manager:"Gestor",almacen:"Almacén (picking móvil LOGS)",rrhh:"RR.HH. (solo altas y accesos)"}}/><label className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm"><input type="checkbox" checked={user.active} onChange={e=>setUser({...user,active:e.target.checked})}/> Usuario activo</label></div>{!isAdmin&&<div className="rounded-2xl bg-slate-50 p-4"><h3 className="mb-2 font-semibold">Provincias visibles</h3><div className="grid max-h-56 gap-2 overflow-auto md:grid-cols-3">{provinceOptions.map(province=><label key={province} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={user.provinces?.includes(province)||false} onChange={()=>toggleProvince(province)}/>{province}</label>)}</div></div>}{!isAdmin&&<div className="rounded-2xl bg-slate-50 p-4"><h3 className="mb-2 font-semibold">Módulos visibles</h3><div className="grid gap-2 md:grid-cols-3">{permissionKeys.filter(k=>k!=="usuarios").map(key=><label key={key} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={!!user.permissions?.[key]} onChange={()=>togglePermission(key)}/>{key}</label>)}</div></div>}<button onClick={persist} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar usuario</button></div>}
function Modal({title,children,onClose}:any){return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"><div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="rounded-xl border p-2"><X className="h-4 w-4"/></button></div>{children}</div></div>}
function Card({children}:any){return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>}
// Tarjeta de KPI: delega en la pieza del sistema visual (etiqueta diminuta en
// mayúsculas, cifra en serif y filete de color arriba). Mantiene la misma firma
// de props, así que todas las pestañas que ya la usaban siguen igual.
function Kpi({label,value,icon:Icon,accent}:any){return <MoKpi label={label} value={value} icon={Icon} accent={accent}/>}
function Mini({label,value}:any){return <div className="rounded-xl bg-slate-50 p-2"><p className="text-slate-500">{label}</p><b>{value}</b></div>}
function BarChart({title,data}:any){const max=Math.max(1,...data.map((d:any)=>Number(d.value||0)));return <Card><h3 className="mb-3 font-semibold">{title}</h3>{data.length===0?<p className="text-sm text-slate-500">Sin datos.</p>:data.map((d:any)=><div key={d.label} className="mb-3"><div className="flex justify-between gap-3 text-sm"><span className="truncate">{d.label}</span><b>{d.displayValue??d.value}</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-slate-900" style={{width:`${Math.max(4,(Number(d.value||0)/max)*100)}%`}}/></div></div>)}</Card>}
function AlertBox({title,items,empty,render}:any){return <Card><h2 className="mb-3 font-semibold">{title}</h2>{items.length===0?<p className="text-sm text-slate-500">{empty}</p>:items.map((x:Service)=><div key={x.id} className="border-t py-3">{render(x)}</div>)}</Card>}
function Input({label,value,onChange,type="text"}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><input type={type} value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2"/></label>}
function Textarea({label,value,onChange}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><textarea value={value??""} onChange={e=>onChange(e.target.value)} rows={5} className="w-full rounded-2xl border p-3"/></label>}
function Select({label,value,onChange,options,labels={}}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o:string)=><option key={o} value={o}>{labels[o]||o||"Seleccionar"}</option>)}</select></label>}
function SelectMini({value,onChange,options,labels={}}:any){return <select value={value??""} onChange={e=>onChange(e.target.value)} className="rounded-xl border bg-white px-2 py-1 text-sm">{options.map((o:string)=><option key={o} value={o}>{labels[o]||o||"Seleccionar"}</option>)}</select>}
