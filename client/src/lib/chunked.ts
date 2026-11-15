/**
 * Cards per group in a long list (the menu, the staff board): each group skips rendering off screen
 * (`content-visibility`) and mounts only as it nears the screen (`LazyGroup`). 12 fills whole rows at 1, 2 or 3
 * columns. Groups, not single cards or whole sections: WebKit could not scroll either into view to tap it.
 */
export const CARD_GROUP = 12;

/** `list` cut into runs of `size` (the last may be shorter). */
export const chunked = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );
