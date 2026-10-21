# Dusty Gulch (repo Gate)

Mobilná webová hra vo westernovom štýle: tvoja skupina (posse) ide hlavnou ulicou mestečka,
zbiera posily cez brány a v prestrelkách za krytom bojuje s bandou. Zadanie: [`ZADANIE.md`](ZADANIE.md),
rozhodnutia: [`DECISIONS.md`](DECISIONS.md).

**Hra online:** https://bohemiangame.github.io/Gate/ (nasadzuje sa automaticky po pushi na `main`)

## Stav
| Fáza | Stav |
|---|---|
| 1. Projekt, deploy, voxelový engine, mesto, postavy, animácie | ✅ |
| 2. Presun, brány (aj strieľanie do brán), bedne so zbraňami, osamelí bandity | ✅ |
| 3. Prestrelka za krytom: drž = strieľaj, pusť = kryt + nabíjanie, varovanie „!“, headshot, TNT, zničiteľné kryty | ✅ |
| 4. Boss, výhra/prehra, hviezdy, mince, obchod, ukladanie, 10 levelov + generátor | ✅ |
| 5. Efekty, zvuky, vibrácie, Dead Eye, PWA, debug | ✅ (prvá verzia) |
| 6. Ladenie čísel simuláciou | ⏳ prebieha |

### Ako sa hrá
1. **Presun** – ťahaj prstom doľava/doprava. Skupina strieľa sama dopredu: do brán (záporné sa dajú vystrieľať na plus), do bední so zbraňou (číslo = počet zásahov) a do banditov na ceste.
2. **Prestrelka** – skupina sa schová za barikádu. **Drž prst** = vykloníš sa a strieľaš tam, kam ukazuje čiara. **Pusť** = skryješ sa a nabíjaš. Keď nad banditom blikne **„!“**, o chvíľu vystrelí – skry sa. Strieľaním sa dajú rozbiť kryty banditov, červená debna **TNT** vybuchne.
3. **Dead Eye** – tlačidlo vpravo dole sa nabíja zásahmi; spomalí čas.
4. **Boss** na konci levelu. Mince za preživších, hviezdy a level → obchod.

### Ďalšie režimy (parametre v URL)
- `?debug` – FPS, počet trojuholníkov, skoky na level, `bot` (autopilot), `god`, +500 $.
- `?sim` – simulácia vyváženia: bot prejde levely bez grafiky a vypíše tabuľku (`?sim&levels=12&runs=3&profile=good,average,bad`).
- `?showcase` – pôvodná vizuálna ukážka, `?view=lineup` – postavy zblízka.
## Verzia 2: taktická hra (prototyp) – `?tactics`
**https://bohemiangame.github.io/Gate/?tactics** – hrá sa **na šírku**.
- **Mesto**: ulica s obchodmi (ZBROJNICA, OBCHOD, SALOON, DOKTOR, ŠERIF). Ťukni na budovu → interiér s predavačom, nakupuje sa v tabuľke vpravo. **NA MISIU ▶** spustí ďalšiu misiu.
- **Misia**: vľavo karty Šerif / Skupina A / Skupina B. Ťukni na kartu (čas sa spomalí) a potom na miesto na mape → muži sa rozdelia do krytov. Vpravo hore PAĽBA / KRYT pre vybranú skupinu. **Vpravo dole mieriaca plocha šerifa**: drž palec a ťahaj = zameriavač sa hýbe a šerif strieľa, pusť = kryje sa a nabíja. Keď mieriš na toho istého banditu 0,7 s, zameriavač zožltne = rana na hlavu. Ťahanie po mape posúva kameru.
- Lokality: Námestie (misie 1–2), Pustatina (3), Železnica (4), potom sa striedajú.
- Rýchly test bez mesta: `?tactics&quick&map=plaza|desert|rail`. Vizuálny test: `?tactics&test&pix=2|3`.
- Čísla: `src/tactics/tbalance.ts` (boj), `src/tactics/campaign.ts` (ceny, štart). Rozhodnutia v `DECISIONS.md`.

## Spustenie lokálne
```bash
npm install
npm run dev      # http://localhost:5173 (aj z telefónu v rovnakej sieti)
npm run build    # produkčná verzia do dist/
```

## Ladenie čísel
Všetky čísla sú v [`src/game/balance.ts`](src/game/balance.ts) (rýchlosť, zbrane, HP násobiče, brány, odmeny, ceny v obchode).
Levely sú dáta v [`src/game/levels.ts`](src/game/levels.ts) – pole `LEVELS` (10 ručných) + `generateLevel()` pre ďalšie.
Po zmene spusti `npm run dev` a otvor `http://localhost:5173/?sim` – tabuľka ukáže výhry, preživších, čas a hviezdy.

## Štruktúra
- `src/engine/voxel.ts` – voxelová mriežka, greedy meshing, zdieľané materiály
- `src/engine/font.ts` – 3×5 pixelový font pre nápisy na domoch
- `src/gfx/characterModels.ts` – generátor postáv (posse, bandita, boss) a zbraní
- `src/gfx/character.ts` – procedurálne animácie postavy
- `src/gfx/town.ts` – domy, ulica, pozadie
- `src/gfx/props.ts` – sudy, debny, TNT, voz, barikáda, kaktusy, brány
- `src/gfx/effects.ts` – častice (kocky), stopy striel, záblesky
- `src/gfx/palette.ts` – všetky farby na jednom mieste
- `src/game/game.ts` – herná slučka, fázy levelu, ovládanie, streľba, kamera, menu, obchod, výsledky, bot
- `src/game/world.ts` – brány, bedne, kryty, bandity, boss, dynamit
- `src/game/balance.ts`, `src/game/levels.ts`, `src/game/save.ts`
- `src/ui/hud.ts` – HUD a obrazovky (DOM)
- `src/audio.ts` – zvuky generované cez Web Audio, vibrácie
- `src/ads.ts` – prázdne miesto pre reklamy portálov
- `src/sim.ts` – simulácia vyváženia

## Grafika a modely
Hra nepoužíva žiadne súbory s modelmi – všetko je voxelové a generované kódom (postavy, zbrane, domy).
Vzhľad sa mení v `src/gfx/characterModels.ts` (postavy, zbrane), `src/gfx/town.ts` (domy) a farby v `palette.ts`.
