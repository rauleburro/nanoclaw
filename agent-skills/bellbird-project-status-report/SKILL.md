---
name: bellbird-project-status-report
description: >-
  Genera el reporte mensual consolidado de todos los proyectos activos de
  Bellbird (Kegler, Iribas, Puntofarma, TU PRIME/App Bienestar) con metricas por
  proyecto: horas vs cap, story points cerrados, sprint activo y carga horaria
  por persona. Usar cuando el usuario pida "estado de los proyectos", "reporte
  del mes", "como vamos en mayo", "horas del mes", "story points de farma",
  "carga horaria de Martin/Amir", "dashboard de proyectos" o variantes. No usar
  para reportes de un solo proyecto ni para crear o modificar issues.
---

# Bellbird Project Status Report

Genera un reporte mensual consolidado para los proyectos activos de Bellbird:

- Kegler (`KG`): horas contra cap mensual de 80h.
- Iribas (`IRB`): worklogs contra cap mensual de 16h.
- Puntofarma/Farma (`FR`): story points cerrados contra meta mensual de 80 SP y sprint activo.
- TU PRIME/App Bienestar (`TP`): horas del mes y estado de liquidacion/cierre.

Usa siempre datos actuales de Jira. No reutilices valores historicos sin verificar con la API.

## Jira

- Cloud URL: `https://bellbird-dev.atlassian.net`
- cloudId: `9fd67552-6d2e-412b-b8f8-2207c3e887ff`
- Si hay herramientas Atlassian disponibles, primero confirma la instancia con `Atlassian:getAccessibleAtlassianResources`.

Campos criticos:

| Campo | Jira ID | Uso |
|---|---|---|
| Story Points activo | `customfield_10032` | Campo real en uso para SP. |
| Story Points legacy | `customfield_10016` | Fallback para issues viejos con SP solo en legacy. |
| Sprint | `customfield_10020` | Array de sprints; filtrar por `state: "active"`. |
| PR data | `customfield_10000` | JSON/string con datos de PR cuando haga falta. |
| Remaining estimate | `timetracking.remainingEstimateSeconds` | Horas restantes de sprint, especialmente Kegler. |
| Original estimate | `timetracking.originalEstimateSeconds` | Estimacion original para Kegler. |

## Antes de calcular

1. Determina el mes:
   - Default: mes calendario en curso.
   - `fecha_inicio`: `YYYY-MM-01`.
   - `fecha_fin`: ultimo dia del mes.
   - `hoy`: fecha actual.
   - `pct_mes`: dias transcurridos / dias totales.
2. Para carga individual, confirma calendario laboral si el usuario pide precision:
   - ES/Madrid mayo 2026: 1/may y 15/may.
   - PY mayo 2026: 1/may, 14/may y 15/may.
   - Si no se confirma, declara el calendario asumido en el reporte.

## Quirks de Jira

- No filtres `issuetype` en JQL con nombres en espanol. En esta instancia puede devolver vacio. Trae issues y filtra client-side.
- Excluye client-side de analisis de SP/estado: `subtarea`, `sub-task`, `subtask`, `epic`.
- Incluye para analisis principal: `Historia`, `Error`, `Tarea`.
- Para horas de proyecto, incluye worklogs de subtareas cuando existan, especialmente en Farma.
- `openSprints()` puede devolver multiples sprints activos. Para Farma toma el sprint activo con `startDate` mas reciente dentro del mes; no uses el primer resultado sin inspeccionarlo.
- Pagina resultados: si `isLast` es `false`, sigue con `nextPageToken`.
- La busqueda puede traer solo 20 worklogs inline por issue. Si `worklog.total > 20`, consulta el endpoint de worklogs del issue.

## Recoleccion base

Ejecuta por proyecto (`KG`, `IRB`, `FR`, `TP`):

```jql
project = {KEY}
AND (
  worklogDate >= "{YYYY-MM-01}"
  AND worklogDate <= "{YYYY-MM-last}"
  OR statusCategory != Done
)
ORDER BY status ASC, updated DESC
```

