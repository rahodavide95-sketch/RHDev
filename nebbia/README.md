# NEBBIA — living chord engine

Strumento **Max for Live** per Ableton Live, pensato per la dub techno.
Suoni **un tasto** e ottieni un accordo. L'accordo nasce da un generatore che fa voice leading, passa per
6 voci analogiche che si comportano come un circuito vero, poi per un tape echo dub e infine per uno spazio
le cui **corde simpatiche si riaccordano sull'accordo** che stai suonando.

Tutto è digitale (gen~, compilato in C dentro Max). Non usa campioni né wavetable e non ripete i preset
dei synth di Live.

---

## Installazione

Serve **Ableton Live 11 o 12 Suite**, oppure Standard con l'add-on Max for Live. gen~ è già incluso in Max for Live.

1. Scarica `Nebbia.amxd`.
2. Trascinalo su una traccia MIDI di Live, come qualsiasi strumento.
3. Opzionale: trascina `demo/dub_stabs.mid` sulla stessa traccia per sentire subito il pattern di stab.

Per tenerlo nel browser di Live, copia il file in
`User Library/Presets/Instruments/Max Instrument/`.

> Al primo caricamento Max compila il codice gen~: può servire un secondo.
> **Se il device si carica ma resta muto**, clicca l'icona *Edit* (Max editor) e apri la *Max Console*
> (menu Window). Se c'è un errore in rosso, copialo e mandamelo.
>
> **Piano B se Live non accetta il file `.amxd`:** trascina in una traccia un *Max Instrument* vuoto
> (Browser → Max for Live → Max Instrument) e clicca *Edit*. In Max apri `Nebbia.maxpat` (File → Open),
> seleziona tutto, copia, incolla nella patch del device vuoto, salva (Cmd/Ctrl+S) e chiudi.

---

## L'idea in tre parti

### 1. CHORD — generatore di accordi con voice leading
- **Harmony = Fixed**: ogni tasto suona il tipo di accordo scelto in *Chord*, trasposto in parallelo come
  negli stab Basic Channel.
- **Harmony = una scala** (Minor, Dorian, Phrygian, Major, Mixolydian, Lydian, Harmonic Minor) con la
  sua **Key**: ogni tasto suona l'accordo *diatonico* di quel grado, impilando terze della scala. Le note
  fuori scala vengono portate sul grado più vicino. Suoni una melodia con un dito e ottieni una progressione.
