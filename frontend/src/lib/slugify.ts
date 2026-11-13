// D13: the New course dialog's address, worked out from the course name. The
// Danish letters spell out (æ → ae, ø → oe, å → aa), so do ß → ss, ł → l and
// đ → d (rev 11), and œ → oe, ı → i, þ → th, ð → d, ħ → h (rev 13), which
// have no accent to drop; other accents drop, and anything else that is not
// a–z or a digit becomes one hyphen. A name with none of those gives '' and
// the superuser types the address.
// It starts from the composed form (NFC), so a decomposed å or the Ångström
// sign spells out as å does; æ, ø and å with an acute on top (ǽ, ǿ, ǻ) spell
// out too (rev 13).
export function slugFromName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[æÆǽǼ]/g, 'ae')
    .replace(/[øØǿǾ]/g, 'oe')
    .replace(/[åÅǻǺ]/g, 'aa')
    .replace(/[ßẞ]/g, 'ss')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐðÐ]/g, 'd')
    .replace(/[œŒ]/g, 'oe')
    .replace(/ı/g, 'i')
    .replace(/[þÞ]/g, 'th')
    .replace(/[ħĦ]/g, 'h')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}
