import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownContent } from "../src/ui/MarkdownContent";

describe("MarkdownContent", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {}),
      },
    });
  });

  it("shows a copy action for long inline code", async () => {
    render(<MarkdownContent content={"邀请码 `nomi://instance-invite?v=1&key=abc&url=http://127.0.0.1:8766`"} />);

    const wrapper = screen.getByText(/nomi:\/\/instance-invite/).closest(".markdown-inline-code");
    expect(wrapper).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(wrapper as HTMLElement).getByRole("button", { name: "复制代码" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "nomi://instance-invite?v=1&key=abc&url=http://127.0.0.1:8766",
    );
  });
});
