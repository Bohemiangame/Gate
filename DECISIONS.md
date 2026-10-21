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
