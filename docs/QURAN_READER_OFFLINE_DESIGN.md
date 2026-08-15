# Offline Qur'an Reader — design record

**Status:** design and foundation in progress. Nothing here describes a shipped feature.
**Opened:** 2026-08-15

This record exists because the offline Reader crosses three separate permission boundaries that are
easy to blur, and because an earlier audit blurred one of them. It states the boundaries first and
the design second, so a future change has to argue against the boundary rather than around it.

---

## 1. The correction this record opens with

An audit dated 2026-08-15 concluded that Quran Foundation publishes no Content Sync API and that
re-reading `list_verse_recitations` was the only available interpretation of the C7 obligation.

**That conclusion was wrong.** Content Sync is documented, versioned and published. The audit
searched the Content API's endpoint categories and the quickstart; Content Sync is documented as its
own tutorial pair and its own two versioned endpoints, and was missed. The superseded text is
retained, marked, in `QURAN_FOUNDATION_AUDIO_PERMISSION.md` §9.1 — history is not rewritten, but it
is no longer allowed to read as current.

A second, related error appeared in the same audit: it treated the Dhikr permission's Arabic
retention clause as if it covered the whole Qur'an. It does not. See §2.

---

## 2. The three retention boundaries

| Content | Permission | Retention | Mechanism |
|---|---|---|---|
| Sudais recitation audio, **resource 3** | Express written permission | Beyond seven days | Content Sync every seven **connected** days |
| Translation **85**, M.A.S. Abdel Haleem | Developer Terms | Beyond seven days **only** through Content Sync | Content Sync every seven connected days, all changes applied, translator shown |
| Arabic Qur'an text, **whole Reader** | Developer Terms, ordinary caching rule | **Seven days maximum** | Re-fetch. No broader permission is confirmed |
| Arabic Qur'an text, **curated Dhikr verses** | Separate written permission | Beyond seven days | Refresh through the Content API |

### 2.1 The Reader's Arabic is not the Dhikr catalogue's Arabic

The Dhikr permission covers a small, curated, scholarly-reviewed set of verses backing one selector.
Reading it as authority to hold all 6,236 ayat offline indefinitely is a generalisation the grant
does not make, and this file exists partly to stop that generalisation being made again.

**Consequence for the design, stated once:** a downloaded surah's Arabic is valid offline for seven
days from the moment it was stored. After that, with no connectivity, NoorLife **may not present it
as current Qur'an text**. The audio is a different matter — it has its own permission — so what
remains available is an **audio-only downloaded-surah surface** that plays the recitation using the
surah/ayah identity in the audio manifest, and says plainly that the text needs a connection.

That asymmetry is not a compromise. It is the two permissions being different, honoured separately.

---

## 3. Content Sync — the contract NoorLife builds against

Quoted from the vendor's versioned documentation, not inferred.

| | |
|---|---|
| Origin | `https://apis.quran.foundation/content` |
| Sync | `GET /api/v4/resources/sync` |
| Snapshot | `GET /content/api/v4/resources/snapshots/{resource_group}/{resource_id}` |
| Groups | `translations`, `tafsirs`, `recitations`, `articles` |
| Auth | `x-auth-token`, `x-client-id` — server-side only, never on a device |

Sync parameters: `bootstrap`, `sync_token`, `resources`, `per_page` (max 100), `cursor`.

Response envelope:

```
sync.sync_until_sequence   sync.has_more   sync.next_page_url   sync.next_sync_token
sync.mutations[] = { sequence, type, resource_group, resource_id, record_type, record_key,
                     changed_at, data, snapshot_url, unavailable_reason }
```

Mutation types: `RESOURCE_CREATE`, `RESOURCE_UPDATE`, `RESOURCE_INVALIDATE`, `RESOURCE_DELETE`,
`ROW_CREATE`, `ROW_UPDATE`, `ROW_DELETE`.

### 3.1 Client rules taken from the vendor, not chosen here

- Bootstrap is a call with no token; paginate with `next_page_url` while `has_more` is true.
  *"Do not build the cursor yourself."*
- `next_sync_token` appears only on the final page and may be persisted **only after that page has
  been processed**. Each token is bound to its canonical filter.
- A rejected or stale token is recovered by bootstrapping again.
- `RESOURCE_CREATE` / `RESOURCE_INVALIDATE` → fetch the snapshot, replace all local rows.
  `RESOURCE_UPDATE` is a freshness marker only. `RESOURCE_DELETE` removes the resource.
  `ROW_CREATE` inserts or replaces; `ROW_UPDATE` replaces; `ROW_DELETE` deletes.

### 3.2 The one identity that is not yet verified

The documentation does not say whether a `recitations` resource id in Content Sync is an
**ayah-recitation** id or a **chapter-reciter** id.

NoorLife's grant names resource **3** in the ayah-recitation space. That much is confirmed against
the live API through NoorLife's own function: `/resources/recitations` returns
`id 3 = Abdur-Rahman as-Sudais`, and it is the same id space that `/recitations/{id}/by_chapter/{n}`
takes — the endpoint that actually serves the ayah audio being downloaded.

Whether `recitations:3` in a canonical filter selects that same resource is **not assumed**. The
first bootstrap resolves it by checking that the returned `resource_group` is `recitations`, the
`resource_id` is 3, and the rows carry ayah identity. Until that has run against the live API, the
extended-retention exemption stays unmet and no claim is made either way.

---

## 4. Storage — two stores, never one

| | Prepared playback cache | Intentional download store |
|---|---|---|
| Purpose | prefetch, playlist preparation, temporary listening | user-chosen surahs, future complete recitation |
| Location | cache directory | private persistent app directory |
| Lifetime | evictable by the OS and by the byte budget | removed only by the user, by a sync deletion, by integrity failure, by migration, or by uninstall |
| Budget | `MAX_PREPARED_BYTES` | not subject to the prefetch budget |
| Visible to MediaStore | no | no |

The two must never resolve to the same directory. A user's deliberate download living in a directory
the operating system may purge is the defect this split exists to prevent, and it is asserted by a
test rather than left to the reading of a path constant.

---

## 5. What is not decided here

- The complete-recitation download size. The 1.9 GiB figure in an earlier report was extrapolated
  from 38 files by Arabic character count and is **not** reliable enough to show a user. A real
  figure comes from sync/snapshot metadata or from validated headers; until then any number shown
  must be labelled an estimate.
- The complete-Qur'an downloader itself, which is proposed and not built.
