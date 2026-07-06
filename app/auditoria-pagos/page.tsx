import { redirect } from "next/navigation";

// La Auditoría de pagos fue sustituida por el Historial económico (Fase 3):
// mismo control cruzado, pero sobre el registro inmutable economic_events.
export default function PaymentAuditRedirect() {
  redirect("/historial-economico");
}
