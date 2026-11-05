/* ============================================================
   SUBCONSCIOUS CULTURE — script.js

   Sicurezza: il sito gira con una Content-Security-Policy rigorosa
   (vedi vercel.json e il <meta> in index.html). Per questo qui:
   - niente attributi style="" o handler onerror="" dentro l'HTML generato
     (gli stili si impostano via element.style, che la CSP consente);
   - niente <style> iniettati: le animazioni dinamiche usano element.animate();
   - ogni testo passa da esc() e ogni URL da safeUrl().
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  hideBrokenImages(document);
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
  applyPeekMask(document.getElementById('releases-grid'));
  applyPeekMask(document.getElementById('artists-grid'));
});

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ----------------------------------------------------------
   Reveal page after fonts load (prevents FOUT)
   ---------------------------------------------------------- */
function revealPage() {
  const cover = document.getElementById('pageCover');
  if (!cover) return;
  const reveal = () => cover.classList.add('is-hidden');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reveal);
  setTimeout(reveal, 1000); // failsafe
}

/* Hide <img> that fail to load (replaces the old inline onerror="") */
function hideBrokenImages(root) {
  root.querySelectorAll('img').forEach(img => {
    if (img.dataset.guarded) return;
    img.dataset.guarded = '1';
    const hide = () => { img.style.visibility = 'hidden'; };
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) hide();
    img.addEventListener('error', hide);
  });
}

/* Set staggered reveal delays without inline style attributes */
function stagger(container, step) {
  if (!container) return;
  Array.from(container.children).forEach((el, i) => {
    el.style.transitionDelay = (i * step).toFixed(2) + 's';
  });
}

/* ----------------------------------------------------------
   Build all dynamic content from content.js
   ---------------------------------------------------------- */
function buildContent() {
  if (typeof SITE === 'undefined') return;
  const { label, releases, artists, contact } = SITE;

  // Hero title: split last word onto new line (SUBCONSCIOUS / Culture)
  const heroTitle = document.getElementById('hero-title');
  if (heroTitle && label.name) {
    const words = label.name.trim().split(/\s+/).map(esc);
    const last  = words.pop();
    heroTitle.innerHTML = (words.length ? words.join(' ') + '<br>' : '') + last;
  }
  const taglineEl = document.getElementById('hero-tagline');
  if (taglineEl && label.tagline) {
    taglineEl.innerHTML = esc(label.tagline).replace(/\n/g, '<br>');
  }
  setText('nav-name', label.name);
  if (label.name) document.title = label.name;

  // Footer
  const year = new Date().getFullYear();
  setText('footer-copy', `© ${year} ${label.name}. All rights reserved.`);

  // Footer social links
  const ICONS = {
    instagram:  `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>`,
    soundcloud: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147a.272.272 0 0 1-.542 0a27.955 27.955 0 0 1 0-7.147a.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"/></svg>`,
    bandcamp:   `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/></svg>`,
    ra:         `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><text x="2" y="17" font-size="13" font-weight="700" font-family="sans-serif" letter-spacing="-0.5">RA</text></svg>`,
  };

  const socials = [
    { key: 'instagram',  label: 'Instagram',  url: safeUrl(label.instagram)  },
    { key: 'soundcloud', label: 'SoundCloud', url: safeUrl(label.soundcloud) },
    { key: 'bandcamp',   label: 'Bandcamp',   url: safeUrl(label.bandcamp)   },
    { key: 'ra',         label: 'Resident Advisor', url: safeUrl(label.ra)   },
  ].filter(s => s.url);

  const footerSocial = document.getElementById('footer-social');
  if (footerSocial) {
    footerSocial.innerHTML = socials
      .map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(s.label)}">${ICONS[s.key] || esc(s.label)}</a>`)
      .join('');
  }

  buildReleases(releases);
  buildArtists(artists);

  // Podcast / Events / Merch — hidden when sections flag is false
  const vis = SITE.sections || {};
  if (vis.podcast !== false) buildPodcast(SITE.podcast); else hideSection('podcast');
  if (vis.events  !== false) buildEvents(SITE.events);   else hideSection('events');
  if (vis.merch   !== false) buildMerch(SITE.merch);     else hideSection('merch');

  buildContactInfo(contact);
  buildMarquee();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.textContent = value;
}

