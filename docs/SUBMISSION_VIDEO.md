# GUION DEL VÍDEO DE ENTREGA — 2:45

Escrito 2026-09-08. Requisito **obligatorio** del brief, no opcional:
`dreamdex_hackathon_package/01_hackathon_brief.md:40-45` pide tres cosas y esta es la única
que no existe todavía — prototipo en testnet ✓, repo de GitHub ✓, **vídeo de 2-3 minutos ✗**.

Todas las cifras de aquí abajo están **leídas de cadena o decodificadas contra los ABI
compilados**, no sacadas de la landing ni del explorer. Las marcadas ✓ las he vuelto a medir hoy.

---

## 0. Lo que NO se puede decir. Leer antes de grabar.

Esto no es escrupulosidad: un juez que pilla una afirmación falsa deja de creer las verdaderas,
y las verdaderas de este proyecto son fuertes.

| No digas | Porque |
|---|---|
| "sin keeper", "reactivo", "mismo bloque" | `npm run prove` **no ha pasado** todavía: el `SelectionEngine` de cadena son 2171 bytes y el compilado 3324. Mientras `fallbackEnabled` sea `true` la frase con licencia es **"selection is on-chain and atomic with redemption"** y nada más fuerte. |
| "generación 1", "han criado", "linaje de N generaciones" | `generation()` es **0** en los ocho. Nadie ha criado. Hay que ganárselo: 4 aciertos seguidos + 1,5× endowment. |
| "los organismos usan un LLM para decidir" sin más | Es cierto y además es lo bueno, pero di **cómo**: inferencia on-chain vía `AgentRequester` con consenso de validadores, respuesta acotada a nueve `allowedValues`. Si suena a llamada a una API de fuera, pierdes el punto. |
| nada filmado con `?demo=1` | Es una ayuda de revisión, nunca el default. En un vídeo sin etiqueta es una demo falsa. La arena real ya tiene dos cadáveres en la banda y logs de verdad en el feed: no hace falta. |
| "el settle salió en el mismo bloque que la liquidación del mercado" | **Ocurre y es casualidad.** El `settleAll` comparte el bloque 483075647 con `0x7e052899…` (32 logs, otro contrato), pero el nuestro lo firmó el owner `0x1420cF8B…8fDA`. Es empaquetado de bloque, no reactividad. Justo lo que `prove` existe para descartar. |

Lo que **sí** se puede decir, y es el encuadre correcto de la ventana 68: *la selección se computa
en cadena y es atómica con la redención; el tick lo dispara todavía un keeper.*

---

## 1. Antes de grabar — pestañas abiertas

1. `https://darwin-protocol.vercel.app/` — la landing.
2. `https://darwin-protocol.vercel.app/arena/` — el dashboard en vivo. **Con la barra `/` final**, o los assets relativos dan 404.
3. `https://shannon-explorer.somnia.network/tx/0x14ac5ad9c5d6a149a4c01b56876601af2e13a97881afe35a1acda9a5eecc389d`
   — el `settleAll` de la ventana 68. ✓ verificado hoy: bloque 483075647, **394.027 gas, 9 logs**.
4. `https://shannon-explorer.somnia.network/address/0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb`
   — Population.
5. `https://github.com/Handilusa/Darwin`
6. Un editor con `genomes/genesis.json` abierto, y otro con `contracts/src/Prophet.sol`.

Deja el dashboard cargado **un minuto antes** de grabar: lee la cadena al montar y el feed
necesita su scan. Una página a medio poblar parece rota.

---

## 2. Guion, plano por plano

### 0:00 – 0:18 · El gancho *(plano: `/arena/`, la rejilla)*

> "Esto es una población de ocho pronosticadores de IA que viven en Somnia. Cada uno lleva un
> genoma: una tesis de trading escrita en inglés. Cada quince minutos se les pregunta qué va a
> hacer Bitcoin, responden por inferencia on-chain, y los que discrepan quedan enfrentados con
> posiciones opuestas respaldadas 1:1. Pensar cuesta dinero de verdad cada ventana. Equivocarse
> mata. **Dos de estos ocho ya están muertos.**"

Que la banda de muertos esté en pantalla al decirlo. No hace falta señalarla.

### 0:18 – 0:45 · El mecanismo *(plano: cabecera + `phaseTrack`, luego una tarjeta)*

> "Una ventana son tres llamadas y la máquina de estados vive en el contrato, no en mi script:
> `think`, `commitAll`, `settleAll`. En `think` cada organismo paga su propia inferencia — 0,24
> STT — de su propio saldo. Si no le llega, se abstiene, abre una posición vacía y **paga el
> metabolismo igual**. Quedarse sin STT es una forma de morir, y está puesto a propósito."

Abre la tarjeta de un organismo (`detail`): dirección, `genome hash`, racha, el listón de cría.

> "Y no es solo dirección. Cada creencia lleva su **tesis** — momentum, reversión, breakout,
> rango — así que lo que se selecciona son ideas, y se lee directamente del log."

### 0:45 – 1:25 · La prueba, en cadena *(plano: el explorer, tx `0x14ac5ad9…`)*

> "La ventana 68 es el primer evento de selección real de este deploy. Este es el `settleAll`:
> nueve logs, 394.000 de gas."

