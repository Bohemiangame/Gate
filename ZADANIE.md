# Zadanie v2: mobilná webová hra – western (pracovný názov „Gate“)

Pôvodné zadanie (Gate Army, veľké hordy) je v `docs/ZADANIE_v1_gate_army.md`.
Táto verzia ho nahrádza. Technické požiadavky z v1 (Three.js + Vite, GitHub Pages,
PWA, localStorage, `?debug`, balance v jednom súbore, levely ako dáta) platia ďalej.

## Čo staviame
Krátku mobilnú hru („time killer“) v prehliadači, **na výšku, ovládanú jedným prstom**.
Tvoja malá skupina (posse) ide hlavnou ulicou westernového mestečka. V meste čakajú bandy
za krytmi, v oknách a na strechách. Po ceste zbieraš posily cez brány a zbrane z bední.
Na konci levelu je boss (šéf bandy).

## Vizuál
- **Voxelová grafika generovaná kódom** – žiadne externé modely ani textúry.
- **Jemné voxely**: postava ~16 × 32 kociek (kocka ~6 cm), aby bolo vidno klobúk, zbraň,
  šatku, opasok. Detail a čitateľnosť má prednosť.
- Animácie procedurálne (beh, streľba, skrčenie, nabíjanie, smrť = rozpad na kocky).
- Hlavná ulica: drevené domy s „falošným“ priečelím (saloon, šerif, banka, obchod…),
  verandy, chodníky z dosiek, sudy, vozy, prach. Domy skladané náhodne z dielov.
- Hráč = modré košele / svetlé klobúky, bandity = čierne klobúky + červené šatky.
- Retro dojem, ale čitateľný na malej obrazovke.

## Štruktúra levelu
Level = striedanie dvoch typov úsekov, na konci boss:
1. **Presun** – skupina beží ulicou, ťahaním do strán sa posúva. Automaticky strieľa
   dopredu. Brány (posily), bedne so zbraňami, občas 1–2 osamelí bandity (alebo jazdec).
2. **Prestrelka** – skupina zastane za krytom. Bandity sú za sudmi/vozmi/debnami,
   na verandách a strechách.
   - **Držíš prst = vykloníš sa a strieľaš** po čiare k miestu prsta (čiara je viditeľná).
   - **Pustíš = skrčíš sa za kryt.**
3. **Boss** – posledná prestrelka so šéfom bandy (veľký, HP pruh, silné salvy).

## Mechaniky
- **Nabíjanie**: zásobník (revolver 6 rán), nabíja sa len skrčený → rytmus vyklon/strieľaj/skry/nabi.
- **Varovanie pred výstrelom**: bandita pred výstrelom blikne / ukáže „!“. Kto sa včas skryje, nestráca ľudí.
- **Headshot** = 2× poškodenie + nápis.
- **Zničiteľné kryty** na oboch stranách. **Výbušné sudy** (plošné poškodenie).
- **Dead Eye**: nabíja sa zásahmi, po aktivácii spomalenie času na pár sekúnd.
- **3 hviezdy** za level (výhra, preživší, čas).
- **Brány malé**: väčšinou +1…+3, zriedka ×2, mínusy −1…−2. Strieľaním do brány sa hodnota zvyšuje.
- **Skupina**: štart 3, dobrý hráč ~8–15 na konci levelu, strop ~20.
- **Zbrane**: revolver → puška → brokovnica → dynamit → gatling. Bedne počas levelu
  (dočasne) + trvalé odomknutie v obchode.
- **Neskôr**: civilisti/rukojemníci, ktorých nesmieš trafiť.

## Meta
- Mince podľa preživších, hviezd a času. Obchod medzi levelmi: veľkosť skupiny na štarte,
  poškodenie, rýchlosť streľby, rýchlosť nabíjania, odolnosť krytu, štartová zbraň. Ceny rastú.
- Aspoň 10 ručných levelov + generátor ďalších.
- Uloženie cez localStorage (try/catch).
- Pripravené (prázdne) miesto pre reklamy portálov: medzi levelmi, za odmenu.

## Ovládanie a platforma
- Primárne telefón na výšku, dotyk. Myš funguje tiež (kvôli portálom), nič navyše.
- Žiadny scroll/zoom/označovanie textu. Vibrácie pri dôležitých udalostiach.
- Zvuky generované cez Web Audio.

## Výkon
- 60 FPS na bežnom Androide. Málo nepriateľov naraz, zdieľané geometrie, pooling efektov,
  žiadne real-time tiene (blob tieň).

## Spôsob práce
- Samostatne, rozhodnutia do `DECISIONS.md`, README po každej fáze.
- Zlučovať do `main` len hrateľný stav. Pracovať len v repe Gate.
- **Fáza 1 = vizuálna ukážka** (mesto, postavy, animácie) → screenshot a odkaz majiteľovi.
  Na odpoveď sa nečaká, pokračuje sa hrateľnosťou.

## Fázy
1. Projekt + deploy, voxelový engine, mesto, postavy, animácie (vizuálna ukážka).
2. Presun: pohyb prstom, brány, bedne, osamelí bandity.
3. Prestrelka: kryty, mierenie, vyklon/skry, nabíjanie, varovanie, headshot, výbušné sudy.
4. Boss, výhra/prehra, hviezdy, mince, obchod, ukladanie, 10 levelov + generátor.
5. Efekty, zvuky, vibrácie, Dead Eye, PWA, debug.
6. Ladenie čísel simuláciou, zápis zmien.
