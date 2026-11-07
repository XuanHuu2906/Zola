# R3 — Zalo Renderer Architecture Map (REA)

**Target:** Zalo PC `26.10.20.3253` (VNG GROUP JSC, signed) — Electron `22.3.9` / Chromium `108.0.5359.215`
**Artifact:** `app.asar` 177,728,582 B, SHA-256 `d83256230e5d1d4483c2411f71936c3dc1562fb8a885fd8752cab17d229201e6`
**Renderer:** `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js` — 20,927,993 code units
**Stylesheet:** `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.css` — 2,328,581 B, **15,934** non-at-rule rules
**Tool:** REA only (`open_binary` → `inspect_artifact` → `extract_artifact`). All measurements are static analysis of the REA-extracted copy (§13.1).

> **Offset convention:** `@N` = UTF-16 code-unit offset into the named file. CSS offsets index the `.css`; JS offsets index the `.js`.

---

## 0. Verdict in one paragraph

Every one of the seven required surfaces is **identifiable and locatable**: each has a stable DOM id or class, a CSS base rule at a known offset, and a JS call site at a known offset. But **none of them is a CSS-only target**. Each surface is painted by an *opaque* per-theme token (`--layer-background` `#22262b`/`#fff`, `--white-message` `#282d33`/`#fff`, `--blue-message` `#1f344d`/`#e5f1ff`, `--title-bar` `#121416`/`#e5e7eb`) applied across **2–3 nested layers per surface**, so recolouring one element in a devtools edit does not produce glass — it produces a hole revealing the next opaque layer. Glass requires neutralizing the whole nested stack plus its `box-shadow` and `border` declarations. The two structural hazards are `contain` (9 declarations on the message scroll chain, `contain:size style` on `.conv-item`, `contain:strict` on `.message-view__blur`) and `transform:translateZ(0)` (`.transform-gpu`, carried by the live message-list content wrapper). There is **exactly one genuine glass element in the shipped app**: the chat date pill, `.chat-date>span`, which has a semi-transparent `--timestamp` fill *and* `backdrop-filter:blur(10px)` — contrary to R2 §0's blanket denial (corrected in §10). **Correction to R2:** the claim "no core UI surface has a single `backdrop-filter`" is **wrong for this element**; it is right for the other ten surfaces.

---

## 1. Evidence base and its granularity limit

### 1.1 What the bundle does and does not expose

| Fact | Value | Evidence |
|---|---|---|
| React version | **16.14.0** | `_r3_final.txt` |
| Module bodies | every one is a `FunctionExpression` bound to a **1–2 letter identifier** | `_r3_modules9.txt`, `unit=?` on every row |
| `sourcemaps/` | ships **empty** | artifact inventory |
| Bundle-declared component names | **14** `data-component` attribute sites; enum `DataAttributes.Component` @`1,721,786` = `ai-sticker, bubble-message, MESSAGE_CONTENT_VIEW, MESSAGE_TEXT_CONTENT, PHOTO, PHOTO_STICKER, STICKER, text-container, RTF_CONTAINER, RTF_BLOCK` | `_r3_bubble.txt` |
| Class components | 362 `render(){` — class components dominate | `_r3_final.txt` |
| State layer | **local React only**: `configureStore(` 0, `useSelector` 0, `useDispatch` 0, `zustand` 0, `mobx` 0. `useState(` 544, `createContext` 60, `useReducer` 24 | `_r3_final.txt` |
| DI container | `ModuleContainer` 2,160 occ, `resolve(` 2,591, `registerModule` 7 | `_r3_final.txt` |

**Consequence, stated plainly:** module attribution in this report is **module-level, not component-level**. `+ISi@85954` means "the anonymous function bound to the identifier `+ISi`, whose definition begins at offset 85,954". It does **not** mean a component was named. Per the standing constraint *"Không tự suy đoán tên component khi bundle không cung cấp đủ bằng chứng"*, this report never invents a component name. Where the bundle does supply a name (`id`, `className`, `data-component`, `ModalIdentitiesDefine` keys, `dataId`), that name is quoted verbatim.

### 1.2 Per-surface census

From `_r3_diag.txt`, strict parse:

| surface | rules | vars | backdrop | shadow | radius | semi-bg | opaque-bg |
|---|---:|---:|---:|---:|---:|---:|---:|
| titlebar | 68 | 18 | 0 | 0 | 2 | 0 | 10 |
| nav (buttons) | 13 | 4 | 0 | 0 | 0 | 0 | 1 |
| conversation list | 126 | 27 | 0 | 1 | 3 | 0 | 16 |
| chat header | 16 | 7 | 0 | 1 | 2 | 0 | 2 |
| message row | 212 | 34 | 0 | 7 | 5 | 0 | 59 |
| bubble | 23 | 6 | 0 | 0 | 1 | 0 | 1 |
| date divider | 20 | 4 | **2** | 0 | 3 | 0 | 1 |
| composer | 146 | 23 | 0 | 2 | 15 | 0 | 20 |
| context menu | 67 | 20 | 0 | 2 | 4 | 0 | 12 |
| modal | 116 | 19 | 0 | 0 | 7 | 0 | 18 |
| settings | 117 | 21 | 0 | 0 | 11 | 0 | 15 |

`semi-bg` counts `rgba`/`hsla`/`transparent` fills declared *directly on the surface selector*. The column is 0 everywhere because the semi-transparent fills live one level deeper (on `>span`, `>div`, or via `var(--timestamp)`).

---

## 2. Page shell (precondition for all seven surfaces)

**Module:** `B` @`12,282,960` — returns the whole three-column skeleton. Verbatim (`_r3_shell2.txt`):

```js
function B(e){return r.a.createElement("nav",{id:"sidebarNav",...className:e.className},
  r.a.createElement("div",{id:"main-tab",...className:"nav__tabs flx flx-col flx-sp-btw WIN32"}, r.a.createElement(h.a,null,e.toolbox)),
  r.a.createElement("div",{className:"flx-cell flx flx-col rel ovf-hidden"+
      (e.compactLv===s.COMPACT_LEVEL.SEMI_COMPACT?" conv-list-semi-compact":"")
      + (e.compactLv===s.COMPACT_LEVEL.COMPACT?" conv-list-compact":""),
      style:{zIndex:5},ref:e=>F.n.setSidePanelRef(e)},
    r.a.createElement(h.a,null,r.a.createElement(k,null)),
    r.a.createElement(h.a,null,e.content)))}
```

