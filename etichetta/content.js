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
    tagline:     "Independent Record Label founded by Raho",
    foundedYear: "2026",

    // Il testo della sezione About (puoi usare \n per andare a capo)
    description: "Subconscious Culture è un'etichetta discografica indipendente dedicata alla musica elettronica d'avanguardia. Nata dall'esigenza di dare voce a suoni che vivono ai margini del mainstream, l'etichetta raccoglie artisti provenienti da tutta Europa accomunati da una visione sonora profonda e senza compromessi.",

    // Email principale
    email:     "subconscious.infoart@gmail.com",

    // Social (inserisci l'URL completo, oppure lascia "" per nasconderlo)
    instagram:  "https://instagram.com/subconscious.culture",
    soundcloud: "https://soundcloud.com/subconscious_culture",
    bandcamp:   "https://subconsciousculture26.bandcamp.com",
    ra:         "",   // Resident Advisor URL
  },

  // ---- RELEASES -----------------------------------------------
  // Release singola/EP/album → catalog: "SSSCLTR001", "SSSCLTR002", ecc.
  // Various Artists (VA)    → catalog: "SSSCLTRS01",  "SSSCLTRS02",  ecc.
  // date: formato GG/MM/AAAA  es. "15/06/2026"
  releases: [
    {
      artist:  "Raho",
      title:   "Solvane EP",
      date:    "23/01/2026",
      catalog: "SSSCLTR001",
      format:  "Digital",
      cover:   "images/releases/sc001.jpg",
      link:    "https://fanlink.tv/raho-solvane-ep-subconscious-culture",
    },
    {
      artist:  "Raho",
      title:   "Somnara EP",
      date:    "13/02/2026",
      catalog: "SSSCLTR002",
      format:  "Digital",
      cover:   "images/releases/sc002.jpg",
      link:    "https://fanlink.tv/raho-somnara-ep-subconscious-culture",
    },
    {
      artist:  "Raho",
      title:   "Lunthera EP",
      date:    "10/04/2026",
      catalog: "SSSCLTR003",
      format:  "Digital",
      cover:   "images/releases/sc003.jpg",
      link:    "https://fanlink.tv/raho-lunthera-ep-subconscious-culture",
    },
    {
      artist:  "Raho",
      title:   "Aevum EP",
      date:    "08/05/2026",
      catalog: "SSSCLTR004",
      format:  "Digital",
      cover:   "images/releases/sc004.jpg",
      link:    "https://fanlink.tv/raho-aevum-ep-subconscious-culture",
    },
    {
      artist:  "Various Artists",
      title:   "Somnia I",
      date:    "05/06/2026",
      catalog: "SSSCLTRS01",
      format:  "Digital",
      cover:   "images/releases/va01.jpg",
      link:    "https://fanlink.tv/subconscious-culture-various-artists-somnia-i",
    },
  ],

  // ---- ARTISTI ------------------------------------------------
  // Per aggiungere un artista: copia un blocco {…}, incollalo dopo
  // l'ultimo (prima del ]), separalo con una virgola.
  artists: [
    {
      name:       "Raho",
      origin:     "Italy",
      bio:        "Breve descrizione dell'artista.",
      photo:      "images/artists/raho.jpg",
      instagram:  "#",
      soundcloud: "#",
    },
    {
      name:       "Daryn Steytler",
      origin:     "Città, Paese",
      bio:        "Breve descrizione dell'artista.",
      photo:      "images/artists/daryn steytler.jpg",
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
      photo:      "images/artists/jack fresia feat vita.jpg",
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
      name:       "Kevin Ferhati",
      origin:     "Città, Paese",
      bio:        "Breve descrizione dell'artista.",
      photo:      "images/artists/kevin ferhati.jpg",
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
      name:       "Rhythm Assembler",
      origin:     "Città, Paese",
      bio:        "Breve descrizione dell'artista.",
      photo:      "images/artists/rhythm assembler.jpg",
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
