# El `SettleFailed` de MOMENTUM en la ventana 68 — diagnóstico cerrado 2026-09-07

Documento de arrastre. Escrito para sobrevivir a un borrado de chat: contiene el error,
la causa, el remedio ya probado con trace, y todo lo que queda pendiente para el submit.

TX bajo análisis: `0xc2705634adec9a805e75ad3674fc2c856b319c8460e47224ac7d2e22ed7ecacc`
(bloque 482387810, `SelectionEngine.poke()` -> `Population.settleAll()`, desde el deployer).

---

## 1. Los cuatro hechos medidos

**HECHO 1 — MOMENTUM sí fue alcanzado por el bucle.** El recibo trae 25 logs. En el
`logIndex 0x16` está `topic0 = 0xba783cf9…517a` sobre Population con `topics[1] = 1`, es
decir **`SettleFailed(prophetId 1)`**. No es que se lo saltara: entró en el `try`, llamó a
`settleWindow` y la subllamada falló. El orden de los logs demuestra además el bucle hacia
atrás de `settleAll` tal cual está documentado: **PINNED(4) -> BREAKOUT(3) -> REVERSION(2)
-> MOMENTUM(1)**. MOMENTUM es el último, y es el único que falló.

**HECHO 2 — la MISMA transacción, reejecutada por el MISMO nodo sobre el MISMO estado
previo, liquida MOMENTUM sin problema.** `cast run` sobre esa tx (replay fiel: imprime
"Executing previous transactions from the block") produce las cuatro patas completas:

```
emit Settled(prophetId: 4, correct: false, …)   emit Starved(4)  emit Died(4)  Reaped(4, alive 7)
emit Settled(prophetId: 3, correct: true,  …)                                  <- BREAKOUT gana
emit Settled(prophetId: 2, correct: false, …)   emit Starved(2)  emit Died(2)  Reaped(2, alive 6)
emit Settled(prophetId: 1, correct: true, collateralOut: 13300000, treasury: 13083750)  <- MOMENTUM GANA
emit WindowClosed(window: 68, aliveCount: 6)
```

Y en las 332 líneas del trace hay **cero** `OutOfGas`, **cero** `Revert`, **cero**
`EvmError`. El total del replay: **`[774291] ::poke()`**.

**HECHO 3 — la cadena cobró 3,2x más gas del que el replay necesita.**

```
gas limit de la tx : 2 592 003
gas COBRADO        : 2 465 478   = 95,1 % del límite
gas del replay     :   774 291   (las 4 patas, todas con éxito)
diferencia sin explicar: 1 691 187
```

Consumir el 95 % del límite y aun así reportar `status 1` es la firma exacta de una
**subllamada que se comió todo el gas que se le reenvió**: un out-of-gas dentro de un
`try` quema los 63/64 forwardeados y devuelve fallo, y el `catch` se lo traga. Ese es el
único mecanismo que explica 1,69 M de gas cobrado sin trabajo que lo justifique.

**HECHO 4 — el estado de MOMENTUM no ha cambiado desde entonces.** Hoy: `outcomeId
…752`, saldo ERC1155 **13 300 000** verificado contra el outcome token (no contra su
propia contabilidad), `currentQuantity` 13 300 000, `currentStake` 6 650 000, `belief` 1,
`positionOpen` true, `treasury` 0, 2,64 STT nativos. Y `settleWindow` resimulado como
Population devuelve **`13300000 / false / 50000 / 166250`**.

## 2. La causa

**No es el estado y no es la lógica.** Es un fallo de ejecución por gas en la última
iteración del bucle de `settleAll`, convertido en `SettleFailed` por el `try/catch` y
enmascarado por `phase = 0` incondicional (`Population.sol:1851`). Por eso la transacción
salió `status 1` dejando un organismo sin liquidar: **`settleAll` no puede revertir**, así
que "éxito de la transacción" no significa "ventana liquidada".

Quedan dos candidatos para *por qué* faltó gas ahí, y no los puedo separar desde aquí:

