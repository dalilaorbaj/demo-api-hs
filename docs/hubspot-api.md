# HubSpot API — Documentación del proyecto Pencil

Referencia técnica de cómo este proyecto consume la API de HubSpot CRM.
Versión documentada: API v3 (CRM Objects).

---

## Autenticación

El proyecto usa una **Private App** de HubSpot (no OAuth, no API Key legacy).

- El token se configura en `.env` como `HS_TOKEN` (ver `.env.example`).
- Se envía en cada request como header HTTP:
  ```
  Authorization: Bearer <HS_TOKEN>
  ```
- El token **nunca llega al navegador**: solo lo usa el backend Express en `server/hubspot.js`. El frontend se comunica con el proxy en `/api/*`.
- Para crear o renovar el token: HubSpot > Settings > Integrations > Private Apps.

### Scopes necesarios

| Scope | Para qué se usa |
|-------|----------------|
| `crm.objects.contacts.read` | Listar y leer contactos |
| `crm.objects.deals.read` | Listar y leer negocios (con historial de etapa) |
| `crm.objects.owners.read` | Resolver nombres de propietarios |
| `crm.objects.companies.read` | Asociaciones de contactos/deals con empresas |
| `sales-email-read` | Leer emails registrados en el CRM |
| `crm.objects.tasks.read` (o `tasks`) | Leer tareas |
| Scopes de engagements (calls, meetings, notes) | Leer actividades |

> Si algún scope falta, el endpoint `/api/activities` lo tolera: omite el tipo de actividad sin romper la respuesta (ver sección "Actividades").

---

## Endpoints utilizados

Todos los requests salen desde `server/index.js` a través de `hsGet()` / `hsPost()` en `server/hubspot.js`.
La URL base es `https://api.hubapi.com`.

### 1. Pipelines

**Propósito:** obtener la estructura de pipelines de deals (etapas, metadatos de ganado/perdido).

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Endpoint HubSpot | `/crm/v3/pipelines/deals` |
| Objeto | Pipelines de deals |
| TTL cache | 1 hora |
| Paginación | No (la API devuelve todos los pipelines en una sola respuesta) |

**Parámetros relevantes:** ninguno adicional.

**Limitaciones:** solo trae pipelines de **deals**. Pipelines de tickets u otros objetos requieren endpoints separados (no usados aquí).

---

### 2. Owners (propietarios)

**Propósito:** resolver IDs de propietario a nombres legibles (vendedores del equipo).

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Endpoint HubSpot | `/crm/v3/owners?limit=100` |
| Objeto | Owners |
| TTL cache | 1 hora |
| Paginación | No (se asume que el equipo tiene menos de 100 owners) |

---

### 3. Propiedades de un objeto

**Propósito:** obtener las definiciones de todas las propiedades de un tipo de objeto (nombre, label, grupo). Se usa en el drawer de detalle de contacto/deal para mostrar labels en vez de claves técnicas.

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Endpoint HubSpot | `/crm/v3/properties/{object}` |
| Objeto | `contacts`, `deals`, o cualquier objeto CRM |
| TTL cache | 1 hora |
| Paginación | No |

**Parámetros relevantes:** `{object}` es el nombre del objeto (p.ej. `contacts`, `deals`).

---

### 4. Listado de contactos

**Propósito:** traer todos los contactos activos con un subconjunto de propiedades para la tabla y el índice de adopción.

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Endpoint HubSpot | `/crm/v3/objects/contacts` |
| Objeto | Contacts |
| TTL cache | 5 minutos |
| Paginación | Sí — hasta 10 páginas × 100 registros = máximo 1 000 contactos |

**Propiedades solicitadas:**
`firstname`, `lastname`, `email`, `phone`, `company`, `jobtitle`, `lifecyclestage`, `hs_lead_status`, `createdate`, `lastmodifieddate`, `hubspot_owner_id`

**Limitaciones:**
- El tope de 1 000 contactos es una decisión de la demo (parámetro `maxPages = 10` en `server/index.js`). Para cuentas grandes habría que paginar más o usar la Search API.
- Las propiedades custom no se incluyen en este listado (sí aparecen en el drawer de detalle).

---

### 5. Listado de deals