**CSS base rules** (`_r3_shellcss.txt`, `_r3_layer8.txt`):

```css
#main-tab   { width:64px; flex:none; box-sizing:border-box; background:var(--layer-background-navbar-normal); position:relative; margin-top:-24px }   /* @269,917 */
#sidebarNav { width:408px; width:var(--nav-width) }                                                                                                  /* @409,527 */
.nav-content{ position:fixed; top:24px; left:64px; z-index:6; box-sizing:border-box; background:var(--layer-background); width:calc(100% - 64px); height:calc(100% - 24px) }  /* @410,911 */
.titlebar   { -webkit-user-select:none; height:24px; min-height:24px; background:var(--title-bar); ...; z-index:2; width:calc(100% - 80px); left:64px }  /* @413,961 */
```

**Tokens:** `--layer-background-navbar-normal` (`#121416` / `#005ae0`), `--title-bar` (`#121416` / `#e5e7eb`), `--layer-background` (`#22262b` / `#fff`), `--nav-width` (408px, set on `body` @246,309).

**Zero-rule probes** — these must be read as negatives, not as misses:
`.main`, `.main__left`, `.main__right`, `.conv-list-panel`, `.sidebarNav`, `.nav__tabs`, `.main__toolbar` → **0 rules**. `.main__center` has one rule only: `transition:width .25s;transition-timing-function:step-end` @246,748.

**Structural note:** the shell is a fixed-position stack — `#main-tab` 64px column, `.nav-content` fixed at `left:64px; top:24px`, `.titlebar` 24px strip. `z-index` is already in play at 5 (`conv-list` wrapper) and 6 (`.nav-content`) and 2 (`.titlebar`), plus `#main-tab` at `position:relative` with no z-index. A glass shell increases the number of overlapping translucent layers from **0 to ≥4**.

**CSS-only feasibility: NO** — for appearance shifting only. There is exactly one background declaration per column; recolouring is trivial, glass is not (no place to sample from — see §9).

---

## 3. Sidebar / navigation

**Module:** the nav toolbox items are rendered by `B`'s `h.a` wrapper @`12,282,960`; the class module is `Zb+t@12278564` (`_r3_modules9.txt`), which also owns the id inventory `sidebarNav, main-tab, todo-tab, kiki-sidebar-menu, conv-skeleton, chatStar, filter-tags-sb, contact-search, contact-search-input, conversationList, conversationListId, …`.

Sidebar tabs, verbatim (`_r3_shell2.txt`):

```js
r.a.createElement(Y,{key:d.SidebarTab.MESSAGE_TAB, name:..., isActive, onClick, onDoubleClick,
  icon:Dn, titleKey:"STR_TAB_MESSAGE", unreadCount:t.count, dataId:"div_Main_TabMsg"})
const Dn = { active:"Message_28_Filled", normal:"Message_28_Line" };
r.a.createElement(Y,{key:d.SidebarTab.SETTING_SHORTCUT, icon:Sn, titleKey:"STR_MENU_SETTING", dataId:"div_Main_TabSetting"})
```

Other tab ids present: `div_Main_TabStar`, `div_Main_TabTool`, `div_Main_Tab_zCloud`, `div_Main_TabScreenshot`.

**CSS:** `.nav-button_add_group{font-size:1.5rem;top:-4px}` @294,642; `.nav-button_add_friend{top:-6px}` @295,927; `.conv-back-btn{margin-right:8px;margin-left:-2px}` @410,029. `#main-tab` is the only element in the shell that carries a **brand-coloured** background (`#005ae0` in light mode).

**State boundary:** `SidebarTab` is an enum on a shared module `d`; `isActive` and `unreadCount` are props. Active/inactive icon is a **prop switch between two icon names**, not a CSS class toggle — so an icon appearance change is not reachable by CSS at all.

**CSS-only feasibility: PARTIAL** — background and radius of `#main-tab` are reachable (1 declaration each), but the active-tab indicator is a JS prop swap between `Message_28_Filled` / `Message_28_Line` and the unread badge is a rendered count. Any glass treatment that depends on hover/active state must reproduce the JS state machine.

**Risk: MEDIUM.** `.nav-content` is `position:fixed` at `left:64px`; a `backdrop-filter` here would sample the page behind a *fixed* element — workable, but `z-index:6` means it also covers the conv list. `#main-tab` has `margin-top:-24px`, i.e. it deliberately overlaps the titlebar strip.

---

## 4. Conversation list

**Modules:** container `Zb+t@12278564`; virtualized row renderer `Br`, which sets `rowCount, height, width, rowHeight:_getItemHeight, rowRenderer:_renderRow, cellRangeRenderer:_cellRangeRenderer, overscanRowCount:5, estimatedRowSize:CONVERSATION_ITEM_HEIGHT` and `onRowsRendered({startIndex,stopIndex}){ Lr.a.getInstance().setScope(e,t) }`. `AutoSizer`, `react-virtualized`, `VariableSizeList` all return **0 occurrences** — the row windowing is in-bundle, not a library import.

Row class composition, verbatim (`_r3_shellcss.txt`):
```js
let e="conv-item conv-rel"; a && (e += " selected"), !!T && (e += " pinned");
```

**CSS base rules** (`_r3_layer3.txt`):
```css
.conv-item { height:calc(100% - 8px); contain:size style; background-color:var(--layer-background); transition:background-color 80ms; cursor:pointer; margin:4px 8px; border-radius:6px; padding:0 8px }   /* @685,776 */
.conv-item:hover   { background:var(--layer-background-hover) }      /* @686,492 */
.conv-item.active  { outline:1.4px dotted var(--BA50); outline-offset:-1px }  /* @687,841 */
.conv      { height:50px; padding:12px 16px 12px 14px; contain:size style; background:var(--layer-background); display:flex; cursor:pointer }  /* @691,244 */
.conv.pinned{ background:var(--layer-background-subtle) }            /* @691,372 */
.conv:hover { background:var(--layer-background-hover) }             /* @691,749 */
.conv-message{ font-size:.875rem; line-height:18px; position:relative; color:var(--text-secondary); left:0 }  /* @692,876 */
#contact-search{ height:64px; min-height:64px; background-color:var(--layer-background); overflow:visible; padding:0 16px }  /* _r3_shellcss.txt */
#contact-search-input{ height:32px; background-color:var(--input-field-bg-filled); ...; border-radius:5px }  /* _r3_renderer_css.txt */
```

