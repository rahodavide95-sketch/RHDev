// ============================================================
//  CONTENT.JS — MODIFICA QUI TUTTI I CONTENUTI DEL SITO
//  Non serve saper programmare: cambia solo i testi tra virgolette!
//  Dopo ogni modifica salva il file e ricarica il browser.
// ============================================================

const SITE = {

  // ---- INFO ETICHETTA ----------------------------------------
  label: {
    name:        "SUBCONSCIOUS Culture",
    tagline:     "Independent Record Label founded by italian Dj/Producer Raho",
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
  //
  // Per aggiungere una release: copia un blocco {…}, incollalo dopo
  // l'ultimo (prima del ]), separalo con una virgola.
  releases: [
    {
      artist:  "Raho",
      title:   "Solvane EP",
      year:    "2026",
      catalog: "SSSCLTR001",
      format:  "Digital",
      cover:   "images/releases/sc001.jpg",
      link:    "#",
    },
    {
      artist:  "Nome Artista",
      title:   "Titolo Release",
      year:    "2026",
      catalog: "SSSCLTR002",
      format:  "Digital",
      cover:   "images/releases/sc002.jpg",
      link:    "#",
    },
    {
      artist:  "Nome Artista",
      title:   "Titolo Release",
      year:    "2026",
      catalog: "SSSCLTR003",
      format:  "Digital",
      cover:   "images/releases/sc003.jpg",
      link:    "#",
    },
    {
      artist:  "Nome Artista",
      title:   "Titolo Release",
      year:    "2026",
      catalog: "SSSCLTR004",
      format:  "Digital",
      cover:   "images/releases/sc004.jpg",
      link:    "#",
    },
    {
      artist:  "Nome Artista",
      title:   "Titolo Release",
      year:    "2026",
      catalog: "SSSCLTR005",
      format:  "Digital",
      cover:   "images/releases/sc005.jpg",
      link:    "#",
    },
    {
      artist:  "Various Artists",
      title:   "Titolo Compilation",
      year:    "2026",
      catalog: "SSSCLTRS01",
      format:  "Digital",
      cover:   "images/releases/va01.jpg",
      link:    "#",
    },
  ],

  // ---- ARTISTI ------------------------------------------------
  // Stesso sistema delle release: aggiungi blocchi per nuovi artisti.
  artists: [
    {
      name:   "Artista Uno",
      origin: "Milano, IT",
      bio:    "Producer e DJ con radici nell'industrial e nella techno minimale. Esplora paesaggi sonori oscuri e ritualistici.",
      photo:  "images/artists/artist01.jpg",  // percorso foto artista
      instagram:  "#",
      soundcloud: "#",
    },
    {
      name:   "Artista Due",
      origin: "Berlino, DE",
      bio:    "Compositore e sperimentatore di trame ambient, noise e musica concreta. Live set ipnotici e immersivi.",
      photo:  "",
      instagram:  "#",
      soundcloud: "",
    },
    {
      name:   "Artista Tre",
      origin: "Roma, IT",
      bio:    "Artista poliedrica che fonde musica elettronica, field recording e poesia sonora.",
      photo:  "",
      instagram:  "#",
      soundcloud: "#",
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
