const WINDOW_CHROME = Object.freeze({
  titleBarStyle: 'hidden',
  titleBarOverlay: Object.freeze({
    color: '#11191c',
    symbolColor: '#e3ebe6',
    height: 44,
  }),
  autoHideMenuBar: true,
  backgroundColor: '#11191c',
});

function windowChromeOptions(icon) {
  return { ...WINDOW_CHROME, titleBarOverlay: { ...WINDOW_CHROME.titleBarOverlay }, ...(icon ? { icon } : {}) };
}

module.exports = { windowChromeOptions };
