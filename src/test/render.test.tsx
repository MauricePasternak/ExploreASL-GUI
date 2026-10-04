import { Transition } from "@mantine/core";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithMantine } from "./render";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("opens and closes real Mantine transitions without scheduling animation callbacks", () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  const onEntered = vi.fn();
  const onExited = vi.fn();

  function ToggleTransition() {
    const [opened, setOpened] = useState(false);
    return (
      <>
        <button data-testid="toggle-transition" onClick={() => setOpened(!opened)}>
          Toggle
        </button>
        <Transition
          mounted={opened}
          duration={150}
          keepMounted
          onEntered={onEntered}
          onExited={onExited}
        >
          {(style) => (
            <div data-testid="transition-content" style={style}>
              Content
            </div>
          )}
        </Transition>
      </>
    );
  }

  renderWithMantine(<ToggleTransition />);
  expect(vi.getTimerCount()).toBe(0);
  for (const opened of [true, false, true]) {
    fireEvent.click(screen.getByTestId("toggle-transition"));
    expect(screen.getByTestId("transition-content").style.display).toBe(opened ? "" : "none");
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(onEntered).toHaveBeenCalledTimes(2);
  expect(onExited).toHaveBeenCalledOnce();
  cleanup();
  // Check before restoring real timers: switching clocks must not conceal leaked callbacks.
  expect(vi.getTimerCount()).toBe(0);
});
