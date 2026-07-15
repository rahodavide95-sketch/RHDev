/* ============================================================
   SUBCONSCIOUS CULTURE — script.js
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  buildContent();
  initReleasesModal();
  initArtistsModal();
  initNavbar();
  initScrollAnimations();
  initMobileMenu();
  initHeroParallax();
  initContactForm();
  revealPage();
});

window.addEventListener('resize', () => {
  const rg = document.getElementById('releases-grid');
  const ag = document.getElementById('artists-grid');
  applyPeekMask(rg);
  applyPeekMask(ag);
});

/* ----------------------------------------------------------
   Reveal page after fonts load (prevents FOUT)
   ---------------------------------------------------------- */
function revealPage() {
  const cover = document.getElementById('pageCover');
  if (!cover) return;
  const reveal = () => cover.classList.add('is-hidden');
  document.fonts.ready.then(reveal);
  setTimeout(reveal, 1000); // failsafe
}

/* Hide all <img> that fail to load (e.g. missing logo) */
document.querySelectorAll('img').forEach(img => {
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
});

/* ----------------------------------------------------------
   Build all dynamic content from content.js
   ---------------------------------------------------------- */
function buildContent() {
  if (typeof SITE === 'undefined') return;
  const { label, releases, artists, contact } = SITE;

  // Hero title: split last word onto new line (SUBCONSCIOUS / Culture)
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle && label.name) {
    const words = label.name.trim().split(' ');
    const last  = words.pop();
    heroTitle.innerHTML = (words.length ? words.join(' ') + '<br>' : '') + last;
  }
  const taglineEl = document.getElementById('hero-tagline');
  if (taglineEl && label.tagline) {
    taglineEl.innerHTML = label.tagline.replace(/\n/g, '<br>');
  }
  setText('nav-name',     label.name);
  document.title = label.name;

  // Footer
  const year = new Date().getFullYear();
  setText('footer-copy', `© ${year} ${label.name}. All rights reserved.`);

  // Footer social links
  const ICONS = {
    instagram:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>`,
    soundcloud: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147a.272.272 0 0 1-.542 0a27.955 27.955 0 0 1 0-7.147a.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"/></svg>`,
    bandcamp:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/></svg>`,
    ra:         `<svg viewBox="0 0 24 24" fill="currentColor"><text x="2" y="17" font-size="13" font-weight="700" font-family="sans-serif" letter-spacing="-0.5">RA</text></svg>`,
  };

  const socials = [
    label.instagram  && { key: 'instagram',  label: 'Instagram',  url: label.instagram  },
    label.soundcloud && { key: 'soundcloud', label: 'SoundCloud', url: label.soundcloud },
    label.bandcamp   && { key: 'bandcamp',   label: 'Bandcamp',   url: label.bandcamp   },
    label.ra         && { key: 'ra',          label: 'RA',          url: label.ra         },
  ].filter(Boolean);

  const footerSocial = document.getElementById('footer-social');
  if (footerSocial) {
    footerSocial.innerHTML = socials
      .map(s => `<a href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="${s.label}">${ICONS[s.key] || s.label}</a>`)
      .join('');
  }

  // Releases
  buildReleases(releases);

  // Artists
  buildArtists(artists);

  // Podcast / Events / Merch — hidden when sections flag is false
  const vis = SITE.sections || {};

  if (vis.podcast !== false) {
    buildPodcast(SITE.podcast);
  } else {
    hideSection('podcast');
  }

  if (vis.events !== false) {
    buildEvents(SITE.events);
  } else {
    hideSection('events');
  }

  if (vis.merch !== false) {
    buildMerch(SITE.merch);
  } else {
    hideSection('merch');
  }

  // Contact info
  buildContactInfo(contact);

  // Marquee news
  buildMarquee();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.textContent = value;
}

function applyPeekMask(gridEl) {
  if (!gridEl) return;
  const cards = Array.from(gridEl.children);
  const cols = 3;
  if (cards.length <= cols * 2) {
    gridEl.style.removeProperty('-webkit-mask-image');
    gridEl.style.removeProperty('mask-image');
    return;
  }
  const thirdRowCard = cards[cols * 2];
  const gridTop = gridEl.getBoundingClientRect().top;
  const rowTop  = thirdRowCard.getBoundingClientRect().top;
  const gridH   = gridEl.offsetHeight;
  const start   = +((rowTop - gridTop) / gridH * 100).toFixed(1);
  const end     = Math.min(start + 18, 96);
  const g = `linear-gradient(to bottom, black ${start}%, transparent ${end}%)`;
  gridEl.style.setProperty('-webkit-mask-image', g);
  gridEl.style.setProperty('mask-image', g);
}

function hideSection(id) {
  const section = document.getElementById(id);
  if (section) section.style.display = 'none';
  const link = document.querySelector(`.nav-link[href="#${id}"]`);
  if (link) link.insertAdjacentHTML('afterend', '<span class="nav-wip">work in progress</span>');
}

/* ----------------------------------------------------------
   Releases
   ---------------------------------------------------------- */
function renderReleaseCard(r, i) {
  const coverHtml = r.cover
    ? `<img src="${r.cover}" alt="${esc(r.artist)} — ${esc(r.title)}" loading="lazy">`
    : `<div class="cover-placeholder"></div>`;

  const overlayHtml = r.link
    ? `<div class="cover-overlay"><a href="${r.link}" target="_blank" rel="noopener">Listen</a></div>`
    : '';

  const metaParts = [r.date || r.year, r.catalog, r.format].filter(Boolean);

  return `
    <article class="release-card" style="transition-delay:${i * 0.07}s">
      <div class="release-cover">
        ${coverHtml}
        ${overlayHtml}
      </div>
      <div class="release-artist">${esc(r.artist)}</div>
      <div class="release-title">${esc(r.title)}</div>
      <div class="release-meta">
        ${metaParts.map(p => `<span>${esc(p)}</span>`).join('')}
      </div>
    </article>`;
}

function buildReleases(releases) {
  const grid = document.getElementById('releases-grid');
  if (!grid || !releases?.length) return;

  const recent = [...releases]
    .sort((a, b) => parseReleaseDate(b.date || b.year) - parseReleaseDate(a.date || a.year))
    .slice(0, 9);

  grid.innerHTML = recent.map((r, i) => renderReleaseCard(r, i)).join('');

  document.getElementById('releasesViewAll')
    ?.addEventListener('click', () => openReleasesModal(releases));

  observeCards('.release-card');
  requestAnimationFrame(() => requestAnimationFrame(() => applyPeekMask(grid)));
}

function parseReleaseDate(str) {
  if (!str) return 0;
  const p = str.split('/');
  return p.length === 3
    ? new Date(+p[2], +p[1] - 1, +p[0]).getTime()
    : new Date(+str, 0, 1).getTime();
}

function openReleasesModal(releases) {
  const modal = document.getElementById('releasesModal');
  if (!modal) return;
  renderAllReleases(releases);
  modal.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-open')));
  document.body.style.overflow = 'hidden';
}

function closeReleasesModal() {
  const modal = document.getElementById('releasesModal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.addEventListener('transitionend', () => { modal.style.display = 'none'; }, { once: true });
  document.body.style.overflow = '';
}

function renderAllReleases(releases) {
  const grid     = document.getElementById('releases-all-grid');
  const sortEl   = document.getElementById('releasesSort');
  const searchEl = document.getElementById('releasesSearch');
  if (!grid) return;

  const sortVal   = sortEl?.value || 'newest';
  const searchVal = (searchEl?.value || '').toLowerCase();

  let filtered = releases.filter(r =>
    !searchVal ||
    r.artist.toLowerCase().includes(searchVal) ||
    r.title.toLowerCase().includes(searchVal)
  );

  filtered.sort((a, b) => {
    if (sortVal === 'newest') return parseReleaseDate(b.date || b.year) - parseReleaseDate(a.date || a.year);
    if (sortVal === 'oldest') return parseReleaseDate(a.date || a.year) - parseReleaseDate(b.date || b.year);
    if (sortVal === 'artist') return a.artist.localeCompare(b.artist);
    if (sortVal === 'name')   return a.title.localeCompare(b.title);
    return 0;
  });

  grid.innerHTML = filtered.map((r, i) => renderReleaseCard(r, i)).join('');
  observeCards('#releases-all-grid .release-card');
}

function initReleasesModal() {
  const modal = document.getElementById('releasesModal');
  if (!modal) return;

  const refresh = () => { if (typeof SITE !== 'undefined') renderAllReleases(SITE.releases); };

  document.getElementById('releasesClose')?.addEventListener('click', closeReleasesModal);
  document.getElementById('releasesSort')?.addEventListener('change', refresh);
  document.getElementById('releasesSearch')?.addEventListener('input', refresh);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('releasesModal').classList.contains('is-open')) closeReleasesModal();
      if (document.getElementById('artistsModal')?.classList.contains('is-open')) closeArtistsModal();
    }
  });
}

/* ----------------------------------------------------------
   Artists grid
   ---------------------------------------------------------- */
function renderArtistCard(a, i) {
  const photoHtml = a.photo
    ? `<img src="${a.photo}" alt="${esc(a.name)}" loading="lazy">`
    : `<div class="photo-placeholder"></div>`;

  const links = [
    a.instagram  && { text: 'Instagram',  url: a.instagram  },
    a.soundcloud && { text: 'Soundcloud', url: a.soundcloud },
  ].filter(Boolean);

  return `
    <article class="artist-card" style="transition-delay:${i * 0.09}s">
      <div class="artist-photo">${photoHtml}</div>
      <div class="artist-name">${esc(a.name)}</div>
      ${links.length ? `
        <div class="artist-links">
          ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener" class="artist-link">${l.text}</a>`).join('')}
        </div>` : ''}
    </article>`;
}