**Two parallel row implementations exist** — `.conv-item` (the newer `conv-item conv-rel` path) and `.conv` (the 50px legacy path). Both ship. Any appearance work must cover both, or it will look correct in one list and stale in the other.

**Tokens:** `--layer-background`, `--layer-background-hover`, `--layer-background-subtle`, `--layer-background-selected`, `--layer-background-pinned`, `--input-field-bg-filled`, `--text-primary`, `--text-secondary`, `--BA50`, `--shadow-overflow` (`#conversationListId`).

**State boundary:** five observable states from class strings alone — `selected`, `pinned`, `active` (`outline` only, not a background!), `noti unread-noti`, `new-just-read`. `.conv-item.active` changing only `outline` — not `background` — is the single most surprising fact on this surface: selection is drawn as a dotted outline, so a glass "selected" state has no background to override.

**CSS-only feasibility: PARTIAL.** Backgrounds are reachable per-state, but `contain:size style` on both `.conv-item` and `.conv` is a hard interaction with `backdrop-filter` (see §9).

**Risk: HIGH.** (a) `contain:size style` on every row — `size` containment means the browser must not consider row content for sizing, which is exactly what a backdrop-sampling layer needs to be able to do; (b) rows are virtualized, so a per-row blur would be created and destroyed at scroll boundaries; (c) `--input-field-bg-filled` is on R2's excluded list (61 categorically excluded tokens) — it cannot be retinted through the internal generator.

---

## 5. Chat header

**Module:** `El` @`11,018,306`, inside `VLvn@10707732`, called once @`11,130,781`; returns `<header id="header" className="flx">` with an optional `.conv-back-btn`, then `div.threadChat.rel.flx.flx-1.flx-al-c` wrapping `Js` + `co`, then `fl`, then `_l.b` (`_r3_shell.txt`).

**CSS — the decisive negative:** **`#header` has ZERO rules.** Probe results (`_r3_layer3.txt`, `_r3_layer4.txt`):
```
### #header exact   → (none)
=== selectors that mention #header (any position) ===  → (none)
### .threadChat plain → (none)
```
`#header` is styled **entirely by utility classes** (`flx`, `rel`, `flx-1`, `flx-al-c`):
```css
.flx     { display:flex; flex-flow:row nowrap }   /* @61926, in a 485-part blob; also @121,511 */
.flx-col { flex-flow:column nowrap }              /* @81623 */
.flx-al-c{ align-items:center }                   /* @95862, 339 parts */
.flx-cell{ flex:1 1 auto }                        /* @109641 */
.flx-1   { flex:1 }                               /* @109761 */
.rel     { position:relative }                    /* @80883 */
```
The only real header styling is on `__`-suffixed children (`_r3_layer4.txt`):
```css
.threadChat__title     { position:relative; margin-left:12px; margin-right:18px }                       /* @255,573 */
.threadChat__avatar>.avatar>.avatar-img:before{ box-shadow:inset 0 0 1px var(--BA20); ... }             /* @255,303 */
.threadChat__btn-is-friend{ background-color:var(--background-inactiveness-subtle); border-radius:4px }  /* @255,920 */
.threadChat__mutual-group{ height:21px; cursor:pointer }                                                /* @256,452 */
.threadChat.nocall  { width:calc(100% - 140px) }   /* @255,133 */
.threadChat.group   { width:calc(100% - 210px) }   /* @255,177 */
```
Background declarations on `.threadChat*`: **2** total, both on children (`--background-inactiveness-subtle`, `--layer-background-subtle`). **The header itself is transparent.**

**State boundary:** `.threadChat` width is a **function of call capability and group-ness** (`nocall`, `group`, `group-preview`) — the header's geometry is computed, not fixed.

**CSS-only feasibility: YES for geometry/typography; NO for glass.** Because `#header` declares no background, glass here needs a *new* rule (`#header{background:…;backdrop-filter:…}`), which no existing token supports. Positive: nothing to un-set — no opaque fill, no `contain`, no `transform` on the header itself.

**Risk: LOW–MEDIUM.** Low structural risk (transparent, simple). Medium semantic risk: the header has no `z-index` and no `position` of its own, so a backdrop-filter added to `#header` samples whatever is painted behind it in the chat column — which is the wallpaper layer (§6.1), not a neutral surface.

---

## 6. Message area

This section covers the message row, bubble, date divider, and the wallpaper layer they sit on.

### 6.1 The wallpaper layer (the only existing compositing in Zalo)

**Modules:** `Rd` @`11,093,488`, `Od` @`11,093,957`, `Td` (`bd` blur img) @`11,093,456`.

```js
var Rd = e => { const {convId:t, hideOverlay:n} = e, {theme:a} = Object(yd.i)(), i = Object(o.useMemo)(()=>Object(Sd.a)(),[]),
  r = Object(o.useMemo)(()=> t && null!=i && i[t]
      ? { backgroundImage:`url(${i[t.toString()]})`, backgroundRepeat:"no-repeat",
          backgroundSize:"cover", backgroundPosition:"center" } : {}, [t,i]);
  return l.a.createElement(l.a.Fragment,null,
    l.a.createElement("div",{ className:"message-view__blur__overlay"
        + (n?"_noavatar":"") + (a===yd.e.DARK?" bg__dark-mode":""), style:r })) };

var Od = e => { ... const A = n.startsWith(d.GROUPID_PREFIX), h = !e.avatarUrl || !c;
  return l.a.createElement(l.a.Fragment,null,
    l.a.createElement(Rd, {...e, hideOverlay:h}),
    (A||r) && s!==yd.e.DARK && l.a.createElement(Td,{domId:"messageViewBlur", key:"convBg",
        convId:n, className:"message-view__blur "+(a&&c?"":" hidden"), image:a})) };
```

CSS:
```css
.message-view__blur         { position:absolute; top:0; left:0; right:0; bottom:0; background-color:var(--NG10); z-index:-2; contain:strict }  /* @784,944 */
.message-view__blur__overlay{ position:absolute; width:100%; height:100%; background:hsla(0,2%,90%,.43); z-index:-1; contain:strict }         /* @785,090 */
.message-view__blur__overlay_noavatar { position:absolute; background:var(--layer-background-CSC); z-index:-1 }
```

