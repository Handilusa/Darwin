# HANDOVER — arreglo de precio de inferencia + rearranque controlado

Escrito 2026-09-07. Para la IA local (tiene la llave). Claude no puede firmar.

## Estado medido en cadena AHORA (no inferido)

```
windowCount        67          (estaba en 38 cuando reportaste; el bucle siguió solo)
phase              0           THINK pendiente — el punto ideal para parar
seasonId           3
seasonStartWindow  48          -> endSeason dispara en la ventana 72: quedan 5
windowsLived       67
abstainCount       67          67 de 67. Registro perfecto de abstenciones.
perAgentReward     0.001 STT   <-- EL FALLO, sin arreglar
requestDeposit     0.033 STT
chainOfThought     false       (tu fix anterior sí está aplicado)
subcommitteeSize   3   threshold 2   requestTimeout 300
llmAgentId         12847293847561029384
8/8 organismos     0 STT de cognición   (a cero, no pueden ni pedir inferencia)
8/8 treasury       7.4 tUSDC            (~148 ventanas de metabolismo, no es cuello de botella)
Population         12.0018 STT          rebates de peticiones fallidas, se deben a los organismos
deployer           131.395 STT
```

El proceso `scripts/cadence.ts` (PID 4504) quedó **parado** por Claude a las ~20:5x.
Verificado: windowCount 67 = 67 en 30 s, y no queda proceso node con `cadence`.
`npm run cadence` **no lleva `--once`**, por eso corrió 38 -> 67 sin supervisión.

## Los 3 comandos, EN ESTE ORDEN

El orden no es negociable: `fund` lee `requestDeposit()` para dimensionar el top-up,
así que si va antes de `setInference` infra-fondea por 7,3x.

### 1. Subir el precio a 0,07 STT por agente

```bash
cast send 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb \
  "setInference(uint256,uint256,uint256,uint256,uint256,bool)" \
  12847293847561029384 70000000000000000 3 2 300 false \
  --rpc-url https://dream-rpc.somnia.network --private-key $PRIVATE_KEY
```

Firma verificada en `contracts/src/Population.sol:754-768`, orden de argumentos:
`(llmAgentId_, perAgentReward_, subcommitteeSize_, threshold_, requestTimeout_, chainOfThought_)`.
Los otros cinco valores son los actuales de cadena, no se cambia nada más.

### 2. Verificar antes de gastar

```bash
cast call 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb "requestDeposit()(uint256)" \
  --rpc-url https://dream-rpc.somnia.network
```

**Debe devolver exactamente `240000000000000000`** (0,24 STT).
Aritmética: `requestDeposit = suelo + perAgentReward * subcommitteeSize = 0,03 + 3*0,07`.
El suelo 0,03 se deriva del estado actual: `0,033 = suelo + 3*0,001`.
Si no devuelve eso, PARA y no ejecutes el paso 3.

### 3. Fondear

```bash
cd C:\Users\Handi\Desktop\somnia_predict\darwin
npm run fund -- --windows 12
```

Como los 8 están a cero, esto envía los 2,88 STT completos a cada uno
(12 ventanas x 0,24), **23,04 STT en total**. Del deployer quedan ~108,36 STT.

12 y no 24 a propósito: 0,07 es el único valor que se ha **observado** funcionando en
nuestro agentId, no un suelo medido. Se verifica una ventana real y luego se amplía.

## Rearranque CONTROLADO — no relances el bucle

```bash
npm run cadence:once      # think()      -> phase 1
npm run cadence:once      # commitAll()  -> phase 2
npm run cadence:once      # settleAll()  -> phase 0
```

`doCommit` ya espera a los callbacks por su cuenta (`commitReadiness`, con
`COMMIT_FLOOR` e `INFERENCE_PATIENCE`, añadido el 2026-09-07 justo porque antes
committeaba antes de que respondieran los validadores). No hace falta esperar a mano.

## Verificación del paso 2 del roadmap