function buildArtists(artists) {
  const grid = document.getElementById('artists-grid');
  if (!grid || !artists?.length) return;

  grid.innerHTML = [...artists]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 9)
    .map((a, i) => renderArtistCard(a, i)).join('');

  document.getElementById('artistsViewAll')
    ?.addEventListener('click', () => openArtistsModal(artists));

  observeCards('.artist-card');
  requestAnimationFrame(() => requestAnimationFrame(() => applyPeekMask(grid)));
}

function openArtistsModal(artists) {
  const modal = document.getElementById('artistsModal');
  if (!modal) return;
  renderAllArtists(artists);
  modal.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('is-open')));
  document.body.style.overflow = 'hidden';
}

function closeArtistsModal() {
  const modal = document.getElementById('artistsModal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.addEventListener('transitionend', () => { modal.style.display = 'none'; }, { once: true });
  document.body.style.overflow = '';
}

function renderAllArtists(artists) {
  const grid     = document.getElementById('artists-all-grid');
  const sortEl   = document.getElementById('artistsSort');
  const searchEl = document.getElementById('artistsSearch');
  if (!grid) return;

  const sortVal   = sortEl?.value || 'az';
  const searchVal = (searchEl?.value || '').toLowerCase();

  let filtered = artists.filter(a =>
    !searchVal || a.name.toLowerCase().includes(searchVal)
  );

  filtered.sort((a, b) =>
    sortVal === 'za' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
  );

  grid.innerHTML = filtered.map((a, i) => renderArtistCard(a, i)).join('');
  observeCards('#artists-all-grid .artist-card');
}

function initArtistsModal() {
  const modal = document.getElementById('artistsModal');
  if (!modal) return;

  const refresh = () => { if (typeof SITE !== 'undefined') renderAllArtists(SITE.artists); };

  document.getElementById('artistsClose')?.addEventListener('click', closeArtistsModal);
  document.getElementById('artistsSort')?.addEventListener('change', refresh);
  document.getElementById('artistsSearch')?.addEventListener('input', refresh);
}

/* ----------------------------------------------------------
   Podcast list
   ---------------------------------------------------------- */
function buildPodcast(episodes) {
  const list = document.getElementById('podcast-list');
  if (!list || !episodes?.length) return;

  list.innerHTML = episodes.map((ep, i) => `
    <div class="podcast-item" style="transition-delay:${i * 0.06}s">
      <div>
        <div class="podcast-title">${esc(ep.title)}</div>
        <div class="podcast-meta">${esc(ep.date)}${ep.duration ? ' · ' + esc(ep.duration) : ''}</div>
      </div>
      ${ep.link ? `<a href="${ep.link}" target="_blank" rel="noopener" class="podcast-link">Listen</a>` : ''}
    </div>`).join('');

  observeCards('.podcast-item');
}

/* ----------------------------------------------------------
   Events list
   ---------------------------------------------------------- */
function buildEvents(events) {
  const list = document.getElementById('events-list');
  if (!list || !events?.length) return;

  list.innerHTML = events.map((ev, i) => {
    const soldOut  = !ev.ticketLink;
    return `
    <div class="event-item" style="transition-delay:${i * 0.06}s">
      <div class="event-date">${esc(ev.date)}</div>
      <div class="event-info">
        <div class="event-name">${esc(ev.name)}</div>
        <div class="event-venue">${esc(ev.venue)}</div>
      </div>
      <a href="${soldOut ? '#' : ev.ticketLink}"
         class="event-link${soldOut ? ' sold-out' : ''}"
         ${!soldOut ? 'target="_blank" rel="noopener"' : ''}>
        ${soldOut ? 'Sold Out' : 'Tickets'}
      </a>
    </div>`;
  }).join('');

  observeCards('.event-item');
}

/* ----------------------------------------------------------
   Merch grid
   ---------------------------------------------------------- */
function buildMerch(items) {
  const grid = document.getElementById('merch-grid');
  if (!grid || !items?.length) return;

  grid.innerHTML = items.map((m, i) => `
    <article class="merch-card" style="transition-delay:${i * 0.07}s">
      <div class="merch-img">
        ${m.image
          ? `<img src="${m.image}" alt="${esc(m.name)}" loading="lazy">`
          : `<div class="merch-img-placeholder"></div>`}
      </div>
      <div class="merch-name">${esc(m.name)}</div>
      <div class="merch-price">${esc(m.price)}</div>
      ${m.buyLink ? `<a href="${m.buyLink}" target="_blank" rel="noopener" class="merch-buy">Buy</a>` : ''}
    </article>`).join('');

  observeCards('.merch-card');
}

/* ----------------------------------------------------------
   Contact info block
   ---------------------------------------------------------- */
function buildContactInfo(contact) {
  if (!contact) return;

  // Primary email
  const emailEl = document.getElementById('contact-email-link');
  if (emailEl && contact.email) {
    emailEl.textContent = contact.email;
    emailEl.href = `mailto:${contact.email}`;
  }

  // Secondary row: booking, demos, instagram, location
  const row = document.getElementById('contact-row');
  if (row) {
    const items = [
      contact.bookings  && { label: 'Booking',   value: contact.bookings,  href: `mailto:${contact.bookings}`                      },
      contact.demos     && { label: 'Demos',      value: contact.demos,     href: `mailto:${contact.demos}`                         },
      contact.instagram && { label: 'Instagram',  value: contact.instagram, href: contact.instagramUrl || '#', external: true       },
      contact.address   && { label: 'Location',   value: contact.address,   href: null                                               },
    ].filter(Boolean);

    row.innerHTML = items.map(item => `
      <div class="contact-row-item">
        <span class="contact-row-label">${item.label}</span>
        ${item.href
          ? `<a href="${item.href}" class="contact-row-value"
               ${item.external ? 'target="_blank" rel="noopener noreferrer"' : ''}
             >${esc(item.value)}</a>`
          : `<span class="contact-row-value">${esc(item.value)}</span>`
        }
      </div>`).join('');
  }
}

/* ----------------------------------------------------------
   Navbar: scroll opacity + active section indicator
   ---------------------------------------------------------- */
function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  const sections = document.querySelectorAll('section[id]');
  const navLinks  = document.querySelectorAll('.nav-link');

  const setActive = (id) => {
    navLinks.forEach(a => {
      a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
    });
  };

  const onScroll = () => {
    navbar.classList.toggle('is-scrolled', window.scrollY > 50);

    // Mark whichever section's top edge is nearest above 40% of the viewport
    const mid = window.scrollY + window.innerHeight * 0.4;
    let current = '';
    sections.forEach(s => {
      if (s.style.display === 'none') return;
      if (s.offsetTop <= mid) current = s.id;
    });
    setActive(current);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ----------------------------------------------------------
   Scroll animations (IntersectionObserver, Apple-style)
   Supports data-aos-delay (ms)
   ---------------------------------------------------------- */
function initScrollAnimations() {
  const targets = document.querySelectorAll('[data-aos]');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const delay = parseInt(entry.target.dataset.aosDelay ?? 0, 10);
      const reveal = () => entry.target.classList.add('aos-visible');
      delay ? setTimeout(reveal, delay) : reveal();
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });

  targets.forEach(t => observer.observe(t));
}

