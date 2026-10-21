# Rozhodnutia (DECISIONS)

Sem zapisujem rozhodnutia, ktoré som urobil sám bez otázok. Najnovšie hore v rámci fázy.

## Fáza 1 – vizuál
- **TypeScript** (nie čistý JS): pri dlhej samostatnej práci zachytí veľa chýb pri kompilácii.
- **Pracovný názov „Dusty Gulch“** (pôvodné „Gate“ zostáva ako názov repa). Generický, nepoužíva cudziu značku. Dá sa zmeniť v `index.html` a `public/manifest.webmanifest`.
- **Voxely generované kódom**, žiadne externé modely. Postava: kocka 6 cm, ~31 kociek na výšku. Zbrane majú ešte jemnejšie kocky (4 cm), aby bolo vidno hlaveň, valec revolvera, pažbu.
- **Greedy meshing**: susedné steny rovnakej farby sa spájajú do jedného štvoruholníka → málo trojuholníkov aj pri jemných kockách.
- **Tieňovanie zapečené do farieb** (vrch svetlejší, spodok tmavší) + `MeshBasicMaterial`. Žiadne svetlá ani tiene v reálnom čase → rýchle na mobile, retro vzhľad. Pod postavami je lacný „blob“ tieň.
- **Animácie procedurálne**: kĺby (stehno, lýtko, ruky, hlava, trup) sa plynulo dorovnávajú k cieľovej póze. Pózy: beh, mierenie, skrčenie, nabíjanie, hod, oslava. Smrť = rozpad na kocky (častice).
- **Domy** sa skladajú z dielov: falošné priečelie s rôznym vrchom, tabuľa s nápisom (vlastný 3×5 pixelový font: SALOON, BANK, SHERIFF…), okná, dvere (saloon má lietacie dvierka), veranda so strieškou, na poschodových domoch balkón. Strieška verandy je miesto pre banditov „na streche“.
- **Kamera**: na výšku je vertikálny uhol obmedzený (max 80°), aby nebolo pol obrazovky oblohy. Pozadie dopĺňajú mesy, oblaky a slnko mimo hmly.
- **Vzdialenosti v prestrelke 10–17 m**, inak by boli bandity na telefóne príliš malí na mierenie prstom.
- Pixel ratio max 2, bez antialiasingu (retro hrany, výkon).

## Fázy 2–4 – hrateľnosť
- **Presun**: skupina beží 6,5 m/s, ťahanie prstom posúva cieľovú pozíciu (celá šírka obrazovky = 9 m), pohyb je vyhladený. Členovia strieľajú **automaticky rovno dopredu**, každý zo svojej pozície → na bránu/bedňu/banditu musíš byť zarovnaný. Počas presunu sa nenabíja.
- **Brány**: väčšinou +1…+3, ×2 až od 6. levelu, ÷2 občas. **Streľbou sa dá zachrániť len záporná/nulová brána** (najviac na +1). V prvej verzii sa dali vylepšovať aj kladné brány a simulácia ukázala, že skupina vždy narástla na maximum 20 a hra bola triviálna.
- **Prestrelka**: držíš prst = celá skupina stojí a strieľa salvu na bod pod prstom. **Mierny bod je 56 px nad prstom**, aby prst nezakrýval cieľ (`aimOffsetPx`, dá sa dať na 0). Bandity majú pri mierení mierne zväčšené zásahové boxy (aim assist 12 cm) a mierenie sa „prichytí“ na hlavu/telo.
- **Kryt a zásah**: keď bandita vystrelí a si vyklonený → 80 % šanca, že padne jeden člen. Keď si skrčený → strela poškodí tvoj kryt (30 HP, 3 na strelu). Keď je kryt zničený, zasahujú aj skrčených (s nižšou presnosťou).
- **Nabíjanie po jednom náboji** (0,16 s/náboj) – krátke skrčenie = pár nábojov. Gatling nabíja rýchlo, dynamit pomaly.
- **Varovanie „!“** bliká nad banditom 0,75 s (v neskorších leveloch kratšie, min. 0,45 s). Počas varovania je bandita odkrytý → dá sa zastreliť skôr, ako vystrelí.
- **Dynamit** (zbraň hráča): hádžu ho max. 3 členovia naraz, plošné poškodenie rastie s veľkosťou skupiny. Bandity s dynamitom hádžu na tvoj kryt.
- **TNT debny** pri banditoch: výbuch zabije všetkých v okruhu 3,6 m a zničí kryty.
- **Boss** sa skrýva za vozom (vyššie HP), strieľa dávku 4 rán. Jeho smrť = výhra levelu (zvyšok bandy zmizne).
- **Hviezdy**: 1 = výhra, 2 = prežije ≥ 60 % najväčšej skupiny, 3 = do časového limitu levelu.
- **Obchod**: väčšia skupina, poškodenie, rýchlosť streľby, nabíjanie, odolnosť krytu, trvalá štartová zbraň (puška, brokovnica). Ceny rastú geometricky.
- **Prehra** dáva malú útechu v minciach (podľa prejdenej časti a zabitých), aby sa dalo nakúpiť a skúsiť znova.
- **Reklamy** sú len prázdne miesto (`src/ads.ts`, `available: false`) – tlačidlo „2× mince“ sa ukáže až po zapojení portálu.
- **Autopilot (bot)** v kóde hry: používa ho simulácia (`?sim`) a tlačidlo `bot` v `?debug`. Simulácia beží na skutočnej hernej logike bez vykresľovania.