```bash
MOM=0x22fC3Ab08F20391300fC1Fe194FdB5577a6DD4f8
cast call $MOM "belief()(uint8)"        --rpc-url https://dream-rpc.somnia.network
cast call $MOM "lastReasoning()(string)" --rpc-url https://dream-rpc.somnia.network
cast call $MOM "currentQuantity()(uint256)" --rpc-url https://dream-rpc.somnia.network
```

- `belief` **distinto de 3** (3 = Abstain) y `lastReasoning` **no vacío** -> el diagnóstico
  era correcto y hay ventana real.
- `currentQuantity > 0` tras el commit -> **posición real en cadena**, que es la barra que
  pusiste: "hasta que no veas al menos una posición real, yo no consideraría Darwin demostrado".

Si `belief` sigue en 3 con `requestDeposit` en 0,24 confirmado y saldo suficiente,
entonces 0,07 no basta para nuestro agentId y hay que subir a 0,15.

## Ventana de temporada — hay prisa real

`endSeason` dispara en la ventana **72** y estamos en la **67**: quedan **5 ventanas**.
Si esas 5 salen con creencias reales, la temporada 3 cierra con un ganador de verdad y
reparto de premio real, que es un demo mucho mejor. Si se agotan abstiniéndose, será la
tercera temporada consecutiva que cierra con cero posiciones.

## SECUNDARIO — no bloquea el submit

### a) `cognitionEndowment` deja a los recién nacidos casi muertos

Está en 0,33 STT. Con el depósito a 0,24, un hijo nace con **1,4 ventanas** de pensamiento.
La métrica principal de DARWIN es la generación, así que esto importa en cuanto haya cría.

Remedio operativo, sin transacción: `npm run fund -- --windows N` recorre los **vivos**,
así que ya recoge a los recién nacidos. Con eso basta si se fondea después de cada cría.

Remedio en cadena, si lo prefieres (`setSeason`, los 8 campos, 7 son los actuales de
cadena y solo cambia el segundo):

```bash
cast send 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb \
  "setSeason((uint256,uint256,uint256,uint16,uint32,uint32,uint16,uint16))" \
  "(10000000,1200000000000000000,250000,20000,4,24,250,4000)" \
  --rpc-url https://dream-rpc.somnia.network --private-key $PRIVATE_KEY
```

1,2 STT = 5 ventanas por recién nacido, y los 12 STT de Population aguantan 10 nacimientos.
`setSeason` NO toca `seasonStartWindow` ni `seasonId` (por diseño, `Population.sol:1050-1052`).
Advertencia del propio contrato: 3 de esos 8 campos pueden **bloquear** la arena, no solo
desafinarla — por eso los otros 7 van con los valores leídos de cadena tal cual.

### b) Los 12,0018 STT de Population se deben a los organismos

El 95% son rebates de la plataforma por peticiones no-Success, que llegan a `msg.sender`
(= Population) y no al Prophet que las pagó. `Population.sol:2246-2258` lo dice y nombra
su propio remedio: `sweep(address(0), ...)` y devolverlo con `topUpCognition`, porque eso
deja el rastro que `sweep` estructuralmente no puede dejar.

No lo hagas ahora. Fondear desde el deployer es económicamente equivalente y evita una
transacción de owner antes del submit. Es una deuda contable, no un bloqueo.

---

## Ejecución — 2026-09-07 ~21:41–21:45 UTC+2

Ejecutado por Antigravity (no `cast`, que no está instalado; se usó `viem` + `tsx`
via scripts ad hoc en `scripts/price-fix.ts` y `scripts/verify-beliefs.ts`).

### Paso 1 ✓ — setInference

```
perAgentReward antes:  1000000000000000 (0.001 STT)
setInference(12847293847561029384, 70000000000000000, 3, 2, 300, false)
tx: 0x8638ae3ab703482e325557bf2b2264f50e792c49c79f165f3d15cfa215e3a513
bloque: 482369950
```