**Fact:** there is **no wallpaper token**. `--chat-background`, `--conversation-background`, `--cover-image`, `--wallpaper`, `--chat-bg` are all **absent** (0 hits). The wallpaper is an **inline `style` object built in JS from a `convId`-keyed map** (`Sd.a`). Changing the chat background is therefore a **JS/data-layer** action, not a CSS action.

**Fact:** the blur image (`Td`) is **light-mode only** (`s!==yd.e.DARK`) and **group/friend conversations only**; the overlay (`Rd`) is always rendered.

### 6.2 Scroll chain and compositing

```css
.message-view               { flex:1 0 auto; overflow:hidden; position:relative; display:flex; flex-direction:column }  /* @784,624 */
.message-view__scroll       { position:relative; flex:1 0 auto; contain:layout style size; bottom:0 }                    /* @785,367 */
.message-view__scroll__inner{ min-height:100%; display:flex; padding-bottom:28px; flex-direction:column; justify-content:flex-end; contain:layout style }  /* @785,498 */
.transform-gpu              { -webkit-transform:translateZ(0); transform:translateZ(0) }                                 /* _r3_blockers.txt */
```

The live render (`@655,000` / `@655,787`, verbatim):
```js
o.a.createElement(ic,{id:"messageViewContainer",
  className:" message-view__scroll "+(...?"message-view__scroll--shrink":""),
  key:"message-view__scroll", contentContainerClassName:"transform-gpu", ...})
o.a.createElement(Wn,{id:"messageViewScroll", ref:this._handleScrollContainerRef,
  className:Object(u.a)("message-view__scroll__inner","--audit-message-spacing",
      this.isLessSpaceBottom()&&"--less-space","preview-ts "),
  key:"mv__inner_"+this.props.conversation.userId}, ...)
```
and the outer root (`@653,837`): `o.a.createElement("div",{id:"messageView", className:"message-view "+(...), ...})`.

**Fact:** `preview-ts` is appended **unconditionally** on the live scroll inner — it is not an audit mode. Its 5 occurrences in JS are 2 `preview-ts__first-msg` and the single live class list above plus 2 more `__first-msg` sites.

**Fact:** the scroll *content* wrapper is `transform-gpu` → `translateZ(0)`. It is a promoted compositing layer.

### 6.3 Message row — layout only, no paint

```css
.chat-message   { display:flex; user-select:none; justify-content:flex-start; align-items:flex-start; position:relative; color:var(--text-primary) }  /* @700,120 */
.chat-message.me{ justify-content:flex-end }   /* _r3_renderer_css.txt */
```
**Fact:** `.chat-message` (212 rules) declares **no background, no border, no shadow, no radius**. It is a flex row. Everything visible is the child `.card`. This is the single most important structural fact for anyone reasoning about "message bubbles" from the class name — `.chat-message` is *not* the bubble.

### 6.4 Bubble — `.card`

**Module:** the class string is composed at `@1,088,030`; `card--text` is appended at `@1,094,059`, `@1,094,313`, `@1,098,218`.

```js
let V = "card " + (Object(Ee.a)().ENABLE_REACTION_V2 ? "card-with-reaction-v2 " : ""),
    H = ("0"==y.fromUid ? " me " : "") + (j ? " pin-react " : "") + (G ? " card-has-react " : "")
      + (this.props.isLast || y.status==u.MSG_FAIL ? " last-msg" : "")
      + (this.props.shouldShowStatus ? " has-status " : "")
      + (this.props.senderName && P && "0"!=y.fromUid && this.props.isFirst ? " sho… 
```

**CSS base rule** (`_r3_bubble3.txt`):
```css
.audio-expired, .card { position:relative; display:block; padding:12px; border-radius:8px; background:var(--white-message); color:var(--text-primary) }  /* @722,335 */
.card.me, .me.audio-expired              { background-color:var(--blue-message) }                                  /* @722,553 */
.card--text.audio-expired:not(.me), .card.card--text:not(.me) { background-color:var(--white-message) }           /* @728,631 */
.card--text.audio-expired, .card.card--text { user-select:text; min-width:40px; max-width:calc(100% - 38px) }     /* @728,528 */
.card.card--file, .card.card--link, .card.card--location, .card.card--sound, .card.card--text, …  { box-shadow:var(--shadow-bubble) }  /* @117,901, 14 parts */
.card.first-msg                          { contain:layout style }                                                /* @724,067 */
.card.admin                              { border:1px solid var(--border-highlight) }                            /* @727,902 */
.card.size-video                         { width:64% }                                                           /* @727,976 */
.card.bubble-preview                     { width:25rem }                                                        /* @723,368 */
.msg-footer { padding:0 12px; margin-top:8px; border-radius:0 0 8px 8px; background:var(--WA100); border-top:1px solid var(--border); position:relative }  /* @912,166 */
.msg-footer.from-me { background-color:var(--NG10) }
```

Census: **36** `.card` rules, **15** `.card--text` rules, **7** distinct vars (`--shadow-bubble` ×3, `--border-focused`, `--layer-background`, `--white-message`, `--text-primary`, `--blue-message`, `--border-highlight`).

Resolved values (first = `:root .dark` @13,665, second = `:root,:root .light` @43,288):
```
--white-message #282d33 / #fff          --blue-message #1f344d / #e5f1ff
--blue-message-selected #111e2c / #c7e0ff
--shadow-bubble 0 0 1px rgba(3,4,4,.5), 0 1px 1px rgba(3,4,4,.5), 0 0 0 1px rgba(188,214,240,.08) inset
              / 0 0 1px rgba(21,39,71,.25), 0 1px 1px rgba(21,39,71,.25)
```

**State boundary:** bubble appearance is a **product of ≥7 independent boolean inputs** composed into a class string in JS (`me`, `pin-react`, `card-has-react`, `last-msg`, `has-status`, `show-sender`, `card--text`/`card--picture`/`card--link`/`card--video`/`card--oa`/`card--file`/`card--sound`/`card--location`, plus `first-msg`, `admin`, `size-video`, `bubble-preview`, `audio-expired`, `multi-select-mode-selected`). Only 4 of those are pure visual state (`me`, `first-msg`, `admin`, selection). The rest are content-type variants where a glass rule would have to be repeated per type — 4 of them carry `contain`.

