/**
 * Menu cards per skippable group (Menu.tsx): each group is `content-visibility: auto`, so one category of hundreds
 * skips its off-screen cards. Even, so the two-column grid lines up across groups. Groups, not single cards or whole
 * sections: WebKit could not scroll either into view to tap it.
 */
export const CARD_GROUP = 12;
