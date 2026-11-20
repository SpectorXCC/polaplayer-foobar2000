# Verdant Architecture Notes

## Phase 1 Verification: `LOVED` Tag & Local Library Metadata (`foo_uie_jsplitter` / foobar2000 v2 x64)

Verified on a live foobar2000 v2 instance (`verdant-cache/spike_loved_result.txt`, run on `03 Credit Theme.flac` + 16-track local library):

### 1. Tag Write API (`UpdateFileInfoFromJSON`)
- **Host object**: `UpdateFileInfoFromJSON` exists on **`IFbMetadbHandleList`** (`fb.CreateHandleList()`), **not** on `IFbMetadbHandle` (`h.UpdateFileInfoFromJSON === undefined`). `UpdateFileInfoSimple` does not exist in `foo_uie_jsplitter`.
- **Accepted JSON payloads**: Both array syntax (`JSON.stringify([{ LOVED: '1' }])` matching `hl.Count`) and single-object syntax (`JSON.stringify({ LOVED: '1' })`, applied to the list) succeed and write `LOVED="1"` (`GetFileInfo().MetaFind('LOVED') >= 0`).
- **Return value & timing**: Returns `undefined` synchronously and commits asynchronously (~18–132 ms observed).
- **Deleting/clearing a tag**:
  - Passing `""` (empty string) or `[]` (empty array) **removes** the tag completely (`MetaFind('LOVED') === -1`, `infoVals === []`).
  - **Do NOT pass `null`**: `{"LOVED": null}` writes the literal string `"null"` into the tag (`MetaFind('LOVED') >= 0`, `infoVals = ["null"]`).
  - Prefer `""` (`JSON.stringify({ [LOVED_FIELD]: next ? value : '' })`) over single-object `null`.

### 2. TitleFormat Quirk (`"?"` for Missing Unbracketed Fields)
- Evaluating unbracketed `%LOVED%` or `%MOOD%` when a tag is absent returns literal **`"?"`** (`16/16` non-empty `"?"`), **not** `""`.
- **Rule**: All optional TitleFormat fields (`LOVED`, `MOOD`, `added`, `last_modified`, `play_count`, `last_played`, `rating`) **must** be wrapped in square brackets: `[%LOVED%]`, `[%added%]`, etc.
- As an extra safety net, `isLovedValue(v)` should also treat `'?'` (and `""`, `'0'`, `'false'`) as unloved when `LOVED_MATCH` is empty.

### 3. `on_metadb_changed(handles, fromhook)` Behavior
- Every `UpdateFileInfoFromJSON` commit triggers `on_metadb_changed` **once** with `handles.Count === 1`, **`fromhook === false` (`boolean`)**, after the updated tag is already readable via TitleFormat (`tfLOVED="1"` or `""`).
- Because `fromhook` is `false`, production `on_metadb_changed` must track recently self-written track paths (`lovedSelfWrite[path]`, e.g. 2–3 s window) and update `lovedSet` in place without running `invalidateItems()` / clearing `songsIdx`.

### 4. Local Library Date / Play-Count Fields (Stock foobar2000 vs `foo_playcount`)
- `%last_modified%` (`[%last_modified%]`): reliably present (`16/16`, format `"2024-09-27 21:01:31"`, lexicographically sortable).
- `[%added%]`, `[%play_count%]`, `[%last_played%]`: empty (`0/16`) when `foo_playcount` is not installed.
- **Implication for `source_local.js` & `stats.js`**:
  - `newest` albums tab must use `$if2(%added%,%last_modified%)`.
  - `recent` and `frequent` depend on `stats.js` (with optional one-time import if `[%play_count%]` / `[%last_played%]` are non-empty) and gracefully fall back when no play history exists yet.

### 5. Pending Edge-Case Check (`[C]`)
- The initial `[C]` run targeted a writable local `.flac`; read-only files, `.cue` subsongs, and `navidrome://` stream handles remain unverified on live host and can be checked directly with `[C]` in `scripts/spike_loved.js` (and `03 Credit Theme.flac` can have its test `LOVED="1"` tag removed via `[D] Remove LOVED Tag` or foobar2000 Properties).
