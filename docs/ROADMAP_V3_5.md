# MerchanOps V3.5 - Grandes cambios

La V3.1 deja la app estable y operativa. La V3.5 debe convertir MerchanOps en una herramienta de control avanzado para planificación, reporting, pagos y rendimiento.

## Objetivo general

Pasar de una app de registro y seguimiento a una herramienta de mando operativo.

La V3.5 debe ayudarte a responder rápido a estas preguntas:

- Qué servicios están en riesgo.
- Qué trabajador está saturado.
- Qué puntos están parados y por qué.
- Qué cliente genera más incidencias.
- Qué pagos están pendientes, validados o cerrados.
- Qué servicios no tienen datos suficientes para liquidarse.
- Qué campañas tienen peor cumplimiento.

---

## 1. Dashboard operativo avanzado

Crear un panel inicial más completo y visual.

### KPIs generales

- Servicios activos.
- Servicios validados.
- Servicios fuera de plazo.
- Servicios con incidencia.
- Puntos totales.
- Puntos pendientes.
- Puntos reportados.
- Puntos finalizados.
- Puntos con incidencia.
- Puntos pospuestos.
- Total validado pendiente de pago.
- Total por horas.
- Total por puntos.
- Tasa de cumplimiento a tiempo.
- Tasa de incidencia.
- Tasa de reporte.
- Tiempo medio de cierre.

### Gráficos

- Servicios por estado.
- Puntos por estado.
- Carga activa por trabajador.
- Cumplimiento a tiempo por trabajador.
- Pagos por trabajador.
- Pagos por cliente.
- Incidencias por cliente.
- Evolución semanal: creados / validados / incidencias.

---

## 2. Vista de trabajador 360º

Crear una pantalla más potente para cada trabajador.

### Datos a mostrar por trabajador

- Nombre.
- Teléfono.
- Provincia base.
- Especialidades.
- Servicios activos.
- Puntos activos.
- Puntos pendientes.
- Puntos reportados.
- Puntos finalizados.
- Servicios fuera de plazo.
- Incidencias abiertas.
- Total validado en el periodo.
- Cumplimiento a tiempo.
- Tiempo medio de cierre.
- Carga semanal estimada.

### Vista tipo calendario/agenda

- Servicios activos por fechas.
- Fecha inicio.
- Fecha límite.
- Cliente.
- Campaña.
- Provincia.
- Número de puntos.
- Estado.
- Total previsto.

---

## 3. Control de pagos avanzado

La sección de pagos debe pasar a ser una herramienta de liquidación.

### Filtros

- Fecha desde / hasta.
- Trabajador.
- Cliente.
- CECO.
- Tipo de pago: puntos / horas / mixto.
- Estado: validado / pagado / pendiente.

### Vistas

- Resumen por trabajador.
- Resumen por cliente.
- Resumen por CECO.
- Detalle de servicios.
- Detalle de puntos.
- Detalle de horas.

### Cierre de pagos

Añadir concepto de periodo de pago:

- Pendiente.
- Exportado.
- Cerrado.

Objetivo: evitar modificar sin querer pagos ya enviados a contabilidad.

### Alertas de pago

- Servicios validados sin importe.
- Servicios por horas sin precio/hora.
- Servicios por horas sin horas trabajadas.
- Puntos sin importe.
- Puntos sin código de reporte.
- Servicios pagados sin fecha de validación.

---

## 4. Servicios: filtros y limpieza de datos

Añadir filtros rápidos y checks de calidad.

### Filtros rápidos

- Sin trabajador.
- Sin puntos.
- Sin fecha límite.
- Fuera de plazo.
- Con incidencia.
- Reportados no validados.
- Validados no pagados.
- Pago por horas.
- Pago mixto.
- Puntos sin código.
- Puntos sin importe.

### Vista de errores / servicios huérfanos

Crear una sección de control de calidad con:

- Servicios sin cliente.
- Servicios sin trabajador.
- Servicios sin puntos.
- Servicios sin fecha límite.
- Servicios con puntos sin importe.
- Servicios con puntos sin código de reporte.
- Servicios por horas sin horas o sin precio/hora.
- Servicios validados sin fecha de validación.
- Incidencias sin comentario.

---

## 5. Importación desde Excel

Permitir importar puntos desde Excel para reducir trabajo manual.

### Columnas esperadas

- Nombre.
- Dirección.
- Importe.
- Código de reporte.
- Notas.
- Provincia.

### Funcionamiento

- Subir archivo Excel.
- Previsualizar puntos antes de guardar.
- Detectar columnas automáticamente cuando sea posible.
- Avisar de filas incompletas.
- Crear puntos en el servicio.

---

## 6. Plantillas de mensajes

Crear generador de mensajes para distintos momentos.

### Plantillas necesarias

- Asignación de servicio.
- Recordatorio por demora.
- Solicitud de reporte.
- Confirmación de recepción de material.
- Aviso de incidencia.
- Servicio pendiente de validar.
- Cierre de campaña.

### Personalización

Cada plantilla debe insertar automáticamente:

- Trabajador.
- Cliente.
- Campaña.
- Fecha límite.
- Puntos pendientes.
- Total previsto.
- Canal de reporte.

---

## 7. Historial de cambios

Crear una tabla o mecanismo de auditoría para registrar cambios importantes.

### Cambios a registrar

- Servicio creado.
- Trabajador asignado.
- Fecha límite modificada.
- Estado de servicio modificado.
- Estado de punto modificado.
- Importe modificado.
- Servicio validado.
- Servicio pagado.
- Periodo de pago cerrado.

---

## 8. Prioridad propuesta

### V3.5.1

- Dashboard avanzado.
- Mejora sección trabajadores.
- Mejora sección pagos.
- Filtros rápidos de servicios.
- Vista de errores / calidad de datos.

### V3.5.2

- Importación desde Excel.
- Plantillas de mensajes.
- Cierre de pagos.

### V3.5.3

- Historial de cambios.
- Auditoría.
- Mejoras de permisos y roles.