Campos:

```json
[
  "summary",
  "status",
  "assignee",
  "issuetype",
  "priority",
  "timetracking",
  "worklog",
  "resolutiondate",
  "customfield_10020",
  "customfield_10032",
  "customfield_10016"
]
```

Normaliza estados:

```python
STATUS_CANON = {
    "tareas por hacer": "TODO", "to do": "TODO", "backlog": "TODO",
    "en curso": "In Progress", "in progress": "In Progress", "doing": "In Progress",
    "code review": "Code Review", "in review": "Code Review",
    "control de calidad": "QA", "qa": "QA", "testing": "QA",
    "finalizada": "Done", "done": "Done", "closed": "Done", "resolved": "Done",
    "bloqued": "Blocked", "blocked": "Blocked", "bloqueado": "Blocked",
}
```

Fallback por `statusCategory.key`: `done` -> `Done`, `new` -> `TODO`, `indeterminate` -> `In Progress`.

## Kegler (`KG`)

Metrica principal: consumo real contra 80h/mes.

```python
consumo_real = sum(
    max(worklog_mes_h, original_estimate_h) if original_estimate_h else worklog_mes_h
    for issue in tareas_con_worklog_del_mes
)
```

Tambien consulta sprint activo:

```jql
project = KG AND sprint in openSprints()
```

Filtra subtareas/epics client-side. Reporta:

- Tabla: issue, estado, worklog del mes, estimado original, max usado, ganador.
- Total `consumo_real`, porcentaje contra 80h y proyeccion fin de mes.
- Sprint activo: horas originales, gastadas, restantes y si esta vencido.
- Tareas sin estimacion.

Alertas:

- `consumo_real / 80 > 0.80`: riesgo de cap.
- `consumo_real / (80 * pct_mes) < 0.50`: ritmo bajo.
- Code Review con `remainingEstimateSeconds = null`.
- Sprint vencido si `endDate < hoy`.
- Sprint con nombre de mes anterior, por ejemplo `Abril KEG`, aunque siga activo.

## Iribas (`IRB`)

Metrica principal: suma directa de worklogs del mes contra 16h/mes.

```python
horas_mes = sum(worklogs_mes_h)
pct_cap = horas_mes / 16
proyeccion = horas_mes / dias_transcurridos * dias_totales
```

Reporta:

- Horas mes, cap, porcentaje y proyeccion.
- Conteo de tablero por estado.
- Worklogs por persona.

Alertas:

- `pct_cap > 0.75` a mitad de mes.
- `proyeccion > 16`.
- `horas_mes / (16 * pct_mes) < 0.70`: ritmo bajo.

## Puntofarma/Farma (`FR`)

Metrica principal: story points cerrados contra 80 SP/mes.

SP cerrados en el mes:

```jql
project = FR
AND statusCategory = Done
AND resolutiondate >= "{YYYY-MM-01}"
AND resolutiondate <= "{YYYY-MM-last}"
```

Filtra client-side a Historia/Error/Tarea. Suma `customfield_10032`; si es nulo o cero, usa `customfield_10016`.

Sprint activo abierto:

1. Consulta:

```jql
project = FR AND sprint in openSprints()
```

2. Inspecciona `customfield_10020` y elige el sprint con `state: "active"` y `startDate` mas reciente dentro del mes.
3. Luego consulta por nombre:

```jql
project = FR AND sprint = "{sprint_name}" AND statusCategory != Done
```

Reporta:

- Done este mes: issue, tipo, SP, fecha de cierre, asignado.
- Sprint abierto agrupado por `TODO`, `In Progress`, `Code Review`, `QA`, `Blocked`, con SP por grupo.
- Header de Jira como `TODO SP | activos SP | Done SP en sprint`.
- Dias desde el ultimo cierre.

Alertas:

