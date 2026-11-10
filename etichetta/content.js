// ============================================================
//  CONTENT.JS — MODIFICA QUI TUTTI I CONTENUTI DEL SITO
//  Non serve saper programmare: cambia solo i testi tra virgolette!
//  Dopo ogni modifica salva il file e ricarica il browser.
// ============================================================

const SITE = {

  // ---- SEZIONI VISIBILI ---------------------------------------
  // Metti true per mostrare la sezione, false per nasconderla.
  sections: {
    podcast: false,
    events:  false,
    merch:   false,
  },


  // ---- INFO ETICHETTA ----------------------------------------
  label: {
    name:        "SUBCONSCIOUS Culture",
    tagline:     "A new vision of underground culture, art and music.\nTechno independent label founded and curated by Raho.",
    foundedYear: "2026",

    // Il testo della sezione About (puoi usare \n per andare a capo)
    description: "Subconscious Culture è un'etichetta discografica indipendente dedicata alla musica elettronica d'avanguardia. Nata dall'esigenza di dare voce a suoni che vivono ai margini del mainstream, l'etichetta raccoglie artisti provenienti da tutta Europa accomunati da una visione sonora profonda e senza compromessi.",

    // Il testo About in inglese, mostrato in fondo al sito (traduzione di "description")
    about: "SUBCONSCIOUS Culture is an independent record label devoted to avant-garde electronic music. Born from the need to give a voice to sounds living on the edges of the mainstream, the label brings together artists from all over Europe who share a deep, uncompromising sonic vision.",

    // Email principale
    email:     "subconscious.infoart@gmail.com",

    // Social (inserisci l'URL completo, oppure lascia "" per nasconderlo)
    instagram:  "https://instagram.com/subconscious.culture",
    soundcloud: "https://soundcloud.com/subconscious_culture",
    bandcamp:   "https://subconsciousculture26.bandcamp.com",
    ra:         "",   // Resident Advisor URL
    // Tutte le piattaforme (link in fondo al sito: "All our platforms")
    platforms:  "https://linktr.ee/subconscious.culture",
  },

  // ---- FAQ (in fondo al sito) --------------------------------
  // q = domanda, a = risposta. Gli indirizzi email diventano link da soli.
  // Per toglierne una cancella il suo blocco {…}; per aggiungerne una copiane uno.
  faq: [
    { q: "Where can I listen to the releases?", a: "Every release has a Listen button: it opens the release on all the main streaming and download platforms." },
    { q: "How can I send a demo?",             a: "Write to subconscious.infoart@gmail.com with a link to your music." },
    { q: "Booking and press?",                 a: "Same address: subconscious.infoart@gmail.com." },
    { q: "Are the releases on vinyl?",         a: "For now every release is digital. Vinyl is coming soon." },
  ],

  // ---- CREDITS (in fondo al sito) ----------------------------
  // Una riga per voce. Il numero di uscite e di artisti si aggiunge da solo.
  credits: [
    "Founded and curated by Raho",
    "Established 2026",
    "Developed by RHDev",
  ],

  // ---- RELEASES -----------------------------------------------
  // Release singola/EP/album → catalog: "SSSCLTR001", "SSSCLTR002", ecc.
  // Various Artists (VA)    → catalog: "SSSCLTRS01",  "SSSCLTRS02",  ecc.
  // date: formato GG/MM/AAAA  es. "15/06/2026"
  //
  // FACOLTATIVI (aggiungili dentro il blocco di un'uscita, se vuoi):
  //   tracks:  [ { title: "Titolo traccia", artist: "Nome artista", link: "https://..." }, ... ]
  //            → nella pagina dell'uscita compare la tracklist; ogni traccia apre il suo link.
  //   artists: [ "Nome Artista 1", "Nome Artista 2" ]
  //            → gli artisti di una compilation (VA). Nelle VA la riga è già pronta:
  //              basta scrivere i nomi. Nella pagina dell'uscita compaiono tutti, e
  //              toccando un nome si apre la sua pagina con la discografia completa.
  //              Se un nome non è nella lista ARTISTI qui sotto, la sua pagina
  //              viene creata da sola (senza foto): scrivi il nome sempre uguale.
  //
  // IMMAGINI LEGGERE: se accanto a una copertina esiste "thumbs/stesso-nome.jpg"
  // (es. images/releases/thumbs/sc001.jpg, circa 800 px) il sito usa quella,
  // altrimenti carica l'originale. Vale anche per le foto degli artisti.
  releases: [
    {
      artist:  "Raho",
      title:   "Solvane EP",
      date:    "23/01/2026",
      catalog: "SSSCLTR001",
      format:  "Digital",
      cover:   "images/releases/sc001.jpg",
      link:    "https://www.submithub.com/link/raho-solvane-ep-subconscious-culture",
    },
    {
      artist:  "Raho",
      title:   "Somnara EP",
      date:    "13/02/2026",
      catalog: "SSSCLTR002",
      format:  "Digital",
      cover:   "images/releases/sc002.jpg",
      link:    "https://www.submithub.com/link/raho-somnara-ep-subconscious-culture",
    },
    {
      artist:  "Raho",
      title:   "Lunthera EP",
      date:    "10/04/2026",
      catalog: "SSSCLTR003",
      format:  "Digital",
      cover:   "images/releases/sc003.jpg",
      link:    "https://www.submithub.com/link/raho-lunthera-ep-subconscious-culture",
    },
    {
      artist:  "Raho",
      title:   "Aevum EP",
      date:    "08/05/2026",
      catalog: "SSSCLTR004",
      format:  "Digital",
      cover:   "images/releases/sc004.jpg",
      link:    "https://www.submithub.com/link/raho-aevum-ep-subconscious-culture",
    },
    {
      artist:  "Various Artists",
      title:   "Somnia I",
      date:    "05/06/2026",
      catalog: "SSSCLTRS01",
      format:  "Digital",
      cover:   "images/releases/va01.jpg",
      link:    "https://www.submithub.com/link/somnia-i-va-subconscious-culture",
      // ARTISTI DELLA COMPILATION: scrivi qui i nomi, tra virgolette e separati da virgola
      // es. artists: [ "Raho", "Jacom", "Pøl" ],
      artists: [ "Daryn Steytler", "Egotot", "FALN", "Jack Fresia feat. VITA", "Jacom", "Kevin Ferhati", "Pøl", "Raho", "Rhythm Assembler", "Zimer" ],
    },
    {
      artist:  "Various Artists",
      title:   "Somnia II",
      date:    "02/10/2026",
      catalog: "SSSCLTRS02",
      format:  "Digital",
      cover:   "images/releases/va02.jpg",
      link:    "https://www.submithub.com/link/somnia-ii-va-subconscious-culture",
      // ARTISTI DELLA COMPILATION: scrivi qui i nomi, tra virgolette e separati da virgola
      // es. artists: [ "Raho", "Jacom", "Pøl" ],
      artists: [ "Artificial DNA", "Bob Semp", "GCOD", "IVISION", "John Wick", "KaioBarssalos", "KLËRR", "Mode_1", "Nilya", "Raho" ],
    },
    {
      artist:  "Raho",
      title:   "Anomaly EP",
      date:    "13/11/2026",
      catalog: "SSSCLTR005",
      format:  "Digital",
      cover:   "images/releases/sc005.jpg",
      link:    "https://www.submithub.com/link/raho-anomaly-ep-subconscious-culture",
    },
    {
      artist:  "Various Artists",
      title:   "Somnia III",
      date:    "18/12/2026",
      catalog: "SSSCLTRS03",
      format:  "Digital",
      cover:   "images/releases/va03.jpg",
      link:    "https://www.submithub.com/link/somnia-iii-va-subconscious-culture",
      // ARTISTI DELLA COMPILATION: scrivi qui i nomi, tra virgolette e separati da virgola
      // es. artists: [ "Raho", "Jacom", "Pøl" ],
      artists: [ "Aldo", "Bimol", "BRNT", "Bürt", "Diana Franco", "LuizFribs", "MONOKRØM", "Raho", "Sid Porwal", "Tsott" ],
    },
  ],

  // ---- ARTISTI ------------------------------------------------
  // Per aggiungere un artista: copia un blocco {…}, incollalo dopo
  // l'ultimo (prima del ]), separalo con una virgola.
  artists: [
    {
  name:       "Raho",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/raho.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Jacom",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/jacom.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Pøl",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/pol.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Daryn Steytler",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/daryn-steytler.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Egotot",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/egotot.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "FALN",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/faln.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Jack Fresia feat. VITA",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/jack-fresia.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Kevin Ferhati",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/kevin-ferhati.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Rhythm Assembler",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/rhythm-assembler.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Zimer",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/zimer.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Artificial DNA",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/artificial-dna.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Bob Semp",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/bob-semp.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "GCOD",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/gcod.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "IVISION",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/ivision.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "John Wick",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/john-wick.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "KaioBarssalos",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/kaiobarssalos.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "KLËRR",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/klerr.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Mode_1",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/mode-1.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Nilya",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/nilya.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Aldo",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/aldo.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Bimol",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/bimol.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "BRNT",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/brnt.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Bürt",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/burt.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Diana Franco",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/diana-franco.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "LuizFribs",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/luizfribs.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "MONOKROM",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/monokrom.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Sid Porwal",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/sid-porwal.jpg",
  instagram:  "#",
  soundcloud: "#",
},
{
  name:       "Tsott",
  origin:     "Città, Paese",
  bio:        "Breve descrizione dell'artista.",
  photo:      "images/artists/tsott.jpg",
  instagram:  "#",
  soundcloud: "#",
},
  ],

  // ---- PODCAST ------------------------------------------------
  // episode: titolo, data, durata (opzionale), link
  podcast: [
    {
      title:    "Titolo Episodio",
      date:     "Jan 2026",
      duration: "60 min",
      link:     "#",
    },
    {
      title:    "Titolo Episodio",
      date:     "Feb 2026",
      duration: "45 min",
      link:     "#",
    },
    {
      title:    "Titolo Episodio",
      date:     "Mar 2026",
      duration: "90 min",
      link:     "#",
    },
  ],

  // ---- EVENTS -------------------------------------------------
  // date: la data per esteso, name: nome evento, venue: luogo, city: città
  // ticketLink: "" = sold out, "#" = available
  events: [
    {
      date:       "15 Jun 2026",
      name:       "Nome Evento",
      venue:      "Venue, Città",
      ticketLink: "#",
    },
    {
      date:       "22 Jul 2026",
      name:       "Nome Evento",
      venue:      "Venue, Città",
      ticketLink: "#",
    },
    {
      date:       "10 Aug 2026",
      name:       "Nome Evento",
      venue:      "Venue, Città",
      ticketLink: "",   // lascia "" per "Sold Out"
    },
  ],

  // ---- MERCH --------------------------------------------------
  // name, price (es. "€30"), image, buyLink
  merch: [
    {
      name:    "Nome Prodotto",
      price:   "€ 00",
      image:   "images/merch/merch01.jpg",
      buyLink: "#",
    },
    {
      name:    "Nome Prodotto",
      price:   "€ 00",
      image:   "images/merch/merch02.jpg",
      buyLink: "#",
    },
    {
      name:    "Nome Prodotto",
      price:   "€ 00",
      image:   "images/merch/merch03.jpg",
      buyLink: "#",
    },
  ],

  // ---- CONTATTI -----------------------------------------------
  contact: {
    email:          "subconscious.infoart@gmail.com",
    bookings:       "bookings@subconsciousculture.com",
    demos:          "demos@subconsciousculture.com",
    instagram:      "@subconscious.culture",
    instagramUrl:   "https://instagram.com/subconscious.culture",
    address:        "Milano, Italia",
  },
};
