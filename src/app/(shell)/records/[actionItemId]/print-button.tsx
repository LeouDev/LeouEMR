"use client";

/**
 * The browser's own print dialog, saving to PDF from the page as rendered:
 * the text stays selectable and searchable, which a screenshot would lose.
 * The print stylesheet (print:hidden on the header, band, back link and this
 * button; print:break-inside-avoid on each section) is what makes the
 * printed page a clean record rather than a screen capture.
 */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary px-6 py-3 text-sm">
      Download PDF
    </button>
  );
}
