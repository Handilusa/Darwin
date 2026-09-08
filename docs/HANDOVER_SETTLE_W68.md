# SETTLE de la ventana 68 — secuencia verificada 2026-09-07 20:02Z

Para la IA local (tiene la llave). Claude no puede firmar.

## PRIMERO: el arreglo del precio FUNCIONÓ

Creencias reales en cadena, ventana 68, verificadas contra el ERC1155 del outcome token
(no contra la contabilidad propia del organismo):

```
MOMENTUM   belief 1 UP    outcomeId ...752   ERC1155 balance 13300000   "UP_MOMENTUM"
BREAKOUT   belief 1 UP    outcomeId ...752   ERC1155 balance 13300000   "UP_BREAKOUT"
REVERSION  belief 2 DOWN  outcomeId ...753   ERC1155 balance 13300000   "DOWN_REVERSION"
PINNED     belief 2 DOWN  outcomeId ...753   ERC1155 balance 13300000   "DOWN_RANGE"
```

Dos en cada mitad complementaria del mismo mercado, 6,65 tUSDC de stake cada uno.
`lastReasoning` no vacío y `belief != 3` en los cuatro. **El paso 2 del roadmap está
demostrado**: hay posición real en cadena. Cada genoma respondió en su propio idioma.

Los otros 4 (SKEPTIC, GAMBLER, PATIENT, SCALPER) también formaron creencia, pero eran
UP sobrantes: 6 UP contra 2 DOWN solo permite 2 parejas, así que `_openEmpty` los cerró
con `quantity 0`. Ya están en `windowsLived 68`.

## El fallo que viste NO era un bug

`settleWindow` revertía `0x1ff09bee` = **`MarketNotSettled()`**. Nuestro mercado es de 4 h
(`tradingStart` 16:00Z, `expiry` 20:00Z) y `settleAll` corrió antes de que expirara —
esos eran tus 905 s. `settleAll` lo tragó en su `catch` (`Population.sol:1847`,
`emit SettleFailed`) y avanzó `phase = 0` de todos modos (`:1851`, incondicional).
Por eso `phase 0` con posiciones aún abiertas: no es que liquidara, es que se rindió
con 4 organismos sin liquidar.

A 20:02Z el mercado `0xbBc01E744b05da71cd9F9769c6f4889276Eb2eEc` da
`isResolved() == true`. Ya se puede liquidar.

## RIESGO REAL — no ejecutes `think()` antes del settle

`Prophet.noteCommitted` (`:408-415`) **no tiene guarda sobre `positionOpen`**: sobrescribe
`currentOutcomeId`, `currentStake` y `currentQuantity` sin condición. El orden de una
ventana es think -> commit -> settle, así que `commitAll` de la ventana 69 pisaría las
posiciones de la 68 antes de liquidarlas, y los 13,3 tokens de outcome de cada organismo
quedarían huérfanos con sus 6,65 tUSDC ya gastados.

`phase` está en **0 (THINK)**, así que un `npm run cadence:once` a secas ejecutaría
`think()`. **NO lo ejecutes hasta después del settle.**

## Resultado ya simulado (`cast call --from Population`, gas cero)

```
MOMENTUM   UP    payout 13300000  starved false  charged 50000  raked 166250
BREAKOUT   UP    payout 13300000  starved false  charged 50000  raked 166250
REVERSION  DOWN  payout        0  starved TRUE
PINNED     DOWN  payout        0  starved TRUE
```

**Ganó UP.** Los dos DOWN salen `starved`, así que `settleAll` llamará `die()` sobre ellos,
volcará su residuo al `prizePool` y `aliveCount` bajará de 8 a 6. Primer evento de
selección natural real del deploy — y para un juez eso vale más que ocho supervivientes.

## Los 2 comandos

`settleAll()` es `inPhase(2)` y la fase está en 0, así que hace falta el escape hatch:

```bash
cast send 0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb "forcePhase(uint8)" 2 \
  --rpc-url https://dream-rpc.somnia.network --private-key $PRIVATE_KEY

cd C:\Users\Handi\Desktop\somnia_predict\darwin
npm run cadence:once      # ve phase 2 -> doSettle
```

`forcePhase` es el escape hatch documentado (`Population.sol:770-774`): no revive nada,
no toca `treasury` ni el flag `dead`, solo mueve la máquina de fases.

Nota: en fase 2 el SelectionEngine puede disparar `settleAll()` por su cuenta al reaccionar
a un settlement ajeno (pasan cada ~60 s). Da igual, es exactamente lo que queremos; si
fallara solo emite `SettleFailed`.

## Verificación posterior

```bash
POP=0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb
MOM=0x22fC3Ab08F20391300fC1Fe194FdB5577a6DD4f8
cast call $POP "aliveCount()(uint256)" --rpc-url https://dream-rpc.somnia.network   # debe dar 6
cast call $POP "prizePool()(uint256)"  --rpc-url https://dream-rpc.somnia.network   # debe subir
cast call $MOM "treasury()(uint256)"     --rpc-url https://dream-rpc.somnia.network
cast call $MOM "abstainCount()(uint256)" --rpc-url https://dream-rpc.somnia.network
cast call $MOM "streak()(uint256)"       --rpc-url https://dream-rpc.somnia.network
```

`abstainCount` debe quedarse en **67** mientras `windowsLived` pasa a **68**. Ese desfase
es la prueba DURABLE de que hubo posición real: `settle` resetea `currentQuantity`, pero
no el contador. Es lo que hay que enseñarle a un juez, porque sobrevive a la ventana.

`streak` en 1 en MOMENTUM y BREAKOUT es el primer paso hacia `breedStreak`, o sea hacia
la generación 1 — que es la métrica principal de DARWIN.

## Después, y solo después

La temporada 3 cierra en la ventana 72 (`seasonStartWindow` 48 + `seasonWindows` 24).
Quedan 4 ventanas. Con el precio ya arreglado pueden salir reales, y entonces `endSeason`
reparte premio de verdad con un ganador de verdad.

Fondear antes de seguir: los organismos gastan 0,24 STT por ventana pensada.
`npm run fund -- --windows 12` recorre a los vivos (ahora 6, tras las dos muertes).
