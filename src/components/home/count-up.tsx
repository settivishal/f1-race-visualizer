'use client';

import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { formatPoints as format } from '@/lib/championship';

/**
 * A number that arrives by counting to itself.
 *
 * Renders its final value first and animates from `from` after mount, so the
 * server output is the real number: a reader with no JavaScript, a crawler, and
 * the prerendered shell all see the answer rather than a zero that never moves.
 *
 * The tween writes to the node's text directly rather than through state. A
 * count-up is roughly sixty renders of one string — React state would re-render
 * the subtree for each of them, and this is a span.
 *
 * `framer-motion` is already the site's motion library, and `useReducedMotion`
 * is how the replay decides the same question — see
 * race-visualization-player.tsx. Someone who asked for less motion keeps the
 * number they already have.
 */
/**
 * Half points exist (they have been scored twice in the sport's history), so a
 * fractional total keeps one decimal and a whole one stays whole — the same
 * rule championship-fight.tsx applies to every other number beside this one.
 *
 * The rounding is imported rather than passed in: a server component cannot
 * hand a function to a client one, and the alternative — making the caller a
 * client component too — is a bundle for a rounding rule.
 */

export function CountUp({
  value,
  from = 0,
  duration = 0.9,
  className,
}: {
  value: number;
  from?: number;
  duration?: number;
  className?: string;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = node.current;
    if (!element || reduced) return;

    const controls = animate(from, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (n) => {
        element.textContent = format(Math.round(n));
      },
      onComplete: () => {
        element.textContent = format(value);
      },
    });

    return () => {
      controls.stop();
      element.textContent = format(value);
    };
  }, [value, from, duration, reduced]);

  return (
    <span ref={node} className={className}>
      {format(value)}
    </span>
  );
}