- `sp_cerrados / 80 < 0.30` a mitad de mes.
- QA/Code Review sin moverse por mas de 5 dias.
- Mas de 5 dias laborables sin cierres.
- Sprint vencido si `endDate < hoy`.

## App Bienestar / TU PRIME (`TP`)

Metrica principal: worklogs del mes y tareas abiertas, sin cap.

Reporta:

- Horas mes y distribucion por persona.
- Conteo de tareas abiertas por estado.
- Total abierto.

Alertas de liquidacion:

- `total_abiertas > 10`: no parece estar liquidando.
- `TODO > 5`: backlog alto para cierre.
- `horas_mes < 20`: ritmo insuficiente para cerrar, salvo que el usuario indique pausa o alcance reducido.

## Carga horaria individual

Usa todos los worklogs recolectados del mes. Personas principales:

- Martin Cardozo.
- Amir Benitez.

Para cada dia laboral pasado:

- Verde: `>= 6h`.
- Amarillo: `> 0h` y `< 6h`.
- Rojo: `0h`.
- Blanco: feriado o fin de semana.

Resumen:

```text
Persona   | Horas mes | Esperado | % | Dias sin carga | Dias parciales
Martin C. | 51.0h     | 72h      | 71% | 0             | 3
Amir B.   | 16.5h     | 72h      | 23% | 3             | 4
```

Alertas:

- Dias laborales pasados sin carga.
- Dias con menos de 6h.
- Total mensual por persona menor al 70% esperado.
- Menor al 50% esperado: alerta critica.

## Formato del reporte

Entrega en espanol, conciso pero accionable:

1. Resumen ejecutivo con cuatro tarjetas o tabla compacta:

```text
Proyecto       | Avance
Kegler         | 22.5h/80h, 28%
Iribas         | 12.5h/16h, 78%
Farma          | 14 SP/80 SP, 17%
App Bienestar  | 12.5h, 36 abiertas
```

2. Kegler: horas vs cap, sprint activo, tareas sin estimacion.
3. Iribas: horas vs cap, proyeccion, tablero y personas.
4. Farma: SP cerrados, sprint abierto, header Jira y dias sin cierre.
5. App Bienestar: horas, personas y tareas abiertas.
6. Carga individual: calendario/resumen de Martin y Amir cuando aplique.
7. Alertas priorizadas al final: `CRITICAL`, `WARNING`, `INFO`.

## Algoritmo de alertas

```python
alertas = []

if proyeccion_iribas > 16:
    alertas.append(("CRITICAL", "Iribas", f"Proyecta {proyeccion_iribas:.1f}h; cap 16h"))

if consumo_kegler < 80 * pct_mes * 0.5:
    alertas.append(("WARNING", "Kegler", f"Ritmo bajo: {consumo_kegler:.1f}h vs {80*pct_mes:.1f}h esperado"))

if dias_sin_cierre_farma > 5:
    alertas.append(("WARNING", "Farma", f"{dias_sin_cierre_farma} dias sin cerrar tareas"))

if total_abiertas_tp > 10:
    alertas.append(("WARNING", "App Bienestar", f"{total_abiertas_tp} tareas abiertas; no cuadra con fase de cierre"))

if horas_amir < horas_esperadas * 0.5:
    alertas.append(("CRITICAL", "Amir Benitez", f"{horas_amir:.1f}h vs {horas_esperadas:.1f}h esperadas"))

if sprint_enddate and sprint_enddate < hoy:
    alertas.append(("WARNING", proyecto, f"Sprint {sprint_name!r} vencido desde {sprint_enddate:%Y-%m-%d}"))
```

## Si faltan herramientas Jira

Si el agente no tiene Atlassian MCP ni credenciales Jira REST, no inventes metricas. Responde que el skill esta preparado pero requiere acceso a `bellbird-dev.atlassian.net` y pide habilitar/conectar Jira o proveer export/API token mediante el mecanismo seguro del entorno.
