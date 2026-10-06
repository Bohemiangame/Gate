# Zadanie: mobilná webová hra „Gate Army“ (pracovný názov)

## Čo staviame
Hrateľnú verziu hry z „fake“ mobilných reklám. Armáda modrých lukostrelcov ide automaticky dopredu po kamennom moste. Hráč ju posúva prstom doľava a doprava. Prechádza bránami s číslami (+, ×, −), strieľa do červenej hordy, do blokov s HP a do bossa. Cieľ je prežiť level a mať čo najväčšiu armádu.

Hrá sa **len na telefóne, v prehliadači, na výšku**. Počítač neriešime, stačí, aby sa to dalo otvoriť aj tam.

## Ako pracuj
- Pracuj **samostatne, bez otázok**. Keď si nie si istý, zvoľ rozumné riešenie a zapíš ho do `DECISIONS.md`. Budem to čítať ráno.
- Commituj často, po každom hotovom kroku.
- Na konci každej fázy aktualizuj `README.md`: čo funguje, čo nie, ako to spustiť.
- Ak niečo nestihneš, nech je posledný stav **hrateľný**. Rozbitú vec radšej vráť späť.

## Technológia
- **Three.js + Vite**, čistý JavaScript alebo TypeScript (vyber si a zapíš prečo).
- Žiadny herný engine, žiadny backend.
- **Nasadenie: GitHub Pages cez GitHub Actions.** Po každom pushe na `main` sa hra automaticky publikuje, aby som ju otvoril v telefóne cez odkaz. Odkaz napíš do README.
- PWA manifest + ikona, aby sa dala „pridať na plochu“ a spúšťala sa na celú obrazovku.
- Uloženie postupu cez `localStorage` (level, mince, upgrady), obalené v try/catch.

## Ovládanie
- Ťahanie prstom kdekoľvek na obrazovke posúva armádu doľava/doprava, plynulo a s jemným vyhladením.
- Na mobile nesmie stránka scrollovať, zoomovať ani označovať text.
- Pri dôležitých udalostiach krátka vibrácia (`navigator.vibrate`, ak existuje).

## Kamera a vizuál
- Kamera zhora zozadu, ako v reklamách (pohľad ~45–55°, armáda v dolnej tretine obrazovky).
- Prostredie: sivý kamenný most s dlaždicami, nízke múriky po krajoch, tmavé pozadie.
- **Placeholder grafika** z jednoduchých tvarov (kapsula + kužeľ ako prilba). Modrí = hráč, červení = nepriatelia, brány modré (plus) / červené (mínus) / žlté (násobenie).
- **Modely sa musia dať neskôr vymeniť:** ak existuje `public/models/soldier.glb`, `enemy.glb`, `boss.glb`, hra ich použije namiesto placeholderov. Ak nie, použije placeholder. Popíš to v README (mierka, orientácia, názvy animácií `Run`, `Shoot`, `Die`).
- Efekty: viditeľné šípy so svetelnou stopou, vyskakujúce čísla poškodenia, malé otrasy kamery pri zničení bloku, „puf“ častice pri smrti jednotky.
- UI: počet vojakov veľkým číslom nad armádou, číslo HP na blokoch a bránach, progres levelu hore.

## Herné mechaniky
**Armáda**
- Vojaci v zhluku (formácia, ktorá rastie so zvyšujúcim sa počtom).
- Každý vojak automaticky strieľa dopredu.
- Vykresľuj max **300** jednotiek. Pri väčšom počte rátaj skutočné číslo, ale kresli 300 a ukazuj presné číslo nad armádou.

**Brány**
- Dvojice alebo trojice brán vedľa seba. Hráč prejde jednou.
- Typy: `+N`, `−N`, `×2`, `×3`, `÷2`.
- **Brány sa dajú strieľať:** každý zásah zvýši hodnotu brány o 1 (z −20 sa dá vystrieľať do plusu). To je kľúčový moment z reklám.

**Zbraňové bedne (odomykanie zbraní)**
- Na trati stoja bedne s číslom, koľko zásahov potrebujú (napr. 40).
- Číslo klesá pri každom zásahu. Pri nule sa armáde na zvyšok levelu zmení zbraň.
- Postup zbraní: luk → kuša (rýchlejšia) → ohnivé šípy (plošné poškodenie) → kanón (veľké poškodenie, pomalý).
- Hráč tak musí balansovať: strieľať do bedne, alebo do nepriateľov, ktorí sa blížia.

**Nepriatelia**
- Červená horda: jednotlivé jednotky s malým HP, idú oproti hráčovi. Keď sa dotknú armády, nepriateľ aj jeden vojak zmiznú.
- Bloky / steny s veľkým HP (číslo na nich), stoja v ceste. Ak do nich armáda narazí, stráca vojakov, kým blok nezmizne.
- Boss na konci levelu: veľký, s HP pruhom, ide pomaly oproti armáde.

**Koniec levelu**
- Výhra = boss porazený. Prehra = 0 vojakov.
- Odmena: mince podľa počtu prežitých vojakov a rýchlosti.
- Obrazovka medzi levelmi s upgradmi: počet vojakov na štarte, rýchlosť streľby, poškodenie. Ceny rastú.

## Štartovacie čísla (všetko v jednom súbore `balance` na ladenie)
- Rýchlosť pohybu dopredu: ~6 m/s. Level: 60–90 sekúnd.
- Brána každé 3–4 sekundy. Medzi bránami nepriatelia alebo bedne.
- Štart: 3 vojaci. Dobrý hráč má na konci levelu 1 okolo 100–300.
- Vojak: 1,5 výstrelu/s, poškodenie 1.
- HP blokov: približne očakávané DPS armády v danom bode × 3 sekundy.
- Každý ďalší level: HP nepriateľov +15–20 %, hodnoty brán rastú pomalšie.
- Zbraňová bedňa: 30–80 zásahov podľa levelu.
- Cieľ: prvé 3 levely ľahké, potom treba voliť brány rozumne.

## Levely
- Levely ako dáta (JSON alebo JS objekty), nie natvrdo v kóde. Aspoň **10 levelov**.
- Plus generátor, ktorý po vyčerpaní ručných levelov tvorí ďalšie podľa obtiažnosti.

## Výkon
- Cieľ 60 FPS na bežnom Android telefóne.
- `InstancedMesh` pre vojakov a nepriateľov, pooling pre šípy a častice, žiadne tiene v reálnom čase (alebo len jeden lacný blob tieň).
- `?debug` v URL zobrazí FPS, počet jednotiek a tlačidlá na skok do levelu.

## Poradie práce (fázy)
1. Projekt, deploy na GitHub Pages, most a kamera, pohyb armády prstom.
2. Streľba, nepriatelia, brány (aj strieľanie do brán), počítadlo vojakov.
3. Bloky s HP, zbraňové bedne, boss, výhra/prehra.
4. Mince, upgrady, ukladanie, 10 levelov, generátor.
5. Efekty, vibrácie, zvuky (jednoduché, generované cez Web Audio), PWA.
6. Ladenie čísel: zahraj si levely v simulácii a uprav `balance`, aby krivka sedela s cieľmi vyššie. Zapíš, čo si zmenil.

## Hotovo znamená
- Odkaz na GitHub Pages funguje na telefóne.
- Dá sa prejsť aspoň 10 levelov, postup sa ukladá.
- README vysvetľuje spustenie, ladenie čísel a výmenu modelov.