**Propósito:** traer todos los negocios activos con sus etapas e **historial de cambio de etapa**, necesario para calcular avances manuales en el índice de adopción.

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Endpoint HubSpot | `/crm/v3/objects/deals` |
| Objeto | Deals |
| TTL cache | 5 minutos |
| Paginación | Sí — hasta 10 páginas × **50** registros = máximo 500 deals |

> El límite por página se reduce a 50 (en vez de 100) porque HubSpot restringe a 50 objetos por request cuando se pide `propertiesWithHistory`.

**Propiedades solicitadas:**
`dealname`, `amount`, `dealstage`, `pipeline`, `closedate`, `createdate`, `hs_lastmodifieddate`, `hubspot_owner_id`

**Historia solicitada:** `dealstage` (todos los cambios de etapa con timestamp y `sourceType`).

**Limitaciones:**
- Tope de 500 deals por la misma razón que contactos.
- El historial de `dealstage` solo está disponible con `propertiesWithHistory`, que reduce el page size.

---

### 6. Listado de tareas

**Propósito:** traer tareas asignadas a los vendedores para calcular la dimensión "tareas" del índice de adopción y mostrar la tabla de tareas.

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Endpoint HubSpot | `/crm/v3/objects/tasks` |
| Objeto | Tasks (tipo especial de engagement) |
| TTL cache | 5 minutos |
| Paginación | Sí — hasta 10 páginas × 100 = máximo 1 000 tareas |

**Propiedades solicitadas:**
`hs_task_subject`, `hs_task_status`, `hs_task_priority`, `hs_task_type`, `hs_timestamp`, `hubspot_owner_id`, `hs_createdate`

---

### 7. Actividades (calls, emails, meetings, notes)

**Propósito:** traer las interacciones registradas en el CRM para el feed de actividades y el índice de adopción.

Se hacen **4 requests separados** (uno por tipo), de forma tolerante a fallos: si falta el scope de uno, se omite ese tipo y los demás se siguen cargando.

| Tipo | Endpoint HubSpot | Propiedades clave |
|------|-----------------|-------------------|
| Llamadas | `/crm/v3/objects/calls` | `hs_call_title`, `hs_call_body`, `hs_call_direction`, `hs_call_duration`, `hs_timestamp`, `hubspot_owner_id` |
| Emails | `/crm/v3/objects/emails` | `hs_email_subject`, `hs_email_text`, `hs_email_direction`, `hs_timestamp`, `hubspot_owner_id` |
| Reuniones | `/crm/v3/objects/meetings` | `hs_meeting_title`, `hs_meeting_body`, `hs_meeting_start_time`, `hs_timestamp`, `hubspot_owner_id` |
| Notas | `/crm/v3/objects/notes` | `hs_note_body`, `hs_timestamp`, `hubspot_owner_id` |

| Campo común | Valor |
|------------|-------|
| Método | `GET` (paginado) |
| TTL cache | 5 minutos |
| Paginación | Hasta 5 páginas × 100 = máximo 500 registros por tipo (2 000 en total) |

---

### 8. Detalle de un contacto

**Propósito:** mostrar todas las propiedades de un contacto en el drawer lateral, junto con sus asociaciones.

Se realizan **3 requests encadenados**:

1. `GET /crm/v3/properties/contacts` — lista completa de nombres de propiedades (cache 1 h)
2. `POST /crm/v3/objects/contacts/batch/read` — leer **todas** las propiedades del contacto por ID (evita el límite de longitud de URL de un GET normal)
3. `GET /crm/v3/objects/contacts/{id}?associations=deals,companies,tasks` — obtener los IDs de objetos asociados

**Body del batch/read:**
```json
{
  "properties": ["<todas las propiedades>"],
  "inputs": [{ "id": "<contactId>" }]
}
```

---

### 9. Detalle de un deal

Idéntico a detalle de contacto, pero para el objeto `deals` con asociaciones `contacts,companies,line_items`.

---

## Rate limits

