/**
 * A tiny in-memory handoff for a GSAP Flip state captured on one page right
 * before a real client-side navigation (router.push), read once by the next
 * page after it mounts. Next.js App Router navigation does not reload the
 * JS module graph, so this module-level variable survives the route change -
 * this is what makes the authority object's shrink-into-place continuity
 * from /wallet to /verdict possible without a persistent canvas across
 * routes that don't share a layout segment.
 *
 * Carries only layout geometry (via GSAP Flip), never business data - the
 * verdict page still fetches its own real state independently.
 */
import type { Flip } from "gsap/Flip";

let pendingState: Flip.FlipState | null = null;

export function setAuthorityFlipState(state: Flip.FlipState) {
  pendingState = state;
}

export function takeAuthorityFlipState(): Flip.FlipState | null {
  const state = pendingState;
  pendingState = null;
  return state;
}