- **(A) Coste real por encima del coste del replay.** La pata ganadora toca
  `BinarySettlement`, que es un **singleton compartido**: sus slots pueden estar
  fríos/calientes de forma distinta en un bloque vivo que en un replay, y eso cambia el
  precio. El replay los ve calientes; la ejecución real pudo pagarlos fríos.
- **(B) Un revert transitorio del singleton compartido** por un `MarketFinalized` ajeno
  cayendo en el mismo bloque (llegan cada ~60 s). El replay no reproduce las
  transacciones sintéticas que insertan los validadores, solo las normales del bloque.

**Medición que los separaría:** un `debug_traceTransaction` con gas por opcode sobre esa
tx (el `cast run` de arriba da el árbol pero con los números del replay, no los reales).
No es necesario para arreglarlo.

### Lo que sí es una conclusión firme y accionable

**`eth_estimateGas` es estructuralmente incapaz de dimensionar `settleAll`.** El estimador
busca el límite mínimo con el que la transacción *no revierte*; `settleAll` **nunca**
revierte, porque cada fallo por organismo se captura y la fase avanza igual. Así que un
límite con el que los últimos organismos fallan en silencio satisface su criterio de
éxito. Los números lo confirman: `2 592 003 / 1,05 = 2 468 574 ≈ 2 465 478` cobrados — el
límite es la estimación x1,05, y **la estimación aterrizó justo en el coste del camino que
falla**, no en los 774 291 del camino bueno.

**Arreglo en el script (no necesita llave, lo hago yo):** el envío del settle debe pasar un
`gas` explícito y generoso en lugar de dejar que viem estime. `scripts/cadence.ts:561-562`
llama a `send(...)` sin `gas`, y no hay ningún `gas:` en toda la ruta de settle.

---

## 2b. ARREGLADO EN EL CÓDIGO — 2026-09-07, sin llave