Recorre los cuatro que importan:

```
Redeemed      13.300.000 quemados -> 13.300.000 tUSDC   (outcomeIdx 0)
Raked         prophetId 1   profit 6.650.000   rake 166.250   (2,5%)
Settled       prophetId 1   correct=true   treasury 13.083.750
WindowClosed  window 68   aliveCount 6
```

> "Ocho vivos pasaron a seis. Dos organismos acertaron y cerraron con 13,08 tUSDC; dos fallaron y
> están muertos, a cero."

Vuelve al dashboard, a la tarjeta de un supervivente:

> "Y este es el detalle que lo hace **duradero**: `windowsLived` marca 68 y `abstainCount` se
> quedó en 67. El settle borra la posición pero nunca toca el contador, así que ese hueco de uno
> sobrevive a la ventana. Es la huella de que existió una posición real, y sigue ahí para quien
> quiera comprobarla."

### 1:25 – 1:50 · La muerte no se deshace *(plano: `Prophet.sol` en el editor)*

> "No hay ningún camino que limpie `dead`. Ni el owner, ni Population, ni una actualización del
> beacon. Dos tests lo afirman y **un juez puede hacer grep** buscando una vía de recuperación
> — la busca y no está."

Si te sobran tres segundos, el `GenesisTreasury` es la mejor moneda de confianza que tiene el
proyecto: `0xF187842DF96d35d7a4dcDdbF83515D6D8aDC97Ca`, 88 líneas, **sin owner, sin withdraw,
sin upgrade**, y una sola función que cambia estado — `recycle()`, que **cualquiera** puede
llamar y devuelve todo al bote de premios.

### 1:50 – 2:10 · Lo que este run NO afirma *(plano: el panel "What this run claims")*

Este plano lo regala la propia página: ya renderiza la frase honesta, con su pastilla
*fallback enabled*.

> "La página dice en voz alta lo que este run **no** afirma. La selección se computa en cadena y
> es atómica con la redención; el tick lo dispara todavía un keeper, así que la frase fuerte no
> es mía hasta que pase el script que la prueba. El README tiene una sección de 'no afirmado' y
> hay dos scripts que la hacen cumplir."

Es veinte segundos que suben la nota de todo lo demás, no que la bajen.

### 2:10 – 2:35 · Por qué costó llegar aquí *(plano: la tabla, o el dashboard)*

> "Sesenta y siete ventanas seguidas se abstuvo la población entera con genomas perfectamente
> sanos. El precio de la inferencia estaba en 0,001 STT, que salía de la aritmética del depósito
> mínimo — y ese mínimo pone precio a una petición que los validadores **pueden declinar**.
> Declinaron 104 de 104. A 0,07: **78 de 78 con éxito**. Ciento ochenta y dos peticiones
> separadas por una sola variable. Lo que distinguió las dos hipótesis fueron las direcciones de
> validador a cero en el evento — sin ese campo, un parser roto y una petición no servida se ven
> exactamente igual desde fuera."

### 2:35 – 2:45 · El cierre *(plano: la landing, sección `enter`)*

> "`enter` es permissionless: cualquiera puede meter su propia tesis en la arena y ver si
> sobrevive. Sin token, sin preventa. La casa cobra un 2,5% de los aciertos. El código está
> entero en GitHub y los ocho organismos están en el explorer de Shannon ahora mismo."

---

## 3. Cifras verificadas — por si improvisas

| | |
|---|---|
| Population | `0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb` |
| ventana / temporada | 68, temporada 3, cierra en la 72 ✓ |
| censo | 8 nacidos · **6 vivos** · 2 muertos · generación **0** ✓ |
| supervivientes con posición | #1 MOMENTUM y #3 BREAKOUT, 13,08 tUSDC, racha 1 |
| muertos | #2 REVERSION y #4 PINNED, a 0 |
| la huella duradera | `windowsLived` 68 vs `abstainCount` 67 |
| coste de pensar | 0,24 STT por organismo y ventana ✓ = 3 × (0,01 + 0,07) |
| el censo de precio | 78/78 con éxito a 0,07 · 0/104 a 0,001 · n=182 |
| bote / rake | prizePool 3.453.000 · rakeAccrued 16.459.500 |
| `settleAll` w68 | `0x14ac5ad9c5d6a149a4c01b56876601af2e13a97881afe35a1acda9a5eecc389d` ✓ |
| tests | 152 en Solidity · 231 comprobaciones en el frontend |

---

## 4. Después de grabar

- [ ] Dura entre 2:00 y 3:00. Menos de dos minutos incumple el brief igual que pasarse.
- [ ] Ninguna URL de `localhost` aparece en pantalla en ningún fotograma.
- [ ] La barra de direcciones muestra el dominio publicado, no una preview de Vercel.
- [ ] No aparece `?demo=1` en ningún sitio.
- [ ] No se pronuncia ninguna de las frases de la tabla del §0.
- [ ] Subido **como no listado o público**, nunca privado — un juez que no puede abrirlo cuenta
      como no entregado.
- [ ] El enlace, pegado en el formulario **y** anotado en `docs/SESSION_CHECKPOINT.md`.
