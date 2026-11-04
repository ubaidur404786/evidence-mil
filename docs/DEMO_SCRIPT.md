# Demo video script (60–90 s, no voice needed — captions)

Goal: a viewer who knows nothing about AI understands *why the model decided*.

| Time | Screen | Caption |
|---|---|---|
| 0–5 s | Title card + one sample image | "A huge image. Is something wrong inside it?" |
| 5–15 s | Step 1–2: image, then grid slices it into patches | "Cut it into small patches." |
| 15–25 s | Step 3: patches light up one by one, points appear on a map | "A pretrained vision model reads each patch." |
| 25–40 s | Step 4: heatmap fades over the image, score appears | "A small model decides which patches matter." |
| 40–55 s | Step 5: top patches, bars add up to the score, what-if slider drops the score | "The score is the sum of these patches. Remove them and it falls." |
| 55–70 s | Step 6: report types in, verifier ticks each number, human clicks Approve | "Every number is checked. A person signs off." |
| 70–85 s | Pull back: architecture grid, repo link | "Open source. Built end to end." |

Rules: use the real app (replay mode), one take per step, show a case where the model abstains once.
Honesty line on screen at the end: "Decision-support demo, not a medical device."
