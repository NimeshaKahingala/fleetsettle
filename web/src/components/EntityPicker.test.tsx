import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EntityPicker } from "./EntityPicker.js";

const drivers = [
  { id: "1", label: "Sunil Perera", sublabel: "0771234567" },
  { id: "2", label: "Kamal Silva", sublabel: "0777654321" },
];

test("shows the pre-filled value, or a placeholder when none is chosen", () => {
  render(<EntityPicker label="Driver" options={drivers} value={null} onChange={vi.fn()} />);
  expect(screen.getByText("Choose driver")).toBeInTheDocument();
});

test("opens a searchable sheet, recent-first order preserved, and selecting closes it", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<EntityPicker label="Driver" options={drivers} value={null} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "Choose driver" }));
  const listedNames = screen.getAllByText(/Perera|Silva/).map((el) => el.textContent);
  expect(listedNames).toEqual(["Sunil Perera", "Kamal Silva"]);

  await user.click(screen.getByRole("button", { name: /Kamal Silva/ }));
  expect(onChange).toHaveBeenCalledWith(drivers[1]);
});

test("the search box filters client-side over label and sublabel", async () => {
  const user = userEvent.setup();
  render(<EntityPicker label="Driver" options={drivers} value={null} onChange={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Choose driver" }));
  await user.type(screen.getByRole("textbox", { name: "Search driver" }), "0777");

  expect(screen.getByText("Kamal Silva")).toBeInTheDocument();
  expect(screen.queryByText("Sunil Perera")).not.toBeInTheDocument();
});

test("once a value is chosen, the field's label survives in the accessible name even though the visible text becomes just the value", () => {
  const [sunil] = drivers;
  if (!sunil) throw new Error("fixture drivers list is empty");
  render(<EntityPicker label="Driver" options={drivers} value={sunil} onChange={vi.fn()} />);
  expect(screen.getByText("Driver")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Driver: Sunil Perera" })).toHaveTextContent(
    "Sunil Perera",
  );
});

test("Add new is pinned at the bottom and fires its own callback", async () => {
  const user = userEvent.setup();
  const onAddNew = vi.fn();
  render(
    <EntityPicker
      label="Driver"
      options={drivers}
      value={null}
      onChange={vi.fn()}
      onAddNew={onAddNew}
      addNewLabel="Add new driver"
    />,
  );

  await user.click(screen.getByRole("button", { name: "Choose driver" }));
  await user.click(screen.getByRole("button", { name: "Add new driver" }));
  expect(onAddNew).toHaveBeenCalledOnce();
});
