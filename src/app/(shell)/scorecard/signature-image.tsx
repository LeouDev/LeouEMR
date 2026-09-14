import { signaturePath, type Signature } from "@/lib/scorecard/signature";

/** A stored signature drawn back as vector strokes: sharp on screen and on paper. */
export function SignatureImage({ signature, className = "" }: { signature: Signature; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${signature.w} ${signature.h}`}
      role="img"
      aria-label="Signature"
      className={className}
      preserveAspectRatio="xMinYMax meet"
    >
      <path
        d={signaturePath(signature)}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
