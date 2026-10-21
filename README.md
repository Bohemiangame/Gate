# Dusty Gulch (repo Gate)

Mobilná webová hra vo westernovom štýle: tvoja skupina (posse) ide hlavnou ulicou mestečka,
zbiera posily cez brány a v prestrelkách za krytom bojuje s bandou. Zadanie: [`ZADANIE.md`](ZADANIE.md),
rozhodnutia: [`DECISIONS.md`](DECISIONS.md).

**Hra online:** https://bohemiangame.github.io/Gate/ (nasadzuje sa automaticky po pushi na `main`)

## Stav
| Fáza | Stav |
|---|---|
| 1. Projekt, deploy, voxelový engine, mesto, postavy, animácie | ✅ vizuálna ukážka |
| 2. Presun, brány, bedne | ⏳ |
| 3. Prestrelka za krytom | ⏳ |
| 4. Boss, levely, obchod, ukladanie | ⏳ |
| 5. Efekty, zvuky, PWA, debug | ⏳ |
| 6. Ladenie čísel | ⏳ |

### Čo je teraz vidieť
- Úvodná stránka je **zatiaľ len ukážka** (nehrá sa): skupina vybehne ulicou, schová sa za barikádu, prestrelka s banditmi, výbuch TNT. Opakuje sa každých 16 s.
- `?view=lineup` – detailný pohľad na postavy a zbrane zblízka.
- `?t=8.5` – zastaví ukážku v danom čase (na screenshoty).

## Spustenie lokálne
```bash
npm install
npm run dev      # http://localhost:5173 (aj z telefónu v rovnakej sieti)
npm run build    # produkčná verzia do dist/
```

## Štruktúra
- `src/engine/voxel.ts` – voxelová mriežka, greedy meshing, zdieľané materiály
- `src/engine/font.ts` – 3×5 pixelový font pre nápisy na domoch
- `src/gfx/characterModels.ts` – generátor postáv (posse, bandita, boss) a zbraní
- `src/gfx/character.ts` – procedurálne animácie postavy
- `src/gfx/town.ts` – domy, ulica, pozadie
- `src/gfx/props.ts` – sudy, debny, TNT, voz, barikáda, kaktusy, brány
- `src/gfx/effects.ts` – častice (kocky), stopy striel, záblesky
- `src/gfx/palette.ts` – všetky farby na jednom mieste
