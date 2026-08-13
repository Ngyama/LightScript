# LightScript

<p align="center">
  [<a href="../README.md">简体中文</a>]
  [<a href="./README.en.md">English</a>]
  [<a href="./README.ja-JP.md">日本語</a>]
</p>

A local-first desktop editor for light novels, visual novels, and scripts (Windows · Tauri 2).

> **UI language:** the application UI is currently **Simplified Chinese only**. English and Japanese READMEs document the product; they do not imply a localized UI yet.

Manuscripts are stored in folders designated by the user. LightScript does not upload writing content to its own servers. An optional **cloud mirror** folder (for example Google Drive) may be bound for infrequent cross-device synchronization.

## Download & install

1. Open [Releases](https://github.com/Ngyama/LightScript/releases) and download the latest Windows installer.
2. After installation, launch **LightScript** from the Start menu.
3. On first launch, select a **local library** folder on local disk (do not place the active library directly inside a Google Drive directory).
4. For multi-device use, bind a **cloud mirror** folder in Settings, then use the title-bar **Sync** action to push and pull.

Unsigned installers may trigger Windows SmartScreen; this is expected for invite builds. Confirm the source before continuing. In-app update checks are performed via GitHub Releases.

## Privacy

| Behavior | Detail |
|----------|--------|
| Writing content | Retained only in the local library and in any cloud mirror the user explicitly synchronizes |
| Network | Limited to checking and downloading application updates (GitHub); no telemetry and no AI upload of manuscript text |
| Google Drive and similar | If folders reside in a cloud-client path, synchronization is performed by that client, not by LightScript telemetry |

## Content model

**Project → Script → Scene**

- On disk: `project.json` (catalog and characters) + `scripts/<id>/scenes/<id>.json` (scene bodies)
- Snapshots are stored under `.lightscript/backups/` within the project (not synchronized to the cloud by default)
- Last-opened Script / Scene is recorded in app-local settings, not in the project folder
- Restoring a **Scene** backup writes the body back and, if it was removed from the catalog, re-attaches it to the matching Script (creating a Script entry if needed). **Save as copy** writes an extra file only and does not add it to the project structure.
- Deleting a Script / Scene asks for confirmation. Bodies are removed from the project; checkpoints may remain under `.lightscript/backups`.
- With auto-sync on leave enabled, LightScript tries to finish saving before push. Failures (conflict, offline, etc.) surface an error instead of failing silently.
- Snapshot policy: unchanged content is never re-snapshotted just because time passed; equal-length rewrites can still take an idle checkpoint after about three minutes.

## Synchronization guidance

1. The **local library** is the sole workspace (autosave, undo, and snapshots apply here).
2. The **cloud mirror** is an optional replica; do not point the active local library at a Drive folder that is under continuous sync.
3. Recommended flow: complete editing on device A, then **Sync to cloud**; on device B, **Pull from cloud** before continuing.
4. When local and cloud versions diverge, Sync offers **Use cloud (overwrite local)** or **Keep local (overwrite cloud)** (or Cancel). **Keep both** applies only to the separate dialog shown when files change on disk outside the app—not to cloud-mirror Sync itself.
5. **Before pull**, LightScript checks that the cloud project is complete and openable (`project.json` plus every declared scene file, parseable). Incomplete or corrupt mirrors are rejected so a bad copy cannot overwrite a good local tree.
6. Transfers write scene bodies before `project.json`, then verify fingerprints. A failed verification is **not** recorded as a successful sync. An interrupted transfer may still leave a partial tree; treat the local library as source of truth and sync again.

## Writing UI & block interactions

The editor layout comprises: a Script / Scene orbit on the left, a character bar and scene metadata above, a flowing block stream in the center, and character / line counts at the bottom-right.

A Scene body is a sequence of blocks. Each block is **either** narrative **or** dialogue; types cannot be mixed within a single block. Enter switches type or inserts the next block:

| Type | Role | Appearance |
|------|------|------------|
| **Narrative** | Description, action, narration | Plain prose |
| **Dialogue** | Spoken lines | Wrapped in `「」`; speaker indicator in **Character dialogue** mode |

Two **writing modes** are available in Settings:

- **Character dialogue**: dialogue blocks display a speaker; Tab opens the speaker menu.
- **Quote style**: dialogue blocks are not bound to characters and do not show a speaker; Enter on an empty block still toggles narrative / dialogue; lines continue to use `「」`.

### Enter: type switching and new blocks

Behavior depends on whether the block is empty and on caret position.

**Enter in a narrative block**

1. **The block is empty** (whitespace only) → **convert the block to dialogue** (insert empty `「」`, place the caret inside). No new block is created.
2. **The block contains text and the caret is mid-block** → **split into two narrative blocks** at the caret.
3. **The block contains text and the caret is at the end** → **insert a new empty narrative** below.

**Enter in a dialogue block**

1. **The block is treated as empty** (whitespace, or scaffold `「」` only) → **convert the block to narrative** (clear the scaffold).
2. **The block contains substantive dialogue** → **insert a new dialogue** below (also with `「」`).  
   - Character dialogue mode: the next speaker is assigned automatically when possible; if the Scene has at least two characters and none can be inferred, the speaker menu opens.  
   - Quote style: the new dialogue has no character binding.

In summary: Enter on an empty block **toggles type**; Enter at the end of a non-empty block **creates another block of the same type**; Enter mid-narrative **splits** the block.

### Backspace: removing empty blocks

- On an **empty narrative**, or an **empty dialogue** (including scaffold-only `「」`), Backspace **deletes the block** and moves focus to the end of the previous block.
- A Scene always retains at least one block; deletion is refused when only one remains.

### Arrow keys

- ↑ on the **first visual line** of a block moves to the previous block, preserving horizontal caret position when possible.
- ↓ on the **last visual line** moves to the next block under the same rule.

### Tab (Character dialogue mode only)

- With focus in a dialogue block, **Tab** opens the speaker menu (especially useful when the Scene has at least two characters).
- Navigate with the arrow keys and Enter; Esc or Tab again closes the menu.
- In Quote style, Tab is not used as the speaker shortcut.

### Undo and other controls

- **Ctrl+Z / Ctrl+Y**: undo / redo for the current Scene (including coalesced typing, paste, block deletion, and type changes).
- Title bar actions: **Import**, **Export**, **Sync**, **Backup & Recovery**, **Library**, **Settings**.
- Global characters are managed in the top character bar; dialogues reference project-level characters.

## Development

```bash
npm install
npm run tauri:dev
npm test
npm run tauri:build
```

Release: push a `v*` tag. CI runs `tsc` and `npm test` before building a draft release.

## License

[MIT](../LICENSE)
