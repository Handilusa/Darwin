# TRES DEFECTOS EN EL SITIO PUBLICADO — 2026-09-08

> ## Actualización 2026-09-08 (noche): **el defecto 2a está CERRADO.**
>
> La tabla de §Estado y todo el §2a describen el motor `0xa21Be351…93E6` y la suscripción 16520350
> como **vivos**. Ya no lo son. El motor vivo es **`0xb85afb90Ee36C757EFe5202434c7a20f9E097eeD`**,
> la suscripción viva es la **17060528**, y la guarda `_windowIsDecidable` **está corriendo en
> producción**: los `ReactionFailed` del feed ya no llevan `WrongPhase(2,0)` (el error de
> *Population*, o sea que `settleAll()` se llamaba de verdad) sino **`NoCommittedWindow(0)`**, que es
> el motor rechazando la liquidación ajena **sin tocar `settleAll()`**.
>
> Con eso, **los cuatro defectos de este documento están hechos**, y la advertencia de §Estado
> ("antes de correr cualquier ventana nueva") queda satisfecha. Evidencia — identidad de bytes con
> control negativo, y el `reason` decodificado — en **`SESSION_CHECKPOINT.md` § "2026-09-08 (noche)"
> §B y §C**.
>
> **Lo que sigue vivo de este documento no es un defecto sino un despliegue:** los arreglos 1, 2b y 3
> están en el repo pero **no publicados**. `/enter/` da 404 en producción y el `main.js` / `chain.js`
> publicados no llevan la decodificación del feed. Hace falta commit + push para que Vercel los
> recoja, y después verificar los enlaces contra el dominio real.
>
> El cuerpo se deja sin reescribir: el diagnóstico de §2a es la razón por la que el redeploy se hizo
> y sigue siendo la explicación de qué se arregló.

Reportados por el usuario mirando **https://darwin-protocol.vercel.app/** (primera vez que el
dominio de producción aparece en el repo; anótalo también en el checkpoint). Día de entrega.

Los tres pasaron por Fase 1 de `superpowers:systematic-debugging` antes de proponer nada. Cada
causa raíz de aquí abajo está **medida**, no inferida: selectores calculados con `cast sig`,
bytecode leído de cadena, y las líneas citadas leídas hoy.

