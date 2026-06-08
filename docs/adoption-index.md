# Índice de adopción — Documentación técnica

El índice de adopción mide cuánto usa el equipo de ventas HubSpot en el día a día.
Está implementado en `src/components/Adoption.tsx`.

---

## Propósito

Dar al responsable del equipo una vista objetiva de qué tan integrado está HubSpot en el trabajo real de cada vendedor: no solo si entran al sistema, sino si registran actividad, crean oportunidades y mantienen el pipeline actualizado.

El resultado es un **score de 0 a 100** por vendedor, compuesto de 6 dimensiones ponderadas.

---

## Fuentes de datos

El componente consume los siguientes endpoints del proxy:

| Endpoint | Dato que aporta |
|----------|----------------|
| `/api/contacts` | Contactos creados por vendedor y fecha de creación |
| `/api/deals` | Deals creados + historial de cambios de etapa (`propertiesWithHistory=dealstage`) |
| `/api/tasks` | Tareas asignadas y su estado de completado |
| `/api/activities` | Llamadas, emails, reuniones y notas registradas |
| `/api/owners` | Nombres de los vendedores (para display) |
| `/api/pipelines` | Metadatos de etapas (para identificar deals cerrados) |

---

## Ventana de tiempo

Los volúmenes de actividad se miden en las **últimas 10 semanas** (constante `WEEKS = 10`), contando desde el lunes de la semana actual hacia atrás.

El objetivo es reflejar la **adopción reciente**, no el histórico acumulado desde que se creó la cuenta (que podría incluir datos migrados de otro sistema).

La única dimensión que usa todo el tiempo histórico es **Recencia** (ver más abajo).

---

## Eventos de CRM

Internamente se construye una lista unificada de "eventos de uso del CRM":

| Tipo de evento (`kind`) | Fuente |
|------------------------|--------|
| `activity` | Cualquier actividad (llamada, email, reunión, nota) con `ownerId` y `timestamp` válidos |
| `contact` | Creación de un contacto (usa `createdate` del contacto) |
| `deal` | Creación de un deal (usa `createdate` del deal) |
| `stage` | Avance manual de etapa de un deal (ver sección de avances de etapa) |

Cada evento queda asociado a un `ownerId` y a un timestamp. Estos eventos se agrupan por vendedor y se usan para calcular las 6 dimensiones.

### Avances de etapa manuales

Para el tipo `stage`, el código lee el historial de `dealstage` de cada deal y extrae solo los cambios donde:
1. No es el primer valor registrado (la etapa inicial al crear el deal no cuenta como "avance").
2. `sourceType === 'CRM_UI'` — solo se cuentan movimientos hechos por una persona en la interfaz de HubSpot.

Quedan excluidos los cambios automáticos de etapa (workflows, integraciones, imports).

```ts
const MANUAL_SOURCES = new Set(['CRM_UI']);
```

---

## Las 6 dimensiones

### 1. Actividad (`actividad`) — peso 25 %

**Qué mide:** cantidad de interacciones registradas en HubSpot (llamadas + emails + reuniones + notas) en la ventana de 10 semanas.

**Fórmula:**
```
score = min(100, (cantidad_actividades / 20) × 100)
```

**Target:** 20 actividades en 10 semanas (2 por semana) → 100 %.

**Cómo se calcula:** se filtran las actividades de `/api/activities` por `ownerId` y por fecha dentro de la ventana.

---

### 2. Creación (`creacion`) — peso 20 %

**Qué mide:** contactos y deals dados de alta en HubSpot en la ventana de 10 semanas.

**Fórmula:**
```
score = min(100, ((contactos_creados + deals_creados) / 10) × 100)
```

**Target:** 10 altas totales (contactos + deals) en 10 semanas → 100 %.

**Cómo se calcula:** se usan los eventos `kind === 'contact'` y `kind === 'deal'` dentro de la ventana.

---

### 3. Pipeline (`pipeline`) — peso 15 %

**Qué mide:** avances manuales de etapa realizados en la ventana de 10 semanas.

**Fórmula:**
```
score = min(100, (avances_de_etapa / 8) × 100)
```

**Target:** 8 avances de etapa en 10 semanas → 100 %.

**Cómo se calcula:** se usan los eventos `kind === 'stage'` (solo `sourceType === 'CRM_UI'`) dentro de la ventana.

---

### 4. Constancia (`constancia`) — peso 20 %

**Qué mide:** cuántas semanas distintas (de las últimas 10) tuvo al menos un evento de CRM (cualquier tipo: actividad, alta, avance).

**Fórmula:**
```
score = min(100, (semanas_activas / 4) × 100)
```

**Target:** 4 semanas activas sobre 10 → 100 %.

**Cómo se calcula:** se cuentan las semanas (por su fecha de lunes) que tienen al menos un evento del vendedor dentro de la ventana.

---

### 5. Recencia (`recencia`) — peso 10 %

**Qué mide:** hace cuántos días fue el último evento de CRM del vendedor (sin importar de qué tipo). A diferencia de las otras dimensiones, **usa todo el historial**, no solo la ventana de 10 semanas.

