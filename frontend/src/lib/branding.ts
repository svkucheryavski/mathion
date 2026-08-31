// Branding seam — the in-app rendered product name.
//
// Single source for the app name shown inside the running app. This slice wires
// AppHeader to it; index.html's <title> and other name sites migrate onto this
// constant in the branding slice. A later white-label slice backs PRODUCT_NAME
// with the superuser Admin-page branding setting (and may promote it to a store
// then, at which point consumers that need live updates subscribe to the store).
export const PRODUCT_NAME = 'Mathion';