**CSS-only feasibility: NO.** The bubble's entire visual identity is (opaque fill + `--shadow-bubble` + 8px radius + 12px padding). Making it glass requires overriding `background`, `box-shadow`, and `border-radius` **and** overriding the shadow's `inset … rgba(188,214,240,.08)` hairline. `--shadow-bubble` is one token serving 14 selectors; retinting it is a single-point change, but *replacing* it per-variant is not.

**Risk: HIGH.** `.card.first-msg{contain:layout style}` and `.card--picture…>.chat-message-picture__photooverlay{contain:content}` sit between the wallpaper layer and the text. A `backdrop-filter` on `.card` samples the wallpaper — but the wallpaper is also `contain:strict` at `z-index:-2`, so the sampling chain is: `#messageView` → `translateZ(0)` content → `contain:layout style size` scroll → `contain:layout style` inner → `contain:layout style` card. Four containment boundaries in series.

### 6.5 Date divider — the one real glass element

```css
.chat-date            { color:var(--text-on-color); contain:content; margin:0 60px 16px; display:grid; grid-template-columns:1fr auto 1fr; font-size:.8125rem; position:relative }  /* @695,905 */
.chat-date>span       { background:var(--timestamp); border-radius:10px; padding:2px 10px 3px; z-index:2 }        /* @696,118 */
.chat-date .line      { width:100%; height:0; border-top:1px solid var(--BA20); z-index:0; margin-top:11px }       /* @696,212 */
.preview-ts .block-date>.chat-date>span            { backdrop-filter:blur(10px) }                                 /* @1,499,840 */
.preview-ts.active-scroll .block-date>.chat-date>span { backdrop-filter:blur(10px) }                              /* @1,500,312 */
.preview-ts.active-scroll .block-date>.chat-date.island { position:sticky; top:10px }                             /* @1,500,231 */
```
`--timestamp` = `hsla(0,0%,100%,.05)` (dark) / `rgba(0,0,0,.2)` (light) — **semi-transparent**.
`.block-date` is rendered by `Ls` @`376,225`: `o.a.createElement("div",{ref:t,className:"block-date",key:e.currentKey}, …)`, and registers with the intersection controller via `n.observe(a,{isBlockDate:!0})`.

**Fact:** the date pill is the **only** element in the chat column with a semi-transparent fill *and* a `backdrop-filter`. Both conditions are statically proven: `--timestamp` is `hsla`/`rgba`, and the selector chain `.message-view__scroll__inner.preview-ts … .block-date > .chat-date > span` matches the live class list at `@655,787`.

**Rendered verification: NOT RUN** — static selector-matching only; no live DOM inspection was performed (§13.3).

**CSS-only feasibility: ALREADY GLASS.** This is the one element R4 can study as Zalo's own idiom: `hsla` fill + `blur(10px)` + `border-radius:10px` + a sticky "island" state at `top:10px` with a 7-step z-index ladder.

**Risk: LOW**, with one caveat: `.chat-date{contain:content}` is the parent of the blurred span.

---

## 7. Composer

**Module:** `JFrT@6508381` (from `_r3_modules9.txt`); root call site @`6,543,073` (`div#chatInput.chat-input-container` → `__left-layout` → `chat-input-scrollable` → `chat-input-wrapper` → `chat-input-content` → RTF `Ze.a` or plain `$e.a`; `__right-layout` → `#p.p`).

**CSS base rules** (`_r3_layer3.txt`, `_r3_layer8.txt`):
```css
.chat-input-container        { box-sizing:border-box; width:100%; padding:10px 12px; display:flex; justify-content:flex-end; flex-direction:row; flex-wrap:wrap; gap:4px }  /* @1,616,696 */
.chat-input-container.--rtf-mode { display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden }     /* @1,616,849 */
.chat-input-container.--rtf-mode.--rtf-mini-mode { min-height:177.75px; max-height:177.75px; height:177.75px }   /* @1,617,088 */
.chat-input-container.--simple-normal-mode { flex-direction:row; flex-wrap:nowrap; height:auto!important; max-height:fit-content!important; min-height:fit-content!important }  /* @1,617,989 */
.chat-box-input              { flex:1; position:relative; background:var(--layer-background); border-top:1px solid var(--divider-bold) }  /* @1,608,178 */
.chat-box-input__content     { background-color:var(--layer-background) }                                        /* @1,610,047 */
.chat-box-input__tools       { height:40px; background-color:var(--layer-background); contain:style size }        /* @1,608,295 */
.chat-input-container .chat-input-scrollable { scrollbar-color:var(--BA50) transparent; overflow-y:auto; max-height:123.75px }  /* _r3_shellcss.txt */
```

**Three nested elements all declare `var(--layer-background)`**: `.chat-box-input`, `.chat-box-input__content`, `.chat-box-input__tools`. Overriding one leaves the other two opaque.

**Zero-rule probes:** `.chat-input-wrapper`, `.chat-input-content`, `.chat-input-scrollable`, `.chat-box-input__left`, `.chat-box-input__right`, `#chatInput` → **0 rules each**. These class names exist in the DOM (from the JS at `@6,543,073`) but carry no compiled CSS — they are structural wrappers, or targets for the CUSTOM runtime sheet only.

**Tokens:** `--layer-background`, `--divider-bold`, `--BA50`, plus 15 radius declarations on this surface (the densest radius usage of any surface).

**State boundary:** 5 mutually exclusive layout modes are pure modifier-class toggles — `--rtf-mode`, `--rtf-mini-mode`, `--rtf-expand-mode`, `--simple-normal-mode`, `--switching-rtf-to-normal-mode`. Crucially `.chat-input-container.--rtf-mode.--rtf-mini-mode` **hard-pins height to 177.75px** with `min-height == max-height`. Any glass panel that wants to grow on focus fights that pin.

**CSS-only feasibility: PARTIAL.** Backgrounds are reachable (3 declarations), but the div structure that gives the composer its "panel" look is not separable from the RTF editor's own styles.

**Risk: MEDIUM–HIGH.** `contain:style size` on `.chat-box-input__tools`; the RTF editor (`Ze.a`) is a contenteditable surface whose own subtree is not mapped in this report; three stacked `--layer-background` fills must all be neutralized; and the fixed 177.75px mini-mode height collides with any blur that needs a stable backdrop.

---

## 8. Dialogs and menus

### 8.1 Modal

