# SpendSync — Gastos Comunes

PWA para el seguimiento compartido de gastos de pareja. Los datos se almacenan en Google Sheets y se sincronizan entre dispositivos en tiempo real.

---

## Características

### Registro de gastos
- Registrá gastos pagados (**Gasto**) o por pagar (**Pendiente**).
- Asigná el pago a uno solo de los usuarios o dividilo entre los dos.
- **División personalizada**: al elegir "Dividir", podés ingresar el monto exacto de cada persona en lugar de usar 50/50. La app valida que las partes sumen el total.
- Editá o eliminá cualquier movimiento ya registrado.

### Gastos propuestos
- Cuando uno de los usuarios registra un movimiento, el otro lo ve como **propuesto** hasta que lo confirma.
- Sirve para que ambos estén de acuerdo antes de que el gasto entre al historial.
- El propuesto se puede rechazar o confirmar desde la pantalla principal.

### Pendientes
- Los pendientes aparecen destacados hasta que se paguen.
- Se pueden pagar parcialmente — el resto queda como un nuevo pendiente.
- En pendientes compartidos, cada persona paga su parte de forma independiente.
- Si la división fue personalizada, el badge muestra el monto exacto de cada uno.

### Cobros y préstamos
- Registrá dinero que le pediste prestado al otro usuario (**Pedí prestado**) o que vos le prestaste (**Presté dinero**).
- El cobro aparece visible en ambos dispositivos, con el badge en rojo indicando cuántos cobros hay pendientes.
- El deudor marca el cobro como pagado tocando **Pagar** — el cobro desaparece y se genera automáticamente un gasto en su historial.
- Si el otro dispositivo registra un nuevo cobro, la app notifica en la próxima sincronización.

### Historial y filtros
- Historial ordenado por mes con resumen de totales por período.
- Filtros por usuario (ver solo los gastos de uno, compartidos, o todos) y por categoría.
- El resumen mensual refleja siempre la división real: si un compartido tiene montos personalizados, el resumen muestra esos montos y no el 50/50.

### Estadísticas
- Gráfico de barras del gasto mensual por persona.
- Desglose por categoría con porcentajes.
- Sección oculta/desplegable para no ocupar espacio en pantalla.

### Categorías
- Creá categorías con nombre, icono (emoji) y color desde Ajustes.
- Asignale una categoría a cada gasto al registrarlo.
- Las categorías se sincronizan entre dispositivos.

### Sincronización multidispositivo
- Los datos se guardan en Google Sheets como fuente de verdad.
- Sincronización automática cada ~30 segundos en segundo plano.
- Botón **Sincronizar** para forzar una descarga inmediata.
- Cuando hay una nueva versión de la app, todos los dispositivos se actualizan automáticamente.

### Acceso y seguridad
- Dos usuarios con PIN de 4 dígitos independientes.
- RUT para recuperación de PIN olvidado (nunca sale del dispositivo/Sheet).
- Sin cuentas externas ni servicios de terceros.

### PWA (Progressive Web App)
- Instalable en el celular como app nativa (iOS y Android).
- Funciona offline usando los datos guardados localmente.
- Service Worker con estrategia network-first para archivos locales y cache-first para recursos externos (fuentes, CDN).

---

## Configuración inicial

### 1. Google Apps Script (backend)

