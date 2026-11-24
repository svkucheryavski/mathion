# Rules for interactive apps

An interactive app is one JavaScript file that an admin uploads to an app item. Mathion runs it in a sandboxed frame on the student page and in the editor preview. Apps that follow these rules look right in both places.

1. **One file.** Everything the app needs (code, styles, images as data URLs, fonts) is inside the one `.js` file.
2. **Mount into `#app-root`.** The page gives the app an empty `<div id="app-root">` that already fills the frame. Put everything inside it.
3. **Fill it.** Use 100 % of `#app-root`'s width and height, and lay out from the size you get (for example with CSS flex or grid, or by reading the size and redrawing on resize). Do not set a fixed pixel size for the whole app.
4. **Design for 16:9.** The frame is always 16:9. On the student page it is never smaller than about 800 × 450 and grows with the window's height. The editor preview can be smaller.
5. **No network.** The sandbox blocks every request: no `fetch`, no external scripts, styles, fonts or images. Data the app needs goes in the file.
6. **Background.** The frame is white where the app paints nothing; paint your own background if you need another.

Students whose window is narrower than 800 px (phones, very small windows) do not get the app at all. They see "This app needs a larger screen. Open this page on a laptop or desktop computer." and the item is not marked covered until they open it on a larger screen.

The Graasta apps in `graasta-mathion/` already follow these rules: `prelude.js` mounts Graasta's container inside `#app-root` and sets graasta.com's font sizes.
