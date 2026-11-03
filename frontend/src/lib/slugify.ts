// D13: the New course dialog's address, worked out from the course name. The
// Danish letters spell out (æ → ae, ø → oe, å → aa), other accents drop, and
// anything that is not a Latin letter or a digit becomes one hyphen. A name
// with none of those gives '' and the superuser types the address.
export function slugFromName(name: string): string {
  return name
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'oe')
    .replace(/[åÅ]/g, 'aa')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}