El remedio que este documento pedía en la §2 (*"el envío del settle debe pasar un `gas`
explícito"*) está implementado, y **en las cuatro llamadas del driver, no solo en el
settle** — porque el argumento no es sobre el settle, es sobre la forma del contrato:

| Llamada | `try`/`catch` por organismo | ¿Avanza fase igual? | Antes | Ahora |
|---|---|---|---|---|
| `think` | `createAdvancedRequest` -> `ThinkFailed` + `CognitionUnspent` | sí, `phase = 1` | estimado | `600k + 500k x vivos` |
| `commitAll` | `_pair` vía `executePair`, `_openEmpty` -> `CommitFailed` | sí | estimado | `600k + 500k x vivos` |
| `settleAll` | `SettleFailed` (`Population.sol:1847`) | sí, `phase = 0` (`:1851`) | estimado | `1.5M + 900k x vivos` |
| `hatchAll` | **ninguno** — un OOG revierte de verdad | no tiene fase | estimado | `400k + 1.2M x vivos` |

`think` es el caso más caro de infraestimar y no era el que se midió: `drawCognition` cobra
el depósito **antes** de `createAdvancedRequest`, así que un organismo saltado por gas ya
pagó sus 0,24 STT y no compró nada. `hatchAll` es el más silencioso: sin `try` por organismo
el OOG revierte, y el `catch` de `hatch()` en `cadence.ts` lo absorbe como tolerancia — una
cría perdida por gas se lee como *"nothing was pending"*.

Ficheros:

- **`scripts/lib/gas.ts`** (nuevo) — módulo puro sin imports, misma razón que `season.ts` y
  `commit.ts`: la aritmética se puede ejercitar sin cadena. Lleva la medición de la ventana
  68 y el argumento completo. `BLOCK_GAS_CEILING = 30M` con `capped` en el retorno, porque a
  `maxPopulation = 24` el settle pide 23,1M y `hatch` 29,2M — el clamp **es alcanzable**, no
  es adorno, y cuando pega hay que decirlo en voz alta en lugar de dejarlo aparecer como un
  `SettleFailed` misterioso en el último organismo del bucle.
- **`scripts/cadence.ts`** — `gasFor()` lee `aliveCount` y avisa si hubo clamp. Si la lectura
  falla dimensiona para 24 organismos, no para 1: sobredimensionar es gratis (el gas no usado
  se devuelve), infradimensionar por el camino de error reintroduciría el defecto. `type Call`
  admite `gas?` — opcional solo porque `pushWindow` y `endSeason` no iteran `living`.

**14 checks nuevos bajo `npm run cadence -- --self-test`** (sin RPC, sin llave, sin deploy),
2 de ellos controles, y **los cuatro se confirmaron capaces de fallar perturbando el módulo**,
no por inspección:

| Perturbación | Qué falló |
|---|---|
| `settle` floor 1,5M -> 900k | 6 filas |
| `hatch` /100 | 3 filas + el invariante W68 |
| `BLOCK_GAS_CEILING` -> 300M | las 2 filas del clamp |

Los dos controles son las dos maneras de equivocarse: `estimatorShaped` devuelve el 2 592 003
literal de la ventana 68 ignorando la población (el defecto como número), y `noClamp` acierta
en toda población pequeña y devuelve 23,1M/30,4M inminables en `maxPopulation` — solo las
filas de 24/25/33 organismos los separan. Aparte de la tabla hay dos invariantes: ninguna
llamada puede dimensionarse por debajo de los **2 465 478 que se cobraron mientras saltaban a
MOMENTUM**, y ninguna puede devolver un límite por encima del techo de bloque a ninguna
población que el contrato pueda alcanzar.

Verificado: `npm run typecheck` limpio, `npm run count:check` PASS, `npm run abi:check` PASS
(257/258), y `npm run cite:check` pasó de **3 BROKEN a 0** — dos de las citas rotas apuntaban
a estas mismas rutas y están corregidas: el `emit SettleFailed` de `HANDOVER_SETTLE_W68.md`
ahora apunta a la línea que existe, y las dos citas de `cadence.ts` en el spec del 09-05
apuntan a la copia sobre founders donde de verdad está. Los 179 "adrift" son previos y no los
toqué.

(Nota para quien edite esto: escribir aquí una cita rota **como ejemplo** la vuelve una cita
rota de verdad — `cite-drift` no distingue prosa de referencia, y así es como debe ser.)

**No he mandado ninguna transacción.** Los comandos de la §3 siguen siendo tuyos.

## 3. Recuperar MOMENTUM — 2 comandos, en este orden

**ESTADO RELEÍDO DE LA CADENA 2026-09-07, y sigue todo igual:** `phase 0`, `windowCount 68`
(`0x44`), `aliveCount 6`, y MOMENTUM con `positionOpen true`, `currentQuantity 13 300 000`
(`0xcaf120`), `treasury 0`, `streak 0`, `abstainCount 67` (`0x43`). La posición ganadora sigue
abierta y sigue recuperable. El arreglo de gas de la §2b **no la recupera por sí solo** — evita
la próxima, no deshace esta.

**AVISO QUE SIGUE VIGENTE:** `phase` está en **0 (THINK)**. Un `npm run cadence:once` a
secas ejecutaría `think()`, y `Prophet.noteCommitted` (`:408-415`) **no tiene guarda sobre
`positionOpen`**: sobrescribe `currentOutcomeId`/`currentStake`/`currentQuantity` sin
condición. El `commitAll` de la ventana 69 dejaría huérfanos los 13 300 000 tokens
ganadores de MOMENTUM con sus 6,65 tUSDC ya gastados. **NO ejecutes `think()` antes del
settle.**

```bash
cast send 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb "forcePhase(uint8)" 2 \
  --rpc-url https://dream-rpc.somnia.network --private-key $PRIVATE_KEY

cast send 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb "settleAll()" \
  --gas-limit 3000000 \
  --rpc-url https://dream-rpc.somnia.network --private-key $PRIVATE_KEY
```

El segundo va **directo a `settleAll` con gas explícito**, no vía `npm run cadence:once`,
precisamente para no volver a pasar por `estimateGas`. Ahora solo queda un organismo
abierto, así que 3 M de límite es ~4x el coste medido de la pata (el replay de MOMENTUM
solo dio 636 284). `forcePhase` es el escape hatch documentado (`Population.sol:770-774`):
no revive nada, no toca `treasury` ni el flag `dead`.

**Verificación posterior:**

```bash
MOM=0x22fC3Ab08F20391300fC1Fe194FdB5577a6DD4f8
cast call $MOM "treasury()(uint256)"     --rpc-url https://dream-rpc.somnia.network  # 13083750
cast call $MOM "streak()(uint256)"       --rpc-url https://dream-rpc.somnia.network  # 1
cast call $MOM "positionOpen()(bool)"    --rpc-url https://dream-rpc.somnia.network  # false
cast call $MOM "abstainCount()(uint256)" --rpc-url https://dream-rpc.somnia.network  # 67, NO 68
```

`abstainCount` en **67** con `windowsLived` en **68** es la prueba DURABLE de que hubo
posición real: el settle resetea `currentQuantity`, pero no el contador. Sobrevive a la
ventana, y es lo que hay que enseñarle a un juez.

## 4. Estado de la ventana 68 (ya en cadena, no pendiente)

```
phase 0   windowCount 68   aliveCount 6   prizePool 3 366 500   rakeAccrued 16 329 750

ORG        lived  abstain  open   dead   treasury    streak
MOMENTUM   67     67       true   false  0           0      <- pendiente del settle de arriba
REVERSION  68     67       false  true   0           0      <- murió (Down, falló)
BREAKOUT   68     67       false  false  13 083 750   1      <- ganó
PINNED     68     67       false  true   0           0      <- murió (Down, falló)
```

Primer evento de selección natural real del deploy: **8 -> 6 vivos**. Los otros 4
(SKEPTIC, GAMBLER, PATIENT, SCALPER) formaron creencia pero eran UP sobrantes (6 UP vs 2
DOWN = solo 2 parejas), así que `_openEmpty` los cerró con `quantity 0`.

---

## 5. Pendiente para el submit — de la auditoría de enlaces

### BLOQUEANTE 1: no hay nada publicado. No existe ninguna URL alojada en el repo.

`README.md:402-412` solo ofrece `npm run preview --prefix app` en localhost. `app/dist`
existe en disco pero **no está trackeado** (`git ls-files app/dist` -> 0 ficheros). No hay
`SUBMISSION*`/`DEMO*`/`PITCH*`. Grep de `vercel|netlify|github.io|youtu|loom` en todos los
docs y ambos frontends: **cero**. El único camino de un juez a la UI es clonar -> submódulos
-> `npm install` en dos sitios -> build. La instrucción de los organizadores ("publish your
project and double check all your links") está sin cumplir y no hay link que revisar.

### BLOQUEANTE 2: `web/config.js` POPULATION vacío — **ARREGLADO 2026-09-08**

Estaba en `export const POPULATION = "";` con el comentario obsoleto encima ("Filled in at
the Season 0 deploy. Empty on purpose"). El deploy ya había pasado. Consecuencia medida: el
camino documentado en `web/README.md` (`npx serve web`) dejaba al juez en la **tarjeta de
setup**, porque el único fallback que quedaba era `MANIFEST_PATH` (`web/config.js:49`),
que apunta **fuera** de la raíz servida. Solo el middleware de vite de `app/` lo rescataba.

Ahora `web/config.js:43` lleva la dirección real de Population
(`0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb`, idéntica a `population` en `50312.json`), y
es **paso 3** en el orden de resolución: `?population=0x…` y `localStorage` siguen ganando,
así que una segunda arena sigue siendo una URL y no un rebuild.

### BLOQUEANTE 3: afirmaciones bajo "verifiable from the chain" que la cadena refuta

Bajo `README.md:175` *"**Claimed, and verifiable from the chain:**"*:

- `:190-192` "Positions are real and fully collateralised…" — medido: `correctCount()` 0,
  `wrongCount()` 0, `abstainCount()` 67/68, `generation()` 0. **Ahora ya es cierto tras la
  ventana 68** (BREAKOUT tiene `correct` 1 y `streak` 1), pero el texto necesita fecha y
  número de ventana para no leerse como una promesa vacía.
- `:198` "Fitness, death, mutation and lineage are computed on-chain" — cero mutaciones y
  cero crías todavía. Muertes ya hay 2. Matizar a lo que existe.

### DEBERÍA ARREGLARSE

- **`GenesisTreasury` está vivo y no aparece en ningún sitio.** `Population.genesisTreasury()`
  -> `0xF187842DF96d35d7a4dcDdbF83515D6D8aDC97Ca` (tiene bytecode, confirmado). No está en
  `contracts/deployments/50312.json` ni en la tabla de `README.md:503-511`, y sin embargo
  `README.md:82-86` hace sobre él la afirmación de confianza más fuerte del documento
  ("no owner, no withdrawal … which anyone may call") sin dar dirección que comprobar.
- **El 189/167 obsoleto: CERRADO.** El real es **231 PASS** y **211** `assert(`, remedido hoy.
  README y `CLAUDE.md` ya lo llevaban corregido del 09-07. Las seis apariciones que quedan en
  `docs/FRONTEND_CHECKPOINT.md` **se dejan a propósito**: todas van fechadas ("measured
  2026-09-05", "as of 2026-09-03") y el propio documento dice que `darwin/CLAUDE.md` es el único
  sitio que se mantiene al día. Es la misma convención que el `56/56` de la fila de
  `evm_version`: re-estampar un registro fechado afirmaría una medición que nunca ocurrió.
- **La economía de inferencia: CERRADA 2026-09-08 en los tres documentos.** El README ya se
  había arreglado el 09-07 (el bloque de agosto sigue ahí pero queda explícitamente superado por
  el bloque del 09-07 debajo, que da 0,07 / 0,24 / 1,375 ventanas). Faltaban los otros dos y ya
  están:
  - **`docs/BUSINESS_PLAN.md`** — `0,033 STT per organism per window` -> **0,24**, y la tabla de
    parámetros lleva `perAgentReward` 0,07 con su medición (78/78 vs 0/104), la fila del refund
    a `msg.sender`, y un párrafo diciendo que esa fila se movió 7x y por qué. La frase
    "0,033 STT per organism per window" ya no aparece en el documento.
  - **`CLAUDE.md`** — la tabla marca el 0,033 tachado -> 0,24; el párrafo del "deposit is not
    escrow" ya distingue éxito (nada vuelve) de fallo (~0,0292 a `msg.sender`); **y la
    conclusión se invierte**: con el suelo en solo el 12% de lo que pagamos, la palanca ya no es
    el número de peticiones sino el reward. Añadido el coste real: 8 organismos a 15 min =
    **7,68 STT/hora**. El párrafo del `perAgentReward` ya no dice "lowered to 0.001", dice que
    0,001 compró **cero** inferencias y que lo que separó las dos hipótesis fueron las
    direcciones de validador a cero. Y las "ten windows each" pasan a 1,375.
  - §7 del business plan no necesitaba tocarse: su desigualdad va en tUSDC, y el riesgo de
    presupuesto STT solo se refuerza a 0,24.
- **`README.md:262-267` y `SPIKE.md:188` fila 9** aún listan `allowedValues` como sin
  verificar. La edición ya hecha en `contracts/src/interfaces/ISomnia.sol` (182 peticiones,
  78/78 Success a 0,07) lo cierra. Esa edición está **sin commitear**.
- **Cifras de la landing que se leen como datos vivos**, sin etiqueta de "ilustrativo", a un
  clic de una arena que las contradice.
  **Hero.jsx: ARREGLADO 2026-09-07.** `Treasury · #3 · 41.20 tUSDC` era la peor: `endowment()`
  es 10 y el saldo más alto que ha existido nunca son 13,08 (organismo #3 tras ganar la 68), así
  que 41,20 no era ni un default ni una lectura. Ahora la cifra ES `endowment()` — 10,00
  drenando 0,05 = `metabolicCost()` — y la etiqueta dice `at birth` en vez de `· #3`, porque
  nombrar un organismo vivo era lo que invitaba a la comparación. El genoma era una paráfrasis
  atribuida a `#3` (que en cadena es BREAKOUT); ahora es un **prefijo contiguo literal** del
  genoma del #1 desde `genomes/genesis.json`, y el hash del genoma completo cuadra con
  `Prophet#1.genomeHash()` — comprobado, `0x8ae06d7c…cad2`. Y la rejilla lleva por fin una
  etiqueta visible (`.vitals-source`): "Illustrative", con enlace a la arena.
  **BeatGenome y BeatLineage: ARREGLADOS 2026-09-08.** Eran la misma clase de defecto
  (`generation` inventada contra el **0** que hay en cadena en los ocho) y el remedio va por
  caminos distintos según si la figura puede ser real o no:
  - **BeatGenome** ahora es un organismo REAL: `REVERSION · #2 · generation 0`, `Dead`, con el
    genoma citado **literal y contiguo** desde `genomes/genesis.json` (no parafraseado — la
    paráfrasis es lo que dejó que el texto viejo derivara), `Parent: founder`, y el resultado
    medido de la ventana 68. Antes decía "Organism #7 · generation 2" con padre "#3".
  - **BeatLineage** no puede ser real (nadie ha criado), así que se declara diagrama: los nodos
    pasan de ids (`#1`, `#17`, `#26`) a **letras** (`A`…`K`), porque un nodo numerado es una
    afirmación sobre un organismo concreto que un juez puede ir a buscar. El raíl de censo pasa
    de `1/3/4/2` en cuatro generaciones al censo REAL — 8 nacidos / 6 vivos / 2 muertos / **0**
    en generación 1 — y el contador `deepest` tweenea a **0** en vez de a 3, que era la mitad
    animada del mismo sobre-anuncio. Lleva `.vitals-source` diciendo en voz alta que nadie ha
    criado.
  - Un cero ahí no es una demo floja: es la métrica funcionando: la profundidad hay que
    GANARLA (4 aciertos seguidos + 1,5x endowment) y todavía nadie la ha ganado. Falsearla
    habría tirado a la basura el único número que el README llama el titular.
- **`cite:check`: de FAIL a PASS, 2026-09-08.** Se rompió por la edición de Hero.jsx del 09-07
  (reordenar el fichero movió las líneas). Eran **5 BROKEN** al releerlo, no 2 — las dos del
  checkpoint más tres que ya venían de antes. Todas corregidas, y los destinos viejos van
  escritos **en palabras y no en forma `fichero:línea`**, porque `cite-drift` no distingue prosa
  de referencia y citarlos como ejemplo los volvería roturas de verdad (es la nota de la §1, y
  funciona: el primer intento de anotar esto creó 3 BROKEN nuevas).
  - Las dos del checkpoint: la que apuntaba a la línea **168** de `Hero.jsx` (en blanco) ahora
    apunta al `pays to think`; la que apuntaba a la **217** (`};`) ahora apunta a los dos
    enlaces `/arena/` del Hero. Ese párrafo decía "from three places" y ahora son **cuatro**,
    con las cuatro líneas nombradas.
  - Las tres previas: una en `web/js/chain.js` hacia `LOG_CHUNK` en `config.js` (línea vieja
    **71**, hoy un `*`), y dos en este mismo documento hacia `web/config.js` — resueltas al
    reescribir el BLOQUEANTE 2 como cerrado.
  - Estado: **PASS, 261/453 resuelven, 0 BROKEN**. Los 175 "adrift" son previos y no los toqué.

### NITPICKS — los cuatro revisados 2026-09-08

- **Los puertos del `web/README.md` ya estaban bien** (`serve` en 3000, python en 8080, cada URL
  con su puerto); el nitpick era una mala lectura mía. Añadido un `(8080, not 3000)` al comentario
  para que la diferencia no se lea como typo.
- **El orden de resolución ya lleva el paso de `config.js`** y además dice explícitamente que va
  *delante* del manifest y por qué (el coste es que la constante se edita a mano).
- **Los dos de `Footer.jsx` ya estaban arreglados** en el árbol sin commitear: `REPO` a
  `github.com/Handilusa/Darwin`, y el enlace del explorer usa `addressUrl(contract)` con
  fallback a la home solo si no hay Population cargada.
- **Viem por CDN sigue en pie y se queda.** Es el único runtime no vendorizado
  (`https://esm.sh/viem@2.56.0`); GSAP y fuentes sí lo están. No es un arreglo de última hora:
  vendorizar viem cambiaría la ruta de carga de las dos UIs el día del submit.

### VERIFICADO LIMPIO (no lo vuelvas a revisar)

Todas las 0x del README coinciden con `50312.json` exactamente, incluidas las 7 formas
truncadas. Cero placeholders (`TODO|TBD|FIXME|0xYOUR`) en README, docs, `web/`, `app/src`.
Las 12 direcciones del manifest y las 8 de los organismos tienen bytecode. El wiring vivo
== manifest en los 6 punteros. El `genomeHash` de MOMENTUM cuadra: `cast keccak` del genoma
== `50312.organisms.json` == `genomeHash()` en cadena. Los 9 enlaces markdown del README dan
200 y todos los de explorer son `shannon-explorer.somnia.network` (testnet, nunca mainnet).
`eth_chainId` de dream-rpc -> `0xc488` = 50312. `github.com/Handilusa/Darwin` es público y
renderiza. **`?demo=1` es opt-in y nunca el default** (`web/js/main.js:471`, gated en
`web/config.js:156`); no hay dirección hardcodeada en `app/`. `.env` no está trackeado.

## 6. Lo demás pendiente

- **`prove`: B1 y B3 ARREGLADOS 2026-09-08, sin llave. B2 sigue necesitando llave.**
  - **B1** era `reactive.at(-1)`: juzgaba UNA reacción de todas las que hay. `main` ahora
    itera de nueva a vieja, se queda con el veredicto más fuerte y corta en el primer
    `decoded` porque nada más viejo puede ganarle. Acotado con `--max-candidates` (25 por
    defecto) ya que cada candidata cuesta un `getLogs`, un `getBlock` y un scan paginado.
  - **B3** era un `warn` en el caso `!opened`: sin `WindowOpened` no hay forma de distinguir
    nuestro mercado del singleton compartido liquidando el de otro en el mismo bloque, que es
    justo la coincidencia que el script existe para descartar. Ahora es `problems.push` — el
    run FALLA y dice qué ampliar. Era la puerta de honestidad satisfecha con su comprobación
    central saltada.
  - Para poder iterar hubo que partir `verify()` en tres: `gather` (lee), `judge` (**puro**:
    sin RPC, sin imprimir, sin `process.exitCode`) y `report` (imprime). El `verify()` viejo
    llamaba a `fail()` él mismo, así que en bucle habría impreso una prueba fallida por
    candidata.
  - **12 checks nuevos en `npm run prove:selftest`**, sin RPC ni llave, **2 de ellos
    controles**. Las cuatro perturbaciones se EJECUTARON y cada una tumbó exactamente una
    fila: B3 de vuelta a `warn` → *"a missing WindowOpened FAILS"*; `RANK.raw`→`decoded` →
    *"raw ranks below decoded"*; quitar el check de `recordedBlock` → *"a lying
    recordedBlock"*; `RANK.unchecked`→`broken` → el control del ranking.
  - **El self-test se pilló a sí mismo un fixture malformado**: mi `MarketFinalized` falso
    llevaba 32 bytes de data, `decodeEventLog` petaba, y `references` caía al tier de hex
    crudo — o sea que los tests 1 y 2 medían los dos el camino RAW mientras decían comparar
    raw contra decoded. Ahora la data va con `encodeAbiParameters`.
  - **B2** (el SelectionEngine desplegado es el build de 2171 bytes sin `_windowIsDecidable`)
    necesita llave: redeploy + `setWiring` + resuscribir.
- **La temporada 3 cierra en la ventana 72** (`seasonStartWindow` 48 + `seasonWindows` 24).
  Estamos en 68: quedan **4 ventanas**. Con el precio arreglado pueden salir reales y
  `endSeason` reparte con un ganador de verdad.
- **Fondear antes de seguir:** 0,24 STT por ventana pensada. `npm run fund -- --windows 12`
  recorre a los vivos (ahora 6).
- `cognitionEndowment` es 0,33 STT contra un depósito de 0,24: un recién nacido piensa 1,4
  ventanas. Remedio operativo `fund --windows`; remedio en cadena, el `setSeason` ya
  preparado en `docs/HANDOVER_PRICE_FIX.md` con `cognitionEndowment = 1200000000000000000`.
- **Nunca `npm run cadence` a secas** — no tiene tope de ventanas. Solo `cadence:once`.
