# LinkedIn post draft

AI models can score a huge image, but a score alone doesn't tell you *why*.

I built EvidenceMIL, an open-source tool that shows its evidence:
• cuts a large image into patches, and a frozen vision model reads each one
• a small "additive" model gives one score, and that score is exactly the sum of the patch contributions
• a dashboard replays every step and highlights the patches that decided the result
• an agent drafts a report, a verifier checks every number against the evidence, and a person signs off
• when the model is unsure, it abstains instead of guessing

First use case: breast-cancer lymph-node slides (CAMELYON16). The engine works on any large image.
Stack: PyTorch · LangGraph · FastAPI · React/TypeScript · Docker · Kubernetes · GitHub Actions.

Demo video ↓ · Code: <repo link>
Decision-support demo, not a medical device.

#MachineLearning #ExplainableAI #ComputationalPathology #MLOps
