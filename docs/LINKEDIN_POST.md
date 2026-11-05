# LinkedIn post (with the pipeline video)

Can an AI show its evidence before we trust it with a cancer diagnosis? 🔬

When doctors look for breast-cancer spread in a lymph node, one slide image can be 100,000 × 200,000 pixels. The tumour might be a few hundred cells hidden somewhere inside it.

Most AI tools give back one number: "Tumour: 97%."
But WHERE is it? And WHY does the model think so?

So I built EvidenceMIL, a system that opens the model like a book. 📖

Most people know Multiple Instance Learning (MIL) from time series. It works just as well on medical images:
🧩 The huge image becomes a "bag" of thousands of small patches
🏷️ The model only needs to know "this slide has a tumour", not where
🎯 It then works out by itself WHICH patches carry the evidence

Here's what you see in the video, step by step:
1️⃣ Input: a real lymph-node slide (CAMELYON16)
2️⃣ Patches: cut into 3,000 tissue tiles, background removed
3️⃣ Embeddings: a frozen pathology model (Phikon) turns each tile into 768 numbers
4️⃣ Patch scores: every tile gets its own score (tumour or normal)
5️⃣ Slide score: the final answer is EXACTLY the sum of those scores
6️⃣ Explanation: the heatmap IS the score, mapped back onto the slide
7️⃣ Report: every number is checked against the evidence, then a human signs off

No hidden step. You can click any patch and see why it counted.

What came out of it, on real slides:
✅ Slide accuracy (AUROC) 0.911 on the 130-slide CAMELYON16 test set, close to the 2016 challenge winner (0.925), which needed pathologists to draw every tumour outline by hand
✅ On average, 95% of its top-5 patches fall inside the pathologist's tumour outline (chance: about 4%)
✅ When it is unsure, it says "I don't know" and refers the case, instead of guessing

How else do people find tumours in these images?
🔹 U-Net segmentation: very precise, but needs pixel-level outlines drawn by experts
🔹 Patch classifiers (the CAMELYON16 winners): also need hand-drawn outlines
🔹 Attention MIL (ABMIL, CLAM, TransMIL): only slide labels, but attention shows where the model looked, not how much each patch pushed the answer
🔹 Grad-CAM heatmaps: explanations added after the fact
🔹 Pathology foundation models (UNI, Phikon, Virchow): strong features that any of these methods can use

My goal wasn't to beat them. It was to show that a complex problem can have a simple, open solution that anyone can follow in a few minutes.

⚠️ This is a research and demo prototype, not a medical device.

I'd love your view:
👉 Would you trust an AI diagnosis more if you could see the exact evidence behind it?
👉 Pathologists and ML folks: in real clinical use, what matters more, accuracy or explainability?

🔗 Live demo and code: link in the first comment 👇

#MachineLearning #MedicalImaging #ExplainableAI #DeepLearning #ComputationalPathology #MultipleInstanceLearning #AIinHealthcare #ComputerVision

---

## First comment (post it right after the post)

🔗 Try it yourself, no install: https://ubaidur404786.github.io/evidence-mil/
💻 Code, results and setup guide: https://github.com/ubaidur404786/evidence-mil
Want to analyse your own image? The "Upload image" button in the demo explains how to run it on your machine with Docker.
