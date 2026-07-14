import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyButton } from "./CopyButton.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CopyButton", () => {
  test("copies the text and flips the tooltip to Copied!", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<CopyButton text="keyline login" />);
    const btn = screen.getByLabelText("copy keyline login");
    expect(btn.getAttribute("data-tip")).toBe("Copy");
    fireEvent.click(btn);

    await waitFor(() => expect(btn.getAttribute("data-tip")).toBe("Copied!"));
    expect(btn.className).toContain("copied");
    expect(writeText).toHaveBeenCalledWith("keyline login");
  });

  test("stays quiet when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) },
    });
    render(<CopyButton text="x" />);
    const btn = screen.getByLabelText("copy x");
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 20));
    expect(btn.getAttribute("data-tip")).toBe("Copy");
  });
});