function applyPeekMask(gridEl) {
  if (!gridEl) return;
  const cards = Array.from(gridEl.children);
  if (cards.length < 2) return;

  // Detect column count from the actual DOM layout (5 / 4 / 3 responsive)
  const firstTop = cards[0].getBoundingClientRect().top;
  let cols = 1;
  for (let i = 1; i < cards.length; i++) {
    if (Math.abs(cards[i].getBoundingClientRect().top - firstTop) > 5) break;
    cols++;
  }

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
  if (section) section.hidden = true;
  const link = document.querySelector(`.nav-link[href="#${id}"]`);
  if (link) link.insertAdjacentHTML('afterend', '<span class="nav-wip">work in progress</span>');
}

/* ----------------------------------------------------------
   Releases
   ---------------------------------------------------------- */
function renderReleaseCard(r) {
  const cover = safeUrl(r.cover);
  const link  = safeUrl(r.link);

  const coverHtml = cover
    ? `<img src="${esc(cover)}" alt="${esc(r.artist)} — ${esc(r.title)}" loading="lazy" decoding="async" width="800" height="800">`
    : `<div class="cover-placeholder"></div>`;

  const overlayHtml = link
    ? `<div class="cover-overlay"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="Listen to ${esc(r.artist)} — ${esc(r.title)}">Listen</a></div>`
    : '';

  const metaParts = [r.date || r.year, r.catalog, r.format].filter(Boolean);

  return `
    <article class="release-card">
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
    .slice(0, 10);

  grid.innerHTML = recent.map(renderReleaseCard).join('');
  stagger(grid, 0.07);
  hideBrokenImages(grid);

  const btn = document.getElementById('releasesViewAll');
  btn?.addEventListener('click', () => openModal('releasesModal', btn, () => renderAllReleases(releases)));

  observeCards('.release-card');
  requestAnimationFrame(() => requestAnimationFrame(() => applyPeekMask(grid)));
}

function parseReleaseDate(str) {
  if (!str) return 0;
  const p = String(str).split('/');
  return p.length === 3
    ? new Date(+p[2], +p[1] - 1, +p[0]).getTime()
    : new Date(+str, 0, 1).getTime();
}

function renderAllReleases(releases) {
  const grid     = document.getElementById('releases-all-grid');
  const sortEl   = document.getElementById('releasesSort');
  const searchEl = document.getElementById('releasesSearch');
  if (!grid) return;

  const sortVal   = sortEl?.value || 'newest';
  const searchVal = (searchEl?.value || '').toLowerCase();

  const filtered = releases.filter(r =>
    !searchVal ||
    String(r.artist).toLowerCase().includes(searchVal) ||
    String(r.title).toLowerCase().includes(searchVal)
  );

  filtered.sort((a, b) => {
    if (sortVal === 'newest') return parseReleaseDate(b.date || b.year) - parseReleaseDate(a.date || a.year);
    if (sortVal === 'oldest') return parseReleaseDate(a.date || a.year) - parseReleaseDate(b.date || b.year);
    if (sortVal === 'artist') return a.artist.localeCompare(b.artist);
    if (sortVal === 'name')   return a.title.localeCompare(b.title);
    return 0;
  });

  grid.innerHTML = filtered.map(renderReleaseCard).join('');
  stagger(grid, 0.07);
  hideBrokenImages(grid);
  observeCards('#releases-all-grid .release-card');
}

function initReleasesModal() {
  const refresh = () => { if (typeof SITE !== 'undefined') renderAllReleases(SITE.releases); };
  document.getElementById('releasesClose')?.addEventListener('click', () => closeModal('releasesModal'));
  document.getElementById('releasesSort')?.addEventListener('change', refresh);
  document.getElementById('releasesSearch')?.addEventListener('input', refresh);
}

/* ----------------------------------------------------------
   Modals (shared): focus goes in on open, back to the button on close,
   Tab stays inside, Escape closes.
   ---------------------------------------------------------- */
const modalState = { open: null, returnFocus: null };

function openModal(id, trigger, render) {
  const modal = document.getElementById(id);
  if (!modal) return;
  render();
  modalState.open = modal;
  modalState.returnFocus = trigger || document.activeElement;
  modal.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    modal.classList.add('is-open');
    modal.querySelector('.modal-search')?.focus({ preventScroll: true });
  }));
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal || !modal.classList.contains('is-open')) return;
  modal.classList.remove('is-open');
  const done = () => { modal.style.display = 'none'; };
  if (REDUCED_MOTION) done(); else modal.addEventListener('transitionend', done, { once: true });
  document.body.style.overflow = '';
  modalState.open = null;
  modalState.returnFocus?.focus?.({ preventScroll: true });
}

document.addEventListener('keydown', e => {
  const modal = modalState.open;
  if (!modal) return;
  if (e.key === 'Escape') { closeModal(modal.id); return; }
  if (e.key !== 'Tab') return;
  const focusable = modal.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ----------------------------------------------------------
   Artists grid
   ---------------------------------------------------------- */
function renderArtistCard(a) {
  const photo = safeUrl(a.photo);
  const photoHtml = photo
    ? `<img src="${esc(photo)}" alt="${esc(a.name)}" loading="lazy" decoding="async">`
    : `<div class="photo-placeholder"></div>`;

  // Links still set to "#" (placeholders) are simply not shown
  const links = [
    { text: 'Instagram',  url: safeUrl(a.instagram)  },
    { text: 'Soundcloud', url: safeUrl(a.soundcloud) },
  ].filter(l => l.url);

  return `
    <article class="artist-card">
      <div class="artist-photo">${photoHtml}</div>
      <div class="artist-name">${esc(a.name)}</div>
      ${links.length ? `
        <div class="artist-links">
          ${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" class="artist-link">${l.text}</a>`).join('')}
        </div>` : ''}
    </article>`;
}

