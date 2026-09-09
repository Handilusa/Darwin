# HAND-OVER — redespliegue de `SelectionEngine` (defecto 2a)

> ## ⚠️ HECHO. NO EJECUTES ESTE BLOQUE. — superseded 2026-09-08 (noche)
>
> **El redeploy está hecho, cableado, resuscrito y verificado en producción.** El motor vivo es
> **`0xb85afb90Ee36C757EFe5202434c7a20f9E097eeD`** y la suscripción viva es la **17060528**. Correr
> los pasos 2–6 de aquí abajo desplegaría un tercer motor y daría de baja una suscripción buena.
>
> Todo lo que este documento llama "vivo" es ahora **registro fechado y falso**: el motor
> `0xa21Be351…93E6` (preflight, pasos 1–3) sigue desplegado pero **sin suscripción**, y la 16520350
> está **dada de baja** — `getSubscriptionInfo(16520350)` revierte con data vacía.
>
> La verificación (identidad de bytes contra el build local con control negativo, y los 18
> `ReactionFailed` que ahora decodifican a `NoCommittedWindow(0)` en vez de `WrongPhase(2,0)`) está
> en **`SESSION_CHECKPOINT.md` § "2026-09-08 (noche)" §B y §C**.
>
> **Lo único de aquí que sigue pendiente es el paso 7, `npm run prove` — y va DESPUÉS de que una
> ventana real se liquide, no ahora.** El motor acaba de nacer y no ha liquidado ninguna, así que
> hoy no puede pasar por construcción. `fallbackEnabled` sigue `true` y se queda así hasta que pase.
>
> El cuerpo se deja sin reescribir a propósito: es el registro de cómo se hizo, y el §4 ("el paso que
> falla en silencio") es la razón por la que la suscripción nueva apunta al motor correcto.

**Necesita tu clave. Yo no firmo nada.** Este documento es el bloque de comandos y las
verificaciones; cada número de aquí abajo está **leído de Shannon hoy 2026-09-08**, no recordado.

**Qué arregla.** El feed lleno de `ReactionFailed / WrongPhase(2,0)` que reportaste como "puro
error". El motor que hay desplegado **no lleva la guarda `_windowIsDecidable`**, así que llama de
verdad a `settleAll()` en cada finalización de un mercado ajeno. Diagnóstico completo en
`ERROR_PUBLISHED_SITE.md` §2a.

**Por qué va ANTES de correr cualquier ventana.** Hoy es inofensivo solo porque la fase es 0 y
`settleAll()` revierte. Con una posición abierta (fase 2), la finalización del mercado de **cualquier
desconocido** llamará a `settleAll()` y **funcionará**: cerraría nuestra ventana contra el resultado
de otro, graduaría la población con un resultado que no es el nuestro, cobraría metabolismo y
devolvería la fase a 0 con nuestro mercado todavía vivo. `SelectionEngine.sol:108-128` lo llama por
su nombre: *"not a wasted callback; it is a corrupted generation."*

---

## La prueba de que son dos contratos distintos, releída hoy

| | bytes de runtime |
|---|---|
| desplegado en `0xa21Be351…93E6` (`cast code`) | **2 171** |
| lo que compila `contracts/src/SelectionEngine.sol` hoy (`forge build --sizes`) | **3 324** |

No es una diferencia de metadatos: `bytecode_hash = "none"` en `foundry.toml`, así que dos builds
del mismo fuente dan bytes idénticos. Es otro contrato.

## Preflight — todo esto está ya comprobado, y sale bien

| qué | valor leído hoy | por qué importa |
|---|---|---|
| `population.phase()` | **0** | es el único momento seguro para repuntar wiring |
| `population.selectionEngine()` | `0xa21Be35123cb7f95F6B95513ae6D3798A39993E6` | coincide con el manifiesto |
| `engine.fallbackEnabled()` | `true` | **déjalo así** hasta que `npm run prove` pase |
| `population.owner()` | `0x1420cF8Bb9D92C3fDb674ECc5A57295c59078fDA` | tu clave; `setWiring` es `onlyOwner` |
| saldo del owner / pagador | **205.15 STT** | el SDK rechaza crear suscripción por debajo de 32 |
| gas price | 6 gwei | el redeploy cuesta ~0.067 STT |
| suscripción viva | id **16520350** → handler `0xa21Be351…93E6` | hay que rehacerla, apunta al motor viejo |

**La cadencia tiene que estar parada** antes de empezar. Y recuerda: nunca `npm run cadence` a
secas — no tiene tope de ventanas.

---

## El bloque

Todo en PowerShell, sin `&&` (PS 5.1 no lo tiene), y con el entorno que pide `RUNBOOK.md` §"Before
you start".

### 0 — entorno, y confirmar que la suscripción se podrá recrear

```powershell
$env:PATH = "$env:USERPROFILE\.foundry\bin;$env:PATH"
$env:PRIVATE_KEY = "0x..."
$env:SOMNIA_RPC_URL = "https://dream-rpc.somnia.network"
$DARWIN = "$env:USERPROFILE\Desktop\somnia_predict\darwin"

cd $DARWIN
npm run subscribe -- --status
```

**Lee el saldo del pagador antes de seguir.** El orden de los pasos 5 y 6 es *dar de baja y luego
crear*, así que si `--create` fuera a fallar por saldo te quedarías sin reactividad ninguna. Con
205 STT no va a pasar, pero el check es gratis y la alternativa es un agujero.

### 1 — dry run del despliegue

```powershell
cd $DARWIN\contracts
forge create src/SelectionEngine.sol:SelectionEngine `
  --rpc-url somnia `
  --constructor-args 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23 0x1420cF8Bb9D92C3fDb674ECc5A57295c59078fDA `
  --interactive
```

Sin `--broadcast` **no envía nada** — en forge 1.6 el broadcast es explícito, así que esto es un
dry run de verdad. `--interactive` pide la clave por teclado en vez de dejarla en el historial del
shell; si prefieres, cámbialo por `--private-key $env:PRIVATE_KEY`.

Los tres argumentos del constructor son, en orden: `population_`, `settlementEmitter_`, `owner_`.

**No confundas esto con el `-g 3000` de `forge script`.** Ese flag existe porque `forge script`
estima en revm local a 200 gas/byte y Shannon cobra ~3 300 (`RUNBOOK.md:137`). `forge create`
pregunta al nodo con `eth_estimateGas`, así que la estimación ya es la real. Si aun así vuelve un
out-of-gas, añade `--gas-limit 30000000`: 3 324 bytes × ~3 300 ≈ 11 M, o sea 2.7x de margen, y un
`gasLimit` es un techo, no un cargo.

### 2 — desplegar

```powershell
forge create src/SelectionEngine.sol:SelectionEngine `
  --rpc-url somnia `
  --constructor-args 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23 0x1420cF8Bb9D92C3fDb674ECc5A57295c59078fDA `
  --interactive `
  --broadcast
```

Apunta el `Deployed to:` que imprime. Llamémoslo `$NEW`.

```powershell
$NEW = "0x..."
cast code $NEW --rpc-url somnia | Measure-Object -Character
```

**Verifica que hay código, no solo que hay dirección.** Tienen que salir 6 650 caracteres
(`0x` + 3 324 × 2). Si sale `0x` a secas, la creación se quedó sin gas y minó con status `0x0`.

### 3 — repuntar el wiring

```powershell
cast send 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb `
  "setWiring(address,address,address,address)" `
  0x0000000000000000000000000000000000000000 `
  $NEW `
  0x0000000000000000000000000000000000000000 `
  0x0000000000000000000000000000000000000000 `
  --rpc-url somnia --private-key $env:PRIVATE_KEY
```

Los ceros no son relleno: `setWiring` ignora cualquier argumento en cero
(`Population.sol:656-659`), así que esto cambia **solo** el motor y deja `priceSource`,
`prophetBeacon` y `venue` intactos.

```powershell
cast call 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb "selectionEngine()(address)" --rpc-url somnia
```

### 4 — actualizar el manifiesto. **Este es el paso que se olvida y falla en silencio.**

`contracts/deployments/50312.json`, campo `selectionEngine` → `$NEW`.

`subscribe.ts` no lee el motor de la cadena: usa `handlerContractAddress: m.selectionEngine`, del
**manifiesto** (`subscribe.ts:519`). Si te lo saltas, `--create` construye una suscripción
perfectamente válida apuntando al motor viejo, no da ningún error, y el feed sigue exactamente igual
que ahora. Es el fallo más caro posible de este documento porque parece éxito.

```powershell
cd $DARWIN
node -e "const f='contracts/deployments/50312.json',j=require('fs');const o=JSON.parse(j.readFileSync(f,'utf8'));console.log('manifiesto:',o.selectionEngine)"
```

### 5 — dar de baja la suscripción vieja

```powershell
npm run subscribe -- --unsubscribe 16520350
```

Cada reacción fallida la paga de gas el dueño de la suscripción, así que esto además corta la
hemorragia.

### 6 — crear la nueva

```powershell
npm run subscribe -- --topic0 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178 --create
npm run subscribe -- --status
```

**`--topic0` explícito, no `--discover`.** `--discover` ordena por frecuencia y pone *redeem*
(`0xe31682dd…`, 281 apariciones) por encima de *finalize* (`0xb1884334…`, 130). Suscribirse a redeem
es circular y nunca dispara primero.

En `--status`, comprueba que `handler` es `$NEW`.

### 7 — la compuerta de honestidad

```powershell
npm run prove
```

Pasa solo con un `Reacted` con `viaReactivity == true` compartiendo bloque con un settlement real
**de uno de nuestros mercados**, recuperado de nuestro propio log `WindowOpened`. Una coincidencia
falla. Hasta que pase, y mientras `fallbackEnabled` siga `true`, la afirmación con licencia es
*"selection is on-chain and atomic with redemption"*, **no** *"no keeper anywhere"*.

**No llames a `disableFallback()` antes de que `prove` pase.** Es de una sola dirección y sin
fallback un motor que no dispare deja la población sin forma de avanzar.

---

## Qué esperar en el feed después

**Los `ReactionFailed` no desaparecen, y eso es correcto.** El motor nuevo sigue emitiendo uno en
cada rechazo (`SelectionEngine.sol:162-166`); lo que cambia es el `reason`: `NoCommittedWindow(0)` en
lugar de `WrongPhase(2,0)`, y **sin haber llamado a `settleAll()`**.

Con el arreglo 2b ya desplegado en el frontend, esas filas se pintan decodificadas, con el emisor
nombrado como ajeno y en severidad informativa en vez de rojo. O sea que después de este
redespliegue el feed deja de ser ruido y pasa a ser **la guarda de cross-talk funcionando en
directo, delante del juez**. Es material de demo.

---

## Dato colateral, verificado hoy y que conviene tener escrito

`populationImpl` mide **34 226 bytes de runtime** en cadena — idéntico al build local, y **9 650 por
encima del límite de EIP-170** (24 576). O sea que **Shannon no aplica EIP-170**, y `forge build
--sizes` marca `Population` con margen negativo sobre un límite que esta cadena no tiene. No es un
problema y no hay nada que arreglar: solo que nadie debería concluir de ese margen negativo que el
build no se puede desplegar, porque lleva desplegado y vivo desde el bloque 481441054.