> Fuente: documentación oficial de HubSpot (verificar en [developers.hubspot.com](https://developers.hubspot.com/docs/api/usage-details) para actualizaciones).

| Plan | Límite por burst (10 s) | Límite diario |
|------|------------------------|---------------|
| Free / Starter | 100 req / 10 s | 250 000 req / día |
| Professional / Enterprise | 190 req / 10 s | 1 000 000 req / día |
| API add-on | 250 req / 10 s | (verificar) |

Cuando se supera el límite de burst, HubSpot responde con HTTP **429 Too Many Requests** e incluye el header `Retry-After` con los segundos de espera.

### Cómo lo maneja el proyecto

El throttle está en `server/hubspot.js` usando la librería **Bottleneck**:

```js
const limiter = new Bottleneck({ maxConcurrent: 2, minTime: 220 });
```

- `minTime: 220 ms` entre requests → ≈ **4.5 req/s = ~45 req/10 s**
- `maxConcurrent: 2` → máximo 2 requests en vuelo al mismo tiempo

Esto representa el **45 %** del límite Free/Starter y el **24 %** del límite Pro/Enterprise. El margen es amplio a propósito: la demo no necesita velocidad máxima y protege la cuenta de cualquier burst accidental.

**Manejo de 429:** si HubSpot responde 429, el código hace hasta **3 reintentos** con backoff exponencial, respetando el header `Retry-After`. Los 429s se cuentan en `stats.rateLimited` (visible en la barra de estado del frontend).

**Lo que no tiene el proyecto:**
- Sin circuit breaker (si HubSpot cae, los requests fallan directamente).
- Stats de rate limit en memoria: se resetean al reiniciar el servidor.
- Sin alerta automática si `rateLimited` supera un umbral.

**Propuesta si fuera necesario agregar más robustez:**
Agregar un circuit breaker con una librería como `opossum`, y persistir los stats de llamadas en un archivo para sobrevivir reinicios.

---

## Search API — por qué no se usa y qué implicaría agregarla

Este proyecto **no usa la Search API** de HubSpot (`/crm/v3/objects/{object}/search`).

Hoy, todos los filtros y agrupaciones se hacen en el cliente (JavaScript) después de traer los datos. Eso funciona para cuentas pequeñas pero escala mal: si hay 50 000 contactos, el listado trae hasta 1 000 y el filtro del cliente solo ve ese subconjunto.

La Search API permitiría filtrar directamente en HubSpot (por propietario, por fecha, por etapa, etc.) y traer solo los registros relevantes. Sin embargo, tiene un **límite separado** del límite de CRM Objects:

| API | Límite |
|-----|--------|
| CRM Objects (GET lista) | 100 req / 10 s (Starter) |
| **Search API** | **4 req / s** (independiente del plan) |

El límite de 4 req/s de Search es estricto y global por portal. Si se agregara Search para filtrar contactos por vendedor, ese tráfico consumiría el cupo de Search de toda la cuenta — incluyendo cualquier otra integración que la use.

**Recomendación:** si se necesita filtrado del lado del servidor, evaluar primero aumentar `maxPages` en los listados existentes (más barato en complejidad) o implementar Search con throttle propio y cache agresiva para no saturar el cupo.

---

## Qué se puede / qué no se puede hacer con la API en el estado actual

### Se puede

- Leer contactos, deals, tareas y actividades (calls, emails, meetings, notes).
- Ver el historial de cambios de etapa de un deal (quién lo movió y cuándo).
- Resolver nombres de propietarios y estructuras de pipelines.
- Ver todas las propiedades de un contacto o deal en el drawer de detalle.
- Ver las asociaciones de un contacto (deals, empresas, tareas vinculadas).

### No se puede (con el estado actual del código)

| Limitación | Causa |
|-----------|-------|
| **Crear o modificar registros** | Solo se usan métodos de lectura (`GET`, `POST /batch/read`). La Private App podría tener scopes de escritura, pero el código no los usa. |
| **Ver más de ~1 000 contactos o ~500 deals** | El paginador tiene un tope de `maxPages = 10`. Aumentarlo incrementa el número de llamadas a la API. |
| **Filtrar por propietario, fecha o etapa en origen** | No se usa la Search API. El filtrado es client-side sobre los datos ya descargados. |
| **Ver tickets, quotes, line items o custom objects** | No están implementados. Requieren scopes y rutas adicionales. |
| **Ver email de marketing o secuencias** | Fuera del alcance; son APIs diferentes (`/marketing/v3/emails`, etc.). |
| **Datos en tiempo real** | HubSpot no tiene WebSockets. La forma de aproximarse es reducir el TTL de cache y usar polling, o implementar webhooks (infraestructura adicional). |