function buildArtists(artists) {
  const grid = document.getElementById('artists-grid');
  if (!grid || !artists?.length) return;

  grid.innerHTML = [...artists]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 10)
    .map(renderArtistCard).join('');
  stagger(grid, 0.09);
  hideBrokenImages(grid);

  const btn = document.getElementById('artistsViewAll');
  btn?.addEventListener('click', () => openModal('artistsModal', btn, () => renderAllArtists(artists)));

  observeCards('.artist-card');
  requestAnimationFrame(() => requestAnimationFrame(() => applyPeekMask(grid)));
}

function renderAllArtists(artists) {
  const grid     = document.getElementById('artists-all-grid');
  const sortEl   = document.getElementById('artistsSort');
  const searchEl = document.getElementById('artistsSearch');
  if (!grid) return;

  const sortVal   = sortEl?.value || 'az';
  const searchVal = (searchEl?.value || '').toLowerCase();

  const filtered = artists.filter(a =>
    !searchVal || String(a.name).toLowerCase().includes(searchVal)
  );

  filtered.sort((a, b) =>
    sortVal === 'za' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
  );

  grid.innerHTML = filtered.map(renderArtistCard).join('');
  stagger(grid, 0.09);
  hideBrokenImages(grid);
  observeCards('#artists-all-grid .artist-card');
}

function initArtistsModal() {
  const refresh = () => { if (typeof SITE !== 'undefined') renderAllArtists(SITE.artists); };
  document.getElementById('artistsClose')?.addEventListener('click', () => closeModal('artistsModal'));
  document.getElementById('artistsSort')?.addEventListener('change', refresh);
  document.getElementById('artistsSearch')?.addEventListener('input', refresh);
}

/* ----------------------------------------------------------
   Podcast list
   ---------------------------------------------------------- */
