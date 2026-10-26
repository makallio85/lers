/** Each player's colour, by player id: flags, borders and the statistics lines. */
export const OWNER_COLORS = [0xe3a33b, 0xd05a5a, 0x8fb3d9, 0x9b7fbf, 0x6fae6a, 0xd98f4e, 0x5fb8b0, 0xc77aa6];

/** Chart series colours in fixed order, checked for colour-blind separation on the dark panel. */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
