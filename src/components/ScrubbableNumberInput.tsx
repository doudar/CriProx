import { useRef, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: number;
  onValueChange: (value: number) => void;
};

/** Drag horizontally to adjust; a click still focuses the field for typing. */
export function ScrubbableNumberInput({ value, onValueChange, ...props }: Props) {
  const drag = useRef<{ x: number; value: number; moved: boolean } | null>(null);
  const clamp = (n: number) =>
    Math.min(
      props.max === undefined ? Infinity : Number(props.max),
      Math.max(props.min === undefined ? -Infinity : Number(props.min), n),
    );
  return (
    <input
      {...props}
      type="number"
      value={value}
      style={{
        cursor: props.disabled ? undefined : 'ew-resize',
        touchAction: 'pan-y',
        ...props.style,
      }}
      onChange={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (Number.isFinite(next)) onValueChange(clamp(next));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || props.disabled || props.readOnly) return;
        drag.current = { x: event.clientX, value, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const distance = event.clientX - start.x;
        if (!start.moved && Math.abs(distance) < 4) return;
        start.moved = true;
        event.preventDefault();
        const step = props.step === undefined || props.step === 'any' ? 1 : Number(props.step);
        onValueChange(clamp(Number((start.value + Math.trunc(distance / 4) * step).toFixed(6))));
      }}
      onPointerUp={(event) => {
        if (drag.current?.moved) event.preventDefault();
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
