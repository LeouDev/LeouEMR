"use client";

import { useEffect, useRef } from "react";
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "@/lib/scorecard/signature";

/**
 * A drawing surface for a signature: mouse, pen or finger. The strokes it
 * produces are in the pad's own coordinate space, whatever size it is on
 * screen, so what is stored draws back the same on the card and on paper.
 */
export function SignaturePad({
  strokes,
  onChange,
}: {
  strokes: number[][];
  onChange: (strokes: number[][]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef<number[] | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIGNATURE_WIDTH * dpr;
    canvas.height = SIGNATURE_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
    // The baseline the signature sits on, like the printed line.
    ctx.strokeStyle = "#c9c4b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, SIGNATURE_HEIGHT - 40);
    ctx.lineTo(SIGNATURE_WIDTH - 24, SIGNATURE_HEIGHT - 40);
    ctx.stroke();

    ctx.strokeStyle = "#0b1d3a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      ctx.beginPath();
      for (let i = 0; i + 1 < stroke.length; i += 2) {
        if (i === 0) ctx.moveTo(stroke[0], stroke[1]);
        ctx.lineTo(stroke[i], stroke[i + 1]);
      }
      ctx.stroke();
    }
  }, [strokes]);

  function pointOf(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * SIGNATURE_WIDTH);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * SIGNATURE_HEIGHT);
    return [Math.min(SIGNATURE_WIDTH, Math.max(0, x)), Math.min(SIGNATURE_HEIGHT, Math.max(0, y))];
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = pointOf(event);
    current.current = [x, y];
    onChange([...strokes, current.current]);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = current.current;
    if (!stroke) return;
    const [x, y] = pointOf(event);
    const lastX = stroke[stroke.length - 2];
    const lastY = stroke[stroke.length - 1];
    // A point every couple of pixels is plenty; more only bloats the stamp.
    if (Math.abs(x - lastX) + Math.abs(y - lastY) < 2) return;
    const next = [...stroke, x, y];
    current.current = next;
    onChange([...strokes.slice(0, -1), next]);
  }

  function end() {
    current.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      aria-label="Signature pad"
      className="block w-full cursor-crosshair border-2 border-ink bg-white"
      style={{ aspectRatio: `${SIGNATURE_WIDTH} / ${SIGNATURE_HEIGHT}`, touchAction: "none" }}
    />
  );
}