**Modules:** constants @`3,368,481` (`A="zl-modal"`, `h={Block:`${A}__dialog`, Header:`${A}__dialog__header`, Body:`${A}__dialog-body`, Footer:`${A}__footer ${A}__footer__button-action`}`, `m="zl-dlg"`, `g="zl-fl-dlg"`); renderer `8ky5@3367770` (`.zl-modal`), `eIjl@14308176` (`.zl-modal__dialog`), `/ymA@1255215` (`.zl-modal__dialog-body`). Portal is a `r.forwardRef` defaulting to `document.body`.

```css
.zl-modal              { position:fixed; z-index:100; width:100%; height:100%; background:var(--curtain); top:0; left:0; overflow:hidden; contain:layout }  /* @1,949,657 */
.zl-modal.fullscreen   { background:var(--layer-background) }        /* @1,949,857 */
.zl-modal.dark         { background:var(--curtain-bold) }            /* @1,949,913 */
.zl-modal__dialog      { width:587px; background:var(--layer-background); border:1px solid var(--border); border-radius:4px; contain:layout; max-height:785px; overflow:hidden; will-change:transform }  /* @1,949,959 */
.zl-modal__dialog.fullscreen { height:100vh; width:100vw; max-width:none; background:none; border:none }  /* @1,950,282 */
.zl-modal__dialog.--safari   { transform:translateZ(0); -webkit-transform:translateZ(0) }                 /* @1,950,727 */
.zl-modal__dialog__header { padding:0 8px 0 16px; height:48px; min-height:48px; border-bottom:1px solid var(--divider); align-items:center }  /* @1,950,871 */
.zl-modal__dialog-body    { padding:14px 16px 0; display:flex; flex-flow:column nowrap; overflow-y:auto; overflow-x:hidden }  /* @1,989,917 */
.zl-modal__footer         { z-index:1 }                              /* @1,990,349 */
.zl-dlg                   { position:absolute; inset:0; z-index:13 } /* @2,203,424 */
.zl-fl-dlg                { top:0; left:0; z-index:13; will-change:transform }  /* @2,258,710 */
```

**Fact:** `--curtain` is **already semi-transparent** — `rgba(0,0,0,.6)` dark / `rgba(0,0,0,.55)` light. The scrim is glass; the dialog is not.

**Fact:** `.zl-modal__dialog` carries **both** `contain:layout` **and** `will-change:transform`, plus `overflow:hidden`. `.zl-fl-dlg` also has `will-change:transform`.

**CSS-only feasibility: PARTIAL.** Dialog background/border/radius are 3 declarations on one selector — reachable. But `will-change:transform` promotes the dialog to its own layer, and `overflow:hidden` + `contain:layout` sit on the same element.

**Risk: HIGH.** `will-change:transform` on the exact element that would need `backdrop-filter`; `contain:layout` on the same element; the scrim (`--curtain`) already covers the page at `z-index:100`, so a dialog backdrop would sample the scrim, not the app.

### 8.2 Context menu

**Modules:** body `MEZx@7331013` (`_r3_modules9.txt`), body call site @`7,341,341`; `.zmenu-item` attributed to `+ISi@85954`.

```css
.zmenu-body          { max-width:270px; min-width:140px; margin:-4px -2px }                                       /* @1,859,180 */
.zmenu-body.has-submenu { min-width:184px }                                                                       /* @1,859,241 */
.zmenu-body.content-only { opacity:0; padding:4px 6px }                                                           /* @1,859,281 */
.zmenu-item          { height:36px; min-width:112px; padding:0 10px; display:flex; align-items:center; cursor:pointer; color:var(--text-primary); position:relative; background-color:var(--layer-background); margin:4px 0; border-radius:4px }  /* @1,856,692 */
.zmenu-item.subtitle { color:var(--text-secondary); cursor:default; height:24px }                                 /* @1,856,964 */
.zmenu-separator     { height:1px; background:var(--divider-subtle); margin:4px }                                 /* @1,859,058 */
.popover-v3, .zmenu-body.content-only { position:absolute; background:var(--layer-background); padding:8px; z-index:9999; box-shadow:var(--shadow-overlay) }  /* @301,247 */
.popover-v3, .zmenu-body.content-only { opacity:0; border-radius:8px; border:1px solid var(--border) }            /* @301,407 */
```

**Fact:** `.zmenu-item` declares its own opaque `--layer-background` **inside** an already-opaque `.zmenu-body` — a double fill.

**Fact:** the two `content-only` rules at `@301,247`/`@301,407` set `opacity:0` — menus are hidden by `opacity`, not `display`. `backdrop-filter` on an `opacity:0` element does not render; it becomes visible when a transition sets `opacity:1`.

**CSS-only feasibility: PARTIAL.** Background/border/radius/shadow are each 1–2 declarations. `--shadow-overlay` is a single token.

**Risk: MEDIUM.** `z-index:9999`; `opacity:0` base state; double background fill (`body` + `item`); `.zmenu-item` shares a `+ISi` attribution with `.chat-message` and `.chat-date`, i.e. one module owns menu items *and* message rows — an override aimed at `.zmenu-item` cannot be scoped by module.

### 8.3 Settings

**Module:** root @`8,125,664` (`div#setting.setting.flx` + `.setting-menu` / `.setting-content`, transition groups `tg-slide-in-left` / `tg-slide-in-right`; `e===S.h.THEME && g.a.trackViewDisplaySetting(...)` proves a THEME entry exists). Items attributed to `O7EA@7989310`; inputs to `pg6P@17403058`.

```css
.setting           { font-size:.875rem; color:var(--text-primary); overflow:hidden }                            /* @1,071,784 */
.setting.compact   { background-color:var(--layer-background-subtle) }                                          /* @1,071,935 */
.setting-menu      { width:228px; flex:none; border-right:1px solid var(--divider-bold); background-color:var(--layer-background) }  /* @1,072,220 */
.setting-menu__item{ height:40px; padding:0 8px; color:var(--text-primary); cursor:pointer; display:flex; justify-content:space-between; align-items:center; margin:4px 8px; border-radius:6px }  /* @1,072,595 */
.setting-menu__item:hover    { background-color:var(--layer-background-hover) }                                 /* @1,072,827 */
.setting-menu__item.selected { background-color:var(--layer-background-selected) }                              /* @1,072,900 */
.setting-menu__item.disabled { cursor:not-allowed!important; pointer-events:none; color:var(--text-disabled) }  /* @1,073,074 */
.setting-content   { height:515px }                                                                             /* @1,073,904 */
```
**Zero-rule probe:** `#setting` → **0 rules** (only the class `.setting` is styled).

