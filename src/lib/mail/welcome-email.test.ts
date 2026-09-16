import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WELCOME_APPROVED_HTML } from "./welcome-approved-template";
import { firstNameOf, renderWelcomeEmail, WELCOME_PLACEHOLDERS } from "./welcome-email";

const VALUES = {
  name: "Dela Cruz, Juan",
  email: "juan.delacruz@example.com",
  role: "supervisor",
  siteUrl: "https://prior-auth-emr.vercel.app",
  helpUrl: "https://help.example.com",
  supportEmail: "support@example.com",
};

describe("firstNameOf", () => {
  it("reads the workbook's 'Last, First' the right way round", () => {
    expect(firstNameOf("Dela Cruz, Juan")).toBe("Juan");
    expect(firstNameOf("Aniban, Brandon")).toBe("Brandon");
  });

  it("takes the first word when the name is written plainly", () => {
    expect(firstNameOf("Juan Dela Cruz")).toBe("Juan");
    expect(firstNameOf("Madonna")).toBe("Madonna");
  });

  it("falls back rather than greeting nobody", () => {
    expect(firstNameOf("   ")).toBe("there");
    expect(firstNameOf(",")).toBe("there");
  });
});

describe("renderWelcomeEmail", () => {
  it("leaves no marker behind", () => {
    const { html } = renderWelcomeEmail(VALUES);
    expect(html).not.toMatch(/\{\{\s*\./);
    for (const key of WELCOME_PLACEHOLDERS) {
      expect(WELCOME_APPROVED_HTML).toContain(`{{ .${key} }}`);
    }
  });

  it("greets by first name and names the role as the sidebar does", () => {
    const { html, text } = renderWelcomeEmail(VALUES);
    expect(html).toContain("You're in, Juan!");
    expect(html).toContain("<strong>Team Leader</strong>");
    expect(text).toContain("the Team Leader role");
  });

  it("points the button at the sign-in page, without doubling the slash", () => {
    const { html } = renderWelcomeEmail({ ...VALUES, siteUrl: "https://prior-auth-emr.vercel.app/" });
    expect(html).toContain('href="https://prior-auth-emr.vercel.app/login"');
    expect(html).not.toContain("//login");
  });

  it("escapes the values that reach the template whole", () => {
    // An unknown role is passed through verbatim, and the address is printed
    // as given — both land in markup, one of them inside an href.
    const { html } = renderWelcomeEmail({
      ...VALUES,
      role: "<script>alert(1)</script>",
      email: 'a"><b>x</b>@example.com',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('a"><b>');
    expect(html).toContain("&quot;&gt;&lt;b&gt;");
  });

  it("keeps a first name to one word, so nothing else in the field is rendered", () => {
    const { html } = renderWelcomeEmail({ ...VALUES, name: '<script>alert(1)</script> Bobby, "Drop"' });
    expect(html).toContain("You're in, &quot;Drop&quot;!");
    expect(html).not.toContain("alert(1)");
  });

  it("drops the address line rather than mailing a placeholder", () => {
    expect(renderWelcomeEmail(VALUES).html).not.toContain("[company address goes here]");
    expect(renderWelcomeEmail({ ...VALUES, postalAddress: "  " }).html).not.toContain("company address");
    expect(renderWelcomeEmail({ ...VALUES, postalAddress: "1 Market St, Cebu" }).html).toContain(
      "1 Market St, Cebu",
    );
  });

  it("keeps a two-line address on two lines, without letting it carry markup", () => {
    const { html } = renderWelcomeEmail({
      ...VALUES,
      postalAddress: "Filinvest Cebu Cyberzone, Tower 4\nCebu IT Park, Apas, Cebu City, Cebu 6000",
    });
    expect(html).toContain("Filinvest Cebu Cyberzone, Tower 4<br>Cebu IT Park, Apas, Cebu City, Cebu 6000");

    // The break is the renderer's, never the value's.
    const injected = renderWelcomeEmail({ ...VALUES, postalAddress: "<b>1 Market St</b>" }).html;
    expect(injected).not.toContain("<b>1 Market St</b>");
    expect(injected).toContain("&lt;b&gt;1 Market St&lt;/b&gt;");
  });

  it("carries a plain-text alternative", () => {
    const { subject, text } = renderWelcomeEmail(VALUES);
    expect(subject).toBe("Your PA Command Center account is approved");
    expect(text).toContain("https://prior-auth-emr.vercel.app/login");
    expect(text).toContain(VALUES.email);
  });

  it("loads artwork from the app itself and nowhere else", () => {
    // Gmail strips inline <svg>, so the astronaut and rocket are hosted PNGs
    // under public/email. Every one must come from this deployment: a third
    // party serving an image in a transactional email is a read receipt for
    // whoever owns that host.
    const { html } = renderWelcomeEmail(VALUES);
    const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);

    expect(sources).toEqual([
      "https://prior-auth-emr.vercel.app/email/astronaut.png",
      "https://prior-auth-emr.vercel.app/email/rocket.png",
    ]);
    expect(html).not.toMatch(/https?:\/\/(?!prior-auth-emr|help\.example|support)/i);
  });

  it("carries no tracking pixel", () => {
    const { html } = renderWelcomeEmail(VALUES);
    // A 1x1 is the shape of a read receipt; both images are sized artwork.
    for (const tag of html.match(/<img[^>]*>/gi) ?? []) {
      expect(tag).not.toMatch(/width="1"|height="1"/);
      expect(tag).toMatch(/width="\d{2,}" height="\d{2,}"/);
    }
  });
});

describe("the template module and the file an administrator pastes", () => {
  it("are byte-identical, so neither can drift from the other", () => {
    expect(WELCOME_APPROVED_HTML).toBe(
      readFileSync("docs/email-templates/welcome-approved.html", "utf8"),
    );
  });
});
