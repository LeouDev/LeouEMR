"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AstronautFigure } from "@/components/astronaut-figure";
import { submitSurvey } from "./actions";

/**
 * The five questions, one screen at a time, with no way past them but
 * through.
 *
 * There is no close, no Escape handling and no link out — by design: the
 * survey is the gate, and an exit would be a skip. Signing out is still
 * possible (the page offers it) because trapping someone in a browser tab
 * is a different thing from requiring an answer, and it does not skip
 * anything: the gate is waiting at the next login.
 */

interface Question {
  kicker: string;
  prompt: string;
  /** A 1–5 or 0–10 scale, or the free-text answer. */
  kind: "scale5" | "nps" | "text";
  lowLabel?: string;
  highLabel?: string;
}

const QUESTIONS: Question[] = [
  {
    kicker: "Question 1 of 5",
    prompt: "How satisfied are you with your overall experience using our website?",
    kind: "scale5",
    lowLabel: "1 · Very dissatisfied",
    highLabel: "5 · Very satisfied",
  },
  {
    kicker: "Question 2 of 5",
    prompt: "How easy was it to navigate and use our website?",
    kind: "scale5",
    lowLabel: "1 · Very difficult",
    highLabel: "5 · Very easy",
  },
  {
    kicker: "Question 3 of 5",
    prompt: "How easy was it to find the information or complete the task you were looking for?",
    kind: "scale5",
    lowLabel: "1 · Very difficult",
    highLabel: "5 · Very easy",
  },
  {
    kicker: "Question 4 of 5",
    prompt: "On a scale of 0–10, how likely are you to recommend our website to a friend or colleague?",
    kind: "nps",
    lowLabel: "Not at all likely",
    highLabel: "Extremely likely",
  },
  {
    kicker: "Question 5 of 5",
    prompt: "What is the one thing we could improve about your experience on our website?",
    kind: "text",
  },
];

export const STEPS = QUESTIONS.length;

type Answers = {
  q1Overall: number | null;
  q2Ease: number | null;
  q3Findability: number | null;
  q4Nps: number | null;
  q5Feedback: string;
};

const EMPTY: Answers = { q1Overall: null, q2Ease: null, q3Findability: null, q4Nps: null, q5Feedback: "" };
const KEYS = ["q1Overall", "q2Ease", "q3Findability", "q4Nps"] as const;

/** Whether the step the person is on has an answer yet. Step 5 needs real text. */
export function canAdvance(step: number, answers: Answers): boolean {
  if (step === STEPS) return answers.q5Feedback.trim().length > 0;
  const key = KEYS[step - 1];
  return key !== undefined && answers[key] !== null;
}

