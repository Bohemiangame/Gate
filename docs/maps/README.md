# Mapy – export na úpravu

V tomto priečinku sú tri vygenerované mapy taktického režimu (seed 7):

| Súbor | Čo to je |
|---|---|
| `plaza_seed7.glb`, `desert_seed7.glb`, `rail_seed7.glb` | 3D scéna – otvoríš v **Blenderi** (zadarmo) cez *File → Import → glTF 2.0*, alebo si ju pozrieš priamo v prehliadači napr. na gltf-viewer.donmccurdy.com |
| `*_plan.png` | Pôdorys zhora: **tenká čiara = 1 m, hrubá čiara = 5 m**. 24 px = 1 m. |

## Mierka a osi
- **1 jednotka = 1 meter.** Hracia plocha je **24 × 28 m** (x −12…12, z −14…14), stred mapy je v bode 0,0.
- Smery v hre: **naša strana je na juhu (+Z, dole na pôdoryse), bandity prichádzajú zo severu (−Z, hore).** Blender pri importe prevedie osi sám (v Blenderi je „hore“ os Z a sever je −Y).
- V scéne je objekt `reference_man_1_86m` – postava šerifa (1,86 m) na porovnanie veľkosti.
- `spawn_player_*` a `spawn_enemy_*` sú prázdne body, kde sa začína.

## Názvy objektov (podľa nich hra spozná, čo to je)
- `cover_<druh>` – kryt: `barrel`, `crate`, `stack`, `wagon`, `hay`, `trough`, `sandbags`, `fence`, `well`, `tower`, `tnt`, `rock`, `rockBig`, `boxcar`
- `building_<číslo>` – dom (fasáda s verandou smeruje do hracej plochy)
- `decor_<druh>` – ozdoba bez krytu (`lamp`, `hitch`, `fence`, `wanted`), `decor` = kaktusy, stromy a pod.

Pri kopírovaní v Blenderi (Shift+D) vznikne napr. `cover_barrel.001` – to je v poriadku, hra číta len začiatok názvu.

## Rozmery objektov (šírka × výška × hĺbka, metre)
| Objekt | Rozmer | Kryt |
|---|---|---|
| Sud | 0,7 × 0,9 × 0,7 | nízky |
| Debna / TNT | 0,9 × 0,9 × 0,9 | nízky (TNT vybuchne) |
| Kopa debien | 1,9 × 1,8 × 0,9 | vysoký – zakryje výhľad |
| Voz | 3,0 × 1,3 × 1,4 | stredný |
| Seno | 1,4 × 0,8 × 0,9 | nízky |
| Koryto | 2,2 × 0,7 × 0,8 | nízky |
| Vrecia s pieskom | 3,2 × 1,1 × 0,6 | stredný, veľmi odolný |
| Plot | 4,0 × 1,1 × 0,2 | stredný |
| Studňa | 1,6 × 2,6 × 1,4 | vysoký, nezničiteľný |
| Vodná veža | 3,6 × 9,6 × 3,6 | kryjú len nohy |
| Malá skala | ~1,4 × 1,0 × 1,0 | nízky, nezničiteľný |
| Veľká skala | ~2,3 × 2,1 × 1,5 | vysoký, nezničiteľný |
| Nákladný vagón | 6,0 × 3,0 × 2,2 | vysoký, nezničiteľný |
| Lampa | 0,5 × 3,4 × 0,5 | žiadny |
| Dom 1 / 2 / 3 poschodia | 5,5–9 × 5,9 / 8,4 / 10,6 × 6,0 | (4 m dom + 2 m veranda) |

Postava zaberá približne 0,6 × 1,86 m, miesto za krytom je asi 0,45 m od jeho hrany, susedné miesta ~0,85 m od seba.

## Ako mi poslať vlastnú mapu
1. Otvor `.glb` v Blenderi, presúvaj/kopíruj/maž objekty, zachovaj začiatky názvov.
2. Ulož cez *File → Export → glTF 2.0 (.glb)* a pošli mi súbor.
3. Ja z neho prečítam polohy a otočenia a spravím z nich pevnú misiu.

Ak nemáš počítač s Blenderom, stačí aj pôdorys (`*_plan.png`) – dokresli/prečiarkni do neho a pošli fotku.
