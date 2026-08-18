# Faith module — missing approved assets

Recorded rather than substituted. Where an approved pictogram does not exist, the
screen keeps a restrained vector and this file says so; nothing is generated in
code to fill the gap.

## Missing

| Surface | Needed | Current | Why not substituted |
|---|---|---|---|
| Upcoming / Ramadan card (Faith Home) | A Ramadan or observance pictogram | `crescent` vector, gold | The approved `faith-submenu-pngs` set has eight entries and none is a Ramadan mark. Borrowing `08-calendar.png` would make the Upcoming card and the Islamic Calendar card beside it visually identical, which is worse than a vector. |

## Present and in use

All eight `faith-submenu-pngs` finals are installed at
`assets/images/modules/faith/submenu/` and registered in
`src/features/faith/faith-submenu-assets.ts`.

## Deliberately kept as vectors

These are functional controls, not feature identities. They are small, several
carry state, and they must stay crisp at 13–22 dp — a generated PNG could do
none of that.

- Back, Help, Profile chevron
- Continue-Quran play / pause (two states)
- Daily Ayah share
- Search, close, bookmark
- Worship completion circles (dynamic state)
- Qibla dial arrow (rotates with the live bearing)
- Hero clock glyph inside the "View Prayer Times" button
