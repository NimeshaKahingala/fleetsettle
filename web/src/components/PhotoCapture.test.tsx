import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PhotoCapture } from "./PhotoCapture.js";

// createImageBitmap/OffscreenCanvas don't exist under jsdom — the real
// pipeline is covered separately in photo-pipeline.test.ts, so this mocks
// the boundary rather than reaching the canvas.
vi.mock("../lib/photo-pipeline.js", () => ({
  downscaleAndEncode: vi.fn((_file: File) =>
    Promise.resolve({ blob: new Blob(["fake"], { type: "image/jpeg" }), flagged: false }),
  ),
}));

function makeFile(): File {
  return new File(["fake"], "front.jpg", { type: "image/jpeg" });
}

test("named-slot mode renders exactly the given slots, no free-add tile", () => {
  render(
    <PhotoCapture
      slots={[
        { key: "front", label: "Front" },
        { key: "back", label: "Back" },
      ]}
      onCapture={vi.fn()}
    />,
  );

  expect(screen.getByText("Front")).toBeInTheDocument();
  expect(screen.getByText("Back")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add a photo" })).not.toBeInTheDocument();
});

test("capturing a slot's photo runs it through the pipeline and reports it via onCapture", async () => {
  const user = userEvent.setup();
  const onCapture = vi.fn();
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={onCapture} />);

  const input = screen.getByLabelText("Front file input");
  await user.upload(input, makeFile());

  await waitFor(() => expect(onCapture).toHaveBeenCalled());
  const [key, photo] = onCapture.mock.calls[0] as [
    string,
    { blob: Blob; url: string; flagged: boolean },
  ];
  expect(key).toBe("front");
  expect(photo.flagged).toBe(false);
  expect(photo.url).toBe("blob:mock-url");

  // A captured slot's action becomes "retake", not "capture" again.
  expect(screen.getByRole("button", { name: "Retake front photo" })).toBeInTheDocument();
});

test("free-grid mode has an Add tile, and each capture grows the grid with a new key", async () => {
  const user = userEvent.setup();
  const onCapture = vi.fn();
  render(<PhotoCapture onCapture={onCapture} />);

  const addInput = screen.getByLabelText("Add a photo file input");
  await user.upload(addInput, makeFile());

  await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
  // The Add tile is still there for the next photo.
  expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
});

test("an upload error shows a retry affordance the caller drives", async () => {
  const user = userEvent.setup();
  const onRetryUpload = vi.fn();
  render(
    <PhotoCapture
      slots={[{ key: "front", label: "Front" }]}
      onCapture={vi.fn()}
      uploadStatus={{ front: "error" }}
      onRetryUpload={onRetryUpload}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetryUpload).toHaveBeenCalledWith("front");
});