/* Observe staggered cards (releases / artists) */
function observeCards(selector) {
  const cards = document.querySelectorAll(selector);

  const reveal = (card) => card.classList.add('aos-visible');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      reveal(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px 80px 0px' });

  cards.forEach(c => observer.observe(c));

  // Fallback: force-reveal after 600ms in case the observer misfires
  setTimeout(() => cards.forEach(reveal), 600);
}

/* ----------------------------------------------------------
   Mobile menu
   ---------------------------------------------------------- */
function initMobileMenu() {
  const toggle = document.getElementById('navToggle');
  const menu   = document.getElementById('navLinks');
  const navbar = document.getElementById('navbar');
  const inner  = navbar?.querySelector('.navbar-inner');
  if (!toggle || !menu) return;

  const isMobile = () => window.innerWidth <= 960;

  function portalOut() {
    document.body.style.setProperty('--navbar-h', navbar.offsetHeight + 'px');
    navbar.after(menu);
    menu.classList.add('is-portaled');
  }

  function portalIn() {
    menu.classList.remove('is-portaled');
    inner?.appendChild(menu);
  }

  function openMenu() {
    portalOut();
    // Wait one frame so browser sees the initial (hidden) state before transitioning
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
      toggle.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    });
  }

  function closeMenu() {
    menu.classList.remove('is-open');
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    // Wait for CSS transition to finish before moving back into navbar
    menu.addEventListener('transitionend', portalIn, { once: true });
  }

  toggle.addEventListener('click', () => {
    menu.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

  window.addEventListener('resize', () => {
    if (!isMobile() && menu.classList.contains('is-portaled')) closeMenu();
  });
}

/* ----------------------------------------------------------
   Hero parallax — content drifts up and fades on scroll
   (subtle, Apple-style)
   ---------------------------------------------------------- */
function initHeroParallax() {
  const content = document.querySelector('.hero-content');
  if (!content) return;

  const vh = window.innerHeight;

  const onScroll = () => {
    const y = window.scrollY;
    if (y > vh) return;
    const progress = y / vh;
    // Drift up 70px over one full viewport height
    content.style.transform = `translateY(${progress * 70}px)`;
    // Fade out as user scrolls
    content.style.opacity   = String(Math.max(0, 1 - progress * 1.6));
  };

  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ----------------------------------------------------------
   Contact form (client-side only — connects to nothing)
   For real email delivery: swap with Formspree, Netlify Forms, etc.
   ---------------------------------------------------------- */
function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('.btn-send');
    btn.textContent = 'Sent ✓';
    btn.classList.add('sent');
    btn.disabled = true;

    setTimeout(() => {
      btn.textContent = 'Send Message';
      btn.classList.remove('sent');
      btn.disabled = false;
      form.reset();
    }, 4000);
  });
}

