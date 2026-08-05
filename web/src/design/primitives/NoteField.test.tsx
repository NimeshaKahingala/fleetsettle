import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { NoteField } from "./NoteField.js";

test("reports every keystroke and starts as one line", () => {
  render(<NoteField value="" onChange={vi.fn()} />);
  const textarea = screen.getByLabelText("Note");
  expect(textarea).toHaveAttribute("rows", "1");
});

test("two NoteFields on the same page don't collide on id", () => {
  render(
    <>
      <NoteField label="Note" value="" onChange={vi.fn()} />
      <NoteField label="Reason" value="" onChange={vi.fn()} />
    </>,
  );
  const note = screen.getByLabelText("Note");
  const reason = screen.getByLabelText("Reason");
  expect(note.id).not.toBe(reason.id);
});

test("reports changes via onChange", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<NoteField value="" onChange={onChange} />);
  await user.type(screen.getByLabelText("Note"), "x");
  expect(onChange).toHaveBeenCalledWith("x");
});
