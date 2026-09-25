# LangTrainer — Courses

A **course** (a `Program` in the code) is one complete learning package: a target language, a level, a set of modules
with topics, and phrase sets of everyday expressions. Every exercise in the app comes from a course, and you can have
several installed side by side — the Learn screen's course card opens a switcher that changes which one you are
learning right now.

There are two kinds of course:

- **bundled** — authored in this repository, built into the app and shipped with it. Everyone who installs the app gets
  it. `Português europeu A1` is one.
- **imported** — a single JSON file you put on the device yourself. It is stored in the browser database, travels with
  your backup, and can be removed again. Nobody else sees it.

## Adding a course

### 1. Bundled: author it in the repo and rebuild

1. Create `content/<programId>/` with `program.json`, `modules/*.json` and `topics/*.json` (see
   [`content-authoring.md`](./content-authoring.md) for the layout and the authoring rules).
2. `npm run content:check -- --program <programId>` — validates the structure and every content rule.
3. `npm run content:build -- --program <programId>` — a course not yet bundled is written to
   `dist-courses/<programId>.json`. The first time, move that file to `src/content/programs/<programId>.json` and add
   it to the list in `src/content/programs/index.ts`; from then on the build writes there directly.
4. Commit and push; the deploy makes it available to every install of the app.

### 2. Imported: a JSON file on the phone

1. Build the course file with `npm run content:build -- --program <programId>` (writes `dist-courses/<programId>.json`,
   exactly the right shape) or get it from someone else.
2. On the phone, open **Settings → Library → Courses → Import course**, or tap the course card on the Learn screen and choose
   **Import a course from file…**.
3. Pick the `.json` file. The app checks it before saving anything:
   - it must be valid JSON under 10 MB;
   - it must match the `Program` shape;
   - it must pass the same content rules as `npm run content:check`;
   - its id must not be the id of a bundled course (those cannot be replaced);
   - its topic and phrase-set ids must not already be used by another installed course.
4. If anything is wrong, a sheet lists the first ten problems with their paths and a **Copy all** button, and nothing is
   saved. On success the course is installed and becomes the active one.

An imported course can be exported again (**Library → the course header → Export course file**) and removed
(**Remove course**, which asks whether your progress for it should go too).

## File format

The file is a `Program` object, exactly as defined in [`src/content/types.ts`](../src/content/types.ts) and produced by
`scripts/content-build.ts`. A leading `"$generated"` marker key (which the build adds) is ignored, so a built file can be
imported as it is. The authoring rules for the contents — exercise types, sizes, difficulty mix — are in
[`content-authoring.md`](./content-authoring.md).

## Id conventions

Ids matter, because progress is keyed by them.

- `program.id` — lowercase, dash-separated, language plus level: `pt-PT-A1`, `en-b2`, `es-a2`. It identifies the course
  in settings, in `sessions.programId` and in `topicProgress.programId`.
- Module ids — `m1`, `m2`, … inside a course.
- **Topic ids — `<programId>-<moduleId>-<slug>`, e.g. `en-b2-m1-collocations`.** Topic and phrase-set ids must be unique
  across _all installed courses_, not just within one course, because a topic id is the primary key of the progress
  table. The import flow rejects a file that reuses an id from another installed course. Prefixing every topic id with
  the program id is the simplest way to be safe.
- Phrase-set ids — same rule: `en-b2-everyday-1`.
- Exercise ids — `<topicId>-01`, `<topicId>-02`, … (two digits, enforced by the content rules).

## `supportLanguage` and `targetLanguage`

- `targetLanguage` is the language being learned: the answers, the tiles, the phrases.
- `supportLanguage` is the language of the _scaffolding_: prompts, explanations, key-item translations and
  `match_pairs.support`. It is the language the learner already knows.

For `pt-PT-A1` that is `targetLanguage: 'pt-PT'`, `supportLanguage: 'en'`. A course can have both the same (an English
B2 vocabulary course for English speakers is `targetLanguage: 'en'`, `supportLanguage: 'en'`); then exercise types that
normally translate are authored as paraphrase → word instead. Note that `supportLanguage` is a property of the course
content and is independent of the app's UI language, which the learner sets in Settings.

## Progress is kept per course

- `topicProgress` rows carry a `programId`, and the Learn screen, session planning and the progress views all filter by
  the active course. Switching courses therefore never mixes two courses' progress or SRS schedules.
- A session in progress belongs to the course it was planned from. Switching courses does not discard it: the Resume
  card names the course it belongs to, and resuming continues in that course. The _next_ new session uses the active
  course.
- Removing an imported course keeps its progress by default, so re-importing it later picks up where you left off.
  Tick "Also delete my progress for this course" in the remove sheet to drop it as well.

## Replacing a course with a new version

Importing a file whose `program.id` matches a course you already imported asks _Replace course «…»? Your progress is
kept._ — the course content is swapped, and every progress row stays where it is.

That works because progress is keyed by **topic id**. So when you publish a new version of a course:

- **keep the topic ids stable** for topics that are the same topic, even if you rewrite their title, context or
  exercises;
- use new ids only for genuinely new topics;
- removing a topic leaves an orphan progress row behind; it is ignored (the Learn screen counts only topics that exist
  in the course), and re-adding the id later picks the old progress back up.

Exercise ids inside a topic may change freely; they only affect which exercises count as "already seen", and unknown
ids in `seenExerciseIds` are simply never matched again.
