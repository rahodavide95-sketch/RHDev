# NEBBIA — living chord engine

Strumento **Max for Live** per Ableton Live, pensato per la dub techno.
Una nota diventa un accordo, che puoi suonare dal piano roll, dalla tastiera o dal **sequencer interno a 4 step**.
L'accordo nasce da un generatore che fa voice leading e può tirare il dado. Passa per 6 voci analogiche che si
comportano come un circuito vero, poi per un tape echo dub e infine per uno spazio le cui **corde simpatiche si
riaccordano sull'accordo** che stai suonando.

![Pannello di NEBBIA (anteprima)](demo/ui_preview.png)

*Anteprima del pannello generata dal file della patch. In Live le manopole hanno lo stile nativo.*

Tutto è digitale (gen~, compilato in C dentro Max). Non usa campioni né wavetable.

---

## Installazione

Serve **Ableton Live 11 o 12 Suite**, oppure Standard con l'add-on Max for Live. gen~ è già incluso.

1. Scarica `Nebbia.amxd`.
2. Trascinalo su una traccia MIDI di Live.
3. Suona una nota: senti già un accordo dub.

Per tenerlo nel browser di Live, copia il file in
`User Library/Presets/Instruments/Max Instrument/`.

> Al primo caricamento Max compila il codice gen~: può servire un secondo.
> **Se il device resta muto o non si carica**, clicca *Edit* e apri *Window → Max Console*.
> Se c'è un errore in rosso, copialo e mandamelo.
>
> **Piano B se Live non accetta il file `.amxd`:** trascina un *Max Instrument* vuoto
> (Browser → Max for Live), clicca *Edit*, apri `Nebbia.maxpat` in Max, seleziona tutto, copia,
> incolla nella patch del device vuoto e salva.

**Passa col mouse su qualsiasi controllo:** la *Info View* di Live (in basso a sinistra, tasto `?`) ti spiega
in italiano cosa fa.

---

## Da dove arrivano le note

Ogni nota che arriva a NEBBIA è la **fondamentale di un accordo**. Hai tre modi per dargliele:

| Come | Imposta | Cosa succede |
|---|---|---|
| **Piano roll / tastiera** | SEQ Mode = **Off** | Scrivi *una* nota per accordo nel piano roll (o suonala). NEBBIA costruisce l'accordo. |
| **Sequencer interno** | SEQ Mode = **Play** | Premi Play in Live: i 4 step suonano a tempo. Il MIDI di Live suona comunque sopra. |
| **Sequencer trasposto** | SEQ Mode = **Trans** | Il pattern suona solo mentre tieni un tasto, trasposto da quel tasto (C3 = come scritto). Perfetto dal vivo. |

> **"Voices" non serve a scrivere note.** È *quante* note ha l'accordo (2–6).
> Le note vere arrivano dal SEQ o dal MIDI di Live.

---

## Le sezioni