**Fórmula (escala de pasos):**

| Días desde último evento | Score |
|--------------------------|-------|
| ≤ 3 días                 | 100   |
| ≤ 7 días                 | 80    |
| ≤ 14 días                | 50    |
| ≤ 30 días                | 25    |
| > 30 días                | 0     |
| Sin eventos registrados  | 0     |

**Cómo se calcula:** se busca el timestamp más reciente en la lista completa de eventos del vendedor (sin filtro de ventana) y se compara con `Date.now()`.

---

### 6. Tareas (`tareas`) — peso 10 %

**Qué mide:** tasa de completado de tareas asignadas al vendedor.

**Fórmula:**
```
score = (tareas_completadas / total_tareas) × 100
       = 0  si el vendedor no tiene tareas
```

**Cómo se calcula:** se filtran las tareas por `hubspot_owner_id` y se calcula el ratio de `hs_task_status === 'COMPLETED'` sobre el total.

---

## Score final

```
score = round(
  actividad  × 0.25 +
  creacion   × 0.20 +
  pipeline   × 0.15 +
  constancia × 0.20 +
  recencia   × 0.10 +
  tareas     × 0.10
)
```

El resultado es un entero de 0 a 100.

**Escala de colores:**

| Score | Color    |
|-------|----------|
| ≥ 67  | Verde    |
| 34–66 | Amarillo |
| < 34  | Rojo     |

---

## Exclusión de vendedores

Los vendedores cuyo nombre de display coincide con la lista `EXCLUDED_SELLERS` se omiten del tablero:

```ts
const EXCLUDED_SELLERS = new Set(['Admin User', 'Manager A', 'Manager B', 'Vendedor #81109103']);
```

Ver sección "Limitaciones conocidas" para el detalle de esta implementación.

---

## Recomendaciones automáticas

Para cada vendedor se generan dos listas:

- **Fortalezas** (`strengths`): dimensiones con score ≥ 67, con texto descriptivo de qué hace bien.
- **Oportunidades de mejora** (`recommendations`): dimensiones con score < 50, con texto concreto de qué trabajar.

Si todas las dimensiones tienen score ≥ 50, el mensaje de recomendaciones indica buen nivel de adopción.
Si ninguna dimensión supera 67, la lista de fortalezas queda vacía y se muestra un mensaje de arranque.

---

## Visualizaciones

El componente incluye cuatro secciones:

1. **KPIs del equipo** — score promedio, vendedores activos en los últimos 7 días, total de actividades y altas, total de avances de etapa.
2. **Ranking** — tabla de todos los vendedores ordenados por score descendente. Cada fila es clickeable para ver el detalle.
3. **Evolución temporal** — gráfico de líneas con la cantidad de eventos de CRM por semana para cada vendedor en las últimas 10 semanas.
4. **Detalle del vendedor** — radar chart con las 6 dimensiones + lista de fortalezas y oportunidades de mejora + KPIs individuales.

---

## Limitaciones conocidas

Las siguientes limitaciones existen en la implementación actual y están documentadas aquí para referencia futura. **No están corregidas.**

### 1. `constancia`: el target llega a 100 % con solo 4 de 10 semanas

La fórmula divide por 4 en lugar de por `WEEKS` (10):

```ts
constancia: Math.min(100, (activeWeekSet.size / 4) * 100),
```

Cualquier vendedor que haya tenido actividad en 4 o más de las últimas 10 semanas obtiene score 100 en esta dimensión. Esto hace que la dimensión sea relativamente fácil de saturar para quienes usan HubSpot aunque sea esporádicamente.

### 2. `tareas`: sin ventana temporal

Las otras cinco dimensiones de volumen miden solo eventos dentro de la ventana de 10 semanas. Las tareas no tienen ese filtro: se consideran **todas** las tareas del vendedor sin importar cuándo fueron creadas.

Consecuencia: un vendedor con muchas tareas completadas en el pasado y pocas pendientes hoy puede obtener un score de tareas alto que no refleja su comportamiento reciente.

### 3. Exclusión de vendedores por nombre de display, no por ID

`EXCLUDED_SELLERS` compara contra el resultado de `ownerLabel()`, que devuelve el nombre del owner si está en el mapa, o la cadena `"Vendedor #<id>"` si no lo está.

```ts
.filter((id) => !EXCLUDED_SELLERS.has(ownerLabel(id, ownerMap)))
```

Esto tiene dos consecuencias:
- Si un owner cuyo ID debería excluirse carga correctamente con su nombre real (p.ej. "Marcela García"), no quedará excluido a menos que ese nombre esté en `EXCLUDED_SELLERS`.
- La entrada `'Vendedor #81109103'` solo excluye al owner con ID `81109103` cuando su nombre **no** se puede resolver desde la API. Si la API de owners está disponible y devuelve un nombre para ese ID, la exclusión no funciona.

La forma robusta de excluir sería comparar directamente contra un `Set` de IDs numéricos.
