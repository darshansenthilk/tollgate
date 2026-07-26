"use client";

import { useId } from "react";

interface TollgateLogoProps {
  className?: string;
}

/**
 * The gate mark — three vertical bars clipped to an arched silhouette, 18px
 * stroke, recolored to --brand (source: user-supplied logo (2).svg). Inlined
 * rather than <img src="/logo.svg"> because the design calls for it twice on
 * one page (nav + footer) — useId() gives each instance its own <clipPath>
 * id so they don't collide.
 */
export function TollgateLogo({ className }: TollgateLogoProps) {
  const clipId = useId();

  return (
    <svg viewBox="0 0 600 600" className={className} aria-hidden focusable="false">
      <defs>
        <clipPath id={clipId}>
          <path d="M 165 285 C 251 285, 266 155, 435 155 L 435 445 L 165 445 Z" />
        </clipPath>
      </defs>
      <g fill="var(--brand)">
        <g clipPath={`url(#${clipId})`}>
          <rect x="223.5" y="145" width="18" height="310" />
          <rect x="291" y="145" width="18" height="310" />
          <rect x="358.5" y="145" width="18" height="310" />
        </g>
        <path
          d="M 165 285 C 251 285, 266 155, 435 155 L 435 445 L 165 445 Z"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="18"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
