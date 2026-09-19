/**
 * GSAP plugins (Flip included) must be explicitly registered with
 * gsap.registerPlugin() before use - without it, Flip's internal calls into
 * gsap core utilities are unbound and throw ("_toArray is not a function").
 * This is the one place that import + registration happens, memoized so it
 * only runs once no matter how many components need Flip.
 */
let flipPromise: Promise<typeof import("gsap/Flip").Flip> | null = null;

export function loadFlip() {
  if (!flipPromise) {
    flipPromise = Promise.all([import("gsap"), import("gsap/Flip")]).then(([{ gsap }, { Flip }]) => {
      gsap.registerPlugin(Flip);
      return Flip;
    });
  }
  return flipPromise;
}
