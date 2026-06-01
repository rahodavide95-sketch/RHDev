/* ============================================================
   SUBCONSCIOUS CULTURE — script.js
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  buildContent();
  initNavbar();
  initScrollAnimations();
  initMobileMenu();
  initHeroParallax();
  initContactForm();
  revealPage();
});

/* ----------------------------------------------------------
   Reveal page after fonts load (prevents FOUT)
   ---------------------------------------------------------- */
function revealPage() {
  document.fonts.ready.then(() => {
    document.body.classList.add('ready');
  });
  // Failsafe: show after 1s regardless
  setTimeout(() => document.body.classList.add('ready'), 1000);
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
  const socials = [
    label.instagram  && { text: 'Instagram',  url: label.instagram  },
    label.soundcloud && { text: 'Soundcloud', url: label.soundcloud },
    label.bandcamp   && { text: 'Bandcamp',   url: label.bandcamp   },
    label.ra         && { text: 'RA',          url: label.ra         },
  ].filter(Boolean);

  const footerSocial = document.getElementById('footer-social');
  if (footerSocial) {
    footerSocial.innerHTML = socials
      .map(s => `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.text}</a>`)
      .join('');
  }

  // Releases
  buildReleases(releases);

  // Artists
  buildArtists(artists);

  // Podcast
  buildPodcast(SITE.podcast);

  // Events
  buildEvents(SITE.events);

  // Merch
  buildMerch(SITE.merch);

  // Contact info
  buildContactInfo(contact);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.textContent = value;
}

/* ----------------------------------------------------------
   Releases grid
   ---------------------------------------------------------- */
function buildReleases(releases) {
  const grid = document.getElementById('releases-grid');
  if (!grid || !releases?.length) return;

  grid.innerHTML = releases.map((r, i) => {
    const coverHtml = r.cover
      ? `<img src="${r.cover}" alt="${esc(r.artist)} — ${esc(r.title)}" loading="lazy">`
      : `<div class="cover-placeholder"></div>`;

    const overlayHtml = r.link
      ? `<div class="cover-overlay"><a href="${r.link}" target="_blank" rel="noopener">Listen</a></div>`
      : '';

    const metaParts = [r.year, r.catalog, r.format].filter(Boolean);

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
  }).join('');

  observeCards('.release-card');
}

/* ----------------------------------------------------------
   Artists grid
   ---------------------------------------------------------- */
function buildArtists(artists) {
  const grid = document.getElementById('artists-grid');
  if (!grid || !artists?.length) return;

  grid.innerHTML = artists.map((a, i) => {
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
        ${a.origin ? `<div class="artist-origin">${esc(a.origin)}</div>` : ''}
        ${a.bio    ? `<p class="artist-bio">${esc(a.bio)}</p>` : ''}
        ${links.length ? `
          <div class="artist-links">
            ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener" class="artist-link">${l.text}</a>`).join('')}
          </div>` : ''}
      </article>`;
  }).join('');

  observeCards('.artist-card');
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

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('aos-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08 });

  cards.forEach(c => observer.observe(c));
}

/* ----------------------------------------------------------
   Mobile menu
   ---------------------------------------------------------- */
function initMobileMenu() {
  const toggle = document.getElementById('navToggle');
  const menu   = document.getElementById('navLinks');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    toggle.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', closeMenu);
  });

  function closeMenu() {
    menu.classList.remove('is-open');
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
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
