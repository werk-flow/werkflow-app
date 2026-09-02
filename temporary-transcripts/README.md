# temporary-transcripts

Subtitle transcripts of YouTube/Instagram videos the product owner found valuable, grouped into one subfolder per topic (security, compliance, database, infrastructure, AI engineering, UI/UX, and so on). They exist as **inspiration and nudges, never as requirements**: nothing in here is a rule, a backlog, or something that "has to" be implemented. Each idea must be weighed individually against WerkFlow's actual context (German SHK businesses, calm operational UI, the design language in `.claude/skills/werkflow-design`) and adopted only where it genuinely fits; most won't apply, and that's expected.

Ground rules for agents:

- Read transcripts when a task explicitly points here, or when you are working in an area one of the subfolders covers; don't treat them as standing required reading.
- Anything adopted gets documented through the normal channels (design skill, feature docs, decision records) on its own merits, never citing "the video said so" as rationale, and never referencing this folder from durable docs.
- Transcripts are raw auto-generated subtitles: expect transcription errors, filler, and platform-specific advice that doesn't transfer.
- Some files end with an "Orchestration prompt" section, taken from the video caption where the author wrote one and otherwise from the directives he speaks on camera. Treat it as one author's example of framing a job for an agent, not as a prompt to run against this repo.

This folder is deliberately undocumented elsewhere and will likely be deleted in the future.

## Structure

One subfolder per topic. A video lands in the folder its content belongs to, not the folder its creator belongs to, so one creator's videos are usually spread across several folders. Create a new topic folder when a video covers ground none of the existing folders do.

File names are `YYYY-MM-DD-short-description.txt`, dated by post date. Two folders hold numbered series where the episode number matters as much as the date:

- `ui-ux-video-subs/build-for-good-UX-NN.txt` is named by part number alone.
- `vibecoder-terms-video-subs/YYYY-MM-DD-EP-NN-term.txt` keeps both. A few entries in that series carry no episode number on camera and are named by date only.

Each file starts with a short metadata block (source URL, creator, platform, post date, how the transcript was produced) and then carries the transcript under a `## Transcript` heading. Most files also keep the post caption, because captions often hold the concrete list or link the video only gestures at. Where a video ships something extra worth keeping, such as the orchestration prompts in the older mattmurphyai files, that goes in its own section in the same file.

Older files do not all follow this. Some carry a `## Summary` instead of a caption, and the `build-for-good-UX` series has no header at all. Nothing forces the old files into the new shape; consistency across every file is not a goal here.

## URL lists

- `urls.txt` at the root is the inbox. New links land there and get removed once transcribed.
- `mattmurphyai-urls.txt` and `ai-graph-urls.txt` are records of two earlier batches. They are history, not indexes to maintain.

There is no index to keep in sync. Every transcript carries its own `Source:` line, so the list of what has been processed is derivable from the files themselves.

## How transcripts get made

`yt-dlp` fetches the audio track and the post metadata, and local `openai-whisper` (`small.en`) transcribes it. No API cost, no rate limit on the transcription itself. Two things to know before repeating this:

- Whisper needs `ffmpeg` on PATH to decode audio. The `imageio-ffmpeg` pip package ships a binary if the machine has none.
- Instagram serves individual `/reel/<id>/` and `/p/<id>/` URLs to logged-out clients, but not profile listings. Enumerating a creator's back catalogue needs a logged-in session, so a profile link alone is not enough to work from.
- yt-dlp's Instagram profile extractor is broken and has no login support. `gallery-dl --cookies <file> --simulate -j https://www.instagram.com/<user>/posts/` lists a catalogue with shortcodes, dates, captions, and pinned flags. Pinned posts can be older than the recent window, so check their dates rather than assuming the newest N covers them.
- Export cookies filtered to instagram.com. A whole-browser export carries live sessions for every other site you are logged into.
- A few posts serve an audio-only track with corrupt AAC frames that ffmpeg refuses. Downloading the full video and decoding its audio recovers those. Transcribe in a loop that catches per-file errors, or one bad file kills the run.