export function SurveyWizard({ signOut }: { signOut: React.ReactNode }) {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0 is the intro; 1–5 are the questions.
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Leave for the dashboard once the thank-you has been read, not before.
   *
   * `router.refresh()` cannot be called the moment the answers are filed:
   * it re-renders this route's server components, and `/survey` redirects
   * to the dashboard as soon as the gate is satisfied — so the refresh
   * carried the person away before the completion screen had rendered, and
   * a bare `setTimeout` then fired against an unmounted component.
   * Navigating and refreshing together, after the pause, does both jobs:
   * the dashboard is fetched fresh rather than from the client cache, which
   * still holds the redirect that sent them here.
   */
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      router.replace("/dashboard");
      router.refresh();
    }, 1600);
    return () => clearTimeout(timer);
  }, [done, router]);

  const set = (patch: Partial<Answers>) => {
    setAnswers((current) => ({ ...current, ...patch }));
    setError(null);
  };

  function advance() {
    if (step < STEPS) {
      setStep(step + 1);
      return;
    }
    startTransition(async () => {
      const result = await submitSurvey({
        q1Overall: answers.q1Overall,
        q2Ease: answers.q2Ease,
        q3Findability: answers.q3Findability,
        q4Nps: answers.q4Nps,
        q5Feedback: answers.q5Feedback.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (step === 0) return <Intro onStart={() => setStep(1)} />;

  if (done) {
    return (
      <Frame step={STEPS} label="Complete" signOut={signOut}>
        <div className="flex h-14 w-14 items-center justify-center border-2 border-orange-brand">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--orange-500)" strokeWidth={3} aria-hidden>
            <path d="M4 12l5 5L20 6" />
          </svg>
        </div>
        <h2 className="mt-6 text-[clamp(28px,4vw,40px)] leading-tight font-extrabold text-ink">
          Thanks for your feedback.
        </h2>
        <p className="mt-4 max-w-[44ch] text-[17px] text-muted">
          Your answers have been recorded. Taking you to your dashboard…
        </p>
      </Frame>
    );
  }

  const question = QUESTIONS[step - 1];
  const ready = canAdvance(step, answers);

  return (
    <Frame step={step} label={`Step ${step} of ${STEPS}`} signOut={signOut}>
      <p className="text-[13px] font-bold tracking-[0.06em] text-orange-brand uppercase">{question.kicker}</p>
      <h2 className="mt-3 text-[clamp(26px,4vw,36px)] leading-tight font-extrabold text-ink">{question.prompt}</h2>

      <div className="mt-8">
        {question.kind === "text" ? (
          <textarea
            rows={5}
            value={answers.q5Feedback}
            onChange={(event) => set({ q5Feedback: event.target.value })}
            placeholder="Type your answer…"
            aria-label={question.prompt}
            className="w-full resize-y border-2 border-ink bg-surface px-3 py-2.5 text-[15px] text-ink outline-none"
          />
        ) : (
          <Scale
            from={question.kind === "nps" ? 0 : 1}
            to={question.kind === "nps" ? 10 : 5}
            value={question.kind === "nps" ? answers.q4Nps : answers[KEYS[step - 1]]}
            onPick={(value) =>
              set(question.kind === "nps" ? { q4Nps: value } : { [KEYS[step - 1]]: value })
            }
            prompt={question.prompt}
          />
        )}
        {question.lowLabel && (
          <div className="mt-2.5 flex justify-between text-[13px] text-muted">
            <span>{question.lowLabel}</span>
            <span>{question.highLabel}</span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-6 border-2 border-fail bg-fail-bg px-4 py-2.5 text-sm font-semibold text-fail">
          {error}
        </p>
      )}

      <div className="mt-12 flex justify-between">
        {/* Hidden rather than disabled on the first question, per the brief. */}
        <button
          type="button"
          onClick={() => setStep(step - 1)}
          className={`btn-secondary px-5 py-2.5 text-sm ${step === 1 ? "invisible" : ""}`}
        >
          Back
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={!ready || pending}
          className="btn-primary px-5 py-2.5 text-sm"
        >
          {pending ? "Submitting…" : step === STEPS ? "Submit" : "Next"}
        </button>
      </div>
    </Frame>
  );
}

/** One row of numbered buttons, the answer being which one is filled. */
function Scale({
  from,
  to,
  value,
  onPick,
  prompt,
}: {
  from: number;
  to: number;
  value: number | null;
  onPick: (value: number) => void;
  prompt: string;
}) {
  const options = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const wide = options.length > 6;
  return (
    <div role="radiogroup" aria-label={prompt} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const picked = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={picked}
            onClick={() => onPick(option)}
            className={`${wide ? "h-11 w-11 text-sm" : "h-13 w-13 text-base"} border-2 font-mono font-extrabold tabular-nums transition ${
              picked
                ? "border-orange-brand bg-orange-brand text-white"
                : "border-line bg-surface text-ink hover:border-ink"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** The wizard's chrome: the label, the rule and the five progress segments. */
function Frame({
  step,
  label,
  children,
  signOut,
}: {
  step: number;
  label: string;
  children: React.ReactNode;
  signOut: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <div className="flex items-center justify-between px-[8vw] pt-6 pb-5">
        <p className="text-[15px] font-bold tracking-[0.06em] text-ink uppercase">Quick Survey</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <div className="px-[8vw]">
        <div className="border-t-2 border-ink" />
        <div className="mt-4 flex gap-1">
          {Array.from({ length: STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 ${i < step ? "bg-orange-brand" : "bg-cream-dark"}`}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-[8vw] pt-10 pb-20">
        <div className="w-full max-w-[640px]">{children}</div>
      </div>
      <div className="px-[8vw] pb-8">{signOut}</div>
    </div>
  );
}

/**
 * The star field, fixed rather than random.
 *
 * A `Math.random()` field renders one way on the server and another in the
 * browser, and React replaces the whole subtree on that mismatch — a
 * flicker on the first screen anyone sees. Written out, it is the same sky
 * every time. [cx, cy, r, seconds, delay] in the scene's own 1600×900 space.
 */
const STARS: Array<[number, number, number, number, number]> = [
  [60, 110, 2, 3.2, 0], [180, 610, 1.5, 2.6, 0.9], [270, 280, 3, 4.1, 0.4], [370, 760, 1.5, 3.4, 1.7],
  [460, 70, 2, 2.9, 0.2], [545, 470, 1.5, 3.8, 1.1], [655, 200, 1.5, 2.4, 0.6], [735, 685, 3, 4.4, 1.4],
  [830, 360, 1.5, 3.1, 0.3], [925, 125, 2, 2.7, 1.9], [1010, 795, 1.5, 3.6, 0.8], [1105, 520, 1.5, 4.2, 0.1],
  [1185, 235, 3, 2.8, 1.2], [1265, 650, 1.5, 3.3, 0.5], [1345, 395, 2, 3.9, 1.6], [1425, 160, 1.5, 2.5, 1.0],
  [1490, 560, 1.5, 4.0, 0.7], [110, 405, 1.5, 3.5, 1.3], [225, 830, 2, 2.9, 0.4], [415, 520, 1.5, 3.7, 1.8],
  [610, 720, 1.5, 2.6, 0.9], [785, 55, 1.5, 4.3, 0.2], [1055, 325, 2, 3.0, 1.5], [1230, 55, 1.5, 3.4, 0.6],
  [1540, 305, 1.5, 2.7, 1.1], [320, 180, 1.5, 3.8, 0.3], [880, 595, 1.5, 2.5, 1.7], [1375, 760, 2, 4.1, 0.8],
  [500, 300, 1.5, 3.3, 1.4], [700, 440, 1.5, 2.8, 0.5], [1150, 860, 1.5, 3.6, 1.0], [40, 700, 1.5, 3.1, 1.6],
];

/**
 * The sun and four planets, drawn as SVG circles.
 *
 * Not CSS shapes: this app squares `rounded-full` on purpose — the
 * Modernist theme has no radius anywhere — so a `rounded-full` div renders
 * as a box, which is exactly what the first cut of this screen showed. A
 * circle that has to be a circle belongs in an SVG, which is also how the
 * app's other space art is drawn (see loading-scene.tsx).
 *
 * One viewBox at `xMidYMid slice` rather than `none`, too: stretching the
 * viewBox to the viewport turns every circle into an ellipse, stars
 * included.
 */
function Planets() {
  return (
    <>
      {/* The sun, top right, with its corona rings. */}
      <g style={{ animation: "drift 9s ease-in-out infinite" }}>
        <circle cx={1430} cy={150} r={128} fill="var(--orange-500)" opacity={0.08} />
        <circle cx={1430} cy={150} r={104} fill="none" stroke="var(--orange-500)" strokeWidth={1.5} opacity={0.35} />
        <circle cx={1430} cy={150} r={86} fill="var(--orange-500)" />
      </g>

      {/* Jupiter: the banded giant, its stripes clipped to the disc. */}
      <g style={{ animation: "drift 13s ease-in-out infinite" }}>
        <clipPath id="survey-jupiter">
          <circle cx={1210} cy={585} r={112} />
        </clipPath>
        <circle cx={1210} cy={585} r={112} fill="#d9a06a" />
        <g clipPath="url(#survey-jupiter)">
          <rect x={1098} y={497} width={224} height={22} fill="#b8784a" opacity={0.85} />
          <rect x={1098} y={533} width={224} height={14} fill="#f0c89a" opacity={0.7} />
          <rect x={1098} y={561} width={224} height={26} fill="#b8784a" opacity={0.75} />
          <rect x={1098} y={601} width={224} height={16} fill="#f0c89a" opacity={0.6} />
          <rect x={1098} y={629} width={224} height={24} fill="#a96a3f" opacity={0.8} />
          <ellipse cx={1255} cy={574} rx={30} ry={16} fill="var(--orange-600)" />
          {/* The terminator, so it reads as lit from the sun above right. */}
          <circle cx={1150} cy={640} r={140} fill="var(--navy-900)" opacity={0.28} />
        </g>
        <circle cx={1210} cy={585} r={112} fill="none" stroke="var(--bg)" strokeWidth={2} opacity={0.55} />
      </g>

      {/* Saturn, rings tilted. */}
      <g transform="rotate(-18 820 175)" style={{ animation: "drift 11s ease-in-out infinite" }}>
        <ellipse cx={820} cy={175} rx={112} ry={26} fill="none" stroke="var(--orange-500)" strokeWidth={4} opacity={0.9} />
        <ellipse cx={820} cy={175} rx={90} ry={18} fill="none" stroke="var(--bg)" strokeWidth={2} opacity={0.5} />
        <circle cx={820} cy={175} r={54} fill="var(--navy-500)" />
        <circle cx={820} cy={175} r={54} fill="none" stroke="var(--bg)" strokeWidth={2} opacity={0.6} />
      </g>

      {/* A cratered rock, bottom right. */}
      <g style={{ animation: "drift 15s ease-in-out infinite" }}>
        <circle cx={1478} cy={772} r={46} fill="var(--navy-400)" />
        <circle cx={1465} cy={757} r={10} fill="var(--navy-600)" opacity={0.7} />
        <circle cx={1492} cy={784} r={7} fill="var(--navy-600)" opacity={0.6} />
        <circle cx={1470} cy={792} r={5} fill="var(--navy-600)" opacity={0.5} />
        <circle cx={1478} cy={772} r={46} fill="none" stroke="var(--bg)" strokeWidth={1.5} opacity={0.4} />
      </g>

      {/* A far, small one, as a crescent. */}
      <g style={{ animation: "drift 17s ease-in-out infinite" }}>
        <clipPath id="survey-crescent">
          <circle cx={1010} cy={112} r={30} />
        </clipPath>
        <circle cx={1010} cy={112} r={30} fill="#eef0f3" opacity={0.85} />
        <g clipPath="url(#survey-crescent)">
          <circle cx={996} cy={124} r={30} fill="var(--navy-800)" opacity={0.75} />
        </g>
      </g>
    </>
  );
}

/**
 * The opening screen: the app's own astronaut over a navy sky.
 *
 * Built here rather than through `SpaceScene`, which login and the MFA step
 * both render — its copy block, type scale and half-panel proportions are
 * theirs, and reshaping it to fit one full-bleed screen would move three
 * pages nobody asked to change. The astronaut is the shared figure.
 */
function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-800">
      {/* One scene, one coordinate space: stars, planets and the astronaut
          all live in it, so nothing drifts out of proportion with anything
          else as the viewport changes shape. */}
      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <g fill="var(--bg)">
          {STARS.map(([cx, cy, r, dur, delay]) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={r}
              style={{ animation: `twinkle ${dur}s ease-in-out ${delay}s infinite` }}
            />
          ))}
        </g>

        <Planets />

        <g transform="translate(250,700) scale(4.2)" style={{ animation: "drift 6s ease-in-out infinite" }}>
          <AstronautFigure />
        </g>
      </svg>

      <div className="relative z-2 flex min-h-screen flex-col justify-center px-[8vw] py-16">
        <div className="fade-up">
          <p className="text-sm font-bold tracking-[0.08em] text-orange-brand uppercase">
            Before you continue
          </p>
          <h1 className="mt-4 max-w-[14ch] text-[clamp(36px,7vw,72px)] leading-[1.02] font-extrabold text-cream">
            Hey, help us improve.
          </h1>
          <p className="mt-5 max-w-[44ch] text-lg text-cream/75">
            Five quick questions before you get to your dashboard.
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="mt-10 w-fit border-2 border-cream px-7 py-3.5 text-sm font-bold tracking-[0.04em] text-cream uppercase transition hover:bg-cream hover:text-navy-800"
        >
          Start survey →
        </button>
      </div>
    </div>
  );
}
