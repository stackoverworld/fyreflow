import { describe, expect, it, vi } from "vitest";

import {
  cancelPendingRestoreAndScrollToBottom,
  shouldAutoLoadOlderMessages,
  scrollContainerToBottom
} from "../../src/components/dashboard/ai-builder/PlanPreview";

describe("scrollContainerToBottom", () => {
  it("scrolls to the bottom immediately and still uses smooth scrolling when available", () => {
    const scrollTo = vi.fn();
    const container = {
      scrollHeight: 960,
      scrollTop: 120,
      scrollTo
    };

    scrollContainerToBottom(container);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 960, behavior: "smooth" });
    expect(container.scrollTop).toBe(960);
  });

  it("falls back to direct scrollTop assignment when scrollTo is unavailable", () => {
    const container = {
      scrollHeight: 540,
      scrollTop: 42
    };

    scrollContainerToBottom(container);

    expect(container.scrollTop).toBe(540);
  });

  it("cancels pending restore before scrolling to bottom", () => {
    const scrollTo = vi.fn();
    const container = {
      scrollHeight: 720,
      scrollTop: 24,
      scrollTo
    };
    const pendingRestoreRef = { current: true };

    cancelPendingRestoreAndScrollToBottom(container, pendingRestoreRef);

    expect(pendingRestoreRef.current).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 720, behavior: "smooth" });
  });
});

describe("shouldAutoLoadOlderMessages", () => {
  it("returns true when user is at top and older messages are available", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 32,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false
      })
    ).toBe(true);
  });

  it("returns true at the top-threshold boundary", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 64,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false
      })
    ).toBe(true);
  });

  it("returns false while older messages are already loading", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        hasOlderMessages: true,
        loadingOlderMessages: true,
        pendingScrollRestore: false
      })
    ).toBe(false);
  });

  it("returns false while pending restore is active", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: true
      })
    ).toBe(false);
  });

  it("returns false when user is not near the top", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 128,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false
      })
    ).toBe(false);
  });

  it("returns false when there are no older messages", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        hasOlderMessages: false,
        loadingOlderMessages: false,
        pendingScrollRestore: false
      })
    ).toBe(false);
  });
});