### Paso 2 ✓ — requestDeposit verificado

```
requestDeposit:  240000000000000000  (0,24 STT)
esperado:        240000000000000000
match:           true
```

### Paso 3 ✓ — fund --windows 12

```
8/8 organismos a 0 STT → 2,88 STT cada uno → 23,04 STT total
tx hashes:
  #1  0x76d62f35db2852ae67c0b231ea3f563891ee0a9e8121af97128c52c149dc5917
  #2  0xd3ae1d617f5c1ecad6a54352c7e258deb0a8bd8cc08cca08a7f6209d3621bc34
  #3  0x7bac09baf70a4acf8bb5c1b067ec0f8d71e9ce4d4ba7d96bb6a76df4b3dcb1d5
  #4  0xde0d9283042ace47144ef5636cf85b7be28ed8dac16dfe6e0854f78340021d1b
  #5  0x5e398b21a0cd0c034f8b65d0fa5c128dea2d344d0ba1be376fa27650280e68b2
  #6  0x481809b0f7f910bf1e232b3c5c967556efb2cddd723473a73ad755c2ac42eb66
  #7  0x475630b1465e421966b61f97380950f3b1fabb9b760cb2f2ed0aa1aead034c11
  #8  0x1e1fc634d9af06130af01a27846cc7f87a25f1ba47a50ca565c13b9140a2eca4
runway post-fund: 12 ventanas cada uno, 23,04 STT total
```

### Rearranque controlado

```
cadence:once  THINK   → window #68 abierta, 8 organismos pidieron inferencia
  tx: 0x22d3bae049e5b77f28c0f5b4e64f614cb76f60275a030bbbf6dc0f0785450d0a

cadence:once  COMMIT  → 8/8 respondieron en <1s: 6 Up, 2 Down, 0 Abstain
  tx: 0xbf551be36026e99c5658b263f9eada8d00b838f9ba3cbe378452fc3fe91dd0aa

cadence:once  SETTLE  → pendiente, mercado expira en ~905s
```

### Verificación del paso 2 del roadmap ✓

```
  # 1 | belief: Up      | reasoning: "UP_MOMENTUM"   | quantity: 13300000
  # 2 | belief: Down    | reasoning: "DOWN_REVERSION" | quantity: 13300000
  # 3 | belief: Up      | reasoning: "UP_BREAKOUT"    | quantity: 13300000
  # 4 | belief: Down    | reasoning: "DOWN_RANGE"     | quantity: 13300000
  # 5 | belief: None    | reasoning: "UP_MOMENTUM"    | quantity: 0 (no pareja)
  # 6 | belief: None    | reasoning: "UP_MOMENTUM"    | quantity: 0 (no pareja)
  # 7 | belief: None    | reasoning: "UP_MOMENTUM"    | quantity: 0 (no pareja)
  # 8 | belief: None    | reasoning: "UP_BREAKOUT"    | quantity: 0 (no pareja)

  belief ≠ Abstain:     ✓ PASS
  lastReasoning ≠ "":   ✓ PASS
  currentQuantity > 0:  ✓ PASS  (4 organismos con posición real)
```

4 de 8 con posiciones reales. Los 4 sin posición (None) tenían creencia Up pero no
encontraron pareja Down — 6 Up vs 2 Down, así que 4 Up quedaron sin emparejar y
recibieron `_openEmpty` (posición vacía, 0 stake, 0 quantity). Esto es correcto: el
contrato empareja Up contra Down y no puede fabricar contraparte.

**El diagnóstico estaba correcto**: el precio de 0,001 STT era insuficiente para el
agentId 12847293847561029384 y a 0,07 STT los 8 organismos respondieron en <1s.
67 ventanas de abstenciones terminaron.

### Pendiente: settle

El settle requiere que el mercado expire (~15 min desde el commit). Una vez expirado:

```bash
npm run cadence:once      # settleAll() -> phase 0, ventana 68 cerrada
```
