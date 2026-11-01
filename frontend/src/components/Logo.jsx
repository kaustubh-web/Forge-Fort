import { useId } from "react";

// The ForgeFort mark (same drawing as docs/logo-mark.svg and public/favicon.svg): a fort with a
// branching workflow graph cut out of it. Coloured with currentColor, so a text-* class sets it.
// useId gives each instance its own mask id: two SVGs sharing one id on a page would clash.
export default function Logo({ className }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="#fff" />
          <path d="M8.6 17.4H16.1L23.4 13.4M16.1 17.4L23.4 21.2" fill="none" stroke="#000" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8.6" cy="17.4" r="2.1" fill="#000" />
          <circle cx="16.1" cy="17.4" r="2.3" fill="#000" />
          <circle cx="23.4" cy="13.4" r="2.5" fill="#000" />
          <circle cx="23.4" cy="21.2" r="2.5" fill="#000" />
        </mask>
      </defs>
      <path fill="currentColor" mask={`url(#${maskId})`} d="M3 4H9V8H12V4H20V8H23V4H29V28H3Z" />
    </svg>
  );
}