### SEQ — sequencer a 4 step
- Ogni step ha **On**, **Note** (la fondamentale dell'accordo) e **Vel**. Il LED mostra lo step che sta suonando.
- **Rate**: durata di uno step, da 1/16 a 2 battute.
  - **1/4 + Offset 50%** = stab in levare, il classico dub (è il default).
  - **1 Bar + Offset 0** = progressione di 4 accordi, uno per battuta.
- **Steps** (1–4), **Gate** (lunghezza della nota), **Swing** (ritarda gli step 2 e 4) e **Chance**
  (probabilità che uno step suoni: sotto 100% il pattern respira da solo).
- Segue il transport di Live con precisione al campione: niente jitter, sempre allineato alla battuta.

### CHORD — generatore di accordi con voice leading
- **Harmony = Fixed**: la nota suona il tipo scelto in *Chord*, trasposto in parallelo come negli
  stab Basic Channel.
- **Harmony = una scala** (Minor, Dorian, Phrygian, Major, Mixolydian, Lydian, Harmonic Minor) con la sua
  **Key**: la nota suona l'accordo *diatonico* di quel grado. Le note fuori scala vanno sul grado più vicino.
- **Voicing = Smooth / Smooth Op**: sceglie il rivolto con il movimento minimo rispetto all'accordo precedente,
  evita i cluster di semitono e resta nel registro della nota suonata.
  Esempio: Am9 → Fm9 diventa Fm9/Ab, senza salti.
- **Voices** (2–6 note), **Octave**, **Strum** (+ dal basso, − dall'alto), **Glide**, **Humanize**, **Bend**.
- **CHORD NOW**: la tastierina mostra in tempo reale le note che NEBBIA sta suonando.

### DICE — caso controllato
- **RANDOMIZE**: genera una patch nuova, con valori dentro range che suonano bene.
  - **Amount** decide quanto: basso = piccola variazione della patch attuale, 100% = patch nuova.
  - Randomizza anche il pattern del SEQ (step, note nella tua Key, velocity).
  - Le manopole si muovono davvero, quindi puoi annullare con Cmd/Ctrl+Z.
- **RESET**: riporta tutto ai valori iniziali. La Key resta quella del tuo pezzo.
- **LOCK** (Seq, Chord, Voice, Filter, Env, Echo, Space): le sezioni accese restano come sono, sia con
  Randomize sia con Reset. Esempio: blocca Filter ed Echo, poi premi Reset per azzerare solo il resto.
- **Chance + Chord Dice**: a ogni nota, con la probabilità *Chance*, l'accordo tira il dado.
  - **Color**: un altro accordo della stessa famiglia (minore resta minore).
  - **Voicing**: rivolto e ottava diversi.
  - **Both**: entrambi.
  - **Wild**: qualsiasi accordo.

  Ottieni progressioni che cambiano da sole senza toccare la clip.

### VOICE / FILTER / ENV — sei voci analogiche "vive"
- Oscillatori **PolyBLEP** anti-aliasing: dente di sega e pulse con PWM, secondo oscillatore detunato,
  sub sulla nota più bassa e rumore (*Air*).
- **Filtro ladder 4 poli ZDF** per ogni voce, con saturazione, a 24 o 12 dB. Stabile anche in auto-oscillazione.
- **Age**: ogni voce ha tolleranze di componente fisse (accordatura, cutoff, risonanza, inviluppi, livello).
- **Drift / Drift Rate**: deriva lenta casuale per voce più una deriva termica comune.
- **Sag**: con accordi pieni l'alimentazione "cede". Intonazione, filtro e livello calano insieme per tutte le
  voci e l'accordo respira.
- LFO sul cutoff (Sine, Triangle, S&H, Drift), mod wheel sul cutoff e due ADSR con curve RC.

### ECHO / SPACE / OUT
- **Echo**: tape delay a tempo con Live. Nel loop ci sono filtri passa-alto e passa-basso, saturazione,
  wow, flutter e ping-pong. Il feedback arriva al 110% per le fughe dub.
- **Space**: riverbero FDN a 8 linee più 6 **corde simpatiche** accordate in tempo reale sull'accordo, che
  seguono anche il glide. **Tune** fa il morph tra riverbero normale e corpo risonante.
  Misurato: con Tune 100% il **92%** dell'energia della coda sta sulle note dell'accordo (66% senza).
- **Out**: chorus BBD stereo, apertura stereo, volume con soft clip trasparente sotto −2 dBFS.

---

## Tutti i parametri

96 controlli, tutti automatizzabili, mappabili su MIDI/Push e modulabili.

| Sezione | Parametri |
|---|---|
| SEQ | Mode (Off/Play/Trans), Rate, Steps, Gate, Offset, Swing, Chance, Step 1–4: On / Note / Vel |
| CHORD | Harmony, Chord, Key, Voicing, Voices, Octave, Strum, Glide, Humanize, Bend |
| DICE | Randomize, Reset, Amount, Lock ×7, Chance, Chord Dice |
| VOICE | Shape, PW, PWM, PWM Rate, Osc 2, Detune, Sub, Air, Drift, Drift Rate, Age, Sag |
| FILTER | Cutoff, Reso, Drive, Slope, Env Amt, Key Trk, MW>Cut, LFO Rate, LFO Amt, LFO Wave |
| ENV | F Attack/Decay/Sustain/Release, Attack/Decay/Sustain/Release, Vel>Amp, Vel>Filt |
| ECHO | Time, Feedback, Mix, Low Cut, High Cut, Drive, Wow, Flutter, Spread |
| SPACE | Decay, Size, Mix, Tune, Strings, Damp, Low Cut, Diffusion, Mod |
| OUT | Chorus, Ch Rate, Ch Depth, Width, Volume |

Chord disponibili: Min7, Min9, Min11, m7 Open, m11 Open, So What, Quartal, Sus2, 7sus4, Minor, Major,
Maj7, Maj9, Dom9, m7b5, Fifths.

---

## Ricette veloci

- **Stab classico (default)**: SEQ su *Play*, premi Play in Live. Automatizza Cutoff ed Echo Feedback.
- **Fuga dub**: Echo Feedback oltre 100% per qualche battuta, High Cut basso, Wow alto.
- **Progressione che si scrive da sola**: Harmony Dorian, SEQ Rate *1 Bar*, Offset 0, DICE Chance 30% su *Color*.
- **Organo nella nebbia**: Voices 4, Attack 500 ms, Sustain 70%, Glide 200 ms, Strum 40 ms, Tune 80%, Strings 8 s.
- **Macchina vecchia**: Age 80%, Drift 60%, Sag 70%, Air 25%.
- **Digitale pulito**: Age 0, Drift 0, Sag 0, Humanize 0.

## Demo

In `demo/` ci sono i render offline dello stesso DSP:

| File | Cosa senti |
|---|---|
| `dub_stabs.mp3` | Il suono di default, stab in levare |
| `seq_progression.mp3` | Il sequencer interno: D Dorian, un accordo per battuta |
| `dice_stabs.mp3` | Lo stesso stab con il dado al 100%: ogni colpo cambia colore e rivolto |
| `dorian_pads.mp3` | Modalità scala, glide e strum su un pad |
| `space_tune0.mp3` / `space_tune100.mp3` | Lo stesso stab con riverbero normale e con le corde accordate |

`demo/dub_stabs.mid` è una clip di 4 battute da trascinare su una traccia con NEBBIA.

---

## Modificarlo

Tutto è generato da un solo file, `src/build.py`: accordi, scale, parametri, layout, colori, testi
d'aiuto e DSP.

```bash
python3 src/build.py           # rigenera Nebbia.amxd, Nebbia.maxpat, src/nebbia.genexpr
node test/render.js            # rende i test in demo/*.wav (gemello JavaScript del DSP)
python3 test/analyse_space.py  # misura quanto lo spazio "canta" l'accordo
python3 test/preview_ui.py ui.html  # anteprima del pannello
```

Il test `torture` porta tutti i parametri al massimo e verifica che l'uscita resti finita e limitata.
`seq_play`, `seq_bars`, `seq_trans` e `dice` verificano sequencer e dado.
