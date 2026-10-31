# Nib — 3-4 minute submission demo

## Setup

In a fresh environment, start the app following the README. The demo uses `DEMO_MODE=true` with paid AI OFF. Do not overwrite an existing `.env`. Open the dashboard and the OBS URL, then click "Pause demo chat" to stop the automatic sample messages.

Make it clear that the conversation demo uses local sample replies. Do not present them as real model output.

## 0:00 — The star and the stream screen

"This is Nib, an original pixel-art character who lives in the corner of the stream. Nib turns comments into little games, and even evolves its form with the mood of chat."

Send `GG 💖` and `!jump` to show eating and hopping. Wait 2-3 seconds for each reaction to finish.

## 0:30 — Six forms and evolution

In the Chat Pulse demo, pick Calm → Hype → Angry and show each wind-up, light, transformation and landing.

"On a live stream, the last 60 seconds are tallied locally every minute. Without enough messages and participants, Nib keeps its previous form. The demo replays simulated history so we can compare them quickly."

Explain that Activity Spike is an example of message volume, not a button that adds an emotion. Open the six-form comparison and evolution replay pages if needed.

## 1:10 — Back-and-forth conversation

In "Talk with Nib", select Viewer A.

1. "Talk to Nib": Nib picks up the snack comment and replies.
2. When the bubble finishes, click "Reply": Nib's next line responds to `!answer Let's split them half and half!`.
3. Add another comment as the same Viewer A: the conversation continues, including the actual previous line.

"These are local sample replies with no API, for testing display and state handling. Live, only selected candidates go to the generative AI, and the current evolution form drives the personality instructions."

You can also show that the same comment sent in a different form changes the speaking style and emote.

## 2:00 — Answers change what happens next

Click "Ask about topic" to ask for a score. Answer 30 as A and 100 as B, then close the window: Nib reacts using the average of 65.

Next, click "Poll about topic". Pick 1 as A and 2 as B, and show that A voting again doesn't add a vote and that the tie result shows up in Nib's line. If a personal question is already open, reply or close it before starting.

"This isn't random monologue — it's a viewer → Nib → viewer → Nib loop. Tallies are finalized on the server, and the AI never changes vote counts."

## 3:00 — OBS and operations

Show the transparent overlay. The whole background is transparent; only the character, speech, answer card and graph appear.

"AI can be switched ON/OFF independently; normal actions and the minute emotion check keep running locally. The budget ledger survives restarts. Memory and familiarity also have OFF and deletion."

If time is short, show only the question or only the poll and keep the whole demo to about 3 minutes.

## Showing it on real Twitch

Set `DEMO_MODE=false` and a channel in `.env`, then start. Post `!jump` from real chat to show live intake. Evolution needs 5+ classifiable comments from 2+ people within 60 seconds. To show paid AI generation, configure the key, model and budget and explicitly turn on live replies.

Real Twitch intake and jumping from posts are confirmed. Describe real model quality and latency, and capture in the OBS desktop app itself, according to what you have actually verified.
