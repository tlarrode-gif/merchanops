# Documentación de empresa · MerchanOPS

Documentos en Word pensados para la carpeta compartida de MerchanCore, no para el
equipo técnico. Describen MerchanOPS en lenguaje de negocio y se mantienen aparte
de las auditorías y los roadmaps de `docs/`, que son cuadernos de ingeniería y no
deberían publicarse tal cual (contienen importes reales y detalle de seguridad).

| Documento | Qué responde | Audiencia |
|---|---|---|
| `01_MerchanOPS_Ficha_de_proyecto.docx` | Qué es, qué problema resuelve, quién lo usa, en qué estado está. Una hoja. | Cualquiera que entre en la carpeta |
| `02_MerchanOPS_Mapa_funcional.docx` | Las veinte pantallas, una a una: qué hace, quién la usa, con qué conecta. | Negocio y usuarios |
| `03_MerchanOPS_dentro_de_MerchanCore.docx` | Dónde acaba MerchanOPS y empieza MerchanLOGS, qué comparten, cómo viaja una petición de material y dónde se hace cada cosa. | Ambos equipos, oficina y almacén |
| `04_MerchanOPS_Roles_y_permisos.docx` | Los cuatro roles, los siete permisos, el ámbito provincial y la matriz de acceso por pantalla. | Administración y responsables de equipo |

## Criterios de contenido

- **Nada de A3.** La integración con A3 es futura, así que ningún documento la
  presenta como existente. El campo que RR.HH. teclea aparece como «número de
  referencia». Al conectarla habrá que revisar los documentos 02 y 03.
- **Las cifras van fechadas.** La volumetría del documento 01 es de la auditoría
  del 29/07/2026 y lo dice explícitamente.
- **Los pendientes se documentan.** El documento 03 cierra con lo que falta del
  encaje entre aplicaciones, sin detalle sensible.

## Cómo regenerarlos

Los `.docx` se generan con scripts de [docx-js](https://docx.js.org). Los scripts
no están versionados aquí: si hay que rehacerlos, se parte del contenido del propio
documento. Al actualizar cualquiera de los cuatro, revisa la fecha y el número de
versión de la portada.
