import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/crm", () => ({ syncLead: vi.fn() }));

import { decideGateReply, extractEmail, MAX_EMAIL_ATTEMPTS } from "@/lib/email-gate";
import { kitSubscriberBody } from "@/lib/crm/kit";

describe("email gate", () => {
  it("finds an email inside a casual reply and lowercases it", () => {
    expect(extractEmail("sure! it's Sam.Lee+ig@Mail.co.uk.")).toBe("sam.lee+ig@mail.co.uk");
    expect(extractEmail("kevin@kevinfernandes.me")).toBe("kevin@kevinfernandes.me");
  });

  it("does not mistake handles or half-addresses for an email", () => {
    for (const text of ["@claudepreneur", "my email is sam at gmail", "sam@gmail", "", null]) {
      expect(extractEmail(text)).toBeNull();
    }
  });

  it("retries, then gives up after the configured number of replies without an email", () => {
    expect(decideGateReply("what is this?", 0)).toEqual({ kind: "retry" });
    expect(decideGateReply("no", MAX_EMAIL_ATTEMPTS - 1)).toEqual({ kind: "give_up" });
    expect(decideGateReply("ok sam@x.io", 5)).toEqual({ kind: "captured", email: "sam@x.io" });
  });

  it("sends Kit only the fields it has", () => {
    expect(kitSubscriberBody({ email: "sam@x.io" })).toEqual({ email_address: "sam@x.io" });
    expect(kitSubscriberBody({ email: "sam@x.io", firstName: "Sam", fields: { instagram: "sam" } })).toEqual({
      email_address: "sam@x.io",
      first_name: "Sam",
      fields: { instagram: "sam" },
    });
  });
});
