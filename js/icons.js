// FORGE inline icons · Tabler Icons (MIT, https://tabler.io/icons), outline set.
// Inlined so the app needs no icon font or network fetch.
const PATHS = {
  "home": "<path d=\"M5 12l-2 0l9 -9l9 9l-2 0\"/><path d=\"M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7\"/><path d=\"M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6\"/>",
  "calendar": "<path d=\"M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12\"/><path d=\"M16 3v4\"/><path d=\"M8 3v4\"/><path d=\"M4 11h16\"/>",
  "list": "<path d=\"M9 6l11 0\"/><path d=\"M9 12l11 0\"/><path d=\"M9 18l11 0\"/><path d=\"M5 6l0 .01\"/><path d=\"M5 12l0 .01\"/><path d=\"M5 18l0 .01\"/>",
  "apple": "<path d=\"M4 11.319c0 3.102 .444 5.319 2.222 7.978c1.351 1.797 3.156 2.247 5.08 .988c.426 -.268 .97 -.268 1.397 0c1.923 1.26 3.728 .809 5.079 -.988c1.778 -2.66 2.222 -4.876 2.222 -7.977c0 -2.661 -1.99 -5.32 -4.444 -5.32c-1.267 0 -2.41 .693 -3.22 1.44a.5 .5 0 0 1 -.672 0c-.809 -.746 -1.953 -1.44 -3.22 -1.44c-2.454 0 -4.444 2.66 -4.444 5.319\"/><path d=\"M7 12c0 -1.47 .454 -2.34 1.5 -3\"/><path d=\"M12 7c0 -1.2 .867 -4 3 -4\"/>",
  "chart-bar": "<path d=\"M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6\"/><path d=\"M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10\"/><path d=\"M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14\"/><path d=\"M4 20h14\"/>",
  "star": "<path d=\"M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245\"/>",
  "flame": "<path d=\"M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.294 -2.333 5.588c0 3.704 3.134 6.706 7 6.706c3.866 0 7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235\"/>",
  "shoe": "<path d=\"M4 6h5.426a1 1 0 0 1 .863 .496l1.064 1.823a3 3 0 0 0 1.896 1.407l4.677 1.114a4 4 0 0 1 3.074 3.89v2.27a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10a1 1 0 0 1 1 -1\"/><path d=\"M14 13l1 -2\"/><path d=\"M8 18v-1a4 4 0 0 0 -4 -4h-1\"/><path d=\"M10 12l1.5 -3\"/>",
  "building-arch": "<path d=\"M3 21l18 0\"/><path d=\"M4 21v-15a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v15\"/><path d=\"M9 21v-8a3 3 0 0 1 6 0v8\"/>",
  "tent": "<path d=\"M11 14l4 6h6l-9 -16l-9 16h6l4 -6\"/>",
  "mountain": "<path d=\"M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612\"/><path d=\"M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2\"/>",
  "sun": "<path d=\"M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\"/><path d=\"M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7\"/>",
  "trees": "<path d=\"M16 5l3 3l-2 1l4 4l-3 1l4 4h-9\"/><path d=\"M15 21l0 -3\"/><path d=\"M8 13l-2 -2\"/><path d=\"M8 12l2 -2\"/><path d=\"M8 21v-13\"/><path d=\"M5.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4l-.176 -.005\"/>",
  "building-castle": "<path d=\"M15 19v-2a3 3 0 0 0 -6 0v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14h4v3h3v-3h4v3h3v-3h4v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1\"/><path d=\"M3 11l18 0\"/>",
  "player-pause": "<path d=\"M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12\"/><path d=\"M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12\"/>",
  "player-play": "<path d=\"M7 4v16l13 -8l-13 -8\"/>",
  "trash": "<path d=\"M4 7l16 0\"/><path d=\"M10 11l0 6\"/><path d=\"M14 11l0 6\"/><path d=\"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12\"/><path d=\"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3\"/>",
  "plus": "<path d=\"M12 5l0 14\"/><path d=\"M5 12l14 0\"/>"
};

export function icon(name, size = 20) {
  const inner = PATHS[name] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function iconEl(name, size = 20, cls = 'icon') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = icon(name, size);
  return span;
}