**Fact:** `.setting-content{height:515px}` is the **only** fixed-height declaration on any R3 surface. The settings pane cannot resize to its content.

**Fact:** a THEME settings screen exists in the renderer. From R1, the only theme DOM mutation it can produce is two `classList.toggle` calls on `<body>`; there is no per-component theme class.

**CSS-only feasibility: PARTIAL.** Menu width/background/border are 1 declaration each; item states are 3 declarations. `--divider-bold` is on R2's excluded list.

**Risk: LOW structurally, MEDIUM semantically.** No `contain`, no `transform`, no `backdrop-filter`. But `height:515px` is hard-pinned and the settings menu is a `flex:none` 228px column — a blurred sidebar behind a fixed-width column is only visible in the 515px of vertical slack.

---

## 9. Consolidated blocker table

From `_r3_blockers.txt` — rules per surface containing each declaration:

```
surface          rules  backdrop willChange contain transform filter isolation zIndex
titlebar            69         0          0       0         1      0         0      4
nav_sidebar         21         0          0       0         0      0         0      1
conv_list          122         0          2       1         3      0         0      1
chat_header         19         0          0       0         0      0         0      0
message_row        113         0          0       0         0      0         0      2
bubble_card         36         0          0       4         0      0         0      1
date_divider        21         2          0       1         0      0         0      6
composer           146         0          0       2         2      0         0      5
zmenu               66         0          0       0         2      0         0      2
modal              116         0          1       3         2      0         0      8
settings            51         0          0       0         0      0         0      0
```

**`filter` and `isolation` are 0 on every surface.** This is the best news in the report: the two CSS properties that most often silently break `backdrop-filter` are not used anywhere in Zalo's core UI.

**`contain` on the message scroll chain — 9 declarations:**
```css
.conv-item                                  { contain:size style }            /* @685,776 */
.chat-message__actionholder                 { contain:strict }
.chat-message__actions                      { contain:layout style }
.card.first-msg                             { contain:layout style }          /* @724,067 */
.card--picture.has-caption > …photooverlay  { contain:content }
.message-view__blur                         { contain:strict }                /* @784,944 */
.message-view__scroll                       { contain:layout style size }     /* @785,367 */
.message-view__scroll__inner                { contain:layout style }          /* @785,498 */
.message-view__scroller__innerScroller      { contain:layout style }
```
plus `.chat-date{contain:content}` @695,905 and `.chat-box-input__tools{contain:style size}` @1,608,295.

**The only transform on the message path:**
```css
.transform-gpu { -webkit-transform:translateZ(0); transform:translateZ(0) }
```
carried by the live scroll content wrapper — one occurrence, at `@655,223`.

**Whole-sheet `backdrop-filter` inventory — exactly 7 declarations:**
```
@1,321,519  .seasonal-item-preview                              blur(2px)
@1,499,840  .preview-ts .block-date>.chat-date>span             blur(10px)
@1,500,312  .preview-ts.active-scroll .block-date>.chat-date>span blur(10px)
@1,668,680  .mvr-thumbplaceholder                               blur(22px)
@1,688,788  .analytic-conv-resources-container                  blur(30px)
@1,691,309  .health-center-analytic-modal                       blur(4px)
@1,692,749  .health-center-tab                                  blur(4px)
```
Non-`backdrop` blurs: `.tiny-thumb.-blur-low/-medium/-high:before{filter:blur(8|16|36px) brightness(1.1)}` (light) / `brightness(.5)` under `.dark`; `.health-center-modal .health-center-modal-background{filter:blur(30px) grayscale(100%);opacity:.2}`.

---

## 10. Correction to R2

R2 §0 states: *"No core UI surface in the shipped app has a single `backdrop-filter`, and none uses a semi-transparent background."*

**Refined, on evidence:**
1. **`backdrop-filter` is NOT zero across core surfaces.** There are 7 declarations; **2 of them apply to the live message list's date pill** (`.preview-ts .block-date>.chat-date>span`, plain and `.active-scroll`), because `preview-ts` is appended unconditionally to `.message-view__scroll__inner` at `@655,787`. The other 5 are non-core (seasonal preview, media placeholder, analytics, health-center).
2. **Semi-transparent fills ARE used on core surfaces**, narrowly: `.chat-date>span{background:var(--timestamp)}` (`hsla(0,0%,100%,.05)` / `rgba(0,0,0,.2)`), `.message-info>div{background:var(--bg-message-info)}`, `.card--picture…photooverlay`, `.zl-modal{background:var(--curtain)}` (`rgba(0,0,0,.6)` / `rgba(0,0,0,.55)`), and `.message-view__blur__overlay{background:hsla(0,2%,90%,.43)}`.
3. **The conclusion R2 drew still holds**: the *composite* glass look (translucent panel + blur + hairline) exists on exactly one element — the date pill. Every other core surface is opaque. R4 still builds glass from zero; it now has one working reference idiom instead of none.

---

## 11. Feasibility summary

| Surface | CSS-only? | Principal blocker | Risk |
|---|---|---|---|
| Page shell | **NO** | no background to sample; `position:fixed` stack; z 2/5/6 | — |
| Sidebar / nav | **PARTIAL** | active icon is a JS prop swap (`_Filled`↔`_Line`) | MEDIUM |
| Conversation list | **PARTIAL** | `contain:size style` per row; 2 parallel row impls | **HIGH** |
| Chat header | **YES (geometry) / NO (glass)** | `#header` has 0 CSS rules; needs a new rule | LOW–MED |
| Message row | NO | `.chat-message` has no paint at all | LOW |
| Bubble | **NO** | opaque `--white-message`/`--blue-message` + `--shadow-bubble` + 4 `contain` | **HIGH** |
| Date divider | **already glass** | — | LOW |
| Composer | **PARTIAL** | 3 stacked `--layer-background`; `contain:style size`; pinned 177.75px | MED–HIGH |
| Context menu | **PARTIAL** | double fill; `opacity:0` base; `z-index:9999` | MEDIUM |
| Modal | **PARTIAL** | `will-change:transform` + `contain:layout` on the dialog itself | **HIGH** |
| Settings | **PARTIAL** | `height:515px` pinned; `--divider-bold` excluded | LOW–MED |

