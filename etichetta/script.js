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
  setText('hero-tagline', label.tagline);
  setText('nav-name',     label.name);
  document.title = label.name;

  // Footer
  const year = new Date().getFullYear();
  setText('footer-copy', `© ${year} ${label.name}. All rights reserved.`);

  // Footer social links
  const ICONS = {
    instagram:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
    soundcloud: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.56 8.87V17h8.76c.98-.04 1.68-.74 1.68-1.68 0-.93-.76-1.68-1.68-1.68-.17 0-.31.03-.46.07C19.69 12.82 18.1 11.3 16.12 11.3c-.75 0-1.45.21-2.05.58-.07-.05-.14-.1-.21-.15.03-.17.05-.34.05-.52 0-1.66-1.35-3.01-3.01-3.01s-3.01 1.35-3.01 3.01c0 .05 0 .1.01.15C6.88 11.59 6 12.59 6 13.81c0 1.37 1.1 2.5 2.5 2.5h3.06V8.87z"/><path d="M2 13.81c0 .92.37 1.75.96 2.36V11.5c-.6.6-.96 1.43-.96 2.31zm2.5-2.31v4.67a3.5 3.5 0 0 0 0-4.67zm2 .35v4c.35.12.73.19 1.13.19h.37v-4.38h-.37c-.4 0-.78.07-1.13.19z"/></svg>`,
    bandcamp:   `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 18.75l7.437-13.5H24l-7.438 13.5z"/></svg>`,
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
    sections.forEach(s => { if (s.offsetTop <= mid) current = s.id; });
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