## Fáza 6 – ladenie čísel (simulácia `?sim`)
Simulácia hrá skutočnú hernú logiku botom s tromi profilmi hráča:
**dobrý** (reakcia 0,3 s, presná muška), **priemerný** (0,45 s), **slabý** (0,65 s, často nestihne kryt).
Bot medzi levelmi nakupuje v obchode najlacnejšie vylepšenie. Cieľ: prvé 3 levely ľahké pre všetkých, dobrý hráč končí s ~8–15 členmi, potom treba voliť rozumne.

| Krok | Problém v simulácii | Zmena |
|---|---|---|
| 1 | Skupina vždy narástla na 20, level za 35 s, všetci 3★ | HP banditov ×3 (`enemyHpMul`), cena vylepšenia brány rastie |
| 2 | Stále 20 – vylepšovanie kladných brán streľbou bolo príliš silné | Streľbou sa dá zdvihnúť len záporná/nulová brána, najviac na +1 (`gateShootCap`); ×2 odstránené z levelov 1–5 |
| 3 | Bandity umierali počas „!“ skôr, než vystrelili | `enemyHpMul` 6, jazdci ×4, boss ×4 |
| 4 | Boss v 8.–9. leveli mal ~1800 HP, prehry na 92 % | Boss HP v dátach 28→86 (namiesto 28→240), `hpGrowth` 0,16 → 0,1 |
| 5 | Bot bez reakčného času – profily sa nelíšili | Bot má reakčný čas na „!“ aj na zmenu cieľa |
| 6 | Od 6. levelu opäť 20 (veľa mincí, ×2 brány v strede levelu) | Menej mincí za preživších (6→4) a hviezdy (12→8), drahší obchod (rast 1,55–1,7), `hpGrowth` 0,14 + kvadratický člen, bandity sa vykláňajú častejšie, ×2 presunuté na prvú bránu levelu |
| 7 | Neskoré levely 130–170 s, slabý hráč nemal z čoho nakúpiť | Boss ×3,2, kvadratický člen 0,006, útecha za prehru 35 × podiel + 2/zabitý |
| 8 | Slabý hráč (0,65 s) nestihol nikdy kryt od 7. levelu | Varovanie sa skracuje pomalšie (0,015/level, min 0,5 s) |

**Výsledok (priemer 2 behov):** levely 1–3 vyhrajú všetci na prvý pokus (8–11 preživších, ~55–65 s).
Priemerný hráč: 4.–10. level vyhráva s 9–15 preživšími, 85–118 s. Slabý hráč: od 7.–12. levelu potrebuje
viac pokusov a nákupy v obchode. Generované levely 11+ sú pre priemerného hráča zatiaľ skôr ľahšie.
**Známe:** neskoré levely sú o niečo dlhšie (90–120 s) ako cieľ 60–90 s – skrátenie by išlo menším počtom banditov alebo kratšími úsekmi.