**Aggregate:** **0 of 11 surfaces are CSS-only for a glass appearance.** 2 are partially reachable because they have no paint to fight (header, settings); 9 require neutralizing ≥1 opaque fill that no token can retint to a translucent value while preserving the light/dark contract.

---

## 12. What R4 takes from this

1. **Model the layer stack explicitly.** Zalo's own structure is *surface → content → tool* (`chat-box-input` → `__content` → `__tools`), each with its own fill. R4 must decide once whether glass is one layer or three, because Zalo proves that three stacked opaque fills silently defeat a single override.
2. **Adopt the date-pill idiom as the design reference:** translucent fill + `blur(10px)` + `border-radius:10px` + a sticky "island" state. It is the only glass the shipped app actually ships, and it works under `contain:content`.
3. **Never build a glass surface under `contain:*` or `translateZ(0)`.** R4's own components are unconstrained; keep them that way. Do not copy Zalo's `transform-gpu` scroll wrapper pattern.
4. **State is a class string composed from ≥7 booleans.** R4 should use a typed variant map rather than replicating string concatenation, or state-specific glass will be unreachable for some variants.
5. **`--curtain` is the one token whose value is already what glass wants** (`rgba(0,0,0,.6)`). R4's scrim can start from that ratio.
6. **The wallpaper is data, not CSS.** If R4 wants a blurred backdrop behind the message list, it must own that as a component with a typed image source — Zalo's version is an inline style from a `convId` map, which is unreachable from a stylesheet.

---

## 13. Method, coverage, and limits

### 13.1 Pipeline

| Step | REA call | Result |
|---|---|---|
| 1 | `binary_session` | bound to `Zalo.exe` / `app.asar` |
| 2 | `open_binary` | ASAR opened |
| 3 | `inspect_artifact` | 13,169 artifacts, SHA-256 verified |
| 4 | `extract_artifact` | root `…\rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6`, `containment_verified: true`, `cleanup.verified: true`, `residual_paths: []` |
| 5 | `get_evidence_bundle` | evidence records retained |

Static string analysis of the extracted copy is post-extraction analysis of an artifact REA produced — the same boundary disclosed in R1 §8.2 and R2 §7.1.

### 13.2 Scripts (all in `reports/`)

| Script | Output | Purpose |
|---|---|---|
| `_r3_diag.cjs` | `_r3_diag.txt` | per-surface rule/var/backdrop/shadow/radius/semi-bg census |
| `_r3_shell.cjs` / `_r3_shell2.cjs` | `_r3_shell.txt`, `_r3_shell2.txt` | page shell `B`, sidebar tabs, message-list chain, composer/settings/zmenu/modal roots |
| `_r3_shellcss.cjs` | `_r3_shellcss.txt` | shell + conv-list base CSS |
| `_r3_renderer_css.cjs` | `_r3_renderer_css.txt` | titlebar/search/conv/header/chat-date/composer/zmenu/settings base rules |
| `_r3_bubble.cjs` / `_r3_bubble2.cjs` / `_r3_bubble3.cjs` | `.txt` | bubble identity, `.card` family, token resolution |
| `_r3_blockers.cjs` | `_r3_blockers.txt` | glass-blocker table, `backdrop-filter` inventory, `contain` chain |
| `_r3_layer.cjs` | `_r3_layer.txt` | base-rule isolation (≤3 compound parts) for modal/menu/settings |
| `_r3_layer2.cjs` | `_r3_layer2.txt` | `preview-ts`/`block-date` liveness proof |
| `_r3_layer3.cjs` | `_r3_layer3.txt` | header/composer/menu/conv base rules; `#header` zero-rule proof |
| `_r3_layer4.cjs` | `_r3_layer4.txt` | `.threadChat__*` rules; header transparency proof |
| `_r3_layer5.cjs` | `_r3_layer5.txt` | `html`/`body`/`#app` page-background probe (all negative) |
| `_r3_layer6.cjs` | `_r3_layer6.txt` | wallpaper token probe (0 hits) + `messageView` inline-style probe |
| `_r3_layer7.cjs` | `_r3_layer7.txt` | `Rd`/`Od`/`Td` wallpaper component source |
| `_r3_layer8.cjs` | `_r3_layer8.txt` | remaining base-rule offsets (sidebar, setting, composer tools, modal parts) |
| `_r3_modules9.cjs` | `_r3_modules9.txt` | selector→module attribution, `verified modules = 4713` |
| `_r3_final.cjs` | `_r3_final.txt` | React version, state-layer census, rule total |
| `_r3_header.cjs` / `_r3_bubble.cjs` | `.txt` | disproof tables for common guess-names |

### 13.3 Explicitly NOT RUN / BLOCKED

| Item | Status | Reason |
|---|---|---|
| Computed-style / live DOM verification of any selector | **NOT RUN** | Requires launching and attaching to a live renderer; excluded by the standing no-modify/no-attach constraint |
| Rendered confirmation that the date pill actually blurs | **NOT RUN** | Static selector match only (§6.5) |
| Component names beyond bundle-supplied identifiers | **BLOCKED** | Every module is an anonymous `FunctionExpression`; `sourcemaps/` ships empty |
| Source-file paths per module | **BLOCKED** | `unit=?` for all 4,713 verified modules |
| RTF editor (`Ze.a`) internal structure | **BLOCKED** | Out of R3 scope; contenteditable subtree not mapped |
| Behaviour of the CUSTOM runtime sheet on these surfaces | **BLOCKED** | Requires the hidden internal dashboard (R1 §6.2, R2 §7.4) |

### 13.4 Fact vs inference

**Fact (measured, quoted from offsets):** every CSS declaration, offset, rule count and resolved token value in §2–§9; every JS snippet and call-site offset; the 7 `backdrop-filter` declarations; the 9 `contain` declarations; `#header` = 0 rules; the 5 absent wallpaper tokens; `preview-ts` being unconditional.

**Inference (labelled in place):** all "Risk" ratings are analyst judgement about compositing behaviour under `contain`/`transform`/`will-change`; they are not measured. The claim that a `contain` boundary clips a backdrop sampling chain is a documented CSS behaviour but was **not** verified against a running Zalo renderer in this report. "CSS-only feasibility" ratings describe whether an overseas stylesheet rule *could* produce the appearance; they do not assert that Zalo would honour such a rule at runtime, which is R5's question, not R3's.