**Lo que este documento cambia del plan:** el paso 3 del checkpoint (§F, "redeploy
`SelectionEngine`") estaba clasificado como el más vistoso y el que *degrada bien* si se acaba el
tiempo. **Eso es falso.** El defecto 2a demuestra que el paso 3 es **precondición del paso 4**, y
el paso 4 es el que produce generación 1. Ver §2a.

| # | Qué ve el usuario | Causa raíz | Dueño |
|---|---|---|---|
| 1 | `/arena/` solapa el primer con la arena | `main.js:493` pinta antes de tener `app.cfg` | Claude, sin clave |
| 2a | feed lleno de `ReactionFailed` | el motor de cadena **no tiene** la guarda `_windowIsDecidable` | **usuario (clave)** |
| 2b | esos logs se pintan en rojo y sin razón | `render.js:1597` tira `emitter` y `reason` | Claude, sin clave |
| 3 | la landing lleva las tres transacciones | `App.jsx:11` monta `<Enter />` inline; no hay segunda ruta | Claude, sin clave |

---

## 1. `/arena/` — el primer se muestra y desaparece

**Síntoma.** Primero sale "Organisms that lose money die." con las instrucciones y las opciones
avanzadas del RPC; "pero de una salta a la arena" bajo `0xe0F46e61…38Cb`.

**Descartado primero:** no es apilamiento de frames. `mount()` en `web/js/dom.js:86` hace
`target.replaceChildren()` antes de rellenar, así que dos pinturas nunca coexisten. El
solapamiento que se percibe es **temporal**, no espacial.

**Causa raíz.** `web/js/boot()` en `web/js/main.js:493-494`:

```js
app.sourceLabel = `via ${sourceLabel}`;
paint(); // show the setup card / previous frame while connecting rather than a blank page

try {
  const { client } = await chain.connect(s.rpc);
  app.client = client;
  app.cfg = await chain.discoverWithRetry(client, population);
```

`app.cfg` todavía es `null` en ese `paint()`, así que entra la rama `!app.cfg`
(`main.js:209-237`), que monta `ui.primer()` + `ui.setupCard(...)` — exactamente las
instrucciones y el formulario de RPC que el usuario describe. Cuando `connect` y
`discoverWithRetry` resuelven, el siguiente `paint()` lo reemplaza por la arena.

**Por qué ha aparecido ahora y no antes.** Porque ayer se arregló `web/config.js` poniendo
`POPULATION`. Sin dirección configurada, la tarjeta de setup era el estado **permanente y
correcto** — la página no tenía nada que leer. Con dirección configurada, la misma rama pasa a
ser un destello equivocado. El arreglo de ayer convirtió un estado válido en un bug.

**Por qué es grave y no cosmético.** El comentario de `:494` dice *"the setup card / previous
frame"*: la intención era el **frame anterior**, y en la primera carga no hay ninguno. El
resultado es que a un juez se le ofrece editar una dirección que ya es buena, y se le quita de
las manos a media lectura. Es la primera impresión de la única página en vivo del proyecto.

**Arreglo.** La rama `!app.cfg` está conflacionando dos estados distintos:

- *no hay dirección configurada* → el formulario es el contenido correcto (comportamiento actual, se queda);
- *hay dirección y todavía se está conectando* → el formulario es contenido **falso**.

Con dirección en mano hay que pintar un estado de conexión (masthead + "leyendo la cadena…"),
nunca el primer ni el formulario.

**Lo construido.** `main.js:230` es ahora una rama `app.connecting` propia, rotulada
*"CONFIGURED BUT UNREAD IS NOT UNCONFIGURED"*, y la rama del primer (`:250`) solo marca `noContract`
para `absent` / `wrong`. La distinción es la misma que CLAUDE.md exige del clasificador: `absent`
significa *edita la dirección*, `unreachable` significa *déjala en paz y reintenta*.

### 1-bis. El defecto 1 no tenía test, y el que existía se apuntaba a una premisa muerta.

**Por qué no lo cazó nada.** El síntoma dura **dos round-trips de RPC**. Eso es exactamente el ancho
que ninguna comprobación de una sola muestra puede ver: `arena.mjs` §12 hacía `sleep(2600)` y leía
una vez, y a esa hora el destello ya se había ido.

**Y además §12 llevaba doce líneas rojas que no eran un defecto del producto.** La sección navegaba a
un `/arena/` desnudo esperando el primer, porque hasta hoy `web/config.js` tenía `POPULATION = ""`.
Puesta la dirección de Season 0, un `/arena/` desnudo pinta la arena en vivo — que es lo correcto —
y doce afirmaciones fallaban sobre una página que se comportaba exactamente como se diseñó. Doce
líneas rojas que significan *"la premisa se movió"* son peores que ninguna comprobación, y el día que
la suite importa son el ruido donde se esconde una regresión de verdad. Ni se dejaron rojas ni se
saltó la sección: **se crea el sujeto a propósito**.

**De las dos rutas que llegan al primer se eligió una, y la elección es la parte reutilizable:**

| ruta | veredicto | qué le hace al `<details>` de setup |
|---|---|---|
| `?population=<sin contrato>` | `absent` | lo fuerza **abierto** y añade copia de remedio |
| **`?rpc=http://127.0.0.1:9/`** | **`unreachable`** | lo deja **cerrado** |

La primera se probó y **la suite la rechazó con la verdad**: *"1478 caracteres, por encima del techo
de 1400"* y *"the setup disclosure is OPEN with no bad address in the URL"*. No eran falsos
positivos; eran dos checks diciendo que había elegido mal el estado. Con `unreachable` el pliegue
sigue cerrado, que es el estado contra el que se escribieron las afirmaciones de §12 y 12c, y las
dos docenas de comprobaciones de geometría siguen valiendo **literalmente sin tocarlas**. De paso,
la regla `absent` ≠ `unreachable` pasa a ser ejecutable **en el DOM**, donde antes solo se afirmaba
contra un clasificador bajo un DOM falso.

**Lo que la medición dijo del otro fallo de §12** (`masthead thesis is stranded invisible, opacity
0.4674`): no era un cuelgue, era una carrera de muestreo. Una sonda de 78 muestras cada 130ms lo
separó en una sola corrida — el tween arranca en el montaje del primer snapshot vivo (~2237ms) y
acaba (~2942ms), así que la muestra fija de 2600ms cae **dentro** del fade y su posición depende de
la latencia del RPC. Corroborado: la corrida siguiente, sobre el mismo código, dio `0.9122`. Eso es
la definición de una moneda al aire. Se arregló **poniendo un poll con deadline, nunca relajando el
umbral**.

**El test: `arena.mjs` §12d.** Una expresión de muestreo, un `/arena/` desnudo, y el veredicto es la
**última** lectura de una ventana que dura `WATCH_PAST_MOUNT = 2400`ms pasado el montaje. Ese número
no es holgura al azar: sobrevive al tween (0.7s) **y** al rescate de `guarantee()` (1200ms de slack),
así que una frase todavía apagada ahí no la levantó ninguno de los dos mecanismos. Salir en la
primera muestra que lea visible habría sido la misma moneda al aire del revés — la frase del header
pre-lectura ya está a `opacity: 1` y el from-state se aplica dentro de un `requestAnimationFrame`.

**Y los tres controles, porque los tres veredictos son ausencias** (regla de CLAUDE.md: un check cuyo
sujeto es "X no puede pasar" va emparejado con uno que hace pasar X a propósito):

1. el mismo poller **tiene que encontrar** un primer en la URL `unreachable`, que sí lo tiene;
2. el dashboard **tiene que llegar** — si no llega, toda ausencia posterior es gratis;
3. un `<p>` clavado a `opacity: 0.2` **tiene que leerse invisible**, o el instrumento de opacidad no
   mide nada.

Corrida de hoy, verde: `dashboard at 1991ms · thesis visible at 2131ms · primer seen never (correct)
· 33 samples`, con `control primer found at 1151ms on the unreachable URL · opacity probe 0.2`.


---

## 2. El feed: `ReactionFailed` cada minuto

El usuario lo lee como "puro error". **No es un contrato roto**, y tiene dos mitades con dueños
distintos. Las dos hay que arreglarlas, y **arreglar 2a no arregla 2b**.

### 2a. El motor desplegado no lleva la guarda. Dueño: el usuario (clave).

**La medida que lo decide.** El `reason` de los `ReactionFailed` en vivo decodifica a selector
`0x05fb5e1b`:

| selector | error | de quién |
|---|---|---|
| **`0x05fb5e1b`** | **`WrongPhase(uint8,uint8)`** con args `(2, 0)` | **Population** (`Population.sol:392`, revertido en `:493`) |
| `0x8e0ebc6c` | `NoCommittedWindow(uint8)` | SelectionEngine |
| `0x1507f5ce` | `MarketUnreadable(bytes32,address)` | SelectionEngine |
| `0xc5425ee1` | `MarketNotDecided(bytes32,address)` | SelectionEngine |

Selectores calculados hoy con `cast sig`, no de memoria.

**El razonamiento.** `_windowIsDecidable()` (`SelectionEngine.sol:250-252`) empieza así:

```solidity
uint8 phase = population.phase();
if (phase != 2) return (false, abi.encodeWithSelector(NoCommittedWindow.selector, phase));
```

La fase de cadena es **0**. Un motor con la guarda habría emitido `NoCommittedWindow(0)` y
**no habría llamado a nada**. Que lo emitido sea `WrongPhase(2,0)` — el error de *Population* —
solo puede venir del `catch` de `_handle`, que envuelve `try population.settleAll()`
(`SelectionEngine.sol:220`). Es decir: el motor de cadena **salta la guarda y llama de verdad a
`settleAll()`** en cada finalización ajena.

**Corroboración independiente:** el motor desplegado son 2171 bytes; el compilado, 3324.
`selectionEngine()` = `0xa21Be35123cb7f95F6B95513ae6D3798A39993E6`, `fallbackEnabled` = `true`.
El `emitter` de los logs es `0xbf4a49e0dfd092e5fbe8e5761064c49533e6ed23`, el `BinarySettlement`
**singleton compartido** del testnet — o sea, mercados de otros. Dos logs en el bloque 483224186,
en transacciones distintas (índices 18 y 19).

**Y aquí está lo que reordena el plan.** Hoy es inofensivo **solo porque la fase es 0** y
`settleAll()` revierte. En el momento en que hagamos `commitAll` (fase 2) con una posición
abierta, la finalización del mercado de **cualquier desconocido** llamará a `settleAll()` y
**funcionará** — cerrando nuestra ventana contra el mercado de otro, graduando la población con un
resultado que no es el nuestro, cobrando metabolismo y devolviendo la fase a 0 con nuestro mercado
todavía vivo. Es literalmente el peligro que documenta `SelectionEngine.sol:108-128`: *"not a
wasted callback; it is a corrupted generation."*

Traducido al plan del checkpoint §F: **el paso 3 no es opcional ni es el vistoso — es
precondición del paso 4.** Correr ventanas con el motor actual desplegado es correr con una
apertura por la que cualquiera puede cerrar nuestra ventana. Y el paso 4 es el que puede dar
generación 1.

**Nota buena, y no es pequeña:** 61 eventos en ~12000 bloques prueban que **la suscripción está
viva y el precompile está disparando de verdad**. La fontanería de reactividad funciona; lo que
falta es la guarda. Eso sube mucho la probabilidad de que `npm run prove` pase tras el redeploy.

**Coste que corre mientras esto siga así:** cada reacción fallida la paga de gas el dueño de la
suscripción. Conviene mirar el saldo del pagador antes de grabar, o la reactividad se muere sola.
(Leído hoy: **205.15 STT**, de sobra — el suelo del SDK son 32.)

**El bloque de comandos está en `docs/HANDOVER_ENGINE_REDEPLOY.md`**, con las direcciones ya puestas,
el dry-run delante, y señalado el paso que falla en silencio: `subscribe.ts:519` toma el handler del
**manifiesto**, no de la cadena, así que sin actualizar `deployments/50312.json` la suscripción nueva
apunta al motor viejo sin dar un solo error.


### 2b. El feed pinta el evento más informativo como la fila menos informativa. Dueño: Claude, sin clave.

`web/js/render.js:1597`:

```js
ReactionFailed: () => [el("span", { class: "bad", text: "reaction failed" })],
```

Tira **los dos** argumentos que tiene el evento: `emitter` (que dice que es el singleton
compartido, o sea el mercado de otro) y `reason` (que dice exactamente por qué). Y lo pinta rojo,
con `SEVERITY.ReactionFailed = "bad"` en `:1614`.

**Esto sobrevive al redeploy.** `SelectionEngine.sol:162-166` sigue emitiendo `ReactionFailed` en
cada rechazo:

```solidity
(bool decidable, bytes memory why) = _windowIsDecidable();
if (!decidable) {
    emit ReactionFailed(settlementEmitter, block.number, why);
    return;
}
```

Después del paso 3 el feed se verá **igual**, con `NoCommittedWindow` en lugar de `WrongPhase`. Así
que 2b hay que arreglarlo pase lo que pase con 2a, y 2b es lo que el usuario vio.

**Arreglo.** Decodificar `reason` (el shim `web/js/viem.js:15` re-exporta *todo* viem, así que
`decodeErrorResult` está disponible; hay que añadir un ABI de errores a `web/js/abi.js`, que hoy
no tiene ninguno), nombrar el `emitter` como ajeno, bajar la severidad de `bad` a informativa para
los rechazos benignos, y **agrupar filas idénticas consecutivas** en una con contador — siete
filas iguales dominando el feed es además un problema de legibilidad.

Hecho eso, tras el paso 3 esas filas dejan de ser ruido y pasan a ser **la guarda de cross-talk
funcionando en directo, delante del juez**. Es material de demo, no suciedad que esconder.

### 2b-bis. El arreglo de 2b rompió `?demo=1` y apagó la suite entera. Anotado porque casi no se ve.

**Lo que hice primero.** Decodificar `reason` en `render.js`, que es donde se pinta. Para eso hay
que importar `decodeErrorResult` de viem y un ABI de errores — y **`render.js` es un import estático
de `main.js`**. Esa única arista convirtió `https://esm.sh/viem@2.56.0` en dependencia de *cargar la
página*:

- **370 peticiones off-origin en `?demo=1`**, el modo que este directorio documenta tres veces como
  funcionando con la red desenchufada;
- y `npm test --prefix web` **incapaz de arrancar** — el cargador ESM de Node rechaza un
  especificador `https:` —, así que los 231 checks del renderer dejaron de ejecutarse **sin reportar
  nada**. No fallaron: desaparecieron.

**Lo que hace que esto merezca un apartado:** ninguno de los dos fallos se ve desde el navegador con
red. La página se veía perfecta.

**Arreglo.** La decodificación vive en `chain.js`, **en la ingesta**, detrás de `await lib()` y
`await abis()` (`chain.js:662-690`), y el renderer recibe un objeto plano
`{name, declined, args:[{type,value}]}`. Los tipos viajan con los argumentos en vez de strings ya
formateados, porque acortar una dirección es una decisión de presentación y `format.js` es del
renderer. El comentario de `chain.js:640-661` lleva la historia completa, y
`web/test/smoke.mjs:1937` afirma que **ningún import estático menciona `esm.sh`** — o sea que el
seam ahora tiene un detector, no solo un comentario.


---

## 3. La landing tiene que ser solo información

**Lo que pidió el usuario, literal:** que `1 faucet(tUSDC)`, `2 approve(Population, exact)` y
`3 enter(genome, endowment)` "deberia estar en otra consola aparte no donde va la info".

**Causa raíz.** No es un bug, es que la ruta no existe. `app/src/App.jsx:11` monta `<Enter />`
inline como beat 6 dentro del mismo `<main>` que los cinco beats explicativos, y el build tiene un
**único input de Rollup** (`app/index.html`) sin router. No hay ningún sitio donde poner una
consola.

`app/src/sections/Enter.jsx` son 955 líneas y contiene todo lo transaccional: `faucet` (`:412`),
`approve` (`:424`), `enter` (`:433`), `ConnectButton` (`:778`), el cambio de cadena, y las
compuertas de saldo.

**Lo construido — 2026-09-08, verificado leyendo los ficheros, no de memoria.** Segundo input de
Vite, no un router:

1. **`app/enter/index.html`** existe como segundo input, y **está nombrado explícitamente** en
   `vite.config.js:221-224` (`input: { main, enter }`). Esto último no es cosmético y el comentario
   de `:210-218` lo dice: hasta hoy el build tenía un único input implícito, y **un input que Rollup
   no conoce simplemente no se emite** — `npm run build` habría salido con código 0, `dist/enter/`
   no existiría, y los seis enlaces a `/enter/` habrían dado 404 solo en producción.
2. **`app/src/enter.jsx`** monta la misma pila de providers que `main.jsx`, y
   **`app/src/Console.jsx`** es la página.
3. **`Enter.jsx` no se tocó.** Sus 955 líneas se movieron enteras.
4. La landing conserva el beat 6 como **`app/src/sections/EnterInvite.jsx`**: sin wagmi, sin writes,
   sin `ConnectButton`, y **deliberadamente sin `.enter-grid`** (`EnterInvite.jsx:13`) — la clase que
   los tests usaban como prueba de que el formulario estaba ahí.
5. **La landing perdió el botón de cartera.** `Nav` ganó un prop `wallet` que por defecto es
   `false`: `App.jsx:69` la monta `<Nav />` (y el hueco lo ocupa un enlace `Enter`),
   `Console.jsx:43` la monta `<Nav home="/" links={LINKS} wallet />`. Así "nada en la landing puede
   gastar nada" es una propiedad del árbol de componentes, no una promesa de la copia.
6. Redirect `/enter` → `/enter/` en **los dos** sitios, porque son dos servidores distintos:
   `vercel.json` en producción y el plugin `enterConsole()` de `vite.config.js:164-177` en dev y
   preview. Sin el segundo, el html-fallback del dev server responde `/enter` con el `index.html`
   **de la landing** y el bug solo aparece en local.

**Tests.** Las afirmaciones de `landing.mjs` sobre `.enter-grid` se movieron a una suite nueva,
**`app/test/console.mjs`**, y `test:browser` (`app/package.json:11`) corre ahora **tres**:
`landing.mjs && console.mjs && arena.mjs`. Las dos primeras aceptan una URL como argumento
(`process.argv[2]`), así que la misma suite corre contra el dominio publicado.


---

## Estado — 2026-09-08, fin de sesión

| # | Estado | Qué queda |
|---|---|---|
| 1 | **hecho + con test** | nada. `main.js:230` + `arena.mjs` §12d con sus tres controles |
| 2b | **hecho + con test** | nada. Decodificación en `chain.js`, no en `render.js`; ver 2b-bis |
| 3 | **hecho + con test** | verificar los enlaces contra el dominio publicado tras el deploy |
| 2a | **pendiente, del usuario** | redeploy `SelectionEngine` + `setWiring` + resuscribir + `npm run prove` → **`HANDOVER_ENGINE_REDEPLOY.md`** |

Suites verdes hoy: `npm test --prefix web` (239 checks) y `node app/test/arena.mjs` (PASS).

**El único defecto grave que sigue vivo es 2a, y es el que el usuario describió como "puro error".**
Necesita su clave. **Antes de correr cualquier ventana nueva**, porque hoy es inofensivo solo porque
la fase es 0: con una posición abierta, la finalización del mercado de cualquier desconocido cerraría
nuestra ventana. Ver §2a.

Los pasos 2 (`setSeason` con `cognitionEndowment`) y 4 (fondear y correr ventanas) del checkpoint
§F siguen donde estaban, con el paso 4 **detrás** del redeploy y no al lado.

