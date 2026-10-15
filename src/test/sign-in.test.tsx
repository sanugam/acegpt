import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInCard } from "@/components/auth/SignInCard";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

function fill() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
}

describe("sign-in recovery path", () => {
  it("submits credentials without a redirect and lets a failed sign-in be corrected", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      error: new Error("Invalid login credentials"),
    });
    render(<SignInCard />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("use Forgot your Ace password");
    expect(screen.getByLabelText("Email")).toHaveValue("test@example.com");
    auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows confirmation instructions when signup requires email verification", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<SignInCard />);
    fireEvent.click(screen.getByRole("button", { name: /New to Ace/ }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("status")).toHaveTextContent("confirmation email");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});

it("offers recovery for Google-linked accounts without requesting a password", async () => {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  render(<SignInCard />);
  fireEvent.click(screen.getByRole("button", { name: "Forgot your Ace password?" }));
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send password reset email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("password-reset link");
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("test@example.com", {
    redirectTo: `${window.location.origin}/account/recovery`,
  });
});
