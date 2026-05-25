// ============================================================
//  CONTENT.JS — MODIFICA QUI TUTTI I CONTENUTI DEL SITO
//  Non serve saper programmare: cambia solo i testi tra virgolette!
//  Dopo ogni modifica salva il file e ricarica il browser.
// ============================================================

const SITE = {

  // ---- INFO ETICHETTA ----------------------------------------
  label: {
    name:        "Subconscious Culture",
    tagline:     "Independent Record Label",
    foundedYear: "2020",

    // Il testo della sezione About (puoi usare \n per andare a capo)
    description: "Subconscious Culture è un'etichetta discografica indipendente dedicata alla musica elettronica d'avanguardia. Nata dall'esigenza di dare voce a suoni che vivono ai margini del mainstream, l'etichetta raccoglie artisti provenienti da tutta Europa accomunati da una visione sonora profonda e senza compromessi.",

    // Email principale
    email:     "info@subconsciousculture.com",

    // Social (inserisci l'URL completo, oppure lascia "" per nasconderlo)
    instagram:  "https://instagram.com/subconsciousculture",
    soundcloud: "",
    bandcamp:   "",
    ra:         "",   // Resident Advisor URL
  },

  // ---- RELEASES -----------------------------------------------
  // Per aggiungere una release copia uno dei blocchi qui sotto,
  // incollalo dopo l'ultimo, separato da una virgola.
  releases: [
    {
      artist:  "Artista Uno",
      title:   "Titolo della Release",
      year:    "2024",
      catalog: "SC001",
      format:  "Digital / 12\" Vinyl",
      cover:   "images/releases/sc001.jpg",   // percorso immagine copertina
      link:    "#",                            // link Spotify / Bandcamp / etc.
    },
    {
      artist:  "Artista Due",
      title:   "Secondo EP",
      year:    "2024",
      catalog: "SC002",
      format:  "Digital",
      cover:   "",          // lascia "" se non hai ancora la copertina
      link:    "#",
    },
    {
      artist:  "Artista Tre",
      title:   "Album Debut",
      year:    "2023",
      catalog: "SC003",
      format:  "Digital / Cassette",
      cover:   "",
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
    email:          "info@subconsciousculture.com",
    bookings:       "bookings@subconsciousculture.com",
    demos:          "demos@subconsciousculture.com",
    instagram:      "@subconsciousculture",
    instagramUrl:   "https://instagram.com/subconsciousculture",
    address:        "Milano, Italia",
  },
};
