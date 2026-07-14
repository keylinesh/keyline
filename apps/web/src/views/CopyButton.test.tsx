import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyButton } from "./CopyButton.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CopyButton", () => {
  test("copies the text and confirms", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<CopyButton text="keyline login" />);
    fireEvent.click(screen.getByText("copy"));

    await waitFor(() => expect(screen.getByText("copied ✓")).toBeDefined());
    expect(writeText).toHaveBeenCalledWith("keyline login");
  });

  test("stays quiet when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) },
    });
    render(<CopyButton text="x" />);
    fireEvent.click(screen.getByText("copy"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("copy")).toBeDefined();
  });
});
