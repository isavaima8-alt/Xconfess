import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock useTheme before importing the component
jest.mock("@/app/lib/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", setTheme: jest.fn() }),
}));

// Mock the toast hook
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/app/components/common/Toast", () => ({
  useGlobalToast: () => mockToast,
}));
jest.mock("@/app/lib/api/admin", () => ({
  adminApi: {
    requestStepUp: jest.fn().mockResolvedValue({
      stepUpToken: "fresh-step-up-proof",
      expiresIn: 300,
    }),
  },
}));

import PrivacySettingsPage from "@/app/(dashboard)/settings/privacy/page";
import { adminApi } from "@/app/lib/api/admin";

const defaultSettings = {
  isDiscoverable: true,
  canReceiveReplies: true,
  showReactions: true,
  dataProcessingConsent: false,
};

function mockFetch(settings = defaultSettings) {
  return jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (opts?.method === "PATCH") {
      const body = JSON.parse(opts.body as string);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      });
    }

    // GET
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(settings),
    });
  });
}

async function confirmStepUp(user: ReturnType<typeof userEvent.setup>) {
  const passwordInput = screen.getByLabelText("Account password");
  await user.click(passwordInput);
  await user.type(passwordInput, "Current!Pass1");
  expect(passwordInput).toHaveValue("Current!Pass1");
  await user.click(screen.getByRole("button", { name: "Verify" }));
}

describe("PrivacySettingsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch() as unknown as typeof fetch;
  });

  it("renders all four privacy toggle controls", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    expect(screen.getByText("Allow Replies")).toBeInTheDocument();
    expect(screen.getByText("Show Reactions")).toBeInTheDocument();
    expect(screen.getByText("Data Processing Consent")).toBeInTheDocument();
  });

  it("shows the effect description for each toggle", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    expect(
      screen.getByText(/hidden from search results/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reply button is disabled/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reaction counts and buttons are hidden/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/excluded from analytics/),
    ).toBeInTheDocument();
  });

  it("loads settings from the API on mount", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/users/privacy-settings",
        expect.objectContaining({ credentials: "include" }),
      );
    });
  });

  it("renders toggle switches with correct initial state", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    const switches = screen.getAllByRole("switch");
    // isDiscoverable=true, canReceiveReplies=true, showReactions=true, dataProcessingConsent=false
    expect(switches[0]).toHaveAttribute("aria-checked", "true");
    expect(switches[1]).toHaveAttribute("aria-checked", "true");
    expect(switches[2]).toHaveAttribute("aria-checked", "true");
    expect(switches[3]).toHaveAttribute("aria-checked", "false");
  });

  it("toggles a setting and enables the save button", async () => {
    const user = userEvent.setup();
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: /save privacy settings/i });
    // Save should be disabled initially (no changes)
    expect(saveButton).toBeDisabled();

    // Click the first toggle to disable discovery
    const discoveryToggle = screen.getAllByRole("switch")[0];
    await user.click(discoveryToggle);

    expect(discoveryToggle).toHaveAttribute("aria-checked", "false");
    // Save button should now be enabled
    expect(saveButton).toBeEnabled();
    // Unsaved changes text should appear
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });

  it("saves settings when the save button is clicked", async () => {
    const user = userEvent.setup();
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    // Toggle a setting to enable save
    const dataToggle = screen.getAllByRole("switch")[3];
    await user.click(dataToggle);

    const saveButton = screen.getByRole("button", { name: /save privacy settings/i });
    await user.click(saveButton);
    expect(screen.getByRole("dialog", { name: "Confirm your identity" })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/users/privacy-settings",
      expect.objectContaining({ method: "PATCH" }),
    );
    await confirmStepUp(user);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/users/privacy-settings",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"dataProcessingConsent":true'),
        }),
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Privacy settings saved successfully",
    );
    expect(adminApi.requestStepUp).toHaveBeenCalledWith({
      password: "Current!Pass1",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/users/privacy-settings",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "x-step-up-token": "fresh-step-up-proof",
        }),
      }),
    );
  });

  it("shows an error toast when loading fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "An unexpected error occurred. Please try again.",
      );
    });

    expect(
      screen.getByText("An unexpected error occurred. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows an error toast when saving fails", async () => {
    const user = userEvent.setup();

    const fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(defaultSettings),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    // Toggle and save
    await user.click(screen.getAllByRole("switch")[0]);
    await user.click(screen.getByRole("button", { name: /save privacy settings/i }));
    await confirmStepUp(user);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "An unexpected error occurred. Please try again.",
      );
    });
  });

  it("displays enabled/disabled badges for each toggle", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    // 3 enabled (isDiscoverable, canReceiveReplies, showReactions), 1 disabled (dataProcessingConsent)
    const enabledBadges = screen.getAllByText("Enabled");
    const disabledBadges = screen.getAllByText("Disabled");

    expect(enabledBadges).toHaveLength(3);
    expect(disabledBadges).toHaveLength(1);
  });

  it("renders data flow categories and effective privacy posture overview", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity & Discovery Data Flow")).toBeInTheDocument();
    expect(screen.getByText("Content & Interaction Data Flow")).toBeInTheDocument();
    expect(screen.getByText("Analytics & Service Telemetry Data Flow")).toBeInTheDocument();
    expect(screen.getByText("Notification & Communication Data Flow")).toBeInTheDocument();

    expect(screen.getByText(/Effective Privacy Posture:/)).toBeInTheDocument();
    expect(screen.getByText("Effective state saved")).toBeInTheDocument();
  });

  it("links each control to its affected product behavior", async () => {
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    const searchLink = screen.getByRole("link", { name: /Public Search & Directory/i });
    expect(searchLink).toHaveAttribute("href", "/search");

    const confessionsLink = screen.getByRole("link", { name: /Confession Discussions/i });
    expect(confessionsLink).toHaveAttribute("href", "/confessions");

    const analyticsLink = screen.getByRole("link", { name: /Activity Analytics & Telemetry/i });
    expect(analyticsLink).toHaveAttribute("href", "/analytics");

    const notificationLink = screen.getByRole("link", { name: /Manage notification preferences/i });
    expect(notificationLink).toHaveAttribute("href", "/settings/notifications");
  });

  it("displays pending changes diff and allows discarding modifications", async () => {
    const user = userEvent.setup();
    render(<PrivacySettingsPage />);

    await waitFor(() => {
      expect(screen.getByText("Profile Discovery")).toBeInTheDocument();
    });

    // Toggle Profile Discovery to off
    const discoveryToggle = screen.getAllByRole("switch")[0];
    await user.click(discoveryToggle);

    expect(screen.getByText(/1 pending change/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending change \(Unsaved\)/i)).toBeInTheDocument();

    const discardButton = screen.getByRole("button", { name: /discard changes/i });
    expect(discardButton).toBeInTheDocument();

    // Click discard
    await user.click(discardButton);

    expect(screen.queryByText(/pending change/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save privacy settings/i })).toBeDisabled();
    expect(discoveryToggle).toHaveAttribute("aria-checked", "true");
  });
});