/* ----------------------------------------------------------
   Marquee — dynamic news from SITE content
   ---------------------------------------------------------- */
function buildMarquee() {
  const dot  = '<span class="live-dot"></span>';
  const sep  = ' &nbsp;—&nbsp; ';
  const items = [];
  const vis  = SITE.sections || {};

  if (SITE.releases?.length) {
    const latest = [...SITE.releases]
      .sort((a, b) => parseReleaseDate(b.date || b.year) - parseReleaseDate(a.date || a.year))[0];
    if (latest) items.push(`New Release: ${esc(latest.artist)} &mdash; ${esc(latest.title)}`);
  }
  if (vis.events !== false && SITE.events?.length) {
    items.push(`Next Event: ${esc(SITE.events[0].name)} &mdash; ${esc(SITE.events[0].venue)}`);
  }
  if (vis.podcast !== false && SITE.podcast?.length) {
    items.push(`New Podcast: ${esc(SITE.podcast[0].title)}`);
  }
  if (vis.merch !== false && SITE.merch?.length) {
    items.push(`New Merch: ${esc(SITE.merch[0].name)}`);
  }

  if (!items.length) return;

  const text = `${dot} SUBCONSCIOUS Culture NEWS! ${dot} ${items.join(sep)}`;

  const track = document.querySelector('.marquee-track');
  if (!track) return;

  // Reset to single template span, set content
  const all  = [...track.querySelectorAll('.marquee-text')];
  const tmpl = all[0];
  if (!tmpl) return;
  tmpl.innerHTML = text;
  all.slice(1).forEach(s => s.remove());

  // After layout: clone enough copies to fill 2.5× viewport, then animate
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const spanW  = tmpl.offsetWidth;
      const needed = Math.max(2, Math.ceil((window.innerWidth * 2.5) / spanW));
      for (let i = 1; i < needed; i++) {
        track.appendChild(tmpl.cloneNode(true));
      }

      // Inject exact-pixel keyframe so loop is truly seamless with N copies
      let ks = document.getElementById('mq-keyframes');
      if (!ks) {
        ks = document.createElement('style');
        ks.id = 'mq-keyframes';
        document.head.appendChild(ks);
      }
      ks.textContent = `@keyframes mq-scroll{from{transform:translateX(0)}to{transform:translateX(-${spanW}px)}}`;

      // Speed: 70 px/s, minimum 20 s so text is readable
      const dur = Math.max(spanW / 70, 20).toFixed(2);

      track.style.animation = 'none';
      void track.offsetHeight; // force reflow to restart
      track.style.animation = `mq-scroll ${dur}s linear infinite, mq-fade ${dur}s linear infinite`;
    });
  });
}

/* ----------------------------------------------------------
   Utils
   ---------------------------------------------------------- */
function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