function buildPodcast(episodes) {
  const list = document.getElementById('podcast-list');
  if (!list || !episodes?.length) return;

  list.innerHTML = episodes.map(ep => {
    const link = safeUrl(ep.link);
    return `
    <div class="podcast-item">
      <div>
        <div class="podcast-title">${esc(ep.title)}</div>
        <div class="podcast-meta">${esc(ep.date)}${ep.duration ? ' · ' + esc(ep.duration) : ''}</div>
      </div>
      ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="podcast-link">Listen</a>` : ''}
    </div>`;
  }).join('');
  stagger(list, 0.06);

  observeCards('.podcast-item');
}

/* ----------------------------------------------------------
   Events list
   ---------------------------------------------------------- */
function buildEvents(events) {
  const list = document.getElementById('events-list');
  if (!list || !events?.length) return;

  list.innerHTML = events.map(ev => {
    const soldOut = !ev.ticketLink;
    const link    = safeUrl(ev.ticketLink);
    const linkHtml = soldOut
      ? `<span class="event-link sold-out">Sold Out</span>`
      : link
        ? `<a href="${esc(link)}" class="event-link" target="_blank" rel="noopener noreferrer">Tickets</a>`
        : `<span class="event-link">Tickets soon</span>`;
    return `
    <div class="event-item">
      <div class="event-date">${esc(ev.date)}</div>
      <div class="event-info">
        <div class="event-name">${esc(ev.name)}</div>
        <div class="event-venue">${esc(ev.venue)}</div>
      </div>
      ${linkHtml}
    </div>`;
  }).join('');
  stagger(list, 0.06);

  observeCards('.event-item');
}

/* ----------------------------------------------------------
   Merch grid
   ---------------------------------------------------------- */
function buildMerch(items) {
  const grid = document.getElementById('merch-grid');
  if (!grid || !items?.length) return;

  grid.innerHTML = items.map(m => {
    const img = safeUrl(m.image);
    const buy = safeUrl(m.buyLink);
    return `
    <article class="merch-card">
      <div class="merch-img">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(m.name)}" loading="lazy" decoding="async">`
          : `<div class="merch-img-placeholder"></div>`}
      </div>
      <div class="merch-name">${esc(m.name)}</div>
      <div class="merch-price">${esc(m.price)}</div>
      ${buy ? `<a href="${esc(buy)}" target="_blank" rel="noopener noreferrer" class="merch-buy">Buy</a>` : ''}
    </article>`;
  }).join('');
  stagger(grid, 0.07);
  hideBrokenImages(grid);

  observeCards('.merch-card');
}

/* ----------------------------------------------------------
   Contact info block (only if the markup exists in index.html)
   ---------------------------------------------------------- */
function buildContactInfo(contact) {
  if (!contact) return;

  const emailEl = document.getElementById('contact-email-link');
  if (emailEl && isEmail(contact.email)) {
    emailEl.textContent = contact.email;
    emailEl.href = `mailto:${contact.email}`;
  }

  const row = document.getElementById('contact-row');
  if (row) {
    const items = [
      isEmail(contact.bookings) && { label: 'Booking',   value: contact.bookings,  href: `mailto:${contact.bookings}` },
      isEmail(contact.demos)    && { label: 'Demos',     value: contact.demos,     href: `mailto:${contact.demos}`    },
      contact.instagram         && { label: 'Instagram', value: contact.instagram, href: safeUrl(contact.instagramUrl), external: true },
      contact.address           && { label: 'Location',  value: contact.address,   href: null },
    ].filter(Boolean);

    row.innerHTML = items.map(item => `
      <div class="contact-row-item">
        <span class="contact-row-label">${esc(item.label)}</span>
        ${item.href
          ? `<a href="${esc(item.href)}" class="contact-row-value"
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
      const on = a.getAttribute('href') === '#' + id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  };

  const onScroll = () => {
    navbar.classList.toggle('is-scrolled', window.scrollY > 50);

    // Mark whichever section's top edge is nearest above 40% of the viewport
    const mid = window.scrollY + window.innerHeight * 0.4;
    let current = '';
    sections.forEach(s => {
      if (s.hidden) return;
      if (s.offsetTop <= mid) current = s.id;
    });
    setActive(current);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ----------------------------------------------------------
   Scroll animations (IntersectionObserver)
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
      toggle.setAttribute('aria-label', 'Close menu');
      document.body.style.overflow = 'hidden';
    });
  }

  function closeMenu() {
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open');
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    document.body.style.overflow = '';
    // Wait for CSS transition to finish before moving back into navbar
    if (REDUCED_MOTION) portalIn(); else menu.addEventListener('transitionend', portalIn, { once: true });
  }

  toggle.addEventListener('click', () => {
    menu.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  window.addEventListener('resize', () => {
    if (!isMobile() && menu.classList.contains('is-portaled')) closeMenu();
  });
}

/* ----------------------------------------------------------
   Hero parallax — content drifts and fades on scroll
   ---------------------------------------------------------- */
function initHeroParallax() {
  const content = document.querySelector('.hero-content');
  if (!content || REDUCED_MOTION) return;

  const vh = window.innerHeight;

  const onScroll = () => {
    const y = window.scrollY;
    if (y > vh) return;
    const progress = y / vh;
    content.style.transform = `translateY(${progress * 70}px)`;
    content.style.opacity   = String(Math.max(0, 1 - progress * 1.6));
  };

  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ----------------------------------------------------------
   Contact form

   Real delivery through Web3Forms (free, no server to maintain):
   paste the Access Key in content.js → contact.formKey.
   Without a key the form opens the visitor's mail app with the
   message already written (it never pretends to have sent it).

   Protection: hidden honeypot field for bots, length limits,
   e-mail format check, one submission per minute per page.
   ---------------------------------------------------------- */
const FORM_LIMITS = { name: 100, email: 254, subject: 150, message: 5000, minMessage: 10 };

function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  const btn    = form.querySelector('.btn-send');
  const status = document.getElementById('formStatus');
  const contact = (typeof SITE !== 'undefined' && SITE.contact) || {};
  const key    = String(contact.formKey || '').trim();
  const to     = isEmail(contact.email) ? contact.email : '';
  let lastSent = 0;

  const say = (msg, kind) => {
    if (!status) return;
    status.textContent = msg;
    status.dataset.kind = kind || '';
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const data = {
      name:    form.elements.name.value.trim(),
      email:   form.elements.email.value.trim(),
      subject: form.elements.subject.value.trim(),
      message: form.elements.message.value.trim(),
    };

    // Honeypot: real people never see or fill this field
    if (form.elements.website?.value) {
      form.reset();
      say('Thank you — your message has been sent.', 'ok');
      return;
    }

    const problem =
      !data.name                                   ? 'Please write your name.' :
      data.name.length > FORM_LIMITS.name          ? 'Your name is too long.' :
      !isEmail(data.email)                         ? 'Please check your e-mail address.' :
      data.subject.length > FORM_LIMITS.subject    ? 'The subject is too long.' :
      data.message.length < FORM_LIMITS.minMessage ? 'Your message is a bit too short.' :
      data.message.length > FORM_LIMITS.message    ? 'Your message is too long (max 5000 characters).' :
      '';
    if (problem) { say(problem, 'error'); return; }

    if (Date.now() - lastSent < 60_000) {
      say('Message already sent — please wait a minute before sending another.', 'error');
      return;
    }

    // No key yet: hand the message to the visitor's own mail app
    if (!key) {
      if (!to) { say('The contact form is not configured yet.', 'error'); return; }
      const subject = data.subject || 'Message from subconsciousculture website';
      const body = `${data.message}\n\n— ${data.name} <${data.email}>`;
      window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      say(`Your mail app should open with the message ready to send. If it doesn't, write to ${to}.`, 'ok');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';
    say('', '');

    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: key,
          from_name:  'Subconscious Culture — website',
          subject:    data.subject ? `[Website] ${data.subject}` : '[Website] New message',
          name:       data.name,
          email:      data.email,
          replyto:    data.email,
          message:    data.message,
          botcheck:   false,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.message || res.status);

      lastSent = Date.now();
      form.reset();
      btn.textContent = 'Sent ✓';
      btn.classList.add('sent');
      say('Thank you — your message has been sent. We will get back to you soon.', 'ok');
      setTimeout(() => {
        btn.textContent = 'Send Message';
        btn.classList.remove('sent');
        btn.disabled = false;
      }, 4000);
    } catch {
      btn.textContent = 'Send Message';
      btn.disabled = false;
      say(to
        ? `Sending failed. Please try again or write to ${to}.`
        : 'Sending failed. Please try again later.', 'error');
    }
  });
}

