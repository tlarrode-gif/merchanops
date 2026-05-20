# MerchanOps V3 - Ideas pendientes

Documento creado para trabajar en la siguiente versión de la app.

## 1. Estados por punto dentro de una campaña

Cuando una campaña tenga varios puntos, cada punto debe poder tener su propio estado independiente.

Estados necesarios por punto:

- Pendiente
- Revisado
- Reportado
- Incidencia
- Pospuesto
- Finalizado
- Pendiente recepción post-incidencia

Para los estados `Incidencia` y `Pospuesto`, la app debe permitir escribir un comentario específico del punto.

Campos propuestos en tabla `points`:

- `point_status`
- `point_comment`
- `reported_at`
- `reviewed_at`
- `finished_at`
- `post_incidence_pending_at`

## 2. Pantalla por instalador / trabajador

Crear una pantalla específica por instalador para ver sus servicios activos.

Debe incluir una vista tipo calendario o agenda para ver:

- Servicios activos por trabajador.
- Fecha de inicio.
- Fecha límite.
- Cliente.
- Campaña.
- Provincia.
- Número de puntos.
- Estado general.
- Servicios solapados.
- Carga de trabajo por semana.

Objetivo: poder ver rápidamente si un trabajador está saturado o si tiene disponibilidad.

## 3. Avisos por demora con generación de texto

En el apartado de avisos por demora, incluir una opción para generar un texto dirigido al trabajador.

Ejemplo de uso:

- Servicio fuera de plazo.
- Servicio pendiente de validación.
- Servicio pendiente de reporte.
- Servicio con puntos sin finalizar.

La app debe generar un mensaje tipo WhatsApp para comunicar al trabajador que el trabajo sigue pendiente.

El texto debería incluir:

- Nombre del trabajador.
- Cliente.
- Campaña.
- Fecha límite.
- Puntos pendientes.
- Instrucción clara para actualizar estado o reportar.

## 4. Filtros avanzados en Servicios

En el apartado Servicios, añadir filtros por:

- Instalador / trabajador.
- Cliente.
- Estado del servicio.
- Provincia.
- Fecha de inicio.
- Fecha límite.
- Servicios fuera de plazo.
- Servicios con incidencia.
- Servicios validados.
- Servicios no validados.

## 5. Sección Pagos más visual

Mejorar la sección Pagos para que sea más clara y ordenada.

Debe permitir:

- Filtrar por fecha de validación desde / hasta.
- Filtrar por trabajador.
- Filtrar por cliente.
- Filtrar por CECO.
- Ver total de dinero por trabajador en el periodo seleccionado.
- Ver total por cliente.
- Ver total por campaña.
- Ver detalle de puntos incluidos.
- Exportar detalle para contabilidad.
- Exportar resumen por trabajador.

La vista debería tener tarjetas resumen:

- Total a pagar.
- Número de trabajadores incluidos.
- Número de puntos validados.
- Cliente con mayor importe.
- Trabajador con mayor importe.

## 6. Ideas adicionales recomendadas

### 6.1 Historial de cambios

Guardar quién cambió un estado y cuándo, especialmente en:

- Cambio a Validado.
- Cambio a Incidencia.
- Cambio a Pagado.
- Cambio de trabajador asignado.
- Cambio de importe de punto.

### 6.2 Bloqueo de pagos cerrados

Cuando un periodo de pagos ya se haya exportado o cerrado, la app debería permitir marcarlo como cerrado para evitar modificaciones accidentales.

### 6.3 Campo “visible para trabajador”

Algunas notas son internas y otras son para el instalador. En el futuro convendría separar:

- Instrucciones internas.
- Instrucciones para trabajador.
- Comentarios de contabilidad.

### 6.4 Validación de datos antes de crear servicio

Antes de guardar un servicio, avisar si falta:

- Cliente.
- Trabajador.
- Fecha límite.
- Importe de punto.
- Código de reporte.
- Provincia.

### 6.5 Importación desde Excel

Permitir subir un Excel de puntos y convertirlo automáticamente en puntos de servicio.

Columnas recomendadas:

- Nombre
- Dirección
- Importe
- Código de reporte
- Notas
- Provincia

### 6.6 Vista semanal de carga de trabajo

Además del calendario por trabajador, incluir una vista semanal general:

- Trabajador
- Horas estimadas
- Servicios activos
- Puntos pendientes
- Riesgo de demora

### 6.7 Mensajes predefinidos

Crear plantillas de mensajes:

- Asignación de servicio.
- Recordatorio por demora.
- Solicitud de reporte.
- Confirmación de recepción de material.
- Comunicación de incidencia.
- Cierre de servicio.

## Prioridad sugerida para desarrollo

1. Estados por punto.
2. Filtros avanzados en Servicios.
3. Pagos más visuales y filtrables.
4. Avisos por demora con texto automático.
5. Pantalla por instalador/calendario.
6. Historial y cierre de pagos.
