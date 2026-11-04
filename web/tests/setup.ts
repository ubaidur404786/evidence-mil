import "@testing-library/jest-dom/vitest";

// jsdom has no canvas; the viewer skips drawing when getContext returns null.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