1. Ir a [script.google.com](https://script.google.com) → Nuevo proyecto.
2. Pegar el contenido de `Code.gs`.
3. **Deploy → New deployment → Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
4. Copiar la URL generada.

### 2. Conectar la app

1. Abrir `index.js` y reemplazar el valor de `GAS_URL` con la URL del paso anterior.
2. Publicar los archivos (`index.html`, `index.js`, `index.css`, `sw.js`, `manifest.json`, `icon.svg`) en cualquier hosting estático (GitHub Pages, Netlify, etc.).

### 3. Primera vez en el celular

1. Abrir la URL en el navegador.
2. Completar el formulario de configuración inicial: nombres, PINs y RUTs de ambos usuarios.
3. Los datos se guardan en Google Sheets automáticamente.
4. El segundo usuario abre la misma URL, ingresa su PIN y ya ve los datos sincronizados.

---

## Estructura de archivos

```
index.html      Interfaz principal (SPA)
index.js        Lógica de la app (~1950 líneas)
index.css       Estilos y variables de tema
sw.js           Service Worker (caché y estrategias de red)
manifest.json   Manifiesto PWA (nombre, ícono, tema)
icon.svg        Ícono de la app
Code.gs         Backend Google Apps Script
```

### Hojas de Google Sheets (creadas automáticamente)

| Hoja | Columnas |
|------|----------|
| `Gastos` | id · fecha · concepto · monto · pagador · tipo · categoria · parte1 · parte2 |
| `Configuracion` | clave · valor |
| `Categorias` | id · nombre · icono · color |

#### Valores del campo `pagador`
- `1` — Usuario 1
- `2` — Usuario 2
- `compartido` — Gasto compartido entre los dos

#### Valores del campo `tipo`
- `gasto` — Gasto pagado
- `pendiente` — Gasto aún no pagado
- `propuesto_1` / `propuesto_2` — Propuesto por el usuario 1 o 2 (pendiente de confirmación)
- `cobro` — Préstamo/cobro entre usuarios

#### Campos `parte1` / `parte2`
Opcionales. Solo presentes en gastos `compartido` con división personalizada. Indican el monto exacto que corresponde a cada usuario. Si están vacíos, se asume 50/50.

---

## Edición directa en Google Sheets

Se puede agregar, editar o borrar filas directamente en la hoja **Gastos**. Los cambios se reflejan en la app al sincronizar.

- Campo `pagador`: usar `1`, `2` o `compartido`.
- Campo `tipo`: usar `gasto`, `pendiente` o `cobro`.
- Campos `parte1`/`parte2`: dejar en blanco para 50/50, o poner el monto de cada usuario para división personalizada.

---

## Changelog

### v18 — División personalizada en totales y pendientes
- Corregido: el resumen mensual del historial (filtro "50/50") ahora muestra los montos reales de cada persona según la división configurada, no siempre el 50/50.
- Corregido: el badge en pendientes compartidos con división personalizada muestra el monto de cada usuario.
- Corregido: al pagar un pendiente compartido con división personalizada, los montos restantes se calculan sobre la parte real de cada uno.
- Actualizado: ayuda contextual ampliada con secciones para Cobros y Categorías.

### v17 — Cobros y préstamos entre usuarios
- Nueva sección **Cobros**: registrá dinero pedido o prestado entre los dos usuarios.
- Dos modos: **Pedí prestado** (vos sos el deudor) y **Presté dinero** (el otro es el deudor).
- Al marcar un cobro como pagado, se genera automáticamente un gasto en el historial del deudor.
- Notificación cuando el otro dispositivo registra un nuevo cobro.
- Corregido: Service Worker actualizado a v17 con estrategia network-first para archivos locales, garantizando que siempre se sirva la versión más reciente del JS.
- Corregido: auto-reload al activarse un nuevo Service Worker para que ambos dispositivos actualicen sin intervención manual.

### v16 — División personalizada de gastos compartidos
- Al seleccionar "Dividir", nuevo panel para ingresar el monto exacto de cada persona.
- Validación: alerta si las partes no suman el total.
- Los campos `parte1`/`parte2` se guardan en Google Sheets.
- Los totales, resúmenes y estadísticas usan la división real en lugar de asumir 50/50.

### v15 — Gastos propuestos
- Los movimientos registrados por un usuario aparecen como "propuestos" en el otro.
- El receptor puede confirmar o rechazar cada propuesto.
- Confirmación con modal propio (sin `confirm()` nativo para compatibilidad móvil).

### v14 — Categorías
- Creación de categorías con nombre, icono y color desde Ajustes.
- Asignación de categoría al registrar o editar un gasto.
- Estadísticas desglosadas por categoría.
- Sincronización de categorías entre dispositivos.

### v13 — Sincronización multidispositivo
- Corrección crítica: el Service Worker ya no cachea respuestas de Google Apps Script, evitando que un dispositivo vea datos desactualizados.
- Pull inmediato al iniciar sesión para que el segundo dispositivo vea los datos al instante.
- Polling de fondo cada 30 segundos con detección de cambios por snapshot.
