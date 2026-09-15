/**
 * The app's pixel astronaut — the figure from the header scene, without
 * the syringe arm — as one reusable group: body, belt, pack, legs, boots,
 * helmet, visor and smile, drawn about the origin (head above it, boots
 * below). The caller positions and animates it with an enclosing <g>.
 * Purely decorative: no props, no state.
 */
export function AstronautFigure() {
  return (
    <g>
      <rect x={-9} y={10} width={18} height={16} fill="#eef0f3" />
      <rect x={-9} y={15} width={18} height={1.5} fill="var(--orange-500)" />
      <rect x={-11} y={11} width={4} height={10} fill="#c9ced6" />
      <rect x={-6} y={25} width={5} height={8} fill="#eef0f3" />
      <rect x={1} y={25} width={5} height={8} fill="#eef0f3" />
      <rect x={-6} y={31} width={5} height={2} fill="var(--orange-500)" />
      <rect x={1} y={31} width={5} height={2} fill="var(--orange-500)" />
      <circle cy={4} r={8} fill="#eef0f3" />
      <circle cy={4.5} r={5.5} fill="#1a3c6b" />
      <path d="M-3.5,1.5 q2,-2.5 5.5,-1.5" stroke="var(--bg)" strokeWidth={1.2} fill="none" strokeLinecap="round" />
    </g>
  );
}
