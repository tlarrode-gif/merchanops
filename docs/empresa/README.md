# Documentación de empresa · MerchanOPS

Documentos en Word pensados para la carpeta compartida de MerchanCore, no para el
equipo técnico. Describen MerchanOPS en lenguaje de negocio y se mantienen aparte
de las auditorías y los roadmaps de `docs/`, que son cuadernos de ingeniería y no
deberían publicarse tal cual (contienen importes reales y detalle de seguridad).

| Documento | Qué responde | Audiencia |
|---|---|---|
| `01_MerchanOPS_Ficha_de_proyecto.docx` | Qué es, qué problema resuelve, quién lo usa, en qué estado está. Una hoja. | Cualquiera que entre en la carpeta |
| `02_MerchanOPS_Mapa_funcional.docx` | Las veinte pantallas, una a una: qué hace, quién la usa, con qué conecta. | Negocio y usuarios |
| `04_MerchanOPS_Roles_y_permisos.docx` | Los cuatro roles, los siete permisos, el ámbito provincial y la matriz de acceso por pantalla. | Administración y responsables de equipo |

La numeración deja hueco para el documento 03 («MerchanOPS dentro de MerchanCore»),
todavía sin redactar.

## Cómo regenerarlos

Los `.docx` se generan con scripts de [docx-js](https://docx.js.org). Los scripts
no están versionados aquí: si hay que rehacerlos, se parte del contenido del propio
documento. Al actualizar cualquiera de los tres, revisa la fecha y el número de
versión de la portada.