/* ----------------------------------------------------------
   Marquee — dynamic news from SITE content
   (animated with element.animate(): no injected <style>, CSP-safe)
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

  const text = `${dot} ${esc(SITE.label?.name || '')} NEWS! ${dot} ${items.join(sep)}`;

  const track = document.querySelector('.marquee-track');
  if (!track) return;

  // Reset to single template span, set content
  const all  = [...track.querySelectorAll('.marquee-text')];
  const tmpl = all[0];
  if (!tmpl) return;
  tmpl.innerHTML = text;
  all.slice(1).forEach(s => s.remove());

  if (REDUCED_MOTION || typeof track.animate !== 'function') return;

  // After layout: clone enough copies to fill 2.5× viewport, then animate
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const spanW  = tmpl.offsetWidth;
      if (!spanW) return;
      const needed = Math.max(2, Math.ceil((window.innerWidth * 2.5) / spanW));
      for (let i = 1; i < needed; i++) track.appendChild(tmpl.cloneNode(true));

      // Speed: 70 px/s, minimum 20 s so text is readable
      const duration = Math.max(spanW / 70, 20) * 1000;
      const timing   = { duration, iterations: Infinity, easing: 'linear' };

      track.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(-${spanW}px)` }],
        timing
      );
      track.animate(
        [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.9 }, { opacity: 0, offset: 1 }],
        timing
      );
    });
  });
}

/* ----------------------------------------------------------
   Utils
   ---------------------------------------------------------- */

/* Escape text for HTML (content and attributes) */
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Only allow https/http/mailto links and relative paths.
   Blocks javascript:, data:, protocol-relative "//" URLs and
   placeholders like "#" or "" (returned as empty → link hidden). */
function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (!u || u === '#') return '';
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('\\')) return '';
  return u; // relative path, e.g. images/releases/sc001.webp
}

function isEmail(v) {
  const s = String(v ?? '').trim();
  return s.length <= FORM_LIMITS.email && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(s);
}
