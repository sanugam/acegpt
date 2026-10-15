import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
import { PasswordRecovery } from "@/routes/account.recovery";
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/account/recovery");
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
it("does not offer a password change to visitors without a recovery link", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<PasswordRecovery />);
  expect(await screen.findByRole("alert")).toHaveTextContent("latest password-reset link");
  expect(screen.queryByLabelText("New Ace password")).not.toBeInTheDocument();
  expect(auth.updateUser).not.toHaveBeenCalled();
});
it("checks matching passwords before saving the recovery user's new password", async () => {
  window.history.replaceState({}, "", "/account/recovery#type=recovery");
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  render(<PasswordRecovery />);
  fireEvent.change(await screen.findByLabelText("New Ace password"), {
    target: { value: "new-test-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new Ace password"), {
    target: { value: "different-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("don't match");
  expect(auth.updateUser).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Confirm new Ace password"), {
    target: { value: "new-test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  await waitFor(() =>
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-test-password" }),
  );
  expect(await screen.findByText("Your Ace password is ready")).toBeInTheDocument();
});
