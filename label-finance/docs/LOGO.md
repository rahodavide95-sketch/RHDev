# Logo ufficiale — Label Finance

> **Questi sono gli UNICI due loghi ufficiali.** Non usarne altri, non ricrearli con
> font diversi, non staccare la scritta. Qualsiasi altro file di logo è da considerarsi
> vecchio/non valido ed è già stato eliminato.

## File ufficiali

| Asset | File | Uso |
|---|---|---|
| **Icona** (badge "LF") | `icon.png` (vettoriale: `icon.svg`) | Favicon, app icon, marchio da solo |
| **Lockup completo** | icona + scritta (ricostruito via markup, vedi sotto) | Header, landing, footer, documenti |

Per la PWA esistono anche `pwa-192.png` e `pwa-512.png`: sono **derivati dall'icona**
e servono solo all'installazione, non sono loghi a sé.

---

## 1) Logo completo — icona + "LabelFinance"

Regole **inderogabili**:
- La scritta è **"LabelFinance" tutta attaccata** (nessuno spazio tra "Label" e "Finance").
- Font **Syne**, weight **600**, `letter-spacing:-.04em`.
- "Label" nel colore testo, **"Finance" in lilla `#c4b5fd`**.
- Spazio (gap) **solo tra icona e parola**, mai dentro la parola.

Markup di riferimento (così è nell'app, in `app.html` → `.brand`):

```html
<a class="logo">
  <img src="icon.png?v=3" alt="">
  <span class="logo-w">Label<span class="fin">Finance</span></span>
</a>
```

```css
.logo{display:flex;align-items:center;gap:10px;
  font-family:'Syne',sans-serif;font-weight:600;letter-spacing:-.04em;color:var(--text)}
.logo img{width:32px;height:32px;flex:none}     /* dimensione a piacere, proporzioni 1:1 */
.logo .fin{color:#c4b5fd}                        /* "Finance" in lilla (light theme: #7c3aed) */
```

> ⚠️ Errore tipico: mettere "Label" e `<span>Finance</span>` come figli diretti del flex.
> Il `gap` finisce dentro la parola e la stacca. La scritta va **avvolta in un unico span**
> (`.logo-w`) così "LabelFinance" è un blocco solo.

## 2) Logo solo icona

Il file `icon.png` (badge "LF" su gradiente viola). Usalo da solo dove non serve la
scritta (favicon, app icon, spazi piccoli).

---

*Nota storica: i vecchi file `lockup-v3*.png` e `logo-full*.svg` (scritta in font largo)
sono stati sostituiti da tempo e rimossi. Non riutilizzarli.*
