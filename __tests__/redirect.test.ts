import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    trackedLink: {
      findUnique: vi.fn(),
    },
    linkClick: {
      create: vi.fn(),
    },
    workflowRun: {
      findUnique: vi.fn(),
    },
    workflowRunEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { GET } from "../app/r/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tracked link redirect route", () => {
  it("logs a workspace-isolated click and redirects to the destination", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: {
        instagramAccountId: "instagram_account_123",
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/abc123", {
        headers: {
          "user-agent": "vitest",
          referer: "https://instagram.com/",
          "x-forwarded-for": "203.0.113.10",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offer");
    expect(mockPrisma.trackedLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc123" },
      select: expect.any(Object),
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_123",
        automationId: "automation_123",
        instagramAccountId: "instagram_account_123",
        trackedLinkId: "link_123",
        userAgent: "vitest",
        referrer: "https://instagram.com/",
      }),
    });
  });

  it("stores a valid recipient token and ignores a malformed one", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: { instagramAccountId: "instagram_account_123" },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});
    const token = "AbCdEfGhIjKlMnOpQrSt_-";

    for (const [query, expected] of [
      [`?r=${token}`, token],
      ["?r=not-a-token", null],
      ["", null],
    ] as const) {
      const response = await GET(
        new Request(`https://manychat-alternative.com/r/abc123${query}`) as Parameters<
          typeof GET
        >[0],
        { params: Promise.resolve({ slug: "abc123" }) }
      );

      expect(response.headers.get("location")).toBe("https://example.com/offer");
      expect(mockPrisma.linkClick.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ recipientHash: expected }),
      });
    }
  });

  it("redirects unknown slugs to the homepage without logging a click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);

    const response = await GET(
      new Request("https://manychat-alternative.com/r/missing") as Parameters<
        typeof GET
      >[0],
      { params: Promise.resolve({ slug: "missing" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://manychat-alternative.com/");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
  });

  it("a workflow link (no automation): a link_clicked event on its run, no LinkClick, then the redirect", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_wf",
      workspaceId: "workspace_123",
      automationId: null,
      destinationUrl: "https://kevin.link/vault",
      runId: "run_1",
      nodeId: "link",
      resourceSlug: "script-vault",
      automation: null,
    });
    mockPrisma.workflowRun.findUnique.mockResolvedValue({ id: "run_1", workspaceId: "workspace_123", workflowId: "wf_1", versionId: "wf_1_v1" });
    mockPrisma.workflowRunEvent.create.mockResolvedValue({});

    const response = await GET(new Request("https://app.test/r/wfslug?r=AbCdEfGhIjKlMnOpQrSt_-") as Parameters<typeof GET>[0], { params: Promise.resolve({ slug: "wfslug" }) });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://kevin.link/vault");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
    expect(mockPrisma.workflowRunEvent.create).toHaveBeenCalledWith({
      data: { workspaceId: "workspace_123", workflowId: "wf_1", versionId: "wf_1_v1", runId: "run_1", nodeId: "link", kind: "link_clicked", data: { slug: "script-vault", link: "link_wf" } },
    });
  });

  it("a workflow click that can't be logged still redirects", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({ id: "l", workspaceId: "w", automationId: null, destinationUrl: "https://kevin.link/vault", runId: "run_1", nodeId: "link", resourceSlug: null, automation: null });
    mockPrisma.workflowRun.findUnique.mockRejectedValue(new Error("db down"));
    const response = await GET(new Request("https://app.test/r/x") as Parameters<typeof GET>[0], { params: Promise.resolve({ slug: "x" }) });
    expect(response.headers.get("location")).toBe("https://kevin.link/vault");
  });
});
