import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { encodeWithWorkerTimeout } from "../lib/photo-pipeline.js";
import { PhotoCapture } from "./PhotoCapture.js";

// createImageBitmap/OffscreenCanvas/Worker don't exist under jsdom — the
// real pipeline and the GAP-17 worker-timeout race are covered separately
// in photo-pipeline.test.ts, so this mocks the boundary rather than
// reaching either.
vi.mock("../lib/photo-pipeline.js", () => ({
  encodeWithWorkerTimeout: vi.fn((_file: File) =>
    Promise.resolve({ blob: new Blob(["fake"], { type: "image/jpeg" }), flagged: false }),
  ),
}));

const mockedEncodeWithWorkerTimeout = vi.mocked(encodeWithWorkerTimeout);

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

test("a flagged photo (still over the size cap after every quality pass, or the no-2D-context fallback) shows a warning badge", async () => {
  mockedEncodeWithWorkerTimeout.mockResolvedValueOnce({
    blob: new Blob(["fake"], { type: "image/jpeg" }),
    flagged: true,
  });
  const user = userEvent.setup();
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={vi.fn()} />);

  await user.upload(screen.getByLabelText("Front file input"), makeFile());

  await waitFor(() =>
    expect(screen.getByTitle("Larger than usual — may take longer to upload")).toBeInTheDocument(),
  );
});

test("an ordinary, in-budget photo shows no warning badge", async () => {
  const user = userEvent.setup();
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={vi.fn()} />);

  await user.upload(screen.getByLabelText("Front file input"), makeFile());

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retake front photo" })).toBeInTheDocument(),
  );
  expect(
    screen.queryByTitle("Larger than usual — may take longer to upload"),
  ).not.toBeInTheDocument();
});

// M-30: `capture="environment"` was skipping the OS picker's own choice
// between camera and photo library on many mobile browsers — no product
// reason requires a live-only photo, so the attribute must stay off both
// inputs.
test("M-30 — neither the named-slot nor the Add-tile file input forces the camera; the OS picker offers gallery too", () => {
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={vi.fn()} />);
  expect(screen.getByLabelText("Front file input")).not.toHaveAttribute("capture");

  render(<PhotoCapture onCapture={vi.fn()} />);
  expect(screen.getByLabelText("Add a photo file input")).not.toHaveAttribute("capture");
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

// Finding C: previously an unhandled rejection left the tile spinning
// forever and onCapture never fired.
test("a decode failure shows a local error instead of spinning forever, and lets the user try again", async () => {
  mockedEncodeWithWorkerTimeout.mockRejectedValueOnce(new Error("createImageBitmap failed"));
  const user = userEvent.setup();
  const onCapture = vi.fn();
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={onCapture} />);

  await user.upload(screen.getByLabelText("Front file input"), makeFile());

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument(),
  );
  expect(onCapture).not.toHaveBeenCalled();
  // Still offering to capture — not stuck mid-encode, and distinct from the
  // caller-driven "Retry" affordance above (there is no blob to re-upload).
  expect(screen.getByRole("button", { name: "Capture front photo" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

// A7's plan, finding C item 4: the no-2D-context fallback in photo-pipeline
// can hand back the original file untouched, in a format the server
// allowlist rejects (HEIC, for one) — caught here, before onCapture ever
// fires, rather than as a background upload failure with no sheet left.
test("a content type outside the server's allowlist is caught before onCapture fires", async () => {
  mockedEncodeWithWorkerTimeout.mockResolvedValueOnce({
    blob: new Blob(["fake"], { type: "image/heic" }),
    flagged: true,
  });
  const user = userEvent.setup();
  const onCapture = vi.fn();
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={onCapture} />);

  await user.upload(screen.getByLabelText("Front file input"), makeFile());

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument(),
  );
  expect(onCapture).not.toHaveBeenCalled();
});

test("retaking a slot's photo revokes the previous object URL", async () => {
  const user = userEvent.setup();
  const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  render(<PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={vi.fn()} />);

  await user.upload(screen.getByLabelText("Front file input"), makeFile());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retake front photo" })).toBeInTheDocument(),
  );
  expect(revokeSpy).not.toHaveBeenCalled();

  await user.upload(screen.getByLabelText("Front file input"), makeFile());
  await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith("blob:mock-url"));

  revokeSpy.mockRestore();
});

test("unmounting revokes every object URL still live", async () => {
  const user = userEvent.setup();
  const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const { unmount } = render(
    <PhotoCapture slots={[{ key: "front", label: "Front" }]} onCapture={vi.fn()} />,
  );

  await user.upload(screen.getByLabelText("Front file input"), makeFile());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retake front photo" })).toBeInTheDocument(),
  );

  unmount();
  expect(revokeSpy).toHaveBeenCalledWith("blob:mock-url");

  revokeSpy.mockRestore();
});
