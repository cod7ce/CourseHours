import '@testing-library/dom';

// jsdom 没有这些，组件里用到就会炸
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
