import { describe, expect, it, vi } from "vitest";

import {
  cancelPendingRestoreAndScrollToBottom,
  shouldAutoLoadOlderMessages,
  scrollContainerToBottom
} from "../../src/components/dashboard/ai-builder/PlanPreview";

describe("scrollContainerToBottom", () => {
  it("uses direct scrollTop assignment when scrollTo is available", () => {
    const scrollTo = vi.fn();
    const container = {
      scrollHeight: 960,
      scrollTop: 120,
      scrollTo
    };

    scrollContainerToBottom(container);

    expect(scrollTo).not.toHaveBeenCalled();
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
    expect(scrollTo).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(720);
  });
});

describe("shouldAutoLoadOlderMessages", () => {
  it("returns true when user is at top and older messages are available", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 32,
        generating: false,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false,
        suppressAutoLoad: false
      })
    ).toBe(true);
  });

  it("returns true at the top-threshold boundary", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 64,
        generating: false,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false,
        suppressAutoLoad: false
      })
    ).toBe(true);
  });

  it("returns false while older messages are already loading", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        generating: false,
        hasOlderMessages: true,
        loadingOlderMessages: true,
        pendingScrollRestore: false,
        suppressAutoLoad: false
      })
    ).toBe(false);
  });

  it("returns false while pending restore is active", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        generating: false,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: true,
        suppressAutoLoad: false
      })
    ).toBe(false);
  });

  it("returns false while auto-load is temporarily suppressed", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        generating: false,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false,
        suppressAutoLoad: true
      })
    ).toBe(false);
  });

  it("returns false when user is not near the top", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 128,
        generating: false,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false,
        suppressAutoLoad: false
      })
    ).toBe(false);
  });

  it("returns false when there are no older messages", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        generating: false,
        hasOlderMessages: false,
        loadingOlderMessages: false,
        pendingScrollRestore: false,
        suppressAutoLoad: false
      })
    ).toBe(false);
  });

  it("returns false while the assistant is generating", () => {
    expect(
      shouldAutoLoadOlderMessages({
        scrollTop: 0,
        generating: true,
        hasOlderMessages: true,
        loadingOlderMessages: false,
        pendingScrollRestore: false,
        suppressAutoLoad: false
      })
    ).toBe(false);
  });
});