- **Voicing = Smooth / Smooth Op**: per ogni nuovo accordo NEBBIA prova tutti i rivolti e le ottave e
  sceglie quello con il movimento minimo rispetto all'accordo precedente. Penalizza i cluster di semitono
  e resta vicino al registro della nota che suoni. È quello che fa un tastierista.
  Esempio: Am9 → Fm9 non salta, diventa Fm9/Ab (G#3 C4 D#4 F4 G4).
- **Strum** positivo arpeggia dal basso verso l'alto, negativo dall'alto verso il basso. **Humanize**
  aggiunge micro-ritardi e variazioni di velocity diverse per ogni voce.
- **Glide**: ogni voce scivola verso la sua nuova nota. Con lo Smooth le voci si muovono poco, quindi i
  glide tra accordi restano morbidi.

### 2. VOICE / FILTER / ENV — sei voci analogiche "vive"
- Oscillatori **PolyBLEP** anti-aliasing: dente di sega + pulse con PWM, secondo oscillatore detunato,
  sub e rumore (*Air*).
- **Filtro ladder 4 poli ZDF** per ogni voce, con saturazione: stabile anche in auto-oscillazione,
  24 o 12 dB.
- **Age**: ogni voce ha le sue *tolleranze di componente* fisse (accordatura, cutoff, risonanza, tempi
  d'inviluppo, guadagno), come un synth uscito dalla fabbrica. 0% = voci identiche (digitale
  perfetto), 100% = macchina vecchia.
- **Drift**: deriva lenta casuale per voce più una deriva termica comune a tutto il "circuito".
- **Sag**: quando suoni un accordo pieno l'alimentazione "cede". Intonazione, cutoff e livello calano un
  po' *insieme* per tutte le voci, e l'accordo respira e si comprime come in un polifonico vero.

### 3. ECHO / SPACE — lo spazio che canta l'accordo
- **Echo**: tape delay sincronizzato al tempo di Live. Ogni ripetizione passa per filtri passa-alto e
  passa-basso e per una saturazione, con wow e flutter separati e ping-pong regolabile. Il feedback
  arriva al 110% per le "fughe" dub controllate.
- **Space**: riverbero FDN a 8 linee, più 6 **corde simpatiche** accordate in tempo reale sulle note
  dell'accordo, che seguono anche il glide. **Tune** fa il morph: 0% = riverbero normale, 100% = la coda
  diventa un corpo risonante intonato.
  Misurato sul render di test: con Tune 100% il **91%** dell'energia della coda sta sulle note
  dell'accordo, contro il 66% del riverbero normale.

---

## Tutti i parametri (65, tutti automatizzabili e mappabili)

| Sezione | Parametro | Cosa fa |
|---|---|---|
| CHORD | Harmony | Fixed (tipo fisso) oppure scala per gli accordi diatonici |
| | Chord | Min7, Min9, Min11, m7 Open, m11 Open, So What, Quartal, Sus2, 7sus4, Minor, Major, Maj7, Maj9, Dom9, m7b5, Fifths |
| | Key | Tonica della scala (solo in modalità scala) |
| | Voicing | Root, Inv 1-3, Open (drop 2), Spread, **Smooth**, **Smooth Op** (voice leading) |
| | Notes | Numero massimo di note (2–6) |
| | Octave | Trasposizione d'ottava dell'accordo |
| | Strum | Arpeggio d'attacco in ms (+ su, − giù) |
| | Glide | Portamento tra un accordo e l'altro |
| | Humanize | Micro-timing e velocity diversi per ogni voce |
| | Bend | Estensione del pitch bend in semitoni |
| VOICE | Shape | Da dente di sega a pulse |
| | PW / PWM / PWM Rate | Larghezza d'impulso e sua modulazione (LFO dedicato, sfasato per voce) |
| | Osc 2 / Detune | Livello e detune (in cent) del secondo oscillatore |
| | Sub | Onda quadra un'ottava sotto la nota più bassa |
| | Air | Rumore filtrato con la voce: respiro, polvere |
| | Drift / Drift Rate | Quantità e velocità della deriva analogica |
| | Age | Tolleranze dei componenti tra voce e voce |
| | Sag | Cedimento d'alimentazione condiviso |
| FILTER | Cutoff / Reso / Drive | Filtro ladder per voce |
| | Slope | 24 dB o 12 dB |
| | Env Amt | Quantità d'inviluppo sul cutoff (bipolare) |
| | Key Trk | Il cutoff segue l'altezza della voce |
| | MW>Cut | Quanto la mod wheel apre il filtro |
| | LFO Rate / Amt / Wave | LFO sul cutoff: Sine, Triangle, S&H, Drift (casuale morbido) |
| ENV | F Attack / Decay / Sustain / Release | Inviluppo del filtro |
| | Attack / Decay / Sustain / Release | Inviluppo d'ampiezza (curve RC esponenziali) |
| | Vel>Amp / Vel>Filt | Sensibilità alla velocity su volume e filtro |
| ECHO | Time | 1/16 … 1/2, terzine e puntati, a tempo con Live |
| | Feedback | 0–110% |
| | Mix | Livello dell'eco |
| | Low Cut / High Cut | Filtri nel loop: ogni ripetizione si scurisce e si assottiglia |
| | Drive | Saturazione del nastro nel loop |
| | Wow / Flutter | Modulazione lenta e veloce del nastro |
| | Spread | Da eco mono a ping-pong |
| SPACE | Decay / Size | Durata e dimensione dello spazio |
| | Mix | Livello dello spazio |
| | Tune | Morph da riverbero a corde simpatiche accordate |
| | Strings | Decadimento delle corde simpatiche |
| | Damp | Smorzamento delle alte (spazio e corde) |
| | Low Cut | Taglio basse in ingresso allo spazio (niente fango) |
| | Diffusion / Mod | Densità e modulazione delle riflessioni |
| OUT | Chorus / Ch Rate / Ch Depth | Chorus BBD stereo |
| | Width | Apertura stereo delle voci |
| | Volume | Uscita, con soft clip trasparente sotto −2 dBFS |

Mod wheel → cutoff (quantità in *MW>Cut*). Pitch bend → tutte le voci (estensione in *Bend*).

---

## Ricette veloci

- **Stab classico**: default. Chord Min9 o m7 Open, Smooth, Cutoff 400–700 Hz, Env Amt 40–60,
  F Decay 200–300 ms, Echo 1/8D con Feedback 60–75%, Space Mix 30%. Automatizza Cutoff ed Echo Feedback.
- **Fuga dub**: alza Echo Feedback oltre 100% per qualche battuta, abbassa High Cut, alza Wow.
- **Organo nella nebbia**: Harmony Dorian, Notes 4, Attack 500 ms, Sustain 70%, Glide 200 ms,
  Strum 40 ms, Tune 80%, Strings 8 s.
- **Macchina vecchia**: Age 80%, Drift 60%, Drift Rate 1 Hz, Sag 70%, Air 25%.
- **Digitale pulito**: Age 0, Drift 0, Sag 0, Humanize 0.

## Demo

In `demo/` ci sono i render offline dello stesso DSP:
`dub_stabs.mp3` (preset di default), `dorian_pads.mp3` (modalità scala + glide + strum) e
`space_tune0.mp3` / `space_tune100.mp3`, lo stesso stab con lo spazio normale e con le corde accordate.

---

## Modificarlo

Tutto è generato da un solo file: `src/build.py`. Lì ci sono gli accordi, le scale, i parametri, il
layout e il DSP.

```bash
python3 src/build.py      # rigenera Nebbia.amxd, Nebbia.maxpat, src/nebbia.genexpr
node test/render.js       # rende i test in demo/*.wav (gemello JavaScript del DSP)
python3 test/analyse_space.py
```

`src/nebbia.genexpr` è il codice che gira nel codebox di gen~, leggibile così com'è.
Il test `torture` porta tutti i parametri al massimo e verifica che l'uscita resti finita e limitata.
